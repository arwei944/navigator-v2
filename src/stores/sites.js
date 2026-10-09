import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import SEED_SITES from '../../api/sites-data.json'
import { encodeStored, decodeStored } from '@/utils/storeVersioning'
import { rankSites } from '@/utils/search'
import { useCategoriesStore } from '@/stores/categories'
import { useClicksStore } from '@/stores/clicks'

const OVERLAY_KEY = 'nav-sites-overlay'
const TRASH_KEY = 'nav-sites-trash'

/**
 * 本地覆盖层：云端数据是基底，访客自己的增 / 改 / 删 / 排序叠加其上并持久化。
 *
 * 没有这一层时，30 秒轮询的 applyCloudData 会用云端数组整体替换 sites，
 * 访客新增的站点、改过的字段、删掉的条目会被全部冲掉（只有 visitCount 侥幸保留）。
 * 云端下架的站点不在基底里、也不在覆盖层里，自然从视图消失 —— 下架仍能正常传导。
 */
function loadOverlay() {
  const d = decodeStored(OVERLAY_KEY, localStorage.getItem(OVERLAY_KEY), null)
  return {
    adds: Array.isArray(d?.adds) ? d.adds : [],
    edits: d?.edits && typeof d.edits === 'object' ? d.edits : {},
    deletes: Array.isArray(d?.deletes) ? d.deletes : [],
    order: Array.isArray(d?.order) ? d.order : [],
    visits: d?.visits && typeof d.visits === 'object' ? d.visits : {},
  }
}

export const useSitesStore = defineStore('sites', () => {
  // 分类表是动态的（云端可下发自定义分类），域 / 子分类的判定必须走 store 而非静态常量，
  // 否则后台新增的分类在「整域筛选」里会被漏掉。
  const categoriesStore = useCategoriesStore()
  // 点击量是**云端全局口径**（所有访客的总和），与本地 visitCounts 是两回事
  const clicksStore = useClicksStore()

  // 云端基底（种子数据只是首屏兜底，拉到云端后即被替换）
  const cloudSites = ref([...SEED_SITES])
  // 渲染用列表 = 基底 + 覆盖层，由 rebuild() 维护，不要直接改它
  const sites = ref([])

  const overlay = loadOverlay()
  const localAdds = ref(overlay.adds)
  const localEdits = ref(overlay.edits)
  const localDeletes = ref(overlay.deletes)
  const localOrder = ref(overlay.order)
  const visitCounts = ref(overlay.visits)

  const cloudVersion = ref(0)
  const cloudLoaded = ref(false)
  let pollTimer = null
  const searchQuery = ref('')
  const currentCategory = ref('all')
  // 用途筛选（Axis 4）：与分类正交，可跨分类聚合「所有查资料站」
  const currentPurpose = ref('all')
  const sortBy = ref('default')
  // 是否处于「归档」范围（由 App 按路由下发）
  const archivedScope = ref(false)
  const viewMode = ref('grid') // grid | list

  // 回收站（持久化，否则刷新后「恢复」就没了）
  const storedTrash = decodeStored(TRASH_KEY, localStorage.getItem(TRASH_KEY), [])
  const trash = ref(Array.isArray(storedTrash) ? storedTrash : [])

  // 批量选择 / 手动拖拽排序（工具栏移出列表后，两者需跨组件共享）
  const batchMode = ref(false)
  const dragEnabled = ref(false)
  const selectedIds = ref(new Set())

  // 正在高亮的卡片 id：跨组件共享（App 发起 → SiteCard 描边 → CardsContainer 滚动定位）
  const highlightSiteId = ref('')
  let highlightTimer = null

  function highlightSite(id) {
    clearTimeout(highlightTimer)
    highlightSiteId.value = id || ''
    if (!id) return
    // 自动消失，避免用户滚动时还挂着一圈描边
    highlightTimer = setTimeout(() => { highlightSiteId.value = '' }, 2500)
  }

  function clearHighlight() {
    clearTimeout(highlightTimer)
    highlightSiteId.value = ''
  }

  // 分类 + 用途筛选后的列表（不含搜索词），作为页面搜索框的检索基底。
  // currentCategory 有三种取值：'all'（不筛）/ 域 id（整域）/ 子分类 id（单个分类）。
  // 用途（currentPurpose）是正交的第二把筛子，叠加在分类结果之上。
  const categorySites = computed(() => {
    // 「归档」是范围轴，不是筛选项：只有站在归档范围里才看得到归档站，
    // 其余范围（全部 / 收藏 / 最近 / 搜索）一律不进列表 —— 归档的语义就是
    // 「这条站我不再日常用，但别删」，它不该继续占正常视野。
    let list = sites.value.filter(s => (archivedScope.value ? s.archived === true : s.archived !== true))
    const v = currentCategory.value
    if (v && v !== 'all') {
      if (categoriesStore.isDomainScope(v)) {
        const ids = new Set(categoriesStore.categoriesOfDomain(v).map(c => c.id))
        list = list.filter(s => ids.has(s.categoryId))
      } else {
        list = list.filter(s => s.categoryId === v)
      }
    }
    const p = currentPurpose.value
    if (p && p !== 'all') list = list.filter(s => Array.isArray(s.purposes) && s.purposes.includes(p))
    return list
  })

  // 点击量走云端全局口径（clicksStore.countFor），不再用本机 visitCount 冒充热度 ——
  // 单人设备的访问次数无法代表站点在全网的热度，两者口径必须分开
  const SORT_COMPARATORS = {
    'name-asc': (a, b) => a.name.localeCompare(b.name),
    'name-desc': (a, b) => b.name.localeCompare(a.name),
    'clicks': (a, b) => clicksStore.countFor(b.id) - clicksStore.countFor(a.id),
    'newest': (a, b) => b.createdAt - a.createdAt
  }

  function applySort(list, mode) {
    const cmp = SORT_COMPARATORS[mode]
    return cmp ? [...list].sort(cmp) : [...list]
  }

  const filteredSites = computed(() => {
    const q = searchQuery.value.trim()

    // 有搜索词：相关性排序说了算。显式排序只作同分并列时的次序，
    // 绝不整体重排——否则选「名称降序」会把最相关的站点挤到后面。
    if (q) {
      return rankSites(categorySites.value, q, { tieBreak: SORT_COMPARATORS[sortBy.value] })
    }

    const list = applySort(categorySites.value, sortBy.value)
    // 置顶：把「每天都要用」的几个站钉在当前列表最前。
    // **只在不搜索时生效** —— 搜索是相关性说了算，把钉住的站插到最相关结果之前会骗人。
    if (!list.some(s => s.pinned)) return list
    return [...list.filter(s => s.pinned), ...list.filter(s => !s.pinned)]
  })

  // ── 覆盖层落盘与视图重建 ──
  function saveOverlay() {
    localStorage.setItem(OVERLAY_KEY, encodeStored({
      adds: localAdds.value,
      edits: localEdits.value,
      deletes: localDeletes.value,
      order: localOrder.value,
      visits: visitCounts.value,
    }))
  }

  function saveTrash() {
    localStorage.setItem(TRASH_KEY, encodeStored(trash.value))
  }

  /** 用「云端基底 + 本地覆盖层」重新拼出渲染用的列表 */
  function rebuild() {
    const deleted = new Set(localDeletes.value)
    const visits = visitCounts.value
    const withVisit = s => ({ ...s, visitCount: visits[s.id] ?? s.visitCount ?? 0 })

    const base = cloudSites.value
      .filter(s => !deleted.has(s.id))
      .map(s => withVisit(localEdits.value[s.id] ? { ...s, ...localEdits.value[s.id] } : s))
    const adds = localAdds.value.filter(s => !deleted.has(s.id)).map(withVisit)

    let list = [...base, ...adds]

    // localOrder 只描述这批 id 的相对顺序，未登记的站点（如云端新收录的）保持原有位置
    if (localOrder.value.length) {
      const pos = new Map(localOrder.value.map((id, i) => [id, i]))
      list = list
        .map((site, i) => ({ site, i }))
        .sort((a, b) => {
          const pa = pos.has(a.site.id) ? pos.get(a.site.id) : Infinity
          const pb = pos.has(b.site.id) ? pos.get(b.site.id) : Infinity
          return pa === pb ? a.i - b.i : pa - pb
        })
        .map(x => x.site)
    }

    sites.value = list
  }

  function addSite(site) {
    const now = Date.now()
    const created = {
      id: now.toString(36) + Math.random().toString(36).slice(2, 6),
      sortOrder: cloudSites.value.length + localAdds.value.length,
      visitCount: 0,
      createdAt: now,
      updatedAt: now,
      ...site
    }
    localAdds.value.push(created)
    rebuild()
    saveOverlay()
    // 自动添加需要拿这条记录去做预览卡片与撤销，故返回创建结果
    return created
  }

  function updateSite(id, data) {
    const patch = { ...data, updatedAt: Date.now() }
    const idx = localAdds.value.findIndex(s => s.id === id)
    if (idx !== -1) localAdds.value[idx] = { ...localAdds.value[idx], ...patch }
    else localEdits.value[id] = { ...(localEdits.value[id] || {}), ...patch }
    rebuild()
    saveOverlay()
  }

  function updateSiteField(id, key, value) {
    updateSite(id, { [key]: value })
  }

  /**
   * 批量改字段：一次遍历写出，最后只 rebuild 一次 —— 逐条调 updateSite 会触发
   * N 次全量 rebuild + saveOverlay，批量改 50 个站就是 50 次重算。
   * 返回实际改动的条数（不存在的 id 静默忽略）。
   */
  function batchUpdate(ids, patch) {
    const now = Date.now()
    const p = { ...patch, updatedAt: now }
    let touched = 0
    for (const id of new Set(ids)) {
      const idx = localAdds.value.findIndex(s => s.id === id)
      if (idx !== -1) {
        localAdds.value[idx] = { ...localAdds.value[idx], ...p }
        touched++
        continue
      }
      if (sites.value.some(s => s.id === id)) {
        localEdits.value[id] = { ...(localEdits.value[id] || {}), ...p }
        touched++
      }
    }
    if (touched) { rebuild(); saveOverlay() }
    return touched
  }

  /** 批量改分类 */
  function batchSetCategory(ids, categoryId) {
    return categoryId ? batchUpdate(ids, { categoryId }) : 0
  }

  /** 批量加用途：已有该用途的跳过，避免标签重复堆叠 */
  function batchAddPurpose(ids, purposeId) {
    if (!purposeId) return 0
    const now = Date.now()
    let touched = 0
    for (const id of new Set(ids)) {
      const site = sites.value.find(s => s.id === id)
      if (!site) continue
      const purposes = Array.isArray(site.purposes) ? site.purposes : []
      if (purposes.includes(purposeId)) continue
      const p = { purposes: [...purposes, purposeId], updatedAt: now }
      const idx = localAdds.value.findIndex(s => s.id === id)
      if (idx !== -1) localAdds.value[idx] = { ...localAdds.value[idx], ...p }
      else localEdits.value[id] = { ...(localEdits.value[id] || {}), ...p }
      touched++
    }
    if (touched) { rebuild(); saveOverlay() }
    return touched
  }

  /**
   * 撤销一次「自动添加」：只从本地新增层摘掉，不进回收站。
   * 自动添加没有人工确认这一步，撤销就要能彻底当没发生过。
   * 返回是否真的摘掉了一条。
   */
  function undoAdd(id) {
    const idx = localAdds.value.findIndex(s => s.id === id)
    if (idx === -1) return false
    localAdds.value.splice(idx, 1)
    delete localEdits.value[id]
    rebuild()
    saveOverlay()
    return true
  }

  /** 从本地视图移除：本地新增的连数据一起删，云端来的记一条「本地隐藏」墓碑 */
  function removeLocally(id) {
    const idx = localAdds.value.findIndex(s => s.id === id)
    if (idx !== -1) {
      localAdds.value.splice(idx, 1)
      delete localEdits.value[id]
      return
    }
    if (!localDeletes.value.includes(id)) localDeletes.value.push(id)
  }

  function deleteSite(id) {
    const site = sites.value.find(s => s.id === id)
    if (site) trash.value.push({ ...site, deletedAt: Date.now() })
    removeLocally(id)
    rebuild()
    saveOverlay()
    saveTrash()
  }

  function recordVisit(id) {
    const site = sites.value.find(s => s.id === id)
    if (!site) return
    // 本地口径：我这台设备的访问次数（供「推荐发现」做个性化）
    const next = (visitCounts.value[id] ?? site.visitCount ?? 0) + 1
    visitCounts.value[id] = next
    site.visitCount = next
    saveOverlay()
    // 云端口径：所有访客的全局点击量（卡片角标 / 排行的权威来源），攒批后匿名上报
    clicksStore.record(id)
  }

  function reorderSites(newOrderedSites) {
    // 只调整这批 id 的相对位置，其余站点原地不动。渲染按数组顺序，
    // 故不改 sortOrder —— 它是云端的全局序号，前端重排不应覆盖它。
    const target = newOrderedSites.map(s => s.id)
    const targetSet = new Set(target)
    const next = []
    let injected = false
    for (const s of sites.value) {
      if (targetSet.has(s.id)) {
        if (!injected) { next.push(...target); injected = true }
        continue
      }
      next.push(s.id)
    }
    if (!injected) next.push(...target)
    localOrder.value = next
    rebuild()
    saveOverlay()
  }

  /** 置顶 / 取消置顶，返回切换后的状态 */
  function togglePin(id) {
    const site = sites.value.find(s => s.id === id)
    if (!site) return false
    const next = !site.pinned
    updateSite(id, { pinned: next })
    return next
  }

  /** 归档 / 取消归档，返回切换后的状态 */
  function toggleArchive(id) {
    const site = sites.value.find(s => s.id === id)
    if (!site) return false
    const next = !site.archived
    updateSite(id, { archived: next })
    return next
  }

  /** 归档站点的总数（sidebar 徽章用） */
  const archivedCount = computed(() => sites.value.filter(s => s.archived === true).length)

  function setArchivedScope(v) { archivedScope.value = Boolean(v) }

  function setSearchQuery(q) { searchQuery.value = q }
  function setCategory(cat) { currentCategory.value = cat }
  function setPurpose(p) { currentPurpose.value = p || 'all' }
  function setSortBy(s) { sortBy.value = s }
  function setViewMode(m) { viewMode.value = m }

  // ── 批量选择 / 手动排序 ──
  function toggleBatchMode() {
    batchMode.value = !batchMode.value
    if (!batchMode.value) {
      selectedIds.value = new Set()
    } else {
      dragEnabled.value = false
    }
  }

  function toggleDragMode() {
    dragEnabled.value = !dragEnabled.value
    if (dragEnabled.value && batchMode.value) {
      batchMode.value = false
      selectedIds.value = new Set()
    }
  }

  function toggleSelect(id) {
    const newSet = new Set(selectedIds.value)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    selectedIds.value = newSet
  }

  function selectAll(ids) {
    selectedIds.value = new Set(ids)
  }

  function clearSelection() {
    selectedIds.value = new Set()
  }

  function batchDeleteToTrash(targetIds) {
    const ids = targetIds || [...selectedIds.value]
    for (const id of ids) {
      const site = sites.value.find(s => s.id === id)
      if (site) trash.value.push({ ...site, deletedAt: Date.now() })
      removeLocally(id)
    }
    selectedIds.value = new Set()
    rebuild()
    saveOverlay()
    saveTrash()
  }

  // ── 回收站管理 ──
  function restoreFromTrash(id) {
    const idx = trash.value.findIndex(s => s.id === id)
    if (idx === -1) return
    const [site] = trash.value.splice(idx, 1)
    delete site.deletedAt
    const dIdx = localDeletes.value.indexOf(id)
    // 墓碑里有 → 原本是云端站点，撤掉墓碑即可；否则是本地新增，放回本地新增层
    if (dIdx !== -1) localDeletes.value.splice(dIdx, 1)
    else localAdds.value.push(site)
    rebuild()
    saveOverlay()
    saveTrash()
  }

  function permanentDelete(id) {
    trash.value = trash.value.filter(s => s.id !== id)
    saveTrash()
  }

  function emptyTrash() {
    trash.value = []
    saveTrash()
  }

  /** 管理端发布成功后调用：覆盖层内容已进入云端，清掉以免长期遮蔽后续云端变更 */
  function clearLocalOverlay() {
    localAdds.value = []
    localEdits.value = {}
    localDeletes.value = []
    localOrder.value = []
    rebuild()
    saveOverlay()
  }

  // ── 云端热更新 ──
  function applyCloudData(data) {
    if (!data || !Array.isArray(data.sites)) return false
    cloudSites.value = data.sites
    cloudVersion.value = data.version || 0
    // 分类表与站点同批下发：缺省时 applyCloudGroups 返回 false，保留当前表不动
    if (data.categories) categoriesStore.applyCloudGroups(data.categories)
    rebuild()
    return true
  }

  async function initCloudSites() {
    try {
      const res = await fetch('/api/sites')
      if (!res.ok) return
      const data = await res.json()
      applyCloudData(data)
    } catch {
      // 离线时使用本地种子兜底
    } finally {
      cloudLoaded.value = true
    }
  }

  async function pollCloudSites() {
    try {
      const res = await fetch('/api/sites')
      if (!res.ok) return
      const data = await res.json()
      if (data && data.version && data.version !== cloudVersion.value) {
        applyCloudData(data)
      }
    } catch {
      // 忽略轮询失败，下次再试
    }
  }

  function startPolling(interval = 30000) {
    stopPolling()
    pollTimer = setInterval(pollCloudSites, interval)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  // 首屏先用种子数据渲染，云端拉到后由 applyCloudData 重建
  rebuild()

  return {
    sites, cloudSites, searchQuery, currentCategory, currentPurpose, sortBy, viewMode,
    highlightSiteId, highlightSite, clearHighlight,
    filteredSites, categorySites, trash, batchMode, dragEnabled, selectedIds,
    cloudVersion, cloudLoaded,
    addSite, updateSite, updateSiteField, undoAdd, deleteSite, recordVisit, reorderSites,
    batchUpdate, batchSetCategory, batchAddPurpose, togglePin, toggleArchive, setArchivedScope,
    archivedCount, archivedScope,
    setSearchQuery, setCategory, setPurpose, setSortBy, setViewMode,
    toggleBatchMode, toggleDragMode, toggleSelect, selectAll, clearSelection, batchDeleteToTrash,
    restoreFromTrash, permanentDelete, emptyTrash, clearLocalOverlay,
    initCloudSites, pollCloudSites, startPolling, stopPolling
  }
})

