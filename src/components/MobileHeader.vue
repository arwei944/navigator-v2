<template>
  <header class="mobile-header">
    <button class="hamburger" @click="sidebarStore.toggle()" :aria-label="sidebarStore.open ? '关闭菜单' : '打开菜单'">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
    </button>
    <span class="mobile-header-title">Navigator</span>
    <div style="width:36px"></div>
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
  padding: 12px 16px;
  background: var(--sidebar-bg);
  flex-shrink: 0;
}
.hamburger {
  width: 36px; height: 36px;
  border-radius: 8px;
  border: none;
  background: rgba(255,255,255,.08);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}
.hamburger svg { width: 20px; height: 20px; }
.mobile-header-title {
  font-size: 15px;
  font-weight: 600;
  color: #f1f5f9;
}
</style>