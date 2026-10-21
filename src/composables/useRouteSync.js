/**
 * 路由 ↔ 状态的单向同步（URL 是真相源，store 是投影）。
 *
 * ## 四个轴为什么都在 URL 里
 *
 * 导航范围（/favorites、/archived…）走路径，分类（c）、用途（p）、搜索（q）走 query ——
 * 这样「收藏里搜钱包 + 只看交易所」这种组合可以直接分享 / 收藏 / 刷新还原。
 * 反过来若把轴存在 store 里，一旦刷新就全丢，用户会觉得「我明明选好了」。
 *
 * ## 两个方向的分工
 *
 *   - 路由变化 → 状态：`applyRoute`（含首次进入，保证粘贴 /favorites 能还原）
 *   - 搜索输入 → query：`useSearchToQuery`（用 replace，避免每个按键都进历史）
 *
 * 其余状态（收藏 / 待办 / 偏好）不在 URL 里，它们由各自的 store 持久化。
 *
 * ## 从 App.vue 抽出来的原因
 *
 * 这段 70 行只依赖 route / router / 三个 store，与页面模板无关。
 * 留在 App.vue 里时，它和 20 多个弹窗开关混在一起，读不出「URL 到底控制了什么」。
 */
import { watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSidebarStore } from '@/stores/sidebar'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'

/** 路由名 → 导航范围。新增路由时必须登记，否则会回落 discover（全部） */
export const SCOPE_BY_ROUTE = {
  Home: 'discover',
  Favorites: 'favorites',
  Recent: 'recent',
  Feed: 'feed',
  Content: 'content',
  Trash: 'trash',
  Archived: 'archived',
  Insights: 'insights',
  Graph: 'graph',
  DomainFlow: 'domain',
  About: 'about',
  Admin: 'admin',
}

/** 范围的中文名（页面标题用）；没有 == 不显示范围 */
export const SCOPE_LABEL = {
  favorites: '收藏',
  recent: '最近',
  archived: '归档',
  feed: '内容聚合',
  content: '领域动态',
  trash: '回收站',
  insights: '洞察',
  graph: '关联图谱',
}

/**
 * 不走导航壳的独立页面（自带整页布局）。
 * 2026-10-16：**Admin 从这一组移走** —— 管理后台改成套壳渲染，保持三栏
 * （左导航 / 中内容 / 右信息栏），不再是整页切换。只剩 404 是真·独立页。
 */
export const STANDALONE_ROUTES = new Set(['NotFound'])

export function useRouteSync() {
  const route = useRoute()
  const router = useRouter()
  const sidebarStore = useSidebarStore()
  const sitesStore = useSitesStore()
  const categoriesStore = useCategoriesStore()

  const scope = computed(() => SCOPE_BY_ROUTE[route.name] || 'discover')
  const isStandalone = computed(() => STANDALONE_ROUTES.has(route.name))

  // 分类（Axis 3）：与范围正交，放 query 才能和 /favorites、/recent 组合
  function categoryFromRoute() {
    const id = route.query.c
    return id && id !== 'all' ? id : 'all'
  }
  // 用途（Axis 4）：同样放 query，才能和分类、范围任意组合
  function purposeFromRoute() {
    const id = route.query.p
    return id && id !== 'all' ? id : 'all'
  }
  function queryFromRoute() {
    return route.query.q || ''
  }

  function updatePageTitle() {
    const cat = categoryFromRoute()
    let title = 'Navigator'
    if (SCOPE_LABEL[scope.value]) {
      title = `Navigator | ${SCOPE_LABEL[scope.value]}`
    } else if (cat !== 'all') {
      title = `Navigator | ${categoriesStore.getCategoryLabel(cat) || cat}`
    }
    if (sitesStore.searchQuery) {
      title = `Navigator | 搜索: ${sitesStore.searchQuery}`
    }
    document.title = title
  }

  function applyRouteToStore() {
    if (sidebarStore.activeNav !== scope.value) sidebarStore.setActiveNav(scope.value)

    // 「归档」是范围轴：只有在这个范围内才把 archived 站点放出来，其余范围一律不显示
    sitesStore.setArchivedScope(scope.value === 'archived')

    const cat = categoryFromRoute()
    if (sitesStore.currentCategory !== cat) sitesStore.setCategory(cat)

    const purpose = purposeFromRoute()
    if (sitesStore.currentPurpose !== purpose) sitesStore.setPurpose(purpose)

    const q = queryFromRoute()
    if (sitesStore.searchQuery !== q) sitesStore.setSearchQuery(q)

    updatePageTitle()
  }

  // 路由变化 → 状态（含首次进入，保证直接粘贴 /favorites 也能还原状态）
  watch(() => route.fullPath, applyRouteToStore, { immediate: true })

  // 搜索 → query（仅当路由尚未反映该关键词时；用 replace 避免每个按键都进历史）
  watch(
    () => sitesStore.searchQuery,
    (q) => {
      if ((q || '') === queryFromRoute()) return
      const next = { ...route.query }
      if (q) next.q = q
      else delete next.q
      router.replace({ path: route.path, query: next })
    },
  )

  return { scope, isStandalone, updatePageTitle, categoryFromRoute, purposeFromRoute, queryFromRoute }
}
