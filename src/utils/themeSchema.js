/**
 * 主题模型：把「配色 + 视觉令牌 + 明暗」合成一个对象。
 *
 * ## 为什么要有这个文件
 *
 * 此前这三件事分散在三处：配色在 `preferences.THEME_PRESETS`、形状与质感在
 * `visualScheme.SCHEMES`、明暗是独立的 `theme`。结果是设置面板里出现「外观」与
 * 「视觉方案」两个入口，用户不知道先点哪个；而且换方案会清空令牌微调，调了半天一换全丢。
 *
 * 现在：
 *   - **内置主题** = SCHEMES 的一项（令牌）+ 它 accent 指向的那套配色 + 它的明暗。
 *     不新造一份真值，只是把两处已有的东西按 id 关联起来 —— 所以「主题」不是第三套机制。
 *   - **自定义主题** = 基于某个内置主题的一层覆盖（颜色覆盖 + 令牌覆盖）。
 *     存覆盖而不是完整快照：内置主题将来调整时，用户的主题会跟着变好而不是僵在旧值上。
 *
 * ## 行为等价
 *
 * 老用户升级后 `visualScheme` 仍是原来的值，主题层**不会**去覆盖它（见 stores/theme.js 的
 * 初始化），因此外观一帧都不变。主题只在用户主动点击内置主题/自定义主题时才介入。
 */
// 带 .js 扩展名：这份模块要能在 Node 里被测试直接 import（无扩展名的相对导入在
// Node ESM 下会 ERR_MODULE_NOT_FOUND，而 Vite 两种写法都认）
import { SCHEMES, TOKENS, getScheme } from './visualScheme.js'

/** 主题对象里出现的颜色键。省略的键沿用基础主题，这是「存覆盖」的关键 */
export const COLOR_KEYS = ['bg', 'bgWhite', 'sidebarBg', 'accent', 'accentLight']

export const COLOR_LABELS = {
  bg: '页面底色',
  bgWhite: '卡片底色',
  sidebarBg: '侧栏底色',
  accent: '强调色',
  accentLight: '强调浅色'
}

export const THEME_VERSION = 1

/**
 * 配色预设：明暗两套都要给。
 *
 * 侧栏底色一律取深色 —— 侧栏文字色是固定的浅色，换成浅底会直接读不出来。
 * 「宣纸」那种纸感靠内容区底色与低对比描边表达，不去动侧栏。
 */
export const THEME_PRESETS = {
  'default': {
    id: 'default',
    name: '默认蓝',
    primary: '#2563eb',
    bg: '#f1f5f9',
    bgWhite: '#ffffff',
    sidebarBg: '#0f172a',
    accent: '#2563eb',
    accentLight: '#dbeafe',
    dark: {
      bg: '#0f172a',
      bgWhite: '#1e293b',
      sidebarBg: '#020617',
      accent: '#3b82f6',
      accentLight: '#1e3a5f'
    }
  },
  'green': {
    id: 'green',
    name: '极客绿',
    primary: '#10b981',
    bg: '#ecfdf5',
    bgWhite: '#ffffff',
    sidebarBg: '#064e3b',
    accent: '#10b981',
    accentLight: '#d1fae5',
    dark: {
      bg: '#022c22',
      bgWhite: '#064e3b',
      sidebarBg: '#020617',
      accent: '#34d399',
      accentLight: '#064e3b'
    }
  },
  'purple': {
    id: 'purple',
    name: '赛博紫',
    primary: '#8b5cf6',
    bg: '#f5f3ff',
    bgWhite: '#ffffff',
    sidebarBg: '#2e1065',
    accent: '#8b5cf6',
    accentLight: '#ede9fe',
    dark: {
      bg: '#1e1b4b',
      bgWhite: '#2e1065',
      sidebarBg: '#020617',
      accent: '#a78bfa',
      accentLight: '#2e1065'
    }
  },
  'orange': {
    id: 'orange',
    name: '日落橙',
    primary: '#f59e0b',
    bg: '#fff7ed',
    bgWhite: '#ffffff',
    sidebarBg: '#431407',
    accent: '#f59e0b',
    accentLight: '#fef3c7',
    dark: {
      bg: '#1c1917',
      bgWhite: '#292524',
      sidebarBg: '#020617',
      accent: '#fbbf24',
      accentLight: '#431407'
    }
  },
  'paper': {
    id: 'paper',
    name: '宣纸',
    primary: '#0f766e',
    bg: '#f6f3ec',
    bgWhite: '#fffdf8',
    sidebarBg: '#33322e',
    accent: '#0f766e',
    accentLight: '#d7efe9',
    dark: {
      bg: '#1c1b19',
      bgWhite: '#26251f',
      sidebarBg: '#111110',
      accent: '#2dd4bf',
      accentLight: '#134e4a'
    }
  },
  'night': {
    id: 'night',
    name: '夜航',
    primary: '#38bdf8',
    bg: '#eef2f7',
    bgWhite: '#ffffff',
    sidebarBg: '#0b1220',
    accent: '#0284c7',
    accentLight: '#e0f2fe',
    dark: {
      bg: '#0b1220',
      bgWhite: '#111a2b',
      sidebarBg: '#070d18',
      accent: '#38bdf8',
      accentLight: '#0c4a6e'
    }
  }
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export function isHexColor(v) {
  return typeof v === 'string' && HEX.test(v.trim())
}

/** 从一个 preset 里取出主题要用的五个色（明暗各一组） */
export function colorsFromPreset(presetId) {
  const p = THEME_PRESETS[presetId] || THEME_PRESETS.default
  const pick = (src) => {
    const out = {}
    for (const k of COLOR_KEYS) if (src && typeof src[k] === 'string') out[k] = src[k]
    return out
  }
  return { light: pick(p), dark: pick(p.dark || p) }
}

/** 内置主题清单：一条 SCHEMES 项 = 一个主题（令牌 + 配色 + 明暗） */
export function builtinThemes() {
  return SCHEMES.map(s => ({
    id: `builtin:${s.id}`,
    kind: 'builtin',
    schemeId: s.id,
    name: s.name,
    desc: s.desc,
    base: s.mode,
    colors: colorsFromPreset(s.accent),
    tokens: { ...getScheme(s.id).tokens }
  }))
}

export function isBuiltinId(id) {
  return typeof id === 'string' && id.startsWith('builtin:')
}

export function schemeIdOf(id) {
  return isBuiltinId(id) ? id.slice('builtin:'.length) : ''
}

/* ---------- 自定义主题的校验与规范化 ---------- */

function tokenFits(key, value) {
  const spec = TOKENS[key]
  if (!spec) return false
  if (spec.type === 'range') return Number.isFinite(Number(value)) && Number(value) >= spec.min && Number(value) <= spec.max
  if (spec.type === 'toggle') return typeof value === 'boolean'
  if (spec.type === 'select') return spec.options.includes(value)
  return false
}

/**
 * 规范化一个（可能来自导入文件或旧版本的）自定义主题。
 * 非法项一律丢弃而不是拒绝整份数据 —— 用户在别处导出的老文件少一两个字段很常见，
 * 整体拒绝会让他无从下手；少掉的字段自然回落到基础主题。
 * @returns {object|null} 连基础主题都认不出来时返回 null
 */
export function normalizeCustom(raw) {
  if (!raw || typeof raw !== 'object') return null
  const base = typeof raw.base === 'string' ? raw.base : ''
  // 必须显式比对 SCHEMES：getScheme 对未知 id 会回退到首套（设计如此），
  // 拿它当校验会让「导入一个 base 不存在的主题」静默变成苹果原生。
  if (!SCHEMES.some(s => s.id === base)) return null

  const colors = { light: {}, dark: {} }
  for (const mode of ['light', 'dark']) {
    const src = raw.colors?.[mode]
    if (!src || typeof src !== 'object') continue
    for (const k of COLOR_KEYS) {
      if (isHexColor(src[k])) colors[mode][k] = String(src[k]).trim()
    }
  }

  const tokens = {}
  for (const [k, v] of Object.entries(raw.tokens || {})) {
    if (tokenFits(k, v)) tokens[k] = v
  }

  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 24) : '我的主题'
  const id = typeof raw.id === 'string' && raw.id.startsWith('user:') ? raw.id : newCustomId()

  return { id, kind: 'custom', name, base, colors, tokens }
}

let seq = 0
export function newCustomId() {
  seq += 1
  return `user:${Date.now().toString(36)}${seq.toString(36)}`
}

/** 造一个基于指定内置主题的空白自定义主题 */
export function blankCustomFrom(schemeId, name = '我的主题') {
  const s = getScheme(schemeId)
  return {
    id: newCustomId(),
    kind: 'custom',
    name,
    base: s.id,
    colors: colorsFromPreset(s.accent),
    tokens: {}
  }
}

/* ---------- 导入 / 导出 ---------- */

export function serializeThemes(list) {
  return JSON.stringify({ v: THEME_VERSION, themes: list }, null, 2)
}

/** 解析导入文本。返回 {themes: [...], skipped: number} */
export function parseThemes(text) {
  let data
  try { data = JSON.parse(String(text || '')) } catch { return { themes: [], skipped: 0 } }
  const raw = Array.isArray(data) ? data : (Array.isArray(data?.themes) ? data.themes : [])
  const themes = []
  let skipped = 0
  for (const r of raw) {
    const t = normalizeCustom(r)
    if (t) themes.push(t)
    else skipped += 1
  }
  return { themes, skipped }
}

/**
 * 分享码：把主题塞进一段可粘贴的文本。
 * 只编码自定义主题（内置主题大家都有，传 id 就行），用 base64 而非裸 JSON，
 * 是为了让它能安全地放进链接的 query 里。
 */
export function toShareCode(theme) {
  const t = normalizeCustom(theme)
  if (!t) return ''
  try {
    const json = JSON.stringify(t)
    return btoa(unescape(encodeURIComponent(json)))
  } catch {
    return ''
  }
}

export function fromShareCode(code) {
  try {
    const json = decodeURIComponent(escape(atob(String(code || '').trim())))
    return normalizeCustom(JSON.parse(json))
  } catch {
    return null
  }
}
