/**
 * 视觉方案：把「一整套前端视觉 + 组件视觉」抽象成一组设计令牌。
 *
 * 模型
 *  - SCHEMES 是若干套完整方案，每套给出全部令牌的取值 —— 点一下即整体换装。
 *  - 用户可在方案基础上逐项微调，微调值存进 overrides，与方案取合并后生效。
 *  - 令牌最终落成 :root 上的 CSS 变量，全站组件消费这些变量，所以是「全站统一生效」。
 *
 * 为什么用 CSS 变量而不是给组件传 props：令牌要在 40+ 个组件、上百处声明里生效，
 * 变量是唯一能做到「一处改、全站响应」且不改动组件模板的方式。
 */

/** 字体族可选项。前三个为回退栈，避免依赖网络字体。 */
export const FONT_STACKS = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans SC', sans-serif",
  sans: "'Inter', 'Helvetica Neue', Arial, 'PingFang SC', 'Noto Sans SC', sans-serif",
  serif: "Georgia, 'Times New Roman', 'Songti SC', 'Noto Serif SC', serif",
  mono: "'SF Mono', 'JetBrains Mono', Menlo, Consolas, 'Noto Sans SC', monospace"
}

export const FONT_LABELS = {
  system: '系统默认',
  sans: '无衬线',
  serif: '衬线',
  mono: '等宽'
}

/** 六个维度，用于设置面板分组 */
export const DIMENSIONS = [
  { id: 'shape', label: '圆角与形状' },
  { id: 'elevation', label: '阴影与层次' },
  { id: 'density', label: '密度与间距' },
  { id: 'glass', label: '玻璃与透明' },
  { id: 'type', label: '字体与字号' },
  { id: 'motion', label: '动效与配色' }
]

/**
 * 令牌登记表。dim = 所属维度；type 决定面板里渲染哪种控件。
 * 只有 range / select / toggle 三种，够覆盖全部维度且不会失控。
 */
export const TOKENS = {
  radiusCard: { dim: 'shape', label: '卡片圆角', type: 'range', min: 0, max: 28, step: 1, unit: 'px', default: 12 },
  radiusControl: { dim: 'shape', label: '控件圆角', type: 'range', min: 0, max: 20, step: 1, unit: 'px', default: 8 },
  borderStrength: { dim: 'shape', label: '描边强度', type: 'range', min: 0, max: 100, step: 5, unit: '%', default: 100 },

  shadowLevel: { dim: 'elevation', label: '阴影强度', type: 'range', min: 0, max: 150, step: 10, unit: '%', default: 100 },

  cardPadding: { dim: 'density', label: '卡片内边距', type: 'range', min: 8, max: 32, step: 2, unit: 'px', default: 18 },
  gridGap: { dim: 'density', label: '卡片间距', type: 'range', min: 4, max: 32, step: 2, unit: 'px', default: 14 },
  gridCols: { dim: 'density', label: '每行卡片数', type: 'range', min: 2, max: 6, step: 1, unit: ' 列', default: 3 },
  navItemHeight: { dim: 'density', label: '导航项高度', type: 'range', min: 32, max: 52, step: 2, unit: 'px', default: 40 },

  glassBlur: { dim: 'glass', label: '毛玻璃模糊', type: 'range', min: 0, max: 40, step: 2, unit: 'px', default: 20 },
  glassAlpha: { dim: 'glass', label: '面板不透明度', type: 'range', min: 40, max: 100, step: 5, unit: '%', default: 72 },

  fontFamily: { dim: 'type', label: '字体族', type: 'select', options: Object.keys(FONT_STACKS), optionLabels: FONT_LABELS, default: 'system' },
  fontSizeBase: { dim: 'type', label: '基础字号', type: 'range', min: 12, max: 18, step: 1, unit: 'px', default: 14 },
  titleWeight: { dim: 'type', label: '标题字重', type: 'range', min: 400, max: 800, step: 100, unit: '', default: 600 },

  motionDuration: { dim: 'motion', label: '过渡时长', type: 'range', min: 0, max: 400, step: 20, unit: 'ms', default: 150 },
  cardAnim: { dim: 'motion', label: '卡片入场动画', type: 'toggle', default: true }
}

/** 强调色沿用「外观」里的主题配色预设，不另立一套，避免两个真值来源 */
export const ACCENT_PRESETS = [
  { id: 'default', name: '默认蓝' },
  { id: 'green', name: '极客绿' },
  { id: 'purple', name: '赛博紫' },
  { id: 'orange', name: '日落橙' }
]

/** 全部令牌的默认值 */
export const DEFAULT_TOKENS = Object.fromEntries(
  Object.entries(TOKENS).map(([k, t]) => [k, t.default])
)

/**
 * 预设方案。每套都是完整取值，不依赖继承，切换即整体换装。
 * accent / mode 直接驱动现有的 themePreset / theme，所以配色也是方案的一部分。
 */
export const SCHEMES = [
  {
    id: 'apple', name: '苹果原生', desc: '当前默认，均衡克制', accent: 'default', mode: 'light',
    tokens: { radiusCard: 12, radiusControl: 8, borderStrength: 100, shadowLevel: 100, cardPadding: 18, gridGap: 14, gridCols: 3, navItemHeight: 40, glassBlur: 20, glassAlpha: 72, fontFamily: 'system', fontSizeBase: 14, titleWeight: 600, motionDuration: 150, cardAnim: true }
  },
  {
    id: 'flat', name: '极简扁平', desc: '去阴影、小圆角、边界靠描边', accent: 'default', mode: 'light',
    tokens: { radiusCard: 4, radiusControl: 4, borderStrength: 55, shadowLevel: 0, cardPadding: 16, gridGap: 12, gridCols: 3, navItemHeight: 38, glassBlur: 0, glassAlpha: 100, fontFamily: 'system', fontSizeBase: 14, titleWeight: 500, motionDuration: 120, cardAnim: false }
  },
  {
    id: 'glass', name: '玻璃拟态', desc: '大圆角、强模糊、半透明面板', accent: 'purple', mode: 'light',
    tokens: { radiusCard: 18, radiusControl: 12, borderStrength: 70, shadowLevel: 55, cardPadding: 20, gridGap: 16, gridCols: 3, navItemHeight: 42, glassBlur: 34, glassAlpha: 52, fontFamily: 'system', fontSizeBase: 14, titleWeight: 600, motionDuration: 220, cardAnim: true }
  },
  {
    id: 'compact', name: '紧凑高密度', desc: '小内边距、5 列、矮导航', accent: 'green', mode: 'light',
    tokens: { radiusCard: 8, radiusControl: 6, borderStrength: 100, shadowLevel: 60, cardPadding: 10, gridGap: 8, gridCols: 5, navItemHeight: 32, glassBlur: 12, glassAlpha: 88, fontFamily: 'system', fontSizeBase: 13, titleWeight: 600, motionDuration: 100, cardAnim: false }
  },
  {
    id: 'cozy', name: '宽松舒适', desc: '大内边距、2 列、慢过渡', accent: 'orange', mode: 'light',
    tokens: { radiusCard: 16, radiusControl: 10, borderStrength: 80, shadowLevel: 110, cardPadding: 26, gridGap: 22, gridCols: 2, navItemHeight: 48, glassBlur: 26, glassAlpha: 82, fontFamily: 'system', fontSizeBase: 15, titleWeight: 600, motionDuration: 240, cardAnim: true }
  },
  {
    id: 'contrast', name: '高对比硬朗', desc: '直角、重阴影、深色底', accent: 'default', mode: 'dark',
    tokens: { radiusCard: 2, radiusControl: 2, borderStrength: 100, shadowLevel: 140, cardPadding: 18, gridGap: 14, gridCols: 3, navItemHeight: 42, glassBlur: 0, glassAlpha: 100, fontFamily: 'sans', fontSizeBase: 15, titleWeight: 700, motionDuration: 120, cardAnim: false }
  }
]

export function getScheme(id) {
  return SCHEMES.find(s => s.id === id) || SCHEMES[0]
}

/** 方案 + 微调 → 最终令牌。微调里非法/超范围的键值一律忽略，避免脏数据把界面搞坏。 */
export function resolveTokens(schemeId, overrides = {}) {
  const base = { ...DEFAULT_TOKENS, ...getScheme(schemeId).tokens }
  const out = { ...base }
  for (const [key, raw] of Object.entries(overrides || {})) {
    const spec = TOKENS[key]
    if (!spec) continue
    if (spec.type === 'range') {
      const n = Number(raw)
      if (!Number.isFinite(n)) continue
      out[key] = Math.min(spec.max, Math.max(spec.min, n))
    } else if (spec.type === 'toggle') {
      out[key] = !!raw
    } else if (spec.type === 'select') {
      if (spec.options.includes(raw)) out[key] = raw
    }
  }
  return out
}

/* ---------- 令牌 → CSS 变量 ---------- */

/** 每个主题模式下的「基准色」，令牌在它们之上做强度混合 */
const MODE_BASE = {
  light: { border: '#e5e5e7', borderLight: '#f0f0f2', surface: '#ffffff', glass: [255, 255, 255], shadowMul: 1 },
  dark: { border: '#3a3a3e', borderLight: '#323236', surface: '#2c2c30', glass: [44, 44, 48], shadowMul: 2.4 }
}

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]
}

/** ratio = 0 保留 base，= 1 完全变成 target */
function mix(baseHex, targetHex, ratio) {
  const a = hexToRgb(baseHex), b = hexToRgb(targetHex)
  const r = Math.min(1, Math.max(0, ratio))
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * r))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

const px = n => `${n}px`
const alpha = n => Math.max(0, Math.min(1, n)).toFixed(3)

/**
 * 语义色：卡片/控件的**状态色**（在线·限流·失效、收藏、热度分档、禁用灰）。
 * 刻意不放进 TOKENS —— 它们表达「状态」而非「风格」，不该被方案改来改去；
 * 但必须**随主题模式取明暗两套值**，否则深色主题下会出现 #fefce8 这种亮黄块。
 */
const SEMANTIC = {
  light: {
    ok: '#22c55e', warn: '#f59e0b', danger: '#ef4444', muted: '#94a3b8',
    favorite: '#eab308', favoriteBg: '#fefce8', favoriteBorder: '#eab308',
    heatWarm: '#b45309', heatWarmBg: 'rgba(245, 158, 11, 0.18)',
    heatHot: '#dc2626', heatHotBg: 'rgba(239, 68, 68, 0.16)',
    onSolid: '#ffffff'
  },
  dark: {
    ok: '#4ade80', warn: '#fbbf24', danger: '#f87171', muted: '#64748b',
    favorite: '#facc15', favoriteBg: 'rgba(234, 179, 8, 0.16)', favoriteBorder: 'rgba(250, 204, 21, 0.45)',
    heatWarm: '#fbbf24', heatWarmBg: 'rgba(245, 158, 11, 0.22)',
    heatHot: '#f87171', heatHotBg: 'rgba(239, 68, 68, 0.22)',
    onSolid: '#ffffff'
  }
}

/** 令牌 → 一批 CSS 自定义属性 */
export function tokensToCssVars(tokens, mode = 'light') {
  const M = MODE_BASE[mode] || MODE_BASE.light
  const S = SEMANTIC[mode] || SEMANTIC.light
  const s = (tokens.shadowLevel / 100) * M.shadowMul
  const fade = 1 - tokens.borderStrength / 100
  const [gr, gg, gb] = M.glass
  const fam = FONT_STACKS[tokens.fontFamily] || FONT_STACKS.system

  return {
    '--radius': px(tokens.radiusCard),
    '--radius-sm': px(tokens.radiusControl),
    // 大圆角跟着卡片圆角走，保持形状语言的层级关系
    '--radius-lg': px(tokens.radiusCard + 4),

    '--border': mix(M.border, M.surface, fade),
    '--border-light': mix(M.borderLight, M.surface, fade),

    // 语义状态色（明暗两套）——卡片与控件只许引用这些，不许再写死颜色
    '--color-ok': S.ok,
    '--color-warn': S.warn,
    '--color-danger': S.danger,
    '--color-muted': S.muted,
    '--color-favorite': S.favorite,
    '--color-favorite-bg': S.favoriteBg,
    '--color-favorite-border': S.favoriteBorder,
    '--color-heat-warm': S.heatWarm,
    '--color-heat-warm-bg': S.heatWarmBg,
    '--color-heat-hot': S.heatHot,
    '--color-heat-hot-bg': S.heatHotBg,
    '--color-on-solid': S.onSolid,

    '--shadow': `0 1px 3px rgba(0, 0, 0, ${alpha(0.06 * s)})`,
    '--shadow-hover': `0 4px 16px rgba(0, 0, 0, ${alpha(0.08 * s)})`,
    '--shadow-card': `0 1px 4px rgba(0, 0, 0, ${alpha(0.04 * s)})`,

    '--card-padding': px(tokens.cardPadding),
    '--grid-gap': px(tokens.gridGap),
    '--grid-cols': String(tokens.gridCols),
    '--nav-item-h': px(tokens.navItemHeight),

    '--glass-blur': px(tokens.glassBlur),
    '--glass-bg': `rgba(${gr}, ${gg}, ${gb}, ${alpha(tokens.glassAlpha / 100)})`,

    '--font': fam,
    '--font-size-base': px(tokens.fontSizeBase),
    '--title-weight': String(tokens.titleWeight),

    '--transition': `${tokens.motionDuration}ms ease`,
    // 0 / 1 乘数，供 calc() 把入场动画时长压成 0，从而「关掉」动画而无需条件类名
    '--card-anim': tokens.cardAnim ? '1' : '0'
  }
}