<template>
  <Teleport to="body">
    <div class="settings-overlay" @click.self="close" @keydown.escape="close">
      <div class="settings-modal">
        <!-- 头部 -->
        <div class="settings-header">
          <h2 class="settings-title">设置</h2>
          <button class="settings-close" @click="close" aria-label="关闭">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div class="settings-body">
          <!-- 外观 -->
          <section class="settings-section">
            <div class="section-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              <span>外观</span>
            </div>
            <div class="setting-row">
              <div class="setting-label">主题模式</div>
              <div class="theme-toggle-wrapper">
                <button class="theme-toggle-btn" :class="{ active: preferencesStore.theme === 'light' }" @click="setTheme('light')">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                  浅色
                </button>
                <button class="theme-toggle-btn" :class="{ active: preferencesStore.theme === 'dark' }" @click="setTheme('dark')">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                  深色
                </button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label">主题配色</div>
              <div class="preset-grid">
                <button v-for="p in presets" :key="p.id"
                  class="preset-btn" :class="{ active: preferencesStore.themePreset === p.id }"
                  :style="{ '--preset-color': p.primary }"
                  @click="preferencesStore.setThemePreset(p.id)"
                  :title="p.name">
                  <span class="preset-swatch" :style="{ background: p.primary }"></span>
                  <span class="preset-name">{{ p.name }}</span>
                </button>
              </div>
            </div>
          </section>

          <!-- 显示 -->
          <section class="settings-section">
            <div class="section-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              <span>显示</span>
            </div>
            <div class="setting-row">
              <div class="setting-label">卡片视图</div>
              <div class="theme-toggle-wrapper">
                <button class="theme-toggle-btn" :class="{ active: sitesStore.viewMode === 'grid' }" @click="sitesStore.setViewMode('grid')">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                  网格
                </button>
                <button class="theme-toggle-btn" :class="{ active: sitesStore.viewMode === 'list' }" @click="sitesStore.setViewMode('list')">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                  列表
                </button>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-label">默认排序</div>
              <select v-model="sortValue" class="setting-select" @change="sitesStore.setSortBy(sortValue)">
                <option value="default">默认排序</option>
                <option value="name-asc">名称 A-Z</option>
                <option value="name-desc">名称 Z-A</option>
                <option value="hot">按热度</option>
                <option value="newest">最近添加</option>
              </select>
            </div>
          </section>

          <!-- 搜索 -->
          <section class="settings-section">
            <div class="section-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <span>搜索</span>
            </div>
            <div class="setting-row">
              <div class="setting-label">默认搜索引擎</div>
              <select v-model="engineValue" class="setting-select" @change="preferencesStore.setSearchEngine(engineValue)">
                <option v-for="e in preferencesStore.engines" :key="e.id" :value="e.id">{{ e.label }}</option>
              </select>
            </div>
          </section>

          <!-- 壁纸 -->
          <section class="settings-section">
            <div class="section-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <span>壁纸</span>
            </div>
            <div class="setting-row">
              <div class="setting-label">背景图片 URL</div>
              <div class="wallpaper-input-group">
                <input v-model="wallpaperUrl" class="setting-input" placeholder="输入图片 URL 或留空" @change="applyWallpaper" />
                <button v-if="preferencesStore.wallpaper" class="wallpaper-clear" @click="clearWallpaper" title="移除壁纸">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>
            </div>
            <div class="setting-row">
              <label class="setting-toggle">
                <span class="setting-label">壁纸模糊效果</span>
                <input type="checkbox" v-model="blurValue" @change="updateBlur" />
                <span class="toggle-track">
                  <span class="toggle-thumb"></span>
                </span>
              </label>
            </div>
          </section>

          <!-- 数据 -->
          <section class="settings-section">
            <div class="section-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>数据管理</span>
            </div>
            <div class="setting-row">
              <button class="data-btn" @click="$emit('open-import')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                导入 / 导出书签
              </button>
            </div>
            <div class="setting-row">
              <div class="data-info">
                <span class="data-info-label">当前数据</span>
                <span class="data-info-value">{{ sitesStore.sites.length }} 个站点 · {{ categoriesStore.categories.length }} 个分类</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch } from 'vue'
import { usePreferencesStore } from '@/stores/preferences'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'

const emit = defineEmits(['close', 'open-import'])

const preferencesStore = usePreferencesStore()
const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()

const presets = [
  { id: 'default', name: '默认蓝', primary: '#2563eb' },
  { id: 'green', name: '极客绿', primary: '#10b981' },
  { id: 'purple', name: '赛博紫', primary: '#8b5cf6' },
  { id: 'orange', name: '日落橙', primary: '#f59e0b' }
]

const sortValue = ref(sitesStore.sortBy)
const engineValue = ref(preferencesStore.searchEngine)
const wallpaperUrl = ref(preferencesStore.wallpaper)
const blurValue = ref(preferencesStore.wallpaperBlur)

watch(() => sitesStore.sortBy, (v) => { sortValue.value = v })
watch(() => preferencesStore.searchEngine, (v) => { engineValue.value = v })

function setTheme(mode) {
  if (preferencesStore.theme !== mode) {
    preferencesStore.toggleTheme()
  }
}

function applyWallpaper() {
  preferencesStore.setWallpaper(wallpaperUrl.value)
}

function clearWallpaper() {
  wallpaperUrl.value = ''
  preferencesStore.setWallpaper('')
}

function updateBlur() {
  preferencesStore.wallpaperBlur = blurValue.value
  if (preferencesStore.wallpaper) {
    preferencesStore.setWallpaper(preferencesStore.wallpaper)
  }
}

function close() {
  emit('close')
}
</script>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.2s ease;
}

.settings-modal {
  background: var(--bg-white);
  border-radius: 16px;
  width: 540px;
  max-width: 92vw;
  max-height: 85vh;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
  animation: slideUp 0.25s ease;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.settings-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
}

.settings-close {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: 8px;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}
.settings-close:hover {
  background: var(--accent-light);
  color: var(--accent);
}
.settings-close svg {
  width: 18px;
  height: 18px;
}

.settings-body {
  padding: 8px 24px 24px;
  overflow-y: auto;
  flex: 1;
}

.settings-section {
  padding: 16px 0;
  border-bottom: 1px solid var(--border-light);
}
.settings-section:last-child {
  border-bottom: none;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 14px;
}
.section-header svg {
  width: 16px;
  height: 16px;
  color: var(--accent);
  opacity: 0.8;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  gap: 16px;
}
.setting-label {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
}

/* Theme toggle */
.theme-toggle-wrapper {
  display: flex;
  gap: 4px;
  background: var(--border-light);
  padding: 3px;
  border-radius: 8px;
}
.theme-toggle-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: var(--font);
}
.theme-toggle-btn svg {
  width: 14px;
  height: 14px;
}
.theme-toggle-btn.active {
  background: var(--bg-white);
  color: var(--text-primary);
  box-shadow: 0 1px 3px rgba(0,0,0,.08);
}

/* Preset grid */
.preset-grid {
  display: flex;
  gap: 8px;
}
.preset-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-white);
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: var(--font);
}
.preset-btn:hover {
  border-color: var(--preset-color, var(--accent));
}
.preset-btn.active {
  border-color: var(--preset-color, var(--accent));
  background: color-mix(in srgb, var(--preset-color, var(--accent)) 8%, transparent);
  box-shadow: 0 0 0 1px var(--preset-color, var(--accent));
}
.preset-swatch {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--preset-color);
}
.preset-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
}

/* Select */
.setting-select {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-white);
  color: var(--text-primary);
  font-size: 12px;
  font-family: var(--font);
  cursor: pointer;
  outline: none;
  min-width: 130px;
}
.setting-select:focus {
  border-color: var(--accent);
}

/* Wallpaper input */
.wallpaper-input-group {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  max-width: 280px;
}
.setting-input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-white);
  color: var(--text-primary);
  font-size: 12px;
  font-family: var(--font);
  outline: none;
  transition: border-color 0.15s ease;
}
.setting-input:focus {
  border-color: var(--accent);
}
.setting-input::placeholder {
  color: var(--text-secondary);
  opacity: 0.5;
}
.wallpaper-clear {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-white);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.15s ease;
}
.wallpaper-clear:hover {
  border-color: #ef4444;
  color: #ef4444;
  background: #fef2f2;
}
.wallpaper-clear svg {
  width: 12px;
  height: 12px;
}

/* Toggle switch */
.setting-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  cursor: pointer;
}
.setting-toggle input {
  display: none;
}
.toggle-track {
  width: 38px;
  height: 22px;
  background: var(--border);
  border-radius: 11px;
  position: relative;
  transition: background 0.2s ease;
  flex-shrink: 0;
}
.setting-toggle input:checked + .toggle-track {
  background: var(--accent);
}
.toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s ease;
  box-shadow: 0 1px 3px rgba(0,0,0,.15);
}
.setting-toggle input:checked + .toggle-track .toggle-thumb {
  transform: translateX(16px);
}

/* Data button */
.data-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-white);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: var(--font);
}
.data-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-light);
}
.data-btn svg {
  width: 16px;
  height: 16px;
}

.data-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.data-info-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
}
.data-info-value {
  font-size: 11px;
  color: var(--text-secondary);
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes slideUp {
  from { opacity: 0; transform: translateY(16px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
</style>