<template>
  <div class="main-toolbar">
    <!-- 站内检索与站外搜索已合并为一个统一搜索框（引擎选择器为其左侧前缀） -->
    <UnifiedSearchBox class="toolbar-search" @add-site="$emit('open-add', $event)" />

    <div class="toolbar-actions">
      <select class="sort-select" v-model="sortValue" aria-label="排序方式" title="排序方式">
        <option value="default">默认排序</option>
        <option value="name-asc">名称 A-Z</option>
        <option value="name-desc">名称 Z-A</option>
        <option value="clicks">按点击量</option>
        <option value="newest">最新收录</option>
      </select>

      <button class="toolbar-btn" :class="{ active: sitesStore.batchMode }"
              :aria-pressed="sitesStore.batchMode" @click="sitesStore.toggleBatchMode()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <span class="btn-label">{{ sitesStore.batchMode ? '取消选择' : '选择' }}</span>
      </button>

      <button class="toolbar-btn drag-toggle" :class="{ active: sitesStore.dragEnabled }"
              :disabled="sitesStore.batchMode" @click="sitesStore.toggleDragMode()"
              title="开启后拖拽卡片手动排序">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        <span class="btn-label">{{ sitesStore.dragEnabled ? '完成排序' : '手动排序' }}</span>
      </button>

      <button class="view-toggle" @click="toggleViewMode"
              :aria-label="sitesStore.viewMode === 'grid' ? '切换到列表视图' : '切换到网格视图'"
              :title="sitesStore.viewMode === 'grid' ? '列表视图' : '网格视图'">
        <svg v-if="sitesStore.viewMode === 'grid'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
      </button>

      <button class="view-toggle" @click="$emit('open-todo')" aria-label="待办事项" title="待办事项">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
      </button>

      <button class="view-toggle" @click="preferencesStore.toggleTheme()" :aria-label="preferencesStore.theme === 'light' ? '切换到深色主题' : '切换到浅色主题'" title="切换主题">
        <svg v-if="preferencesStore.theme === 'light'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </button>

      <button class="view-toggle settings-btn" @click="$emit('open-settings')" aria-label="设置" title="设置">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>

      <!-- 添加站点：常驻右上角的主操作（原在左侧栏底部，带文字，已移除） -->
      <button class="view-toggle add-site-btn" @click="$emit('open-add')" aria-label="添加网站" title="添加网站">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useSitesStore } from '@/stores/sites'
import { usePreferencesStore } from '@/stores/preferences'
import UnifiedSearchBox from '@/components/UnifiedSearchBox.vue'

defineEmits(['open-settings', 'open-todo', 'open-add'])

const sitesStore = useSitesStore()
const preferencesStore = usePreferencesStore()

const sortValue = ref(sitesStore.sortBy)
watch(sortValue, (val) => sitesStore.setSortBy(val))
watch(() => sitesStore.sortBy, (val) => { if (val !== sortValue.value) sortValue.value = val })

function toggleViewMode() {
  sitesStore.setViewMode(sitesStore.viewMode === 'grid' ? 'list' : 'grid')
}
</script>

<style scoped>
.main-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 28px 0;
  flex-shrink: 0;
}
.toolbar-search { flex: 1 1 260px; min-width: 0; padding: 0; }
.toolbar-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: auto; }

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

.toolbar-btn, .view-toggle {
  height: 32px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-white);
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  transition: all .15s ease;
  white-space: nowrap;
}
.view-toggle { width: 32px; padding: 0; }
.toolbar-btn:hover, .view-toggle:hover { border-color: var(--accent); color: var(--accent); }
.toolbar-btn.active, .view-toggle.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.toolbar-btn:disabled { opacity: .4; cursor: not-allowed; }
.toolbar-btn svg, .view-toggle svg { width: 15px; height: 15px; flex-shrink: 0; }

/* 添加站点：右上角主操作，用实心强调色与其余描边图标按钮拉开层级 */
.add-site-btn { background: var(--accent); border-color: var(--accent); color: #fff; }
.add-site-btn:hover { background: var(--accent); border-color: var(--accent); color: #fff; opacity: .9; }

@media (max-width: 1024px) {
  .toolbar-btn { padding: 0 8px; }
}
/* 中等宽度：按钮只留图标，把空间还给两个搜索框，避免工具栏折成两行 */
@media (max-width: 1500px) {
  .toolbar-btn .btn-label { display: none; }
  .toolbar-btn { width: 32px; padding: 0; }
}
@media (max-width: 1360px) {
  .toolbar-search { flex-basis: 200px; }
}
@media (max-width: 1300px) {
  .toolbar-search { flex-basis: 150px; }
}
@media (max-width: 768px) {
  .main-toolbar { flex-direction: column; align-items: stretch; padding: 12px 16px 0; gap: 8px; }
  .toolbar-search { flex: 1 1 auto; padding: 0; }
  .toolbar-actions { margin-left: 0; overflow-x: auto; padding-bottom: 2px; scrollbar-width: none; }
  .toolbar-actions::-webkit-scrollbar { display: none; }
}
</style>