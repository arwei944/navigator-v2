import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/views/HomeView.vue')
  },
  {
    path: '/category/:id',
    name: 'Category',
    component: () => import('@/views/HomeView.vue'),
    props: true
  },
  {
    path: '/admin',
    name: 'Admin',
    component: () => import('@/views/AdminView.vue')
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/NotFoundView.vue')
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router