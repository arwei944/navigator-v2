import { createRouter, createWebHistory } from 'vue-router'

// 布局壳始终是 App.vue，这里的路由只负责「范围 + 筛选」的状态表达。
//
// 两个轴必须正交，否则会互相挤掉：范围进路径（/favorites），分类与搜索进 query（?c= / ?q=）。
// 早先把分类也放进路径（/c/:id）时，「收藏 + 币圈」这种组合无法表达 —— 用户从收藏页点
// 任一方向筛选，就会被弹回全量范围，收藏上下文直接丢失。
const HomeView = () => import('@/views/HomeView.vue')

const routes = [
  { path: '/', name: 'Home', component: HomeView },
  { path: '/favorites', name: 'Favorites', component: HomeView },
  { path: '/recent', name: 'Recent', component: HomeView },
  { path: '/archived', name: 'Archived', component: HomeView },
  { path: '/feed', name: 'Feed', component: HomeView },
  // 领域动态：公开 RSS/API 的时间线（仅本地内容库）
  { path: '/content', name: 'Content', component: () => import('@/views/ContentView.vue') },
  { path: '/trash', name: 'Trash', component: HomeView },
  { path: '/insights', name: 'Insights', component: () => import('@/views/InsightsView.vue') },
  // 关联图谱：懒加载 —— 布局与建图只在真的打开这一页时才跑
  { path: '/graph', name: 'Graph', component: () => import('@/views/GraphView.vue') },
  // 领域流水线：把站点按「价值链位置」组织，看上下游与空缺
  { path: '/domain', name: 'DomainFlow', component: () => import('@/views/DomainFlowView.vue') },
  // 关于：同样套壳（带侧边栏），懒加载
  { path: '/about', name: 'About', component: () => import('@/views/AboutView.vue') },
  // PWA 分享目标（share_target）：系统分享面板把网址发到这里，直接走秒加链路收录。
  // 不套侧边栏 —— 分享落地页就该是一张干净的卡片，不是半个首页。
  { path: '/share', name: 'Share', component: () => import('@/views/ShareView.vue') },
  // 旧链接兼容：分类曾在路径里，统一重定向到 query 形式（保留范围与其余 query）
  {
    path: '/c/:id',
    redirect: (to) => ({ name: 'Home', query: { ...to.query, c: to.params.id } })
  },
  {
    path: '/category/:id',
    redirect: (to) => ({ name: 'Home', query: { ...to.query, c: to.params.id } })
  },
  { path: '/admin', name: 'Admin', component: () => import('@/views/AdminView.vue') },
  { path: '/:pathMatch(.*)*', name: 'NotFound', component: () => import('@/views/NotFoundView.vue') }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

export default router