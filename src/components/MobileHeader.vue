<template>
  <header class="mobile-header">
    <button class="hamburger" @click="sidebarStore.toggle()" :aria-label="sidebarStore.open ? '关闭菜单' : '打开菜单'" :aria-expanded="sidebarStore.open">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
    </button>
    <span class="mobile-header-title">Navigator</span>
    <div class="mobile-header-spacer"></div>
  </header>
</template>

<script setup>
import { useSidebarStore } from '@/stores/sidebar'
const sidebarStore = useSidebarStore()
</script>

<style scoped>
.mobile-header {
  display: none;
  align-items: center;
  justify-content: space-between;
  height: calc(52px + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) 12px 0;
  background: var(--glass-bg);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--border);
  color: var(--text-primary);
  flex-shrink: 0;
  z-index: 60;
}
.hamburger {
  width: 36px; height: 36px;
  border-radius: 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-primary);
}
.hamburger:hover { background: var(--accent-light); color: var(--accent); }
.hamburger svg { width: 20px; height: 20px; }
.mobile-header-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -.2px;
}
.mobile-header-spacer { width: 36px; height: 36px; }

@media (max-width: 768px) {
  .mobile-header { display: flex; }
}
</style>