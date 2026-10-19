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

/**
 * `var(--border, #e2e8f0)` 里的 `#e2e8f0` **不是硬编码**，是令牌的兜底值。
 *
 * 本门禁要抓的是「颜色绕过了令牌体系」。兜底值恰恰相反 —— 它是令牌存在、
 * 且作者考虑了变量缺失时的表现。把它计入基线会让两件事同时失真：
 *   ① 计数虚高（原 187 里有 30 处属于此类），基线数字不具备「还要还多少」的含义；
 *   ② 真正该还的裸实色被兜底值稀释，看数字看不出问题。
 *
 * 判定方式：该颜色字面量之前、最近的未闭合 `var(` 之后没有 `)`，
 * 即它位于 `var(name, <这里>)` 的兜底位。
 */
function isFallbackLiteral(src, index) {
  const before = src.slice(Math.max(0, index - 160), index)
  const open = before.lastIndexOf('var(')
  if (open < 0) return false
  const close = before.lastIndexOf(')')
  if (close > open) return false
  // var( 之后必须已经出现逗号，才是「第二参数」的位置
  return /,/.test(before.slice(open))
}

let hardTotal = 0
let fallbackTotal = 0
const perFile = {}
for (const f of walk(join(ROOT, 'src'), [])) {
  const src = readFileSync(f, 'utf8')
  let n = 0
  for (const m of src.matchAll(COLOR_RE)) {
    if (isFallbackLiteral(src, m.index)) { fallbackTotal++; continue }
    n++
  }
  hardTotal += n
  if (n) perFile[f.replace(/\\/g, '/').replace(ROOT.replace(/\\/g, '/'), '')] = n
}
console.log(`     裸实色 ${hardTotal} 处｜var() 兜底值 ${fallbackTotal} 处（不计入基线）`)

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
      `硬编码实色 ${hardTotal} 处 ≤ 存量上限 ${cap} 处`,
      hardTotal > cap
        ? `超 ${hardTotal - cap} 处 —— 新颜色请走令牌（见 docs/VISUAL.md）；确属布局必需（如纯色遮罩）则更新基线并补备注\n      主要来源：\n      ${top}`
        : '')
    console.log(`     主要来源：\n      ${top}`)

    /*
     * 递减闸：基线只拦增量时，187 会变成一个永久地板 ——
     * 存量没人还，数字满格反而诱导「改基线」而不是「用令牌」。
     *
     * 两条规则：
     *   ① 实际值必须 ≤ 目标（target）：目标只减不增，达成后要把新值写回。
     *   ② 实际值必须真的在下降：若与目标持平，给出「本季还要还 N 处」的提示。
     *      **不因此失败** —— 还债需要时间，硬逼会让改基线成为唯一出路。
     * 但「基线被调高」必须失败：那是把闸门往回开。
     */
    const target = B.opaqueColors?.target
    const raisedFrom = B.opaqueColors?.loweredFrom
    if (typeof target === 'number') {
      ok(hardTotal <= target,
        `硬编码实色 ${hardTotal} 处 ≤ 递减目标 ${target} 处`,
        hardTotal > target ? `距目标还差 ${hardTotal - target} 处（见 docs/VISUAL.md 的偿还计划）` : '')
      if (hardTotal < target) {
        console.log(`     🎯 已达成本季目标（${target} → ${hardTotal}）：请把 target 写回 ${hardTotal}，让闸门继续下压`)
      } else if (hardTotal === target) {
        console.log(`     ⏳ 尚未开始偿还：本季目标 ${target} 处，当前就是 ${hardTotal} 处`)
      }
    }
    if (typeof raisedFrom === 'number') {
      // 基线上调 = 往回开闸。允许的唯一方式是有记录的下调，不允许抬高。
      ok(cap <= raisedFrom,
        `存量上限没有被调高（${raisedFrom} → ${cap}）`,
        cap > raisedFrom ? '抬高基线等于放开闸门：请改用递减目标，并在 docs/VISUAL.md 说明原因' : '')
    }
  }
}

/* ---------------- ④ 层级（z-index）走令牌 ---------------- */

console.log('\n── ④ 层级：z-index 一律走令牌 ──')

// ④ 的遍历必须**含 main.css**（③ 的 walk 排除了它 —— 那里是颜色定义处）：
// 否则 main.css 里的 z-index 不被检查，等于门禁留了个口子。
function walkAll(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walkAll(p, out)
    else if (/\.(vue|css|js)$/.test(e.name)) out.push(p)
  }
  return out
}
const layerFiles = walkAll(join(ROOT, 'src'))

// 4a. 组件与全局样式里不得再出现硬编码 z-index 数字
const zHard = []
for (const f of layerFiles) {
  const src = readFileSync(f, 'utf8')
  const m = src.match(/z-index:\s*\d+/g)
  if (m) zHard.push(`${f.replace(/\\/g, '/').replace(ROOT.replace(/\\/g, '/'), '')}: ${m.join(', ')}`)
}
ok(zHard.length === 0, 'src/ 内无硬编码 z-index 数字（一律 var(--z-*)）',
  zHard.length ? `\n      ${zHard.join('\n      ')}` : '')

// 4b. 被引用的 --z-* 必须都有定义（防拼错/漏定义）
const zDefined = Object.keys(rootVars).filter(k => k.startsWith('--z-'))
const zReferenced = new Set()
for (const f of layerFiles) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/var\((--z-[a-z-]+)\)/g)) zReferenced.add(m[1])
}
const zUndef = [...zReferenced].filter(k => !rootVars[k])
ok(zDefined.length >= 20, `层级令牌已建立（${zDefined.length} 个）`)
ok(zReferenced.size >= 20 && zUndef.length === 0,
  `被引用的 ${zReferenced.size} 个层级令牌全部有定义`, zUndef.join(' ') || '')

// 4c. 令牌取值互不重复（同值 = 层序由引入顺序决定，而非设计）
const zVals = {}, zDup = []
for (const k of zDefined) {
  const v = norm(rootVars[k])
  if (zVals[v] !== undefined) zDup.push(`${k} 与 ${zVals[v]} 同为 ${rootVars[k]}`)
  else zVals[v] = k
}
ok(zDup.length === 0, '层级令牌取值互不重复', zDup.join('; ') || '')

/* ---------------- ⑤ 动效时长走令牌 ---------------- */

console.log('\n── ⑤ 动效时长：transition 一律走档位令牌 ──')

// lookbehind 排除 `--transition:` 定义行（它是完整值，门禁 ① 要它与真值相等）
const durHard = []
for (const f of layerFiles) {
  const src = readFileSync(f, 'utf8')
  const m = src.match(/(?<![-\w])transition:[^;{}]*\d+\.?\d*s/g)
  if (m) durHard.push(`${f.replace(/\\/g, '/').replace(ROOT.replace(/\\/g, '/'), '')}: ${m.join(' | ')}`)
}
ok(durHard.length === 0, 'transition 内无硬编码时长（一律 var(--dur-*)）',
  durHard.length ? `\n      ${durHard.join('\n      ')}` : '')

const durRef = new Set()
for (const f of layerFiles) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/var\((--dur-[a-z]+)\)/g)) durRef.add(m[1])
}
const durUndef = [...durRef].filter(k => !rootVars[k])
ok(durRef.size >= 3 && durUndef.length === 0,
  `被引用的 ${durRef.size} 个时长令牌全部有定义`, durUndef.join(' ') || '')

/* ---------------- ⑥ 响应式断点 ---------------- */

console.log('\n── ⑥ 响应式断点：值必须来自登记档位 ──')

// 真值从 src/utils/breakpoints.js 读（单一事实来源）—— 不在门禁里再抄一份。
const { LOCKED_VALUES } = await import(new URL('../../src/utils/breakpoints.js', import.meta.url).href)

// 6a. CSS @media 的宽度值必须在登记档位内（新增断点必须先登记）
const mediaUnknown = []
for (const f of layerFiles) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/@media[^{]*?\((max|min)-width:\s*([\d.]+)px\)/g)) {
    const v = Number(m[2])
    if (!LOCKED_VALUES.has(v)) {
      mediaUnknown.push(`${f.replace(/\\/g, '/').replace(ROOT.replace(/\\/g, '/'), '')}: ${v}px`)
    }
  }
}
ok(mediaUnknown.length === 0,
  `CSS 媒体查询断点全部来自登记档位（${LOCKED_VALUES.size} 个）`,
  mediaUnknown.length ? `\n      ${mediaUnknown.join('\n      ')}` : '')

// 6b. JS 侧不得硬编码断点数字（一律走 breakpoints.js 的查询串 / helper）
const bpHard = []
for (const f of layerFiles) {
  if (f.endsWith('breakpoints.js')) continue
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/matchMedia\(\s*['"`][^'"`]*\d+px|innerWidth\s*[<>]=\s*\d+/g)) {
    bpHard.push(`${f.replace(/\\/g, '/').replace(ROOT.replace(/\\/g, '/'), '')}: ${m[0]}`)
  }
}
ok(bpHard.length === 0, 'JS 侧无硬编码断点（走 utils/breakpoints）',
  bpHard.length ? `\n      ${bpHard.join('\n      ')}` : '')

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
  ok(/层级|z-index/.test(doc), '契约说明了层级（z-index）体系')
  ok(/动效时长|--dur/.test(doc), '契约说明了动效时长体系')
  ok(/断点|breakpoints/.test(doc), '契约说明了响应式断点体系')
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
