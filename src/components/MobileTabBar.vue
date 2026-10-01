<template>
  <nav class="mobile-tabbar" aria-label="移动端主导航">
    <button class="tab" :class="{ active: isActive('Home') }" @click="go('Home')"
            :aria-current="isActive('Home') ? 'page' : undefined">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
      <span>全部</span>
    </button>

    <button class="tab" :class="{ active: isActive('Favorites') }" @click="go('Favorites')"
            :aria-current="isActive('Favorites') ? 'page' : undefined">
      <span class="tab-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
        <span v-if="favoritesStore.count > 0" class="tab-badge">{{ favoritesStore.count }}</span>
      </span>
      <span>收藏</span>
    </button>

    <button class="tab" :class="{ active: isActive('Recent') }" @click="go('Recent')"
            :aria-current="isActive('Recent') ? 'page' : undefined">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
      <span>最近</span>
    </button>

    <button class="tab" :class="{ active: sidebarStore.open }" @click="sidebarStore.openSidebar()"
            aria-label="打开更多菜单">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
      <span>更多</span>
    </button>
  </nav>
</template>

<script setup>
import { useRoute, useRouter } from 'vue-router'
import { useSidebarStore } from '@/stores/sidebar'
import { useFavoritesStore } from '@/stores/favorites'

const route = useRoute()
const router = useRouter()
const sidebarStore = useSidebarStore()
const favoritesStore = useFavoritesStore()

// 「全部」范围即首页；分类筛选是叠加在范围之上的 query，不再单独成路由
function isActive(name) {
  return route.name === name
}

function go(name) {
  sidebarStore.close()
  if (route.name === name) {
    router.push({ name, query: undefined })
    return
  }
  router.push({ name })
}
</script>

<style scoped>
.mobile-tabbar {
  display: none;
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 150;
  height: calc(56px + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--glass-bg);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: 1px solid var(--border);
}

.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  padding: 0;
  transition: color var(--transition);
}
.tab svg { width: 21px; height: 21px; }
.tab.active { color: var(--accent); }

.tab-icon { position: relative; display: inline-flex; }
.tab-badge {
  position: absolute;
  top: -5px;
  right: -9px;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  font-size: 9px;
  font-weight: 600;
  line-height: 15px;
  text-align: center;
}

@media (max-width: 768px) {
  .mobile-tabbar { display: flex; }
}
</style>