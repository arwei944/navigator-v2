<template>
  <section class="settings-section">
    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4z"/><path d="M18 16l.9 2.1L21 19l-2.1.9L18 22l-.9-2.1L15 19l2.1-.9z"/></svg>
      <span>视觉方案</span>
      <span v-if="prefs.isVisualCustomized" class="custom-badge">已微调</span>
      <button v-if="prefs.isVisualCustomized" class="reset-btn" @click="prefs.resetVisualTokens()">恢复方案默认</button>
    </div>

    <!-- 方案预设：每套都是完整取值，点一下整体换装 -->
    <div class="scheme-grid">
      <button
        v-for="s in schemes" :key="s.id"
        class="scheme-card" :class="{ active: prefs.visualScheme === s.id }"
        :title="s.desc"
        @click="prefs.setVisualScheme(s.id)"
      >
        <span class="scheme-preview" :style="previewStyle(s)">
          <span class="preview-card">
            <span class="preview-line w70"></span>
            <span class="preview-line w45"></span>
          </span>
          <span class="preview-dots">
            <i v-for="i in s.tokens.gridCols" :key="i"></i>
          </span>
        </span>
        <span class="scheme-meta">
          <span class="scheme-name">{{ s.name }}</span>
          <span class="scheme-desc">{{ s.desc }}</span>
        </span>
      </button>
    </div>

    <!-- 微调：按维度分组，改任一项即进入「已微调」 -->
    <div class="tune-list">
      <div v-for="d in dimensions" :key="d.id" class="tune-group">
        <div class="tune-title">{{ d.label }}</div>

        <template v-for="t in tokensOf(d.id)" :key="t.key">
          <label v-if="t.type === 'toggle'" class="tune-row tune-toggle">
            <span class="tune-label">{{ t.label }}</span>
            <input type="checkbox" :checked="prefs.activeTokens[t.key]"
                   @change="prefs.setVisualToken(t.key, $event.target.checked)">
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>

          <div v-else-if="t.type === 'select'" class="tune-row">
            <span class="tune-label">{{ t.label }}</span>
            <select class="tune-select" :value="prefs.activeTokens[t.key]"
                    @change="prefs.setVisualToken(t.key, $event.target.value)">
              <option v-for="o in t.options" :key="o" :value="o">{{ (t.optionLabels && t.optionLabels[o]) || o }}</option>
            </select>
          </div>

          <div v-else class="tune-row">
            <span class="tune-label">{{ t.label }}</span>
            <input class="tune-range" type="range" :min="t.min" :max="t.max" :step="t.step"
                   :value="prefs.activeTokens[t.key]"
                   @input="prefs.setVisualToken(t.key, Number($event.target.value))">
            <span class="tune-value">{{ prefs.activeTokens[t.key] }}{{ t.unit }}</span>
          </div>
        </template>

        <!-- 配色不另立真值来源，直接驱动「外观」里那两个字段 -->
        <template v-if="d.id === 'motion'">
          <div class="tune-row">
            <span class="tune-label">强调色</span>
            <div class="accent-row">
              <button v-for="a in accents" :key="a.id"
                      class="accent-dot" :class="{ active: prefs.themePreset === a.id }"
                      :style="{ background: accentColor(a.id) }"
                      :title="a.name"
                      @click="prefs.setThemePreset(a.id)"></button>
            </div>
          </div>
          <div class="tune-row">
            <span class="tune-label">主题模式</span>
            <div class="segmented">
              <button class="seg-btn" :class="{ active: prefs.theme === 'light' }" @click="setMode('light')">浅色</button>
              <button class="seg-btn" :class="{ active: prefs.theme === 'dark' }" @click="setMode('dark')">深色</button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>

<script setup>
import { usePreferencesStore } from '@/stores/preferences'
import {
  SCHEMES, DIMENSIONS, TOKENS, ACCENT_PRESETS,
  resolveTokens, tokensToCssVars
} from '@/utils/visualScheme'

const prefs = usePreferencesStore()
const schemes = SCHEMES
const dimensions = DIMENSIONS
const accents = ACCENT_PRESETS

// panel:'card' 的令牌归「卡片设置」面板管，这里不重复列出（同一 store，只是换个入口）
const tokensOf = dimId => Object.entries(TOKENS)
  .filter(([, t]) => t.dim === dimId && t.panel !== 'card')
  .map(([key, t]) => ({ key, ...t }))

/** 预览缩略图：把该方案的圆角/阴影/描边/内边距/密度映射到小样上，一眼能看出差别 */
function previewStyle(s) {
  const t = resolveTokens(s.id, {})
  const vars = tokensToCssVars(t, s.mode)
  return {
    '--p-radius': vars['--radius'],
    '--p-shadow': vars['--shadow-card'],
    '--p-border': vars['--border'],
    '--p-pad': `${Math.max(3, Math.round(t.cardPadding / 5))}px`,
    '--p-line': `${Math.max(2, Math.round(t.fontSizeBase / 5))}px`,
    '--p-cols': t.gridCols
  }
}

function accentColor(id) {
  return (prefs.THEME_PRESETS[id] || prefs.THEME_PRESETS.default).primary
}

function setMode(mode) {
  if (prefs.theme !== mode) prefs.toggleTheme()
}
</script>

<style scoped>
.settings-section { padding: 16px 0; border-bottom: 1px solid var(--border-light); }
.settings-section:last-child { border-bottom: none; }
.section-header { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 14px; }
.section-header svg { width: 16px; height: 16px; color: var(--accent); opacity: 0.8; flex-shrink: 0; }
.custom-badge { font-size: 11px; font-weight: 600; color: var(--accent); background: var(--accent-light); padding: 2px 7px; border-radius: 10px; }
.reset-btn { margin-left: auto; font-size: 11px; font-family: var(--font); color: var(--text-secondary); background: transparent; border: 1px solid var(--border); border-radius: 6px; padding: 3px 9px; cursor: pointer; transition: color var(--transition), border-color var(--transition); }
.reset-btn:hover { color: var(--accent); border-color: var(--accent); }

/* 方案预设 */
.scheme-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 18px; }
.scheme-card { display: flex; align-items: center; gap: 10px; padding: 9px 10px; text-align: left; font-family: var(--font); background: var(--bg-white); border: 1px solid var(--border); border-radius: 10px; cursor: pointer; transition: border-color var(--transition), box-shadow var(--transition); }
.scheme-card:hover { border-color: var(--accent); }
.scheme-card.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.scheme-preview { flex-shrink: 0; width: 54px; height: 40px; display: flex; flex-direction: column; justify-content: center; gap: 3px; background: var(--border-light); border-radius: 6px; padding: 4px 5px; }
.preview-card { display: flex; flex-direction: column; gap: 3px; padding: var(--p-pad); border-radius: var(--p-radius); border: 1px solid var(--p-border); box-shadow: var(--p-shadow); background: var(--bg-white); }
.preview-line { display: block; height: var(--p-line); border-radius: 2px; background: var(--border); }
.preview-line.w70 { width: 70%; }
.preview-line.w45 { width: 45%; }
.preview-dots { display: grid; grid-template-columns: repeat(var(--p-cols), 1fr); gap: 2px; }
.preview-dots i { height: 3px; border-radius: 1px; background: var(--border); }
.scheme-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.scheme-name { font-size: 12px; font-weight: 600; color: var(--text-primary); }
.scheme-desc { font-size: 11px; color: var(--text-secondary); line-height: 1.35; }

/* 微调 */
.tune-list { display: flex; flex-direction: column; gap: 14px; }
.tune-group { display: flex; flex-direction: column; gap: 2px; }
.tune-title { font-size: 12px; font-weight: 600; color: var(--text-primary); opacity: .75; margin-bottom: 4px; }
.tune-row { display: flex; align-items: center; gap: 10px; padding: 4px 0; }
.tune-label { flex-shrink: 0; width: 84px; font-size: 12px; color: var(--text-secondary); }
.tune-range { flex: 1; min-width: 0; height: 4px; -webkit-appearance: none; appearance: none; background: var(--border); border-radius: 2px; outline: none; cursor: pointer; }
.tune-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 13px; height: 13px; border-radius: 50%; background: var(--accent); border: 2px solid var(--bg-white); box-shadow: 0 1px 3px rgba(0,0,0,.2); cursor: pointer; }
.tune-range::-moz-range-thumb { width: 13px; height: 13px; border-radius: 50%; background: var(--accent); border: 2px solid var(--bg-white); cursor: pointer; }
.tune-value { flex-shrink: 0; width: 46px; text-align: right; font-size: 11px; font-variant-numeric: tabular-nums; color: var(--text-secondary); }
.tune-select { flex: 1; min-width: 0; padding: 5px 8px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg-white); color: var(--text-primary); font-size: 12px; font-family: var(--font); cursor: pointer; outline: none; }
.tune-select:focus { border-color: var(--accent); }
.tune-toggle { cursor: pointer; }
.tune-toggle input { display: none; }
.tune-toggle .tune-label { width: auto; flex: 1; }
.toggle-track { width: 34px; height: 20px; background: var(--border); border-radius: 10px; position: relative; transition: background var(--transition); flex-shrink: 0; }
.tune-toggle input:checked + .toggle-track { background: var(--accent); }
.toggle-thumb { position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform var(--transition); box-shadow: 0 1px 3px rgba(0,0,0,.15); }
.tune-toggle input:checked + .toggle-track .toggle-thumb { transform: translateX(14px); }

.accent-row { display: flex; gap: 7px; }
.accent-dot { width: 18px; height: 18px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; transition: transform var(--transition), box-shadow var(--transition); }
.accent-dot:hover { transform: scale(1.12); }
.accent-dot.active { box-shadow: 0 0 0 2px var(--bg-white), 0 0 0 4px currentColor; }
.segmented { display: flex; gap: 3px; background: var(--border-light); padding: 3px; border-radius: 8px; }
.seg-btn { padding: 4px 12px; border: none; border-radius: 6px; background: transparent; color: var(--text-secondary); font-size: 12px; font-weight: 500; font-family: var(--font); cursor: pointer; transition: all var(--transition); }
.seg-btn.active { background: var(--bg-white); color: var(--text-primary); box-shadow: 0 1px 3px rgba(0,0,0,.08); }
</style>