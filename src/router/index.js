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
  { path: '/trash', name: 'Trash', component: HomeView },
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