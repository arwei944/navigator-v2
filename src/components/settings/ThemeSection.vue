<template>
  <section class="settings-section">
    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="2.5"/><circle cx="8.5" cy="7.5" r="2.5"/><circle cx="6.5" cy="12.5" r="2.5"/><path d="M12 2a10 10 0 0 0 0 20c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1-.24-.27-.36-.6-.36-.95 0-.83.67-1.5 1.5-1.5H16a6 6 0 0 0 6-6c0-5.52-4.48-10-10-10z"/></svg>
      <span>主题</span>
    </div>

    <div class="setting-row">
      <div class="data-info">
        <span class="data-info-label">当前：{{ themeStore.currentName }}</span>
        <span class="data-info-value">主题 = 配色 + 形状质感 + 明暗，一次切换整体换装。</span>
      </div>
      <button class="data-btn" @click="$emit('open-editor')">编辑 / 另存</button>
    </div>

    <!-- 主题市场：内置在前，自建在后 -->
    <div class="theme-grid">
      <button v-for="t in themeStore.allThemes" :key="t.id"
              class="theme-card" :class="{ active: t.id === themeStore.effectiveId }"
              @click="themeStore.apply(t.id)">
        <span class="theme-swatches">
          <i :style="{ background: swatch(t, 'bg') }"></i>
          <i :style="{ background: swatch(t, 'bgWhite') }"></i>
          <i :style="{ background: swatch(t, 'accent') }"></i>
          <i :style="{ background: swatch(t, 'sidebarBg') }"></i>
        </span>
        <span class="theme-name">{{ t.name }}</span>
        <span class="theme-desc">{{ t.desc || '自建主题' }}</span>
        <span v-if="t.kind === 'custom'" class="theme-del" title="删除这个主题"
              @click.stop="remove(t)">×</span>
      </button>
    </div>

    <div class="setting-row">
      <div class="data-info">
        <span class="data-info-label">切换策略</span>
        <span class="data-info-value">跟随系统会随操作系统的明暗变化；定时按本地时间切换。</span>
      </div>
    </div>
    <div class="follow-row">
      <button v-for="f in FOLLOWS" :key="f.id" class="chip" :class="{ on: themeStore.follow === f.id }" @click="themeStore.setFollow(f.id)">
        {{ f.label }}
      </button>
      <template v-if="themeStore.follow === 'schedule'">
        <input v-model="scheduleFrom" class="time-input" type="time" aria-label="开始时间" @change="onSchedule" />
        <span class="time-sep">至</span>
        <input v-model="scheduleTo" class="time-input" type="time" aria-label="结束时间" @change="onSchedule" />
      </template>
    </div>

    <div class="setting-row">
      <button class="data-btn" @click="exportThemes">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        导出主题
      </button>
      <label class="data-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        导入主题
        <input type="file" accept="application/json,.json" class="file-hidden" @change="onImport" />
      </label>
    </div>
    <div v-if="msg" class="sync-status" :class="{ error: msgError }">{{ msg }}</div>
  </section>
</template>

<script setup>
import { ref } from 'vue'
import { useThemeStore } from '@/stores/theme'
import { usePreferencesStore } from '@/stores/preferences'
import { colorsFromPreset } from '@/utils/themeSchema'
import { getScheme } from '@/utils/visualScheme'

defineEmits(['open-editor'])

const FOLLOWS = [
  { id: 'manual', label: '手动' },
  { id: 'system', label: '跟随系统' },
  { id: 'schedule', label: '定时' }
]

const themeStore = useThemeStore()
const preferences = usePreferencesStore()
const scheduleFrom = ref(themeStore.schedule.from)
const scheduleTo = ref(themeStore.schedule.to)
const msg = ref('')
const msgError = ref(false)

/**
 * 色块预览：优先取主题自己的覆盖值，没有就回落到它基础配色的（按当前明暗模式）。
 * 这里只为了取色显示，不参与真值 —— 真正生效的是 stores/theme.js 的 apply()。
 */
function swatch(t, key) {
  const mode = preferences.theme === 'dark' ? 'dark' : 'light'
  const own = t.colors?.[mode]?.[key]
  if (own) return own
  const accent = getScheme(t.schemeId || t.base || 'apple').accent || 'default'
  return colorsFromPreset(accent)[mode]?.[key] || '#888888'
}

function onSchedule() {
  themeStore.setSchedule({ from: scheduleFrom.value, to: scheduleTo.value })
}

function remove(t) {
  themeStore.deleteCustom(t.id)
  msg.value = `已删除「${t.name}」`
  msgError.value = false
}

function exportThemes() {
  const text = themeStore.exportThemes()
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'nav-themes.json'
  a.click()
  URL.revokeObjectURL(url)
  msg.value = '已导出自定义主题'
  msgError.value = false
}

async function onImport(e) {
  const file = e.target.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const res = themeStore.importThemes(text)
    msg.value = res.ok
      ? `已导入 ${res.count} 个主题${res.skipped ? `（跳过 ${res.skipped} 条无法识别的数据）` : ''}`
      : '文件里没有可识别的主题'
    msgError.value = !res.ok
  } catch {
    msg.value = '读取文件失败'
    msgError.value = true
  }
  e.target.value = ''
}
</script>

<style scoped>
.settings-section { padding: 16px 0; border-bottom: 1px solid var(--border-light); }
.section-header { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 14px; }
.section-header svg { width: 16px; height: 16px; color: var(--accent); opacity: 0.8; }
.setting-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; }
.data-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.data-info-label { font-size: 12px; font-weight: 500; color: var(--text-primary); }
.data-info-value { font-size: 11px; color: var(--text-secondary); line-height: 1.5; }
.data-btn { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-white); color: var(--text-primary); font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.15s ease; font-family: var(--font); flex-shrink: 0; }
.data-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-light); }
.data-btn svg { width: 16px; height: 16px; }
.file-hidden { display: none; }
.theme-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin: 10px 0 14px; }
.theme-card { position: relative; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; padding: 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-white); cursor: pointer; text-align: left; transition: all .15s ease; font-family: var(--font); }
.theme-card:hover { border-color: var(--accent); transform: translateY(-1px); }
.theme-card.active { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 22%, transparent); }
.theme-swatches { display: flex; gap: 3px; margin-bottom: 2px; }
.theme-swatches i { width: 22px; height: 14px; border-radius: 3px; border: 1px solid rgba(0,0,0,.12); }
.theme-name { font-size: 12px; font-weight: 600; color: var(--text-primary); }
.theme-desc { font-size: 10px; color: var(--text-secondary); line-height: 1.4; }
.theme-del { position: absolute; top: 6px; right: 8px; border: none; background: transparent; color: var(--text-secondary); font-size: 15px; line-height: 1; cursor: pointer; opacity: .6; }
.theme-del:hover { color: var(--color-danger); opacity: 1; }
.follow-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 0; }
.chip { padding: 5px 12px; border: 1px solid var(--border); border-radius: 999px; background: var(--bg-white); color: var(--text-secondary); font-size: 12px; cursor: pointer; font-family: var(--font); }
.chip.on { border-color: var(--accent); color: var(--accent); background: var(--accent-light); }
.time-input { padding: 4px 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-white); color: var(--text-primary); font-size: 12px; font-family: var(--font); }
.time-sep { font-size: 12px; color: var(--text-secondary); }
.sync-status { margin-top: 8px; font-size: 12px; color: var(--text-secondary); }
.sync-status.error { color: var(--color-danger); }
</style>
