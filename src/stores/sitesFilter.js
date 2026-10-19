/**
 * 站点列表的筛选与排序 —— 全部是纯函数。
 *
 * ## 四个轴怎么组合
 *
 * 这里是**数据层**的轴组合，与 URL 无关（URL → 轴的映射在 `useRouteSync.js`）：
 *   1. 归档范围（archivedScope）：归档是范围不是筛选项，二选一
 *   2. 分类 / 域（currentCategory）：支持「整域」与「单子分类」两种粒度
 *   3. 用途（currentPurpose）：与分类正交，可跨分类聚合
 *   4. 排序（sortBy）：default / name / clicks / newest / smart
 * 搜索词存在时，相关性排序优先，显式排序降级为「同分并列时的次序」。
 *
 * ## 为什么抽成纯函数
 *
 * 这段此前内联在 `defineStore` 里，导致「排序口径」只能通过建 Pinia、造 store、
 * 再读 computed 来验证。抽出来后可以直接喂数组断言：
 *   - 归档站在非归档范围里一律不可见
 *   - 置顶只在**不搜索**时浮到最前（搜索时插队会骗人）
 *   - 智能排序在冷启动时降级为点击量，而不是随机顺序冒充智能
 * 这三条都是产品口径，值一条断言。
 */

/* ---------------- 轴 1-3：筛选 ---------------- */

/**
 * 按归档范围 + 分类 + 用途筛出候选列表。
 * @param {any[]} sites 全量渲染列表
 * @param {{ archivedScope:boolean, category:string, purpose:string }} axes
 * @param {{ isDomainScope:(v:string)=>boolean, categoriesOfDomain:(v:string)=>any[] }} cats 分类能力（来自 categories store）
 */
export function filterByAxes(sites, axes, cats) {
  const { archivedScope, category, purpose } = axes

  // 归档是范围轴：只有站在归档范围里才看得到归档站，其余范围一律不进列表 ——
  // 归档的语义是「这条站我不再日常用，但别删」，它不该继续占正常视野。
  let list = sites.filter((s) => (archivedScope ? s.archived === true : s.archived !== true))

  if (category && category !== 'all') {
    if (cats.isDomainScope(category)) {
      const ids = new Set(cats.categoriesOfDomain(category).map((c) => c.id))
      list = list.filter((s) => ids.has(s.categoryId))
    } else {
      list = list.filter((s) => s.categoryId === category)
    }
  }

  if (purpose && purpose !== 'all') {
    list = list.filter((s) => Array.isArray(s.purposes) && s.purposes.includes(purpose))
  }

  return list
}

/* ---------------- 轴 4：排序 ---------------- */

/**
 * 构建比较器表。
 *
 * 点击量走**云端全局口径**（countFor），不用本机 visitCount 冒充热度 ——
 * 单人设备的访问次数无法代表站点在全网的热度，两者口径必须分开。
 */
export function buildComparators(clicksStore) {
  return {
    'name-asc': (a, b) => a.name.localeCompare(b.name),
    'name-desc': (a, b) => b.name.localeCompare(a.name),
    clicks: (a, b) => clicksStore.countFor(b.id) - clicksStore.countFor(a.id),
    newest: (a, b) => b.createdAt - a.createdAt,
  }
}

/**
 * 智能排序：按「此刻最可能要用」的顺序排。
 *
 * 信号来自本机访问记录与本地访问次数，冷启动（没有任何记录）时**降级为点击量** ——
 * 没有数据却硬要个性化，结果只会是随机顺序冒充智能。
 */
export function applySmart(list, { historyRecords, clicksStore, buildSignals, hasSignal, rankSmart }) {
  const signals = buildSignals(historyRecords, list)
  if (!hasSignal(signals)) {
    return [...list].sort((a, b) => clicksStore.countFor(b.id) - clicksStore.countFor(a.id))
  }
  const ranked = rankSmart(list, signals, {
    clicks: clicksStore.mergedCounts || {},
    recentId: historyRecords[0]?.siteId,
  })
  const order = new Map(ranked.map((x, i) => [x.site.id, i]))
  // 没进榜的排在后面，且保持原有相对顺序（稳定）
  return [...list].sort(
    (a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  )
}

/** 应用显式排序（未知模式原样返回副本，不改原数组） */
export function applySort(list, mode, ctx) {
  if (mode === 'smart') return applySmart(list, ctx)
  const cmp = buildComparators(ctx.clicksStore)[mode]
  return cmp ? [...list].sort(cmp) : [...list]
}

/* ---------------- 组合：最终列表 ---------------- */

/**
 * @param {any[]} sites 渲染列表
 * @param {object} state `{ archivedScope, category, purpose, sortBy, searchQuery, clickBoost }`
 * @param {object} ctx `{ cats, clicksStore, historyRecords, buildSignals, hasSignal, rankSmart, rankSites }`
 */
export function computeFilteredSites(sites, state, ctx) {
  const searched = filterByAxes(sites, state, ctx.cats)
  const q = String(state.searchQuery || '').trim()

  // 有搜索词：相关性排序说了算。显式排序只作同分并列时的次序，
  // 绝不整体重排 —— 否则选「名称降序」会把最相关的站点挤到后面。
  if (q) {
    // 「常访问」加权：相关性同档时热度高的在前。开关一关就退回纯相关性排序。
    return ctx.rankSites(searched, q, {
      tieBreak: buildComparators(ctx.clicksStore)[state.sortBy],
      clicks: state.clickBoost ? ctx.clicksStore.mergedCounts : null,
    })
  }

  const list = applySort(searched, state.sortBy, ctx)
  // 置顶：把「每天都要用」的几个站钉在当前列表最前。
  // **只在不搜索时生效** —— 搜索是相关性说了算，把钉住的站插到最相关结果之前会骗人。
  if (!list.some((s) => s.pinned)) return list
  return [...list.filter((s) => s.pinned), ...list.filter((s) => !s.pinned)]
}
