/**
 * 图表原语：**手写 SVG 字符串**，零依赖、零第三方图表库。
 *
 * 为什么不引 echarts / chart.js：首屏预算是 600 KiB raw，当前已用 589.3，
 * 只剩约 10 KiB —— 任何图表库都装不下。而洞察面板需要的只有四种图形
 * （趋势线、环形、堆叠条、单条），手写比引库更小也更可控。
 *
 * 两条硬规则，改这个文件时别破：
 *  1. **只输出几何，绝不输出文本**。文本交给 Vue 模板用 HTML 渲染：
 *     ① 站点名是外部数据，拼进 SVG 属性就是 XSS 面；② 文字留在 HTML 里
 *     才能吃 `--color-text-*` 主题变量，不必在这里复制一套配色。
 *  2. **颜色一律用 CSS 变量字符串**（`var(--accent)` 之类），不写死色值。
 *     硬编码色会在深色主题下变成一块看不清的补丁，且绕开语义令牌体系。
 *
 * 全部是纯函数：同输入必同输出，可以直接在 node 里断言（见 test-chartkit）。
 */

const num = (v) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** 保留两位小数：SVG 属性不需要更高精度，短字符串能省下不少 DOM 体积 */
const r2 = (v) => Math.round(num(v) * 100) / 100

function normalizeList(values) {
  if (!Array.isArray(values)) return []
  return values.map((v) => Math.max(0, num(v)))
}

/**
 * 趋势线（sparkline）：全零时退化成一条基线，而不是画一条贴底的折线 ——
 * 「没有数据」和「数据都是 0」在视觉上必须能分开。
 */
export function sparkline(values, opts = {}) {
  const w = clamp(num(opts.width) || 120, 16, 2000)
  const h = clamp(num(opts.height) || 32, 8, 400)
  const pad = clamp(num(opts.pad) || 2, 0, 8)
  const stroke = opts.stroke || 'var(--accent)'
  const area = opts.area === null || opts.area === false ? '' : (opts.area || 'var(--accent-light)')

  const pts = normalizeList(values)
  const innerW = Math.max(1, w - pad * 2)
  const innerH = Math.max(1, h - pad * 2)
  const base = r2(h - pad)

  if (!pts.length) {
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><line x1="${pad}" y1="${base}" x2="${r2(w - pad)}" y2="${base}" fill="none" stroke="var(--border-light)" stroke-width="1"/></svg>`
  }

  const max = Math.max(...pts)
  const span = pts.length > 1 ? pts.length - 1 : 1
  const xAt = (i) => (pts.length > 1 ? r2(pad + (i * innerW) / span) : r2(pad + innerW / 2))
  const yAt = (v) => (max > 0 ? r2(h - pad - (v / max) * innerH) : base)

  const coords = pts.map((v, i) => `${xAt(i)},${yAt(v)}`)
  const line = pts.length > 1
    ? `<polyline points="${coords.join(' ')}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<circle cx="${xAt(0)}" cy="${yAt(pts[0])}" r="2" fill="${stroke}"/>`

  const shape = area && max > 0 && pts.length > 1
    ? `<polygon points="${r2(pad)},${base} ${coords.join(' ')} ${r2(w - pad)},${base}" fill="${area}" stroke="none"/>`
    : ''

  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${shape}${line}</svg>`
}

/**
 * 环形图（donut）：segments = `[{ value, color }]`，按占比分配 dash。
 * 总量为 0 时输出一圈空轨道 —— 空数据要给「轨道」而不是什么都不渲染，
 * 否则面板会因为高度塌陷而抖动。
 */
export function donut(segments, opts = {}) {
  const size = clamp(num(opts.size) || 140, 32, 600)
  const thickness = clamp(num(opts.thickness) || 18, 2, size / 2)
  const track = opts.track || 'var(--border-light)'
  const c = r2(size / 2)
  const r = r2((size - thickness) / 2)
  const circ = 2 * Math.PI * r

  const list = (Array.isArray(segments) ? segments : []).map((s) => ({
    value: Math.max(0, num(s && s.value)),
    color: (s && s.color) || 'var(--accent)',
  }))
  const total = list.reduce((a, s) => a + s.value, 0)

  if (!total) {
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${track}" stroke-width="${thickness}"/></svg>`
  }

  let offset = 0
  const arcs = list.map((s) => {
    if (!s.value) return ''
    const len = (circ * s.value) / total
    const dash = `${r2(len)} ${r2(circ - len)}`
    const off = r2(-offset)
    offset += len
    return `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${thickness}" stroke-dasharray="${dash}" stroke-dashoffset="${off}" transform="rotate(-90 ${c} ${c})"/>`
  }).join('')

  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${track}" stroke-width="${thickness}"/>${arcs}</svg>`
}

/** 堆叠条（heatstrip）：健康度这类「几段占比拼成一条」的场景，比饼图省地方 */
export function heatstrip(segments, opts = {}) {
  const w = clamp(num(opts.width) || 320, 24, 2000)
  const h = clamp(num(opts.height) || 10, 4, 64)
  const radius = clamp(num(opts.radius) || h / 2, 0, h / 2)
  const track = opts.track || 'var(--border-light)'

  const list = (Array.isArray(segments) ? segments : []).map((s) => ({
    value: Math.max(0, num(s && s.value)),
    color: (s && s.color) || 'var(--accent)',
  }))
  const total = list.reduce((a, s) => a + s.value, 0)

  if (!total) {
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><rect x="0" y="0" width="${w}" height="${h}" rx="${r2(radius)}" fill="${track}"/></svg>`
  }

  let x = 0
  const bars = list.map((s, i) => {
    if (!s.value) return ''
    const seg = (w * s.value) / total
    const isLast = i === list.length - 1
    const ww = isLast ? r2(w - x) : r2(seg)
    const rect = `<rect x="${r2(x)}" y="0" width="${ww}" height="${h}" fill="${s.color}"/>`
    x += seg
    return rect
  }).join('')

  // 圆角靠外层 clip：逐段画圆角会在拼接处露出缝隙
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><defs><clipPath id="hs${r2(w)}x${r2(h)}"><rect width="${w}" height="${h}" rx="${r2(radius)}"/></clipPath></defs><g clip-path="url(#hs${r2(w)}x${r2(h)})">${bars}</g></svg>`
}

/** 单条横向条（barTrack）：一行一个，文本由 HTML 渲染在条外面 */
export function barTrack(value, max, opts = {}) {
  const w = clamp(num(opts.width) || 160, 16, 2000)
  const h = clamp(num(opts.height) || 8, 3, 64)
  const radius = clamp(num(opts.radius) || h / 2, 0, h / 2)
  const track = opts.track || 'var(--border-light)'
  const color = opts.color || 'var(--accent)'

  const v = Math.max(0, num(value))
  const m = Math.max(0, num(max))
  const filled = m > 0 ? clamp((v / m) * w, v > 0 ? Math.min(h, 2) : 0, w) : 0

  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><rect x="0" y="0" width="${w}" height="${h}" rx="${r2(radius)}" fill="${track}"/>${filled > 0 ? `<rect x="0" y="0" width="${r2(filled)}" height="${h}" rx="${r2(radius)}" fill="${color}"/>` : ''}</svg>`
}

export const chartkit = { sparkline, donut, heatstrip, barTrack }
