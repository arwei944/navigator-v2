import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { decodeStored } from '@/utils/storeVersioning'
import { rankSites } from '@/utils/search'
import { watchVisibility } from '@/utils/visibility'
import { sanitizeSites } from '../../shared/sanitize.mjs'
import { useToastStore } from '@/stores/toast'
import { useCategoriesStore } from '@/stores/categories'
import { useClicksStore } from '@/stores/clicks'
import { usePreferencesStore } from '@/stores/preferences'
import { useHistoryStore } from '@/stores/history'
import { buildSignals, hasSignal, rankSites as rankSmart } from '@/utils/smartRank'

/* 覆盖层与回收站的治理逻辑已抽到同目录的纯函数模块：
 *   - sitesOverlay.js  读盘净化 + 统一写盘（防「存储被改坏 → 首屏白屏」）
 *   - sitesTrash.js    保留期 / 条数 / 字节三道闸 + 恢复前校验
 * 抽出来的好处是它们能在 Node 里直接断言，不必建 Pinia、也不必 mock localStorage。 */
import { loadOverlay, saveOverlay as persistOverlay } from './sitesOverlay'
import {
  loadTrash as readStoredTrash,
  persistTrash,
  pruneTrash,
  validateTrashSite,
} from './sitesTrash'
import { createCloudSync } from './sitesCloud'
import { filterByAxes, computeFilteredSites } from './sitesFilter'
import { rebuildSites } from './sitesRebuild'
import { createSiteMutations } from './sitesMutations'
import {
  toggleBatchMode as applyToggleBatch,
  toggleDragMode as applyToggleDrag,
  toggleSelection,
  pruneSelectionSet,
} from './sitesSelection'

export const useSitesStore = defineStore('sites', () => {
  // 分类表是动态的（云端可下发自定义分类），域 / 子分类的判定必须走 store 而非静态常量，
  // 否则后台新增的分类在「整域筛选」里会被漏掉。
  const categoriesStore = useCategoriesStore()
  // 点击量是**云端全局口径**（所有访客的总和），与本地 visitCounts 是两回事
  const clicksStore = useClicksStore()
  const prefs = usePreferencesStore()
  // 智能排序要用访问记录（时段偏好与共现）—— 这是本地信号，不上云
  const historyStore = useHistoryStore()
  // 恢复回收站时若发现记录损坏，要能「说出来」而不是静默放回坏数据
  const toast = useToastStore()

  // 云端基底。**不再用种子数据做同步首屏**：那份 152 KB 的站点表原先静态 import，
  // 必然进首屏静态图，而它只在「云端拉取失败」时才用得上 —— 改成云端首拉失败时
  // 再动态 import（见 loadSeedSites / applySeedFallback），不为少数路径付首屏字节。
  const cloudSites = ref([])
  // 渲染用列表 = 基底 + 覆盖层，由 rebuild() 维护，不要直接改它
  const sites = ref([])

  const overlay = loadOverlay()
  const localAdds = ref(overlay.adds)
  const localEdits = ref(overlay.edits)
  const localDeletes = ref(overlay.deletes)
  const localOrder = ref(overlay.order)

  /**
   * 本机访问计数：**从 history store 派生，不再单独持久化**。
   *
   * 此前它是 overlay 里的第二个 `visits` 副本，与 `history.records` 各记一半
   * （一个记次数、一个记时间），`recordVisit` 必须同时写两处才能保持一致。
   * 现在唯一存储是 `history.visits`，这里只是把它投影成 `{ [id]: count }`
   * 给 rebuild 用 —— 一个只读视图，不可能再与记录漂移。
   */
  const visitCounts = computed(() => {
    const out = {}
    for (const [id, v] of Object.entries(historyStore.visits)) {
      const n = Number(v?.count) || 0
      if (n > 0) out[id] = n
    }
    return out
  })

  const cloudVersion = ref(0)
  const cloudLoaded = ref(false)
  /**
   * 拉取失败的原因，用**机器可读的短码**表示，文案交给 UI 决定（见 useCloudNotice）。
   *   '' 正常 / 'offline' 网络不可达 / 'timeout' 超时 / 'http-<status>' 服务端错误
   *   / 'invalid-payload' 响应结构不合法
   * 这一项存在的意义是「断网时用户看到的到底是真实数据还是构建期种子，界面要说得出来」——
   * 旧实现是 `catch {}` 全空，断网与正常在界面上完全一样。
   */
  const cloudError = ref('')
  const searchQuery = ref('')
  const currentCategory = ref('all')
  // 用途筛选（Axis 4）：与分类正交，可跨分类聚合「所有查资料站」
  const currentPurpose = ref('all')
  const sortBy = ref('default')
  // 是否处于「归档」范围（由 App 按路由下发）
  const archivedScope = ref(false)
  const viewMode = ref('grid') // grid | list

  // 回收站（持久化，否则刷新后「恢复」就没了）
  // 读盘只丢「非对象」项：字段级完整性留到恢复时逐条校验（见 sitesTrash.js#validateTrashSite）——
  // 读盘阶段做深度过滤会把「字段略缺但仍可用」的条目直接丢掉，反而丢用户数据
  const trash = ref(readStoredTrash(decodeStored))

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
  /* 筛选与排序的实现在 sitesFilter.js（纯函数，可直接断言）。
   * 这里只负责把 store 里的状态与依赖「喂」进去，并保持 computed 的依赖追踪。 */
  const filterCtx = {
    cats: categoriesStore,
    clicksStore,
    get historyRecords() { return historyStore.records },
    buildSignals,
    hasSignal,
    rankSmart,
    rankSites,
  }

  const categorySites = computed(() =>
    filterByAxes(
      sites.value,
      {
        archivedScope: archivedScope.value,
        category: currentCategory.value,
        purpose: currentPurpose.value,
      },
      categoriesStore,
    ),
  )

  const filteredSites = computed(() =>
    computeFilteredSites(
      sites.value,
      {
        archivedScope: archivedScope.value,
        category: currentCategory.value,
        purpose: currentPurpose.value,
        sortBy: sortBy.value,
        searchQuery: searchQuery.value,
        clickBoost: prefs.clickBoost,
      },
      filterCtx,
    ),
  )

  // ── 覆盖层落盘与视图重建 ──
  function saveOverlay() {
    persistOverlay({
      adds: localAdds.value,
      edits: localEdits.value,
      deletes: localDeletes.value,
      order: localOrder.value,
      // visits 已迁到 history store（唯一存储），这里不再写第二份
    })
  }

  /**
   * 回收站落盘：**所有**改动回收站的入口都走这里，所以治理只挂一处即可，不会漏。
   * 三道闸与顺序见 `sitesTrash.js#persistTrash`。
   */
  function saveTrash() {
    const r = persistTrash(trash.value)
    trash.value = r.list
  }

/* rebuild 的实现在 sitesRebuild.js（纯函数）：物化 + 身份记忆 + 顺序应用 + 数组恒等。
 * 记忆表的不变量说明也随实现搬过去了 —— 改 rebuild 前请先读那段。 */
let rebuildMemo = new Map()

function rebuild() {
  const r = rebuildSites({
    cloudSites: cloudSites.value,
    localAdds: localAdds.value,
    localEdits: localEdits.value,
    localDeletes: localDeletes.value,
    localOrder: localOrder.value,
    visits: visitCounts.value,  // computed 投影，见上方 visitCounts 定义
    prevMemo: rebuildMemo,
    prevList: sites.value,
  })
  rebuildMemo = r.memo
  sites.value = r.list
}

  /* 单站 / 批量改动、删除、访问、排序的实现在 sitesMutations.js（工厂，注入 ref 与提交动作）。
   * 它把「补丁落在 localAdds 还是 localEdits」这条判断收成唯一一处 —— 此前五个函数各写一遍。 */
  const mut = createSiteMutations({
    localAdds, localEdits, localDeletes, localOrder, historyStore, trash, selectedIds, sites, cloudSites,
    rebuild, saveOverlay, saveTrash,
  })
  const {
    addSite, addSites, updateSite, updateSiteField, batchUpdate, batchSetCategory, batchAddPurpose, batchPatch,
    removeLocally, deleteSite, reorderSites, applySortOrder, undoAdd,
  } = mut

  /** 访问计数：本地口径落 history store（唯一存储），云端口径交给 clicks store */
  function recordVisit(id) {
    mut.recordVisit(id, clicksStore)
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

  /**
   * 批量置顶。语义与单站 `togglePin` 一致：置顶同时退出归档
   * —— 否则「已归档的站被置顶后仍藏在归档范围里」，用户看不到刚置顶了它。
   */
  function batchPin(ids) {
    const list = [...new Set(ids || [])]
    if (!list.length) return 0
    return batchUpdate(list, { pinned: true, archived: false })
  }

  /** 批量归档。与单站 `toggleArchive` 一致：归档同时取消置顶。 */
  function batchArchive(ids) {
    const list = [...new Set(ids || [])]
    if (!list.length) return 0
    return batchUpdate(list, { archived: true, pinned: false })
  }

  /**
   * 反选：以 `visibleIds`（当前可见的站点）为全集取反。
   *
   * 刻意**不**用全部站点做全集：在 A 分类选了 3 个，切到 B 分类点反选，
   * 意图是「选中 B 里除了这 3 个之外的全部」—— 用全量会把 A 里没选的全选上，
   * 接着一次批量删除就是误删。与 `pruneSelection` 同一条思路：只动看得见的。
   */
  function invertSelection(visibleIds) {
    const visible = new Set(Array.isArray(visibleIds) ? visibleIds : [])
    const next = new Set()
    for (const id of visible) {
      if (!selectedIds.value.has(id)) next.add(id)
    }
    selectedIds.value = next
    return next.size
  }

  // ── 批量选择 / 手动排序 ──
  /* 批量 / 拖拽 / 选择集的规则实现在 sitesSelection.js（纯函数）：
   * 「两个模式互斥」与「选择集要收敛到可见集」这两条规则只在那里写一次，
   * 所有入口（工具栏 / 右键菜单 / 快捷键）共用，不靠自觉。 */

  function toggleBatchMode() {
    const r = applyToggleBatch({ batchMode: batchMode.value, dragEnabled: dragEnabled.value, selectedIds: selectedIds.value })
    batchMode.value = r.batchMode
    dragEnabled.value = r.dragEnabled
    selectedIds.value = r.selectedIds
  }

  function toggleDragMode() {
    const r = applyToggleDrag({ batchMode: batchMode.value, dragEnabled: dragEnabled.value, selectedIds: selectedIds.value })
    batchMode.value = r.batchMode
    dragEnabled.value = r.dragEnabled
    selectedIds.value = r.selectedIds
  }

  function toggleSelect(id) {
    selectedIds.value = toggleSelection(selectedIds.value, id)
  }

  function selectAll(ids) {
    selectedIds.value = new Set(ids)
  }

  function clearSelection() {
    selectedIds.value = new Set()
  }

  /**
   * 把选择集收敛到「当前看得见的站点」。
   * @param {string[]} [visibleIds] 以调用方给出的可见集为准；缺省用当前过滤结果
   */
  function pruneSelection(visibleIds) {
    const visible = visibleIds || filteredSites.value.map((s) => s.id)
    selectedIds.value = pruneSelectionSet(selectedIds.value, visible)
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
  /**
   * 从回收站恢复一条站点。返回 `{ ok, reason }`。
   *
   * 恢复前先做**完整性校验**：回收站是持久化数据，可能被外部改坏（手工编辑
   * localStorage、旧版本结构、写入被截断）。坏数据一旦放回列表，轻则卡片渲染报错、
   * 重则整站白屏，而且它会随下一次发布进入云端 —— 所以宁可拒绝恢复并明确告知，
   * 也不静默放进一个坏条目。
   */
  function restoreFromTrash(id) {
    const idx = trash.value.findIndex(s => s.id === id)
    if (idx === -1) return { ok: false, reason: 'not-found' }
    const bad = validateTrashSite(trash.value[idx])
    if (bad) {
      toast.push({ message: `无法恢复：${bad}`, tone: 'error' })
      return { ok: false, reason: bad }
    }
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
    return { ok: true }
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

  /* ── 云端同步：实现在 stores/sitesCloud.js ──
   * 这里只做接线：把「当前版本 / 是否已有数据 / 如何应用」三件事交给它，
   * 它返回拉取与轮询的控制面。store 不关心退避节奏、ETag、种子兜底的细节。 */
  const cloud = createCloudSync({
    getVersion: () => cloudVersion.value,
    hasSites: () => cloudSites.value.length > 0,
    applyData: (data) => applyCloudData(data),
    applySeed: (seed) => {
      cloudSites.value = seed
      rebuild()
    },
    cloudError,
    cloudLoaded,
    watchVisibility,
  })
  const { initCloudSites, pollCloudSites, startPolling, stopPolling, retryCloudNow } = cloud

  // 启动时先按保留期收一轮：把「上次关闭期间已经过了 30 天」的条目清掉。
  // 无改动就不写盘（pruneTrash 返回 false），避免每次启动都白写一次 localStorage。
  {
    const pruned = pruneTrash(trash.value)
    if (pruned.changed) {
      trash.value = pruned.list
      saveTrash()
    }
  }

  // 首屏从空列表起步：云端拉到后由 applyCloudData 填充，拉取失败则由
  // initCloudSites 末尾的 applySeedFallback 用种子兜底，两条路径都走 rebuild()
  rebuild()

  return {
    sites, cloudSites, searchQuery, currentCategory, currentPurpose, sortBy, viewMode,
    highlightSiteId, highlightSite, clearHighlight,
    filteredSites, categorySites, trash, batchMode, dragEnabled, selectedIds,
    cloudVersion, cloudLoaded, cloudError,
    addSite, addSites, updateSite, updateSiteField, undoAdd, deleteSite, recordVisit, reorderSites, applySortOrder,
    batchUpdate, batchPatch, batchSetCategory, batchAddPurpose,
    batchPin, batchArchive, invertSelection,
    togglePin, toggleArchive, setArchivedScope,
    archivedCount, archivedScope,
    setSearchQuery, setCategory, setPurpose, setSortBy, setViewMode,
    toggleBatchMode, toggleDragMode, toggleSelect, selectAll, clearSelection, pruneSelection,
    batchDeleteToTrash,
    restoreFromTrash, permanentDelete, emptyTrash, clearLocalOverlay,
    initCloudSites, pollCloudSites, startPolling, stopPolling, retryCloudNow
  }
})

