<template>
  <div class="export-panel">
    <div class="export-info">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="export-icon">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
      </svg>
      <p class="export-count">当前共有 <strong>{{ sitesStore.sites.length }}</strong> 个站点</p>
      <p class="export-hint">将导出为 JSON 格式文件</p>
    </div>
    <div class="export-actions">
      <button class="export-btn" @click="exportJSON">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
        </svg>
        下载 JSON
      </button>
      <button class="export-btn export-btn-secondary" @click="exportHTML">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        导出为 HTML 书签
      </button>
    </div>
  </div>
</template>

<script setup>
import { useSitesStore } from '@/stores/sites'
import { useFavoritesStore } from '@/stores/favorites'
import { useHistoryStore } from '@/stores/history'
import { buildExportJSON, buildExportHTML, downloadBlob } from '@/utils/bookmarks'

const sitesStore = useSitesStore()
const favoritesStore = useFavoritesStore()
const historyStore = useHistoryStore()

/**
 * store 暴露的是 `favoriteIds` / `records`，不是 `favorites` / `visitHistory` ——
 * 后两个名字全项目只在这里出现过，取到的是 undefined，JSON.stringify 会直接丢键，
 * 于是「备份文件」里既没有收藏也没有访问记录。
 */
function exportJSON() {
  const data = buildExportJSON(sitesStore.sites, favoritesStore.favoriteIds, historyStore.records)
  downloadBlob(JSON.stringify(data, null, 2), `nav-sites-${Date.now()}.json`, 'application/json')
}
function exportHTML() {
  const now = new Date().toISOString().split('T')[0]
  const html = buildExportHTML(sitesStore.sites)
  downloadBlob(html, `nav-bookmarks-${now}.html`, 'text/html')
}
</script>

<style scoped>
.export-panel { padding: 32px 24px; text-align: center; }
.export-icon { color: var(--accent); margin-bottom: 12px; }
.export-info { margin-bottom: 20px; }
.export-count { font-size: 14px; color: var(--text-secondary); margin-bottom: 4px; }
.export-count strong { color: var(--accent); font-size: 18px; }
.export-hint { font-size: 12px; color: var(--text-secondary); }
.export-btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 28px; font-size: 14px; font-weight: 600; border: none; background: var(--accent); color: white; border-radius: var(--radius-sm); cursor: pointer; transition: opacity var(--transition); }
.export-btn:hover { opacity: 0.9; }
.export-actions { display: flex; flex-direction: column; gap: 10px; align-items: center; }
.export-btn-secondary { background: var(--bg-white); color: var(--text-primary); border: 1px solid var(--border); }
.export-btn-secondary:hover { border-color: var(--accent); color: var(--accent); opacity: 1; }
</style>