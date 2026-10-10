<template>
  <div class="editor-root" @pointerdown.self="cancel">
    <aside class="editor-panel" role="dialog" aria-label="主题编辑器">
      <header class="editor-head">
        <div>
          <h3 class="editor-title">{{ isNew ? '新建主题' : '编辑主题' }}</h3>
          <p class="editor-sub">基于「{{ baseName }}」· 改动即时预览，取消即还原</p>
        </div>
        <button class="editor-close" aria-label="关闭" @click="cancel">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </header>

      <div class="editor-body">
        <div class="field">
          <label class="field-label">名称</label>
          <input v-model="draft.name" class="field-input" maxlength="24" placeholder="给这个主题起个名字" />
        </div>

        <div class="field">
          <label class="field-label">基础方案</label>
          <select v-model="draft.base" class="field-input" @change="onBaseChange">
            <option v-for="s in builtins" :key="s.schemeId" :value="s.schemeId">{{ s.name }}</option>
          </select>
          <p class="field-hint">基础方案提供默认值，你改过的项才写进主题里。</p>
        </div>

        <div class="field">
          <div class="field-label-row">
            <label class="field-label">配色</label>
            <div class="mode-switch">
              <button :class="{ on: mode === 'light' }" @click="mode = 'light'">浅色</button>
              <button :class="{ on: mode === 'dark' }" @click="mode = 'dark'">深色</button>
            </div>
          </div>
          <div class="color-grid">
            <div v-for="k in colorKeys" :key="k" class="color-row">
              <input type="color" :value="colorValue(k)" @input="setColor(k, $event.target.value)" />
              <span class="color-name">{{ colorLabels[k] }}</span>
              <code class="color-hex">{{ colorValue(k) }}</code>
            </div>
          </div>
          <button v-if="preferences.wallpaper" class="link-btn" @click="pickFromWallpaper">从壁纸取主色</button>
          <p v-else class="field-hint">在设置里填一张壁纸后，可以从它取主色。</p>
        </div>

        <div class="field">
          <label class="field-label">形状与质感</label>
          <div class="token-list">
            <div v-for="t in tokenList" :key="t.key" class="token-row">
              <span class="token-name">{{ t.label }}</span>
              <input type="range" :min="t.min" :max="t.max" :step="t.step"
                     :value="tokenValue(t.key)" @input="setToken(t.key, $event.target.value)" />
              <span class="token-value">{{ tokenValue(t.key) }}{{ t.unit }}</span>
            </div>
          </div>
          <p class="field-hint">其余令牌沿用基础方案；完整微调在「视觉方案」里。</p>
        </div>
      </div>

      <footer class="editor-foot">
        <button v-if="!isNew" class="foot-btn danger" @click="remove">删除</button>
        <span class="foot-spacer"></span>
        <button class="foot-btn" @click="cancel">取消</button>
        <button class="foot-btn primary" @click="save">保存并应用</button>
      </footer>
    </aside>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useThemeStore } from '@/stores/theme'
import { usePreferencesStore } from '@/stores/preferences'
import { useToastStore } from '@/stores/toast'
import { COLOR_KEYS, COLOR_LABELS, colorsFromPreset } from '@/utils/themeSchema'
import { TOKENS, getScheme } from '@/utils/visualScheme'

const emit = defineEmits(['close'])

const themeStore = useThemeStore()
const preferences = usePreferencesStore()
const toastStore = useToastStore()

const colorKeys = COLOR_KEYS
const colorLabels = COLOR_LABELS
const builtins = computed(() => themeStore.builtins)

/** 编辑器里的关键令牌：够造出辨识度，又不至于把面板变成第二个「视觉方案」 */
const tokenList = [
  { key: 'radiusCard' },
  { key: 'shadowLevel' },
  { key: 'cardPadding' },
  { key: 'gridGap' },
  { key: 'glassBlur' },
  { key: 'fontSizeBase' }
].map(t => ({ ...t, ...TOKENS[t.key] }))

const draft = ref(themeStore.draftFromCurrent())
const mode = ref(preferences.theme === 'dark' ? 'dark' : 'light')
const isNew = computed(() => !themeStore.customThemes.some(t => t.id === draft.value.id))
const baseName = computed(() => getScheme(draft.value.base).name)

// 进入编辑器时记一份快照：取消要能完整还原，包括「用户本来没选过主题」这件事
const snapshot = { activeId: themeStore.activeId, scheme: preferences.visualScheme, overrides: { ...preferences.visualOverrides }, preset: preferences.themePreset }

function colorValue(k) {
  return draft.value.colors?.[mode.value]?.[k] || fallbackColor(k)
}
function fallbackColor(k) {
  const s = getScheme(draft.value.base)
  const pair = colorsFromPreset(s.accent)
  return pair[mode.value]?.[k] || ''
}

function setColor(k, v) {
  if (!draft.value.colors[mode.value]) draft.value.colors[mode.value] = {}
  draft.value.colors[mode.value][k] = v
  preview()
}

function tokenValue(k) {
  const own = draft.value.tokens?.[k]
  if (own !== undefined) return own
  const s = getScheme(draft.value.base)
  return s.tokens[k]
}

function setToken(k, v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return
  draft.value.tokens = { ...(draft.value.tokens || {}), [k]: n }
  preview()
}

/** 换基础方案：默认值整体换掉，已改过的项保留 */
function onBaseChange() {
  const s = getScheme(draft.value.base)
  const pair = colorsFromPreset(s.accent)
  draft.value.colors = {
    light: { ...pair.light, ...(draft.value.colors?.light || {}) },
    dark: { ...pair.dark, ...(draft.value.colors?.dark || {}) }
  }
  preview()
}

/** 即时预览：直接落 CSS 变量，不写进 store —— 保存才落库，取消则还原 */
function preview() {
  preferences.applyColors(colorMap())
  preferences.setVisualTokens(draft.value.tokens || {})
}

function colorMap() {
  const own = draft.value.colors?.[mode.value] || {}
  const s = getScheme(draft.value.base)
  return { ...colorsFromPreset(s.accent)[mode.value], ...own }
}

function save() {
  const res = themeStore.saveCustom({ ...draft.value, tokens: draft.value.tokens || {} })
  if (res.ok) toastStore.push({ message: `已保存主题「${draft.value.name}」`, tone: 'ok' })
  else toastStore.push({ message: '主题数据不合法，未能保存', tone: 'error' })
  emit('close')
}

function cancel() {
  // 还原：先回到快照里的方案（会清掉预览写入的微调），再补回用户原本的微调
  preferences.setVisualScheme(snapshot.scheme)
  preferences.setVisualTokens(snapshot.overrides)
  themeStore.activeId = snapshot.activeId
  emit('close')
}

function remove() {
  const name = draft.value.name
  themeStore.deleteCustom(draft.value.id)
  toastStore.push({ message: `已删除主题「${name}」`, tone: 'info' })
  emit('close')
}

/**
 * 从壁纸取主色：把图缩到 32×32 后按亮度分桶取均值。
 * 跨域图片会污染 canvas，getImageData 直接抛错 —— 那时明确提示，不静默失败。
 */
async function pickFromWallpaper() {
  const url = preferences.wallpaper
  if (!url) return
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = url
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej })
    const c = document.createElement('canvas')
    c.width = 32
    c.height = 32
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0, 32, 32)
    const data = ctx.getImageData(0, 0, 32, 32).data
    const buckets = [[], [], []]
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      const idx = lum < 80 ? 0 : lum < 170 ? 1 : 2
      buckets[idx].push([r, g, b])
    }
    const avg = (arr) => {
      if (!arr.length) return null
      const s = arr.reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]], [0, 0, 0])
      const n = arr.length
      return '#' + s.map(v => Math.round(v / n).toString(16).padStart(2, '0')).join('')
    }
    const accent = avg(buckets[1]) || avg(buckets[0]) || avg(buckets[2])
    if (!accent) throw new Error('empty')
    if (!draft.value.colors[mode.value]) draft.value.colors[mode.value] = {}
    draft.value.colors[mode.value].accent = accent
    // 浅色底取最亮的一档，深色底取最暗的一档 —— 直接拿主色当底色会脏
    const bg = mode.value === 'dark' ? (avg(buckets[0]) || accent) : (avg(buckets[2]) || accent)
    draft.value.colors[mode.value].bg = mix(bg, mode.value === 'dark' ? '#000000' : '#ffffff', 0.72)
    preview()
    toastStore.push({ message: '已取到主色，可以再微调', tone: 'ok' })
  } catch {
    toastStore.push({ message: '这张壁纸不允许取样，请手动选色', tone: 'error' })
  }
}

function mix(a, b, ratio) {
  const pa = a.replace('#', '')
  const pb = b.replace('#', '')
  const to = (s) => [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16))
  const [x, y] = [to(pa), to(pb)]
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * ratio).toString(16).padStart(2, '0')).join('')
}

onMounted(() => {
  // 进入即以当前草稿预览一次，让用户看到「从这个样子开始改」
  preview()
})
</script>

<style scoped>
.editor-root { position: fixed; inset: 0; z-index: 470; background: rgba(15, 23, 42, .35); display: flex; justify-content: flex-end; }
.editor-panel { width: 380px; max-width: 92vw; height: 100%; background: var(--bg-white); border-left: 1px solid var(--border); display: flex; flex-direction: column; box-shadow: -8px 0 30px rgba(0,0,0,.18); }
.editor-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 18px 12px; border-bottom: 1px solid var(--border-light); }
.editor-title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
.editor-sub { margin: 4px 0 0; font-size: 12px; color: var(--text-secondary); }
.editor-close { width: 28px; height: 28px; border: none; border-radius: 8px; background: transparent; color: var(--text-secondary); display: flex; align-items: center; justify-content: center; cursor: pointer; }
.editor-close:hover { background: var(--border-light); }
.editor-close svg { width: 16px; height: 16px; }
.editor-body { flex: 1; overflow: auto; padding: 14px 18px; display: flex; flex-direction: column; gap: 18px; }
.field { display: flex; flex-direction: column; gap: 8px; }
.field-label { font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: .5px; opacity: .8; }
.field-label-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.field-input { width: 100%; box-sizing: border-box; padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text-primary); font-size: 13px; font-family: var(--font); outline: none; }
.field-input:focus { border-color: var(--accent); }
.field-hint { margin: 0; font-size: 11px; line-height: 1.6; color: var(--text-secondary); opacity: .8; }
.mode-switch { display: flex; gap: 2px; padding: 2px; background: var(--border-light); border-radius: 8px; }
.mode-switch button { border: none; background: transparent; padding: 3px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; color: var(--text-secondary); cursor: pointer; font-family: var(--font); }
.mode-switch button.on { background: var(--bg-white); color: var(--accent); }
.color-grid { display: flex; flex-direction: column; gap: 6px; }
.color-row { display: flex; align-items: center; gap: 10px; }
.color-row input[type="color"] { width: 34px; height: 26px; padding: 0; border: 1px solid var(--border); border-radius: 6px; background: none; cursor: pointer; }
.color-name { flex: 1; font-size: 12px; color: var(--text-primary); }
.color-hex { font-size: 11px; color: var(--text-secondary); font-family: var(--font-mono, monospace); }
.link-btn { align-self: flex-start; border: none; background: transparent; color: var(--accent); font-size: 12px; cursor: pointer; padding: 0; font-family: var(--font); }
.link-btn:hover { text-decoration: underline; }
.token-list { display: flex; flex-direction: column; gap: 10px; }
.token-row { display: grid; grid-template-columns: 84px 1fr 52px; align-items: center; gap: 10px; }
.token-name { font-size: 12px; color: var(--text-primary); }
.token-row input[type="range"] { width: 100%; accent-color: var(--accent); }
.token-value { font-size: 11px; color: var(--text-secondary); text-align: right; font-variant-numeric: tabular-nums; }
.editor-foot { display: flex; align-items: center; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--border-light); }
.foot-spacer { flex: 1; }
.foot-btn { padding: 7px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-white); color: var(--text-primary); font-size: 12px; font-weight: 500; cursor: pointer; font-family: var(--font); }
.foot-btn:hover { border-color: var(--accent); color: var(--accent); }
.foot-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--color-on-solid); }
.foot-btn.primary:hover { opacity: .9; color: var(--color-on-solid); }
.foot-btn.danger { color: var(--color-danger); border-color: var(--color-danger); }
.foot-btn.danger:hover { background: var(--color-danger); color: var(--color-on-solid); }
@media (max-width: 768px) {
  .editor-panel { width: 100%; }
}
</style>
