import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import SEED_SITES from '../../api/sites-data.json'
import { encodeStored, decodeStored } from '@/utils/storeVersioning'
import { rankSites } from '@/utils/search'
import { watchVisibility } from '@/utils/visibility'
import { safeSetItem } from '@/utils/safeStorage'
import { sanitizeSites } from '../../shared/sanitize.mjs'
import { useCategoriesStore } from '@/stores/categories'
import { useClicksStore } from '@/stores/clicks'
import { useHistoryStore } from '@/stores/history'
import { buildSignals, hasSignal, rankSites as rankSmart } from '@/utils/smartRank'

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
    // adds 逐条过滤（不是只判顶层是不是数组）：存储被外部改坏时，一条 null 就足以让
    // rebuild 在 materialize 里读 src.id 抛错，而那是首屏路径 —— 结果是永久白屏。
    // 过滤掉坏条目、保住其余数据，比整体丢弃或崩溃都好。
    adds: Array.isArray(d?.adds) ? d.adds.filter(isOverlaySite) : [],
    edits: d?.edits && typeof d.edits === 'object' ? d.edits : {},
    deletes: Array.isArray(d?.deletes) ? d.deletes.filter(x => typeof x === 'string' && x) : [],
    order: Array.isArray(d?.order) ? d.order.filter(x => typeof x === 'string' && x) : [],
    visits: d?.visits && typeof d.visits === 'object' ? d.visits : {},
  }
}

/** 覆盖层里一条「足够像站点」的记录：有非空字符串 id 是重建列表的最低要求 */
function isOverlaySite(x) {
  return Boolean(x) && typeof x === 'object' && !Array.isArray(x) && typeof x.id === 'string' && x.id
}

export const useSitesStore = defineStore('sites', () => {
  // 分类表是动态的（云端可下发自定义分类），域 / 子分类的判定必须走 store 而非静态常量，
  // 否则后台新增的分类在「整域筛选」里会被漏掉。
  const categoriesStore = useCategoriesStore()
  // 点击量是**云端全局口径**（所有访客的总和），与本地 visitCounts 是两回事
  const clicksStore = useClicksStore()
  // 智能排序要用访问记录（时段偏好与共现）—— 这是本地信号，不上云
  const historyStore = useHistoryStore()

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

  /**
   * 智能排序：按「此刻最可能要用」的顺序排。
   *
   * 信号来自本机访问记录与本地访问次数，冷启动（没有任何记录）时**降级为点击量** ——
   * 没有数据却硬要个性化，结果只会是随机顺序冒充智能。
   */
  function applySmart(list) {
    const signals = buildSignals(historyStore.records, list)
    if (!hasSignal(signals)) {
      return [...list].sort((a, b) => clicksStore.countFor(b.id) - clicksStore.countFor(a.id))
    }
    const ranked = rankSmart(list, signals, {
      clicks: clicksStore.mergedCounts || {},
      recentId: historyStore.records[0]?.siteId
    })
    const order = new Map(ranked.map((x, i) => [x.site.id, i]))
    // 没进榜的排在后面，且保持原有相对顺序（稳定）
    return [...list].sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER))
  }

  function applySort(list, mode) {
    if (mode === 'smart') return applySmart(list)
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
    safeSetItem(OVERLAY_KEY, encodeStored({
      adds: localAdds.value,
      edits: localEdits.value,
      deletes: localDeletes.value,
      order: localOrder.value,
      visits: visitCounts.value,
    }))
  }

  function saveTrash() {
    safeSetItem(TRASH_KEY, encodeStored(trash.value))
  }

/**
 * rebuild 产出的记忆表：id → { src, edit, visits, out }。
 *
 * 为什么需要它：渲染层是按 prop 的**对象身份**决定要不要跳过子组件更新的。
 * 早期版本对每条站点都 `{ ...s, visitCount }` 展开出新对象，于是「改 1 个站点」
 * （置顶 / 归档 / 编辑 / 记一次访问）或一次 30s 云端轮询，都会让 300 张卡片的
 * `site` prop 全部换新 —— 300 个组件全部重渲染，而其中 299 个的内容一字未改。
 *
 * 现在的判据是三个来源标记的**身份**而非内容比对（O(1)，不做字符串拼接）：
 *   - src    云端数组里的那个对象 / 本地新增层里的那个对象
 *   - edit   该 id 的编辑补丁对象（updateSite 会整体换掉它）
 *   - visits 该 id 的本地访问计数（数字）
 * 三者都没变就沿用上次那个对象，未变的卡片因 prop 恒等被 Vue 跳过。
 *
 * ⚠️ 这套判据依赖一条不变量：**来源对象一律整体替换，绝不就地改字段**。
 *    - 云端 src 来自 `res.json()`，每次轮询都是新解析出来的新对象；
 *    - 本地新增层在 updateSite / batchUpdate 里是 `localAdds[i] = { ...old, ...patch }`；
 *    - 本地编辑层同理整体替换 `localEdits[id]`。
 * 若将来有人写下 `cloudSites.value[i].name = x` 这样的就地改，视图不会跟着变 ——
 * 因为 src 身份没变、memo 会照旧返回上一个对象。要改数据请走 updateSite /
 * applyCloudData 这条路，不要碰数组元素。
 *
 * 注意与 recordVisit 的配合：那里会直接改 `site.visitCount`（为了让卡片角标立刻 +1），
 * 于是 out 被就地改过、下一次 rebuild 的 visits 与记忆不符 → 那一条必然重建。
 * 这是刻意接受的：只重建被点的那一张，且顺带把记忆同步回真实值（改的是 out，
 * 不是 src，所以不违反上面那条不变量）。
 */
let rebuildMemo = new Map()

/** 用「云端基底 + 本地覆盖层」重新拼出渲染用的列表 */
function rebuild() {
  const deleted = new Set(localDeletes.value)
  const edits = localEdits.value
  const visits = visitCounts.value
  const next = new Map()

  /** 把一条来源对象物化成渲染用对象，能复用则复用 */
  function materialize(src, edit) {
    const id = src.id
    const v = visits[id] ?? src.visitCount ?? 0
    const prev = rebuildMemo.get(id)
    if (prev && prev.src === src && prev.edit === edit && prev.visits === v) {
      next.set(id, prev)
      return prev.out
    }
    const out = edit ? { ...src, ...edit, visitCount: v } : { ...src, visitCount: v }
    next.set(id, { src, edit, visits: v, out })
    return out
  }

  const base = cloudSites.value
    .filter(s => !deleted.has(s.id))
    .map(s => materialize(s, edits[s.id] || null))
  const adds = localAdds.value
    .filter(s => !deleted.has(s.id))
    .map(s => materialize(s, null))

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

  rebuildMemo = next

  // 顺序与内容都逐项恒等时，连数组引用都不换：ref 赋值同一个数组不会触发任何
  // 依赖它的 computed / 渲染，省下一整趟 300 张卡的 diff。
  const prevList = sites.value
  const identical = prevList.length === list.length && list.every((s, i) => s === prevList[i])
  sites.value = identical ? prevList : list
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
    // 顺手把这条从批量选择里摘掉：否则「已选 3 个」的计数会含一条不存在的站，
    // 后续批量操作会拿它去匹配，结果既删不动也清不掉。
    if (selectedIds.value.has(id)) {
      const next = new Set(selectedIds.value)
      next.delete(id)
      selectedIds.value = next
    }
    rebuild()
    // 先落回收站再落覆盖层：回收站是「删过什么」的唯一证据，
    // 万一配额溢出只能写入一处，宁可丢墓碑也不能让这条记录凭空消失。
    saveTrash()
    saveOverlay()
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

  /**
   * 置顶 / 取消置顶，返回切换后的状态。
   * 与归档**互斥**：归档是「我不再日常用」，置顶是「我要一直看到」—— 两者同时为真时，
   * 取消归档会让这条站突然弹到列表最前，看起来像凭空冒出来的，所以置顶即取消归档。
   */
  function togglePin(id) {
    const site = sites.value.find(s => s.id === id)
    if (!site) return false
    const next = !site.pinned
    updateSite(id, next ? { pinned: true, archived: false } : { pinned: false })
    return next
  }

  /** 归档 / 取消归档，返回切换后的状态。归档即取消置顶（同上，保持两者互斥） */
  function toggleArchive(id) {
    const site = sites.value.find(s => s.id === id)
    if (!site) return false
    const next = !site.archived
    updateSite(id, next ? { archived: true, pinned: false } : { archived: false })
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

  /**
   * 把选择集收敛到「当前看得见的站点」。
   *
   * 为什么必须有：选择集是跨分类存活的。在 A 分类选了 3 个站，再切到 B 分类点「批量删除」，
   * 会删掉 3 个用户此刻根本看不见的站 —— 这是这套交互里最伤人的一种误操作，
   * 而且删完还能在回收站里看到，用户会一头雾水。
   *
   * 选择集为空时直接返回：这是绝大多数时刻的状态，不该为它做任何遍历。
   * @param {string[]} [visibleIds] 以调用方给出的可见集为准；缺省用当前过滤结果
   */
  function pruneSelection(visibleIds) {
    if (!selectedIds.value.size) return
    const visible = visibleIds ? new Set(visibleIds) : new Set(filteredSites.value.map(s => s.id))
    let dropped = false
    const next = new Set()
    for (const id of selectedIds.value) {
      if (visible.has(id)) next.add(id)
      else dropped = true
    }
    if (dropped) selectedIds.value = next
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
    // 墓碑里有 → 原本是云端站点，撤掉墓碑即可；否则是本地新增，放回本地新增层。
    // **但先要确认它现在不在列表里** —— 若站点已经在（例如回滚时墓碑被清掉、云端又把
    // 它带了回来），再往新增层压一条就会造出两条同 id 的记录：item-key 重复，
    // 后续删除/编辑只命中一条，另一条变成删不掉的幽灵卡片。
    const exists = sites.value.some(s => s.id === id)
    if (dIdx !== -1) localDeletes.value.splice(dIdx, 1)
    else if (!exists) localAdds.value.push(site)
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

  /**
   * 管理端发布 / 回滚成功后调用：覆盖层内容已进入云端，清掉以免长期遮蔽后续云端变更。
   *
   * **刻意不清 `deletes` 墓碑**。墓碑表达的是用户本机的意图（「这条我不看」），
   * 而云端的发布/回滚是另一回事 —— 顺手清掉会让用户已经删掉的站点复活，这是实打实的数据
   * 语义错误（审计里那条「回滚后已删站点复活」）。留着也不会有副作用：
   *   - 发布路径：被删的站已经不在云端基底里了，墓碑过滤的是一个不存在的 id，等于空操作；
   *   - 回滚路径：墓碑继续生效，用户的删除意图被保住。
   */
  function clearLocalOverlay() {
    localAdds.value = []
    localEdits.value = {}
    localOrder.value = []
    rebuild()
    saveOverlay()
  }

  // ── 云端热更新 ──
  function applyCloudData(data) {
    if (!data) return false
    // 元素级校验（与 api/sites.js 用同一个 shared/sanitize.mjs）：空数组、元素缺 id/name/url、
    // id 重复，任何一种都不该落地 —— 落地就是全站白屏，而且没有回退路径。
    // 不合法时**保留上一版**，并把原因记到 cloudError 上让界面能说出来。
    const clean = sanitizeSites(data.sites)
    if (!clean) {
      console.warn('[sites] 云端站点表结构不合法，已保留上一版')
      cloudError.value = 'invalid-payload'
      return false
    }
    cloudSites.value = clean
    cloudVersion.value = Number(data.version) || 0
    // 分类表与站点同批下发：缺省时 applyCloudGroups 返回 false，保留当前表不动
    if (data.categories) categoriesStore.applyCloudGroups(data.categories)
    cloudError.value = ''
    rebuild()
    return true
  }

/**
 * 云端请求收口：同一时刻只保留一个在途请求，并给 10s 超时。
 *
 * 不做这两件事会发生什么：`visibilitychange` 的立即重拉会与 30s 定时轮询并发，
 * 弱网下连接一直挂着、请求越堆越多；两个响应乱序回来时，先发的慢响应会把
 * 整站数据覆盖回旧版本（分类表一起回退），最长持续一个轮询周期才自愈。
 */
let cloudInflight = null
const CLOUD_TIMEOUT = 10000

/**
 * 上一次成功应用的响应的 ETag，用于发条件请求。
 *
 * 轮询的内容绝大多数时候和上一轮一模一样，而 Vercel 会依据响应体自动生成弱 ETag，
 * 带上 If-None-Match 就能换回一个 304 —— **0 字节**（线上实测；不带是 34,180 字节）。
 * 每 30s 一轮、一天挂机约 4 MB，这一条把它压到几十 KB。
 *
 * 刻意存成普通变量而不是 ref：它只是请求头的一个附属状态，不该驱动任何渲染。
 */
let cloudEtag = ''

/**
 * 拉取失败的原因，用**机器可读的短码**表示，文案交给 UI 决定。
 *   '' 正常 / 'offline' 网络不可达 / 'timeout' 超时 / 'http-<status>' 服务端错误
 *   / 'invalid-payload' 响应结构不合法
 * 这一项存在的意义是「断网时用户看到的到底是真实数据还是构建期种子，界面要说得出来」——
 * 旧实现是 `catch {}` 全空，断网与正常在界面上完全一样。
 */
const cloudError = ref('')

function fetchCloud() {
  if (cloudInflight) return cloudInflight
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), CLOUD_TIMEOUT)
  cloudInflight = (async () => {
    try {
      const res = await fetch('/api/sites', {
        signal: ctrl.signal,
        headers: cloudEtag ? { 'If-None-Match': cloudEtag } : undefined
      })
      // 304：内容与上次一致。既不用解析 JSON，也不用 rebuild
      if (res.status === 304) { cloudError.value = ''; return null }
      if (!res.ok) {
        cloudError.value = `http-${res.status}`
        return null
      }
      /**
       * 不能直接 `res.json()`：静态托管（或任何 SPA 兜底 / 代理）会把未知路径
       * 也返回 200 + `index.html`，于是 `res.ok` 为真，`res.json()` 抛
       * 「Unexpected token '<'」并被下面 catch 误判成「离线」——用户明明在线，
       * 界面却说「已离线，联网后会自动更新」，而那个自动恢复永远不会发生。
       *
       * 先看 Content-Type，再尽力解析：拿不到合法对象就归入 `invalid-payload`
       * （与「网络不可达」分开），界面据此说真话。
       */
      const ctype = res.headers.get('Content-Type') || ''
      if (!ctype.includes('json')) {
        cloudError.value = 'invalid-payload'
        return null
      }
      let data = null
      try {
        data = await res.json()
      } catch {
        cloudError.value = 'invalid-payload'
        return null
      }
      // 只在拿到合法版本号时才记住 ETag。否则一旦第一次响应体不合法，
      // 下次的 304 会把「这份数据没被应用过」这个状态永久钉住，热更新再也进不来。
      const v = Number(data?.version)
      if (Number.isFinite(v)) cloudEtag = res.headers.get('ETag') || cloudEtag
      return data
    } catch (e) {
      cloudError.value = e && e.name === 'AbortError' ? 'timeout' : 'offline'
      return null
    } finally {
      clearTimeout(timer)
      cloudInflight = null
    }
  })()
  return cloudInflight
}

  /**
   * version 必须**单调递增**才应用。
   * 旧判据是 `version !== cloudVersion`，只要求「不等」——于是慢响应的旧版本也满足，
   * 成了数据回滚的通道。
   */
  function applyIfNewer(data) {
    if (!data) return false
    const v = Number(data.version)
    if (!Number.isFinite(v)) {
      console.warn('[sites] 云端响应缺少合法的 version，已忽略本次更新')
      cloudError.value = 'invalid-payload'
      return false
    }
    if (v <= cloudVersion.value) return false
    return applyCloudData(data)
  }

  async function initCloudSites() {
    try {
      applyIfNewer(await fetchCloud())
    } finally {
      cloudLoaded.value = true
    }
  }

  /* ── 轮询节奏：成功间隔恒定，失败指数退避 ──
   * 为什么必须退避：断网时 30s 一轮会一直打一个必然失败的请求，移动端上每次都要等
   * 到超时（10s），叠加起来就是「后台一直在耗电、前台一直没有新数据」。
   * 退避到 5 分钟封顶，并在 `online` 事件与标签页重新可见时立刻重试 ——
   * 恢复联网那一瞬间用户就能拿到数据，不用等退避窗口走完。 */
  const POLL_BASE_MS = 30000
  const POLL_MAX_MS = 300000

  /**
   * 「再轮询一万次也不可能成功」的服务端状态 → 停掉排期。
   *
   * 目前三项：
   *   - `http-402`：Vercel 在 Hobby 额度（边缘请求 / 函数调用 100 万每月）打满后会暂停整个部署，
   *     全站返回 `402 DEPLOYMENT_DISABLED`。这种状态不会因为重试而改变，
   *     按退避节奏每 5 分钟继续打只是白白消耗额度 —— 而额度正是被耗光的那个东西。
   *   - `http-404`：这个部署根本没有 `/api/sites`（纯静态托管就是这样）。接口不存在，
   *     重试一万次也还是 404。
   *   - `invalid-payload`：`/api/sites` 回了 200 但不是 JSON（SPA 兜底页、登录页、
   *     代理拦截页）。同上，接口不存在。
   * 停掉之后由**用户手动重试**、`online` 事件、标签页回到前台这三条路径重新探一次；
   * 探通了（`cloudError` 清空）就自动恢复常规节奏。
   */
  const CLOUD_FATAL = new Set(['http-402', 'http-404', 'invalid-payload'])

  let pollTimer = null
  let pollDelay = POLL_BASE_MS
  let pollFails = 0
  let polling = false
  /** 标签页是否在后台：在后台不排期（见 utils/visibility.js 的说明） */
  let pageHidden = false

  function scheduleNext(delay = pollDelay) {
    if (!polling || pageHidden) return
    if (pollTimer) clearTimeout(pollTimer)
    pollTimer = setTimeout(tick, delay)
  }

  async function tick() {
    pollTimer = null
    if (!polling || pageHidden) return
    await pollCloudSites()
    if (!polling || pageHidden) return
    // 平台暂停（CLOUD_FATAL）时 pollCloudSites 已经决定不再排期，这里不续期
    if (CLOUD_FATAL.has(cloudError.value)) return
    scheduleNext()
  }

  async function pollCloudSites() {
    const applied = applyIfNewer(await fetchCloud())
    if (CLOUD_FATAL.has(cloudError.value)) {
      if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
      return applied
    }
    if (cloudError.value) {
      pollFails += 1
      pollDelay = Math.min(POLL_MAX_MS, POLL_BASE_MS * 2 ** Math.min(pollFails, 4))
    } else {
      pollFails = 0
      pollDelay = POLL_BASE_MS
    }
    return applied
  }

  /** 立刻重试并复位退避：联网恢复 / 标签页回来 / 用户点「重试」时用，别让人干等退避窗口 */
  function retryCloudNow() {
    pollFails = 0
    pollDelay = POLL_BASE_MS
    return pollCloudSites().then((applied) => {
      // 之前可能因为平台暂停或进后台停掉了排期，这次探通了就把节奏接回去
      if (polling && !pollTimer && !pageHidden && !CLOUD_FATAL.has(cloudError.value)) scheduleNext()
      return applied
    })
  }

  function startPolling(interval = POLL_BASE_MS) {
    stopPolling()
    polling = true
    pollDelay = interval
    scheduleNext(interval)
  }

  function stopPolling() {
    polling = false
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
  }

  // 进后台停排期、回前台立刻补一次并接回节奏 —— 后台标签页不该消耗云端额度（见 utils/visibility.js）
  watchVisibility((visible) => {
    pageHidden = !visible
    if (!visible) {
      if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
      return
    }
    if (polling && !CLOUD_FATAL.has(cloudError.value)) {
      if (!pollTimer) retryCloudNow()
    }
  })

  // 首屏先用种子数据渲染，云端拉到后由 applyCloudData 重建
  rebuild()

  return {
    sites, cloudSites, searchQuery, currentCategory, currentPurpose, sortBy, viewMode,
    highlightSiteId, highlightSite, clearHighlight,
    filteredSites, categorySites, trash, batchMode, dragEnabled, selectedIds,
    cloudVersion, cloudLoaded, cloudError,
    addSite, updateSite, updateSiteField, undoAdd, deleteSite, recordVisit, reorderSites,
    batchUpdate, batchSetCategory, batchAddPurpose, togglePin, toggleArchive, setArchivedScope,
    archivedCount, archivedScope,
    setSearchQuery, setCategory, setPurpose, setSortBy, setViewMode,
    toggleBatchMode, toggleDragMode, toggleSelect, selectAll, clearSelection, pruneSelection,
    batchDeleteToTrash,
    restoreFromTrash, permanentDelete, emptyTrash, clearLocalOverlay,
    initCloudSites, pollCloudSites, startPolling, stopPolling, retryCloudNow
  }
})

