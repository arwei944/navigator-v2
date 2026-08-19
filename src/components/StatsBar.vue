<template>
  <div class="stats-bar">
    <div class="stats-bar-left">
      <div class="stat-item">共 <strong>{{ sitesStore.filteredSites.length }}</strong> 个站点</div>
      <div class="stat-item">今日访问 <strong>{{ todayCount }}</strong></div>
      <div class="stat-item">收藏 <strong>{{ favoritesStore.count }}</strong></div>
    </div>
    <div class="stats-bar-right">
      <div class="sort-selector" @change="sitesStore.setSortBy($event.target.value)">
        <select v-model="sortValue" class="sort-select">
          <option value="default">默认排序</option>
          <option value="name-asc">名称 A-Z</option>
          <option value="name-desc">名称 Z-A</option>
          <option value="hot">按热度</option>
          <option value="newest">最近添加</option>
        </select>
      </div>
      <button class="view-toggle" :class="{ active: sitesStore.viewMode === 'grid' }" @click="sitesStore.setViewMode('grid')" aria-label="网格视图">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
      </button>
      <button class="view-toggle" :class="{ active: sitesStore.viewMode === 'list' }" @click="sitesStore.setViewMode('list')" aria-label="列表视图">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      </button>
      <button class="view-toggle" @click="preferencesStore.toggleTheme()" aria-label="切换主题">
        <svg v-if="preferencesStore.theme === 'light'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </button>
      <button class="view-toggle settings-btn" @click="$emit('open-settings')" aria-label="设置" title="设置">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useSitesStore } from '@/stores/sites'
import { useFavoritesStore } from '@/stores/favorites'
import { usePreferencesStore } from '@/stores/preferences'
import { useHistoryStore } from '@/stores/history'

const sitesStore = useSitesStore()
const favoritesStore = useFavoritesStore()
const preferencesStore = usePreferencesStore()
const historyStore = useHistoryStore()

const sortValue = ref('default')
watch(sortValue, (val) => sitesStore.setSortBy(val))

const todayCount = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return historyStore.records.filter(r => r.timestamp >= today.getTime()).length
})
</script>

<style scoped>
.stats-bar {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 16px 28px;
  background: var(--bg-white);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
  transition: background var(--transition), border-color var(--transition);
}
.stats-bar-left { display: flex; align-items: center; gap: 20px; flex: 1; min-width: 200px; }
.stat-item { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-secondary); }
.stat-item strong { color: var(--text-primary); font-weight: 600; }
.stats-bar-right { display: flex; align-items: center; gap: 6px; }
.sort-select {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-white);
  color: var(--text-primary);
  font-size: 12px;
  font-family: var(--font);
  cursor: pointer;
  outline: none;
}
.sort-select:focus { border-color: var(--accent); }
.view-toggle {
  width: 34px; height: 34px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-white);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  transition: all .15s ease;
}
.view-toggle:hover { border-color: var(--accent); color: var(--accent); }
.view-toggle.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.view-toggle svg { width: 16px; height: 16px; }
</style>