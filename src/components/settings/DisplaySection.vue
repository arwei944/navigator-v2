<template>
  <section class="settings-section">
    <!-- 显示 -->
    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
      <span>显示</span>
    </div>
    <div class="setting-row">
      <div class="setting-label">卡片视图</div>
      <div class="theme-toggle-wrapper">
        <button class="theme-toggle-btn" :class="{ active: sites.viewMode === 'grid' }" @click="sites.setViewMode('grid')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          网格
        </button>
        <button class="theme-toggle-btn" :class="{ active: sites.viewMode === 'list' }" @click="sites.setViewMode('list')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          列表
        </button>
      </div>
    </div>
    <div class="setting-row">
      <div class="setting-label">卡片信息密度</div>
      <div class="theme-toggle-wrapper">
        <button class="theme-toggle-btn" :class="{ active: prefs.cardDensity === 'compact' }"
                title="只留图标、名称与域名" @click="prefs.setCardDensity('compact')">简洁</button>
        <button class="theme-toggle-btn" :class="{ active: prefs.cardDensity === 'standard' }"
                title="名称、域名、描述与用途标签" @click="prefs.setCardDensity('standard')">标准</button>
        <button class="theme-toggle-btn" :class="{ active: prefs.cardDensity === 'rich' }"
                title="再加别名与三行描述" @click="prefs.setCardDensity('rich')">详细</button>
      </div>
    </div>
    <div class="setting-row">
      <div class="setting-label">默认排序</div>
      <select v-model="sortValue" class="setting-select" @change="sites.setSortBy(sortValue)">
        <option value="default">默认排序</option>
        <option value="name-asc">名称 A-Z</option>
        <option value="name-desc">名称 Z-A</option>
        <option value="clicks">按点击量</option>
        <option value="newest">最新收录</option>
        <option value="smart">智能排序</option>
      </select>
    </div>
    <div class="setting-row">
      <label class="setting-toggle">
        <span class="setting-label">首页「此刻推荐」</span>
        <input type="checkbox" :checked="prefs.smartBar" @change="prefs.setSmartBar($event.target.checked)" />
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
      </label>
    </div>

    <!-- 搜索 -->
    <div class="section-header sub">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <span>搜索</span>
    </div>
    <div class="setting-row">
      <div class="setting-label">默认搜索引擎</div>
      <select v-model="engineValue" class="setting-select" @change="prefs.setSearchEngine(engineValue)">
        <option v-for="e in prefs.engines" :key="e.id" :value="e.id">{{ e.label }}</option>
      </select>
    </div>

    <!-- 壁纸 -->
    <div class="section-header sub">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      <span>壁纸</span>
    </div>
    <div class="setting-row">
      <div class="setting-label">背景图片 URL</div>
      <div class="wallpaper-input-group">
        <input v-model="wallpaperUrl" class="setting-input" placeholder="输入图片 URL 或留空" @change="applyWallpaper" />
        <button v-if="prefs.wallpaper" class="wallpaper-clear" @click="clearWallpaper" title="移除壁纸">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>
    <div class="setting-row">
      <label class="setting-toggle">
        <span class="setting-label">壁纸模糊效果</span>
        <input type="checkbox" v-model="blurValue" @change="updateBlur" />
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
      </label>
    </div>
  </section>
</template>

<script setup>
import { ref, watch } from 'vue'
import { usePreferencesStore } from '@/stores/preferences'
import { useSitesStore } from '@/stores/sites'

const prefs = usePreferencesStore()
const sites = useSitesStore()

const sortValue = ref(sites.sortBy)
const engineValue = ref(prefs.searchEngine)
const wallpaperUrl = ref(prefs.wallpaper)
const blurValue = ref(prefs.wallpaperBlur)

watch(() => sites.sortBy, v => { sortValue.value = v })
watch(() => prefs.searchEngine, v => { engineValue.value = v })

function applyWallpaper() { prefs.setWallpaper(wallpaperUrl.value) }
function clearWallpaper() { wallpaperUrl.value = ''; prefs.setWallpaper('') }
function updateBlur() {
  prefs.wallpaperBlur = blurValue.value
  if (prefs.wallpaper) prefs.setWallpaper(prefs.wallpaper)
}
</script>

<style scoped>
.settings-section { padding: 16px 0; border-bottom: 1px solid var(--border-light); }
.settings-section:last-child { border-bottom: none; }
.section-header { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 14px; }
.section-header.sub { margin-top: 18px; }
.section-header svg { width: 16px; height: 16px; color: var(--accent); opacity: 0.8; }
.setting-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; gap: 16px; }
.setting-label { font-size: 13px; color: var(--text-secondary); white-space: nowrap; }
.theme-toggle-wrapper { display: flex; gap: 4px; background: var(--border-light); padding: 3px; border-radius: 8px; }
.theme-toggle-btn { display: flex; align-items: center; gap: 5px; padding: 5px 12px; border: none; border-radius: 6px; background: transparent; color: var(--text-secondary); font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.15s ease; font-family: var(--font); }
.theme-toggle-btn svg { width: 14px; height: 14px; }
.theme-toggle-btn.active { background: var(--bg-white); color: var(--text-primary); box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.setting-select { padding: 6px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-white); color: var(--text-primary); font-size: 12px; font-family: var(--font); cursor: pointer; outline: none; min-width: 130px; }
.setting-select:focus { border-color: var(--accent); }
.wallpaper-input-group { display: flex; align-items: center; gap: 4px; flex: 1; max-width: 280px; }
.setting-input { flex: 1; padding: 6px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-white); color: var(--text-primary); font-size: 12px; font-family: var(--font); outline: none; transition: border-color 0.15s ease; }
.setting-input:focus { border-color: var(--accent); }
.setting-input::placeholder { color: var(--text-secondary); opacity: 0.5; }
.wallpaper-clear { width: 28px; height: 28px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-white); color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.15s ease; }
.wallpaper-clear:hover { border-color: #ef4444; color: #ef4444; background: #fef2f2; }
.wallpaper-clear svg { width: 12px; height: 12px; }
.setting-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; cursor: pointer; }
.setting-toggle input { display: none; }
.toggle-track { width: 38px; height: 22px; background: var(--border); border-radius: 11px; position: relative; transition: background 0.2s ease; flex-shrink: 0; }
.setting-toggle input:checked + .toggle-track { background: var(--accent); }
.toggle-thumb { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform 0.2s ease; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
.setting-toggle input:checked + .toggle-track .toggle-thumb { transform: translateX(16px); }
</style>