/**
 * 视觉层门禁（统一视觉层）
 *
 * 为什么需要它：项目的「视觉」此前没有单一守卫，散成三处真值 + 大量组件内硬编码，
 * 任何一处改了都不报错 —— 表现为「改了设置面板，某页没跟着变」「暗色下某块刺眼」，
 * 而且**无声**。这道门禁把三条不变量钉住：
 *
 *   ① 兜底 == 真值：`src/styles/main.css` 的 :root 首帧兜底，必须与
 *      `src/utils/visualScheme.js` 用默认方案算出的 CSS 变量**逐一相等**
 *      （归一化后比较：hex≡rgb、0.15s≡150ms、0.72≡0.720）。两处一旦漂移，
 *      首帧与运行时就会闪一下不同的值。
 *   ② 语义色明暗成对：后台徽章语义色（--ok-fg/--ok-bg/…）在 :root 与
 *      [data-theme="dark"] 两套都必须定义 —— 少一套，暗色下就是亮底刺眼。
 *   ③ 硬编码不超基线：组件里散落的「不透明实色」（hex / rgb()）若继续增长，
 *      说明有颜色绕过了令牌体系。基线存于 visual-layer-baseline.json。
 *
 * 另：契约文档 `docs/VISUAL.md` 必须存在且含关键小节（改视觉的入口在文档里）。
 *
 * 运行：node tools/console/test-visual-layer.mjs
 * 加 `--report`：只打印当前统计、不做判定（用于重建基线）。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCHEMES, resolveTokens, tokensToCssVars } from '../../src/utils/visualScheme.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const REPORT = process.argv.includes('--report')

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? ` → ${extra}` : ''}`) }
  else { failures.push(`${label}${extra ? ` — ${extra}` : ''}`); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`) }
}

/* ---------------- 读 main.css ---------------- */

const css = readFileSync(join(ROOT, 'src', 'styles', 'main.css'), 'utf8')

/** 取某个选择器块内的 CSS 变量（先剥注释，避免注释里的分号/示例干扰解析） */
function blockVars(selector) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([\\s\\S]*?)\\}')
  const m = css.match(re)
  if (!m) return null
  const clean = m[1].replace(/\/\*[\s\S]*?\*\//g, '')
  const out = {}
  for (const part of clean.split(';')) {
    const i = part.indexOf(':')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (k.startsWith('--') && v) out[k] = v
  }
  return out
}

const rootVars = blockVars(':root') || {}
const darkVars = blockVars('[data-theme="dark"]') || {}

/* ---------------- 归一化比较 ---------------- */

function hexToRgb(hex) {
  let h = hex.slice(1)
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  if (h.length > 6) h = h.slice(0, 6) // 忽略 alpha 通道（#rrggbbaa 比较前 6 位）
  return `rgb(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)})`
}
/** 把「等价但写法不同」的值归一到同一形态，再比较 */
function norm(v) {
  let s = String(v).trim().toLowerCase()
  s = s.replace(/#[0-9a-f]{3,8}\b/g, m => hexToRgb(m))
  s = s.replace(/(\d*\.?\d+)s\b/g, (_, n) => `${+n * 1000}ms`) // 0.15s → 150ms
  s = s.replace(/\d*\.\d+/g, m => String(parseFloat(m)))       // 0.060 → 0.06
  s = s.replace(/,\s*/g, ',')
  s = s.replace(/\s+/g, ' ')
  return s.trim()
}

/* ---------------- ① 兜底 == 真值 ---------------- */

console.log('\n── ① 首帧兜底与真值一致（防双源漂移）──')

// 首帧默认方案 = SCHEMES[0]（preferences store 初始即取它），首帧主题 = light
const defaultVars = tokensToCssVars(resolveTokens(SCHEMES[0].id, {}), 'light')

/** 两边都有、且必须逐一相等的变量（main.css 独有的 --glass-border / --sidebar-* 不在此列） */
const MUST_MATCH = [
  '--font', '--radius', '--radius-sm', '--radius-lg', '--transition',
  '--border', '--border-light', '--shadow', '--shadow-hover', '--shadow-card',
  '--glass-bg', '--glass-blur', '--card-padding', '--grid-gap', '--grid-cols',
  '--nav-item-h', '--font-size-base', '--title-weight', '--card-anim',
]

const drift = []
for (const key of MUST_MATCH) {
  const a = rootVars[key]
  const b = defaultVars[key]
  if (a === undefined) { drift.push(`${key} 在 main.css 缺兜底值`); continue }
  if (b === undefined) { drift.push(`${key} visualScheme 未生成`); continue }
  if (norm(a) !== norm(b)) drift.push(`${key}: main.css「${a}」≠ 真值「${b}」`)
}
ok(drift.length === 0,
  `main.css 的 ${MUST_MATCH.length} 个兜底变量与 visualScheme 默认方案逐一相等`,
  drift.length ? `\n      ${drift.join('\n      ')}` : '')
ok(defaultVars['--radius'] !== undefined && rootVars['--radius'] !== undefined,
  '真值源与兜底都存在 --radius（门禁确实比到了东西，而非空比）')

/* ---------------- ② 语义色明暗成对 ---------------- */

console.log('\n── ② 后台徽章语义色：明暗两套齐全 ──')

const SEMANTIC_VARS = [
  '--ok-fg', '--ok-bg', '--ok-border',
  '--warn-fg', '--warn-bg', '--warn-border',
  '--danger-fg', '--danger-bg', '--danger-border',
  '--info-fg', '--info-bg',
]
const missingLight = SEMANTIC_VARS.filter(k => !rootVars[k])
const missingDark = SEMANTIC_VARS.filter(k => !darkVars[k])
ok(missingLight.length === 0, `:root 定义了全部 ${SEMANTIC_VARS.length} 个语义色`, missingLight.join(' ') || '')
ok(missingDark.length === 0, `[data-theme="dark"] 定义了全部 ${SEMANTIC_VARS.length} 个语义色`, missingDark.join(' ') || '')

// 明暗两套不能同值（同值 = 暗色没适配）
const samePairs = SEMANTIC_VARS.filter(k => rootVars[k] && darkVars[k] && norm(rootVars[k]) === norm(darkVars[k]))
ok(samePairs.length === 0, '语义色明暗两套取值不同（不是复制粘贴）', samePairs.join(' ') || '')

/* ---------------- ③ 硬编码不透明实色不超基线 ---------------- */

console.log('\n── ③ 组件硬编码「不透明实色」不超基线 ──')

// 真值源本身就在定义颜色，不纳入统计
const SKIP_FILES = ['visualScheme.js', 'themeSchema.js', 'main.css']
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgb\(/g // 不透明实色；rgba( 不算（多为遮罩/阴影/叠加）

function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(vue|css|js)$/.test(e.name) && !SKIP_FILES.includes(e.name)) out.push(p)
  }
  return out
}

let hardTotal = 0
const perFile = {}
for (const f of walk(join(ROOT, 'src'), [])) {
  const m = readFileSync(f, 'utf8').match(COLOR_RE)
  if (m && m.length) { hardTotal += m.length; perFile[f.replace(/\\/g, '/').replace(ROOT.replace(/\\/g, '/'), '')] = m.length }
}

const baselinePath = join(HERE, 'visual-layer-baseline.json')
if (!existsSync(baselinePath)) {
  console.log(`  ℹ️  尚无基线文件，当前硬编码实色 ${hardTotal} 处（${Object.keys(perFile).length} 个文件）`)
  console.log('     创建 tools/console/visual-layer-baseline.json 后即可开始守卫。')
  if (!REPORT) { failures.push('缺少 visual-layer-baseline.json'); }
} else {
  const B = JSON.parse(readFileSync(baselinePath, 'utf8'))
  const cap = B.opaqueColors?.total
  if (typeof cap !== 'number') {
    failures.push('visual-layer-baseline.json 缺 opaqueColors.total')
  } else {
    const top = Object.entries(perFile).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([k, v]) => `${v} ${k}`).join('\n      ')
    ok(hardTotal <= cap,
      `硬编码实色 ${hardTotal} 处 ≤ 基线 ${cap} 处`,
      hardTotal > cap
        ? `超 ${hardTotal - cap} 处 —— 新颜色请走令牌（见 docs/VISUAL.md）；确属布局必需（如纯色遮罩）则更新基线并补备注\n      主要来源：\n      ${top}`
        : '')
    console.log(`     主要来源：\n      ${top}`)
  }
}

/* ---------------- 契约文档 ---------------- */

console.log('\n── 契约文档 ──')
const contract = join(ROOT, 'docs', 'VISUAL.md')
if (!existsSync(contract)) {
  ok(false, 'docs/VISUAL.md 存在', '缺契约文档 —— 改视觉的人找不到入口')
} else {
  const doc = readFileSync(contract, 'utf8')
  ok(true, 'docs/VISUAL.md 存在')
  ok(/真值来源|唯一事实来源/.test(doc), '契约写明了真值来源')
  ok(/令牌/.test(doc), '契约说明了令牌体系')
  ok(/硬编码/.test(doc), '契约说明了硬编码政策')
}

/* ---------------- 结果 ---------------- */

if (REPORT) {
  console.log(`\n📊 报告模式：硬编码实色 ${hardTotal} 处 / ${Object.keys(perFile).length} 个文件（未判定）`)
  process.exit(0)
}
if (failures.length) {
  console.error(`\n❌ 视觉层门禁 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  console.error('\n  视觉的问题都是「无声的」——不会让别的测试变红，只会让观感不一致。')
  console.error('  改视觉前先读 docs/VISUAL.md：真值来源、加令牌流程、硬编码政策都在里面。')
  process.exit(1)
}
console.log(`\n✅ 视觉层门禁通过：${pass} 条断言`)
