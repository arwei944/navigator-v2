<template>
  <section class="settings-section">
    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      <span>外观</span>
    </div>
    <div class="setting-row">
      <div class="setting-label">主题模式</div>
      <div class="theme-toggle-wrapper">
        <button class="theme-toggle-btn" :class="{ active: prefs.theme === 'light' }" @click="setTheme('light')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          浅色
        </button>
        <button class="theme-toggle-btn" :class="{ active: prefs.theme === 'dark' }" @click="setTheme('dark')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          深色
        </button>
      </div>
    </div>
    <div class="setting-row">
      <div class="setting-label">主题配色</div>
      <div class="preset-grid">
        <button v-for="p in presets" :key="p.id"
          class="preset-btn" :class="{ active: prefs.themePreset === p.id }"
          :style="{ '--preset-color': p.primary }"
          @click="prefs.setThemePreset(p.id)"
          :title="p.name">
          <span class="preset-swatch" :style="{ background: p.primary }"></span>
          <span class="preset-name">{{ p.name }}</span>
        </button>
      </div>
    </div>
  </section>
</template>

<script setup>
import { usePreferencesStore } from '@/stores/preferences'

const prefs = usePreferencesStore()

const presets = [
  { id: 'default', name: '默认蓝', primary: '#2563eb' },
  { id: 'green', name: '极客绿', primary: '#10b981' },
  { id: 'purple', name: '赛博紫', primary: '#8b5cf6' },
  { id: 'orange', name: '日落橙', primary: '#f59e0b' }
]

function setTheme(mode) {
  if (prefs.theme !== mode) prefs.toggleTheme()
}
</script>

<style scoped>
.settings-section { padding: 16px 0; border-bottom: 1px solid var(--border-light); }
.settings-section:last-child { border-bottom: none; }
.section-header { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 14px; }
.section-header svg { width: 16px; height: 16px; color: var(--accent); opacity: 0.8; }
.setting-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; gap: 16px; }
.setting-label { font-size: 13px; color: var(--text-secondary); white-space: nowrap; }
.theme-toggle-wrapper { display: flex; gap: 4px; background: var(--border-light); padding: 3px; border-radius: 8px; }
.theme-toggle-btn { display: flex; align-items: center; gap: 5px; padding: 5px 12px; border: none; border-radius: 6px; background: transparent; color: var(--text-secondary); font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.15s ease; font-family: var(--font); }
.theme-toggle-btn svg { width: 14px; height: 14px; }
.theme-toggle-btn.active { background: var(--bg-white); color: var(--text-primary); box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.preset-grid { display: flex; gap: 8px; }
.preset-btn { display: flex; align-items: center; gap: 6px; padding: 5px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-white); cursor: pointer; transition: all 0.15s ease; font-family: var(--font); }
.preset-btn:hover { border-color: var(--preset-color, var(--accent)); }
.preset-btn.active { border-color: var(--preset-color, var(--accent)); background: color-mix(in srgb, var(--preset-color, var(--accent)) 8%, transparent); box-shadow: 0 0 0 1px var(--preset-color, var(--accent)); }
.preset-swatch { width: 12px; height: 12px; border-radius: 50%; background: var(--preset-color); }
.preset-name { font-size: 12px; font-weight: 500; color: var(--text-primary); }
</style>