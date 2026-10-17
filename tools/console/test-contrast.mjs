/**
 * 对比度守卫（F3）：从 `src/styles/main.css` 的变量**实算** WCAG 2.1 对比度并断言。
 *
 * ## 这个门禁守什么、不守什么（先读，否则会误报）
 *
 * 站点颜色有三层真值：main.css 的 :root（**首帧兜底**）→ preferences 的
 * `applyPreset` 把 --accent/--bg-white 等写成 :root 行内样式 → visualScheme
 * 再覆盖 --border/语义色。运行期用户看到的颜色要靠 `probe/_contrast-audit.mjs`
 * （无头 Chrome 读 computed style）实测 —— 那才是真值。
 *
 * 本门禁守的是**真值确实在 main.css 的那一层**：--text-secondary/占位符、
 * --ok/warn/danger/info 语义对 —— accent 与结构边框会被预设覆盖，在这里断言
 * 会拿「用户看不到的兜底值」误报，所以只打印信息、不判失败。
 *
 * 判据（WCAG 2.1 SC 1.4.3）：
 *   · 正文 / 次要文字 / 占位符（role=text）≥ 4.5:1
 *   · 大字（≥24px，或 ≥18.66px 粗体）≥ 3:1
 *   · 半透明前景先按 alpha 合成到实际底色再算 —— 不拿 rgba 原值糊弄公式
 *   · 卡片描边等纯装饰性分隔不做断言（WCAG 1.4.11 只约束「识别组件所必需」的视觉信息）
 *
 * 运行：node tools/console/test-contrast.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/* ---------------- 颜色解析与 WCAG 计算 ---------------- */

/** 解析 #rgb / #rrggbb / rgba(r,g,b,a) → {r,g,b,a} */
function parseColor(raw) {
  const s = String(raw).trim()
  let m = s.match(/^#([\da-f]{3})$/i)
  if (m) {
    const [r, g, b] = m[1].split('').map(c => parseInt(c + c, 16))
    return { r, g, b, a: 1 }
  }
  m = s.match(/^#([\da-f]{6})$/i)
  if (m) {
    const h = m[1]
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }
  }
  m = s.match(/rgba?\(([^)]+)\)/i)
  if (m) {
    const p = m[1].split(',').map(x => Number(String(x).trim()))
    if (p.length >= 3 && p.slice(0, 3).every(n => Number.isFinite(n))) {
      return { r: p[0], g: p[1], b: p[2], a: p.length >= 4 ? p[3] : 1 }
    }
  }
  throw new Error(`无法解析颜色：${raw}`)
}

/** sRGB 通道 → 线性（WCAG 规定的分段函数） */
function lin(c) {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/** 相对亮度 */
function luminance({ r, g, b }) {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** 对比度：始终 ≥1 */
function contrast(fg, bg) {
  const l1 = luminance(fg)
  const l2 = luminance(bg)
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

/** 把带 alpha 的前景合成到不透明底色上（sRGB 空间直接加权，与浏览器一致） */
function composite(fg, bg) {
  if (fg.a >= 1) return { r: fg.r, g: fg.g, b: fg.b, a: 1 }
  const a = fg.a
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  }
}

/** 沿底色栈自上而下合成，得到最终不透明底 */
function stackBottom(colors) {
  let out = { r: 255, g: 255, b: 255, a: 1 } // 最外层假定白（浏览器默认画布）
  for (const c of colors) out = composite(c, out)
  return out
}

/* ---------------- 从 main.css 取变量 ---------------- */

const css = readFileSync(join(ROOT, 'src', 'styles', 'main.css'), 'utf8')

/**
 * 收集某选择器的**全部**块，合并成一张变量表。
 * main.css 里 `:root` 与 `[data-theme="dark"]` 各出现两次（结构性令牌 + 语义色令牌），
 * 只取第一个块会漏掉 ok/warn/danger/info 那整组 —— 漏检比误报更危险。
 */
function varsAll(selectorText) {
  const out = {}
  let pos = 0
  for (;;) {
    pos = css.indexOf(selectorText, pos)
    if (pos === -1) break
    const brace = css.indexOf('{', pos)
    const close = brace === -1 ? -1 : css.indexOf('\n}', brace)
    if (brace === -1 || close === -1) break
    for (const line of css.slice(brace + 1, close).split('\n')) {
      // 一行可能写多个声明（main.css 的语义色令牌就是 `--ok-fg: …; --ok-bg: …;` 三个一行），
      // 按行首单匹配会整片漏掉后半 —— 那是漏检，比误报危险。
      for (const kv of line.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[kv[1]] = kv[2].trim()
    }
    pos = close
  }
  return out
}

const light = varsAll(':root {')
const dark = { ...light, ...varsAll('[data-theme="dark"] {') }

const themeVars = { light, dark }

/** 解析 var 引用链，返回最终颜色字符串 */
function resolveVar(name, theme, seen = new Set()) {
  const table = themeVars[theme]
  let value = table[name]
  if (value === undefined) throw new Error(`未知变量 ${name}（主题 ${theme}）`)
  let guard = 0
  while (guard++ < 10) {
    const ref = /^var\((--[\w-]+)(?:\s*,\s*[^)])*\)$/.exec(value)
    if (!ref) break
    if (seen.has(ref[1])) throw new Error(`变量循环引用：${ref[1]}`)
    seen.add(ref[1])
    value = table[ref[1]]
    if (value === undefined) throw new Error(`变量未定义：${ref[1]}`)
  }
  return value
}

const colorOf = (name, theme) => parseColor(resolveVar(name, theme))

/* ---------------- 待测组合 ---------------- */

/**
 * role：text → 4.5:1（正文、次要文字、占位符、小字徽章）；large → 3:1。
 * stack：底色栈，自上而下合成（玻璃层必须先合成到它背后的实际底色）。
 * info: true 的组合只打印数值，不进断言（见文件头「不守什么」）。
 */
const CASES = [
  // ——— 正文（真值在 main.css：text-* 从未被预设覆盖）———
  { label: '正文 text-primary / 卡片底 bg-white', fg: '--text-primary', stack: ['--bg-white'], role: 'text' },
  { label: '正文 text-primary / 页面底 bg-primary', fg: '--text-primary', stack: ['--bg-primary'], role: 'text' },
  { label: '正文 text-primary / 主内容区（玻璃叠页面底）', fg: '--text-primary', stack: ['--glass-bg', '--bg-primary'], role: 'text' },
  { label: '侧栏文字 text-sidebar / 侧栏玻璃底', fg: '--text-sidebar', stack: ['--glass-bg', '--bg-primary'], role: 'text' },

  // ——— 次要文字（历史上最容易掉线的一组，2026-10-18 起为 #636366 / #9d9da2）———
  { label: '次要文字 text-secondary / 卡片底 bg-white', fg: '--text-secondary', stack: ['--bg-white'], role: 'text' },
  { label: '次要文字 text-secondary / 页面底 bg-primary', fg: '--text-secondary', stack: ['--bg-primary'], role: 'text' },
  { label: '次要文字 text-secondary / 浅分隔底 border-light', fg: '--text-secondary', stack: ['--border-light'], role: 'text' },
  { label: '次要文字 text-secondary / 主内容区玻璃底', fg: '--text-secondary', stack: ['--glass-bg', '--bg-primary'], role: 'text' },
  { label: '侧栏次要文字 text-sidebar-dim / 侧栏玻璃底', fg: '--text-sidebar-dim', stack: ['--glass-bg', '--bg-primary'], role: 'text' },

  // ——— 占位符（CommandPalette 等输入框明示用 text-secondary）———
  { label: '占位符 placeholder / 输入框底 bg-white', fg: '--text-secondary', stack: ['--bg-white'], role: 'text' },
  { label: '占位符 placeholder / 浅分隔底 border-light', fg: '--text-secondary', stack: ['--border-light'], role: 'text' },

  // ——— 语义徽章小字（后台按 12–13px 用，按正文判）———
  { label: '成功 ok-fg / ok-bg', fg: '--ok-fg', stack: ['--ok-bg', '--bg-white'], role: 'text' },
  { label: '警告 warn-fg / warn-bg', fg: '--warn-fg', stack: ['--warn-bg', '--bg-white'], role: 'text' },
  { label: '危险 danger-fg / danger-bg', fg: '--danger-fg', stack: ['--danger-bg', '--bg-white'], role: 'text' },
  { label: '信息 info-fg / info-bg', fg: '--info-fg', stack: ['--info-bg', '--bg-white'], role: 'text' },

  // ——— 以下会被运行期预设覆盖（themeSchema / visualScheme），只报数值不作门禁 ———
  { label: '链接 accent / 卡片底（运行期被 preset 覆盖，仅报数值）', fg: '--accent', stack: ['--bg-white'], role: 'text', info: true },
  { label: '主按钮白字 / accent 实底（运行期被 preset 覆盖，仅报数值）', fg: '#ffffff', fgLiteral: true, stack: ['--accent'], role: 'large', info: true },
  { label: '卡片描边 border / 页面底（纯装饰性分隔，WCAG 1.4.11 豁免）', fg: '--border', stack: ['--bg-primary'], role: 'large', info: true },
]

/* ---------------- 执行 ---------------- */

const MIN = { text: 4.5, large: 3.0 }
const rows = []
const failures = []

for (const theme of ['light', 'dark']) {
  for (const c of CASES) {
    let ratio, need, bottomHex, fgHex
    try {
      const bottomStack = c.stack.map(v => (v.startsWith('--') ? colorOf(v, theme) : parseColor(v)))
      const bottom = stackBottom(bottomStack)
      const fgRaw = c.fgLiteral ? parseColor(c.fg) : colorOf(c.fg, theme)
      const fg = composite(fgRaw, bottom)
      ratio = contrast(fg, bottom)
      need = MIN[c.role]
      fgHex = hex(fg)
      bottomHex = hex(bottom)
    } catch (e) {
      failures.push(`[${theme}] ${c.label} — 计算失败：${e.message}`)
      continue
    }
    const pass = ratio >= need - 1e-9
    rows.push({ theme, label: c.label, role: c.role, info: Boolean(c.info), fgHex, bottomHex, ratio, need, pass })
    if (!pass && !c.info) failures.push(`[${theme === 'light' ? '亮' : '暗'}] ${c.label} 实测 ${ratio.toFixed(2)}:1 < ${need.toFixed(1)}:1`)
  }
}

function hex({ r, g, b }) {
  return '#' + [r, g, b].map(n => Math.round(n).toString(16).padStart(2, '0')).join('')
}

/* ---------------- 报告 ---------------- */
console.log('\n对比度门禁（F3 · WCAG 2.1 AA · main.css 兜底层）')
console.log('  运行期真实值（含 preset 覆盖）以 probe/_contrast-audit.mjs 实测为准。')
for (const theme of ['light', 'dark']) {
  console.log(`\n── ${theme === 'light' ? '亮色主题 :root' : '暗色主题 [data-theme="dark"]'} ──`)
  for (const r of rows.filter(x => x.theme === theme)) {
    const mark = r.info ? 'ℹ' : (r.pass ? ' ✓' : ' ✗')
    console.log(
      `  ${mark} ${r.ratio.toFixed(2).padStart(5)}:1（需 ${r.need.toFixed(1)}）  ${r.fgHex} / ${r.bottomHex}  ${r.label}`,
    )
  }
}

const hard = failures.filter(f => !f.includes('计算失败'))
const worst = rows.filter(r => !r.info && !r.pass)
console.log(`\n断言 ${rows.length - rows.filter(r => r.info).length} 组（另 ${rows.filter(r => r.info).length} 组仅报数值），不达标 ${worst.length} 组。`)

if (hard.length) {
  console.log('\n不达标明细：')
  for (const f of failures) console.log('  ✗ ' + f)
} else if (!worst.length) {
  console.log('  ✓ 全部通过')
}

if (failures.length) process.exit(1)
