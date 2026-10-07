/**
 * src/utils/visualScheme.js 用例：零依赖、不联网、不起浏览器。
 *
 * 这里只测「纯函数 + 登记表自洽性」——方案与微调怎么合并、令牌怎么落成 CSS 变量。
 * 组件里那层「变量被谁消费」不属于本文件的职责，靠构建与肉眼验收覆盖。
 * 运行：node tools/console/test-visual-scheme.mjs
 */
import {
  FONT_STACKS, FONT_LABELS, DIMENSIONS, TOKENS, DEFAULT_TOKENS,
  ACCENT_PRESETS, SCHEMES, getScheme, resolveTokens, tokensToCssVars,
} from '../../src/utils/visualScheme.js'

let pass = 0
const failures = []

function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}
function deepEq(actual, expected, label) {
  ok(JSON.stringify(actual) === JSON.stringify(expected), label,
    `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

/** 某令牌的取值是否满足它的 spec —— 登记表与方案共用这把尺子 */
function valueFitsSpec(spec, value) {
  if (spec.type === 'range') {
    return Number.isFinite(value) && value >= spec.min && value <= spec.max
  }
  if (spec.type === 'toggle') return typeof value === 'boolean'
  if (spec.type === 'select') return spec.options.includes(value)
  return false
}

/* ---------------- 令牌登记表 ---------------- */

const dimIds = new Set(DIMENSIONS.map(d => d.id))
const tokenKeys = Object.keys(TOKENS)

ok(tokenKeys.length >= 12, '令牌数量足以覆盖一整套视觉')
ok(dimIds.size === DIMENSIONS.length, '维度 id 唯一')

let specOk = true
let specWhy = ''
for (const [key, spec] of Object.entries(TOKENS)) {
  if (!dimIds.has(spec.dim)) { specOk = false; specWhy = `${key} 的维度 ${spec.dim} 不在 DIMENSIONS 里`; break }
  if (!spec.label) { specOk = false; specWhy = `${key} 缺 label`; break }
  if (!['range', 'select', 'toggle'].includes(spec.type)) { specOk = false; specWhy = `${key} 控件类型非法：${spec.type}`; break }
  if (spec.type === 'range') {
    if (!(spec.min < spec.max)) { specOk = false; specWhy = `${key} 的 min 未小于 max`; break }
    if (!(spec.step > 0)) { specOk = false; specWhy = `${key} 的 step 非正数`; break }
    if (!spec.unit && key !== 'titleWeight') { specOk = false; specWhy = `${key} 缺 unit`; break }
  }
  if (spec.type === 'select') {
    if (!Array.isArray(spec.options) || spec.options.length < 2) { specOk = false; specWhy = `${key} 的 options 不足两项`; break }
  }
  if (!valueFitsSpec(spec, spec.default)) { specOk = false; specWhy = `${key} 的 default 超出自身 spec`; break }
}
ok(specOk, '每个令牌的 spec 自洽（维度/类型/区间/默认值）', specWhy)

// 每个维度都得有令牌，否则面板会出现空分组
const coveredDims = new Set(Object.values(TOKENS).map(t => t.dim))
ok(coveredDims.size === dimIds.size, '六个维度都有令牌落在上面',
  `未覆盖：${[...dimIds].filter(d => !coveredDims.has(d)).join(', ')}`)

deepEq(Object.keys(DEFAULT_TOKENS).sort(), tokenKeys.slice().sort(), 'DEFAULT_TOKENS 与 TOKENS 键集一致')
ok(Object.values(DEFAULT_TOKENS).every(v => v !== undefined), 'DEFAULT_TOKENS 无 undefined')

/* ---------------- 字体族 ---------------- */

deepEq(Object.keys(FONT_LABELS).sort(), Object.keys(FONT_STACKS).sort(), '字体族的中文标签与回退栈一一对应')
ok(Object.values(FONT_STACKS).every(s => typeof s === 'string' && s.length > 0), '每个字体族都有回退栈')
ok(TOKENS.fontFamily.options.every(o => FONT_LABELS[o]), '字体族下拉的每项都有中文名（不暴露内部 id）')

/* ---------------- 预设方案 ---------------- */

const schemeIds = SCHEMES.map(s => s.id)
eq(new Set(schemeIds).size, schemeIds.length, '方案 id 唯一')
ok(SCHEMES.length >= 4, '预设方案数量足够形成风格跨度')

const accentIds = new Set(ACCENT_PRESETS.map(a => a.id))
let schemeOk = true
let schemeWhy = ''
for (const s of SCHEMES) {
  if (!s.name || !s.desc) { schemeOk = false; schemeWhy = `${s.id} 缺 name/desc`; break }
  if (!accentIds.has(s.accent)) { schemeOk = false; schemeWhy = `${s.id} 的 accent ${s.accent} 不在 ACCENT_PRESETS 里`; break }
  if (!['light', 'dark'].includes(s.mode)) { schemeOk = false; schemeWhy = `${s.id} 的 mode 非法：${s.mode}`; break }
  // 每套方案必须是完整取值，不做继承 —— 否则切换方案会残留上一套的令牌
  const missing = tokenKeys.filter(k => !(k in s.tokens))
  if (missing.length) { schemeOk = false; schemeWhy = `${s.id} 缺令牌：${missing.join(', ')}`; break }
  const extra = Object.keys(s.tokens).filter(k => !(k in TOKENS))
  if (extra.length) { schemeOk = false; schemeWhy = `${s.id} 含未登记令牌：${extra.join(', ')}`; break }
  const bad = Object.entries(s.tokens).find(([k, v]) => !valueFitsSpec(TOKENS[k], v))
  if (bad) { schemeOk = false; schemeWhy = `${s.id}.${bad[0]} = ${JSON.stringify(bad[1])} 超出 spec`; break }
}
ok(schemeOk, '每套方案都是完整、合法、自洽的取值', schemeWhy)

/* ---------------- getScheme ---------------- */

eq(getScheme('glass').id, 'glass', '按 id 取到对应方案')
eq(getScheme('does-not-exist').id, SCHEMES[0].id, '未知方案回退到首套（不抛错）')
eq(getScheme(undefined).id, SCHEMES[0].id, 'undefined 回退到首套')

/* ---------------- resolveTokens ---------------- */

deepEq(resolveTokens('glass'), getScheme('glass').tokens, '无微调时令牌等于方案取值')
deepEq(resolveTokens('nope'), getScheme(SCHEMES[0].id).tokens, '未知方案名回退到首套令牌')
deepEq(resolveTokens('glass', null), getScheme('glass').tokens, 'overrides 为 null 不抛错')
deepEq(resolveTokens('glass', undefined), getScheme('glass').tokens, 'overrides 为 undefined 不抛错')

const tDefault = resolveTokens('apple', { radiusCard: 20 })
eq(tDefault.radiusCard, 20, 'range 微调被采纳')
eq(tDefault.gridGap, getScheme('apple').tokens.gridGap, '未微调的令牌保持方案取值')

eq(resolveTokens('apple', { radiusCard: 999 }).radiusCard, TOKENS.radiusCard.max, 'range 微调上溢被夹到 max')
eq(resolveTokens('apple', { radiusCard: -999 }).radiusCard, TOKENS.radiusCard.min, 'range 微调下溢被夹到 min')
eq(resolveTokens('apple', { radiusCard: 5.7 }).radiusCard, 5.7, 'range 微调保留小数（不擅自取整）')

// 脏数据不得把界面搞坏：非数字一律忽略，回落方案值
const appleRadius = getScheme('apple').tokens.radiusCard
eq(resolveTokens('apple', { radiusCard: 'abc' }).radiusCard, appleRadius, '非数字 range 微调被忽略')
eq(resolveTokens('apple', { radiusCard: NaN }).radiusCard, appleRadius, 'NaN range 微调被忽略')
eq(resolveTokens('apple', { radiusCard: undefined }).radiusCard, appleRadius, 'undefined range 微调被忽略')
eq(resolveTokens('apple', { radiusCard: '16' }).radiusCard, 16, '数字字符串被接受（表单 input 常给字符串）')

eq(resolveTokens('apple', { cardAnim: false }).cardAnim, false, 'toggle 微调被采纳')
eq(resolveTokens('apple', { cardAnim: 0 }).cardAnim, false, 'toggle 接受假值')
eq(resolveTokens('flat', { cardAnim: true }).cardAnim, true, 'toggle 接受真值')
eq(resolveTokens('apple', { cardAnim: 'yes' }).cardAnim, true, 'toggle 归一成布尔而非透传原值')

eq(resolveTokens('apple', { fontFamily: 'serif' }).fontFamily, 'serif', 'select 微调命中选项时被采纳')
eq(resolveTokens('apple', { fontFamily: 'comic-sans' }).fontFamily, 'system', 'select 微调不在选项内被忽略')

eq(resolveTokens('apple', { 不存在的令牌: 1 }).radiusCard, appleRadius, '未知令牌键被忽略（不污染结果）')
deepEq(Object.keys(resolveTokens('apple', { 不存在的令牌: 1 })).sort(), tokenKeys.slice().sort(), '结果键集恒等于登记表')

// 微调只影响本次结果，不得回写方案或默认值
const before = JSON.stringify(getScheme('apple').tokens)
resolveTokens('apple', { radiusCard: 0, gridCols: 6, fontFamily: 'mono' })
eq(JSON.stringify(getScheme('apple').tokens), before, 'resolveTokens 不修改方案本身')
eq(DEFAULT_TOKENS.radiusCard, TOKENS.radiusCard.default, 'resolveTokens 不修改 DEFAULT_TOKENS')

/* ---------------- tokensToCssVars ---------------- */

const apple = resolveTokens('apple')
const vars = tokensToCssVars(apple, 'light')

const expectKeys = [
  '--radius', '--radius-sm', '--radius-lg', '--border', '--border-light',
  '--shadow', '--shadow-hover', '--shadow-card', '--card-padding', '--grid-gap',
  '--grid-cols', '--nav-item-h', '--glass-blur', '--glass-bg', '--font',
  '--font-size-base', '--title-weight', '--transition', '--card-anim',
]
deepEq(Object.keys(vars).sort(), expectKeys.slice().sort(), 'CSS 变量键集完整')
ok(Object.values(vars).every(v => typeof v === 'string'), '所有 CSS 变量值都是字符串（setProperty 只吃字符串）')
ok(Object.keys(vars).every(k => k.startsWith('--')), '所有变量名以 -- 开头')

eq(vars['--radius'], '12px', '卡片圆角落成 px')
eq(vars['--radius-sm'], '8px', '控件圆角落成 px')
eq(vars['--radius-lg'], '16px', '大圆角跟随卡片圆角 +4px')
eq(vars['--grid-cols'], '3', '列数以字符串输出（供 repeat() 使用）')
eq(vars['--card-padding'], '18px', '卡片内边距落成 px')
eq(vars['--grid-gap'], '14px', '卡片间距落成 px')
eq(vars['--nav-item-h'], '40px', '导航项高度落成 px')
eq(vars['--glass-blur'], '20px', '毛玻璃模糊落成 px')
eq(vars['--font-size-base'], '14px', '基础字号落成 px')
eq(vars['--title-weight'], '600', '标题字重以字符串输出')
eq(vars['--transition'], '150ms ease', '过渡时长落成 ms + 缓动')
eq(vars['--card-anim'], '1', '开启动画时为乘数 1')
eq(vars['--font'], FONT_STACKS.system, '字体族落成完整回退栈')

// 描边强度是「往面板底色里淡出」：100% 保留原边框，0% 完全融进底色
const fullBorder = tokensToCssVars({ ...apple, borderStrength: 100 }, 'light')
const noBorder = tokensToCssVars({ ...apple, borderStrength: 0 }, 'light')
eq(fullBorder['--border'], 'rgb(229, 229, 231)', '描边 100% 时为浅色模式的基准边框色')
eq(noBorder['--border'], 'rgb(255, 255, 255)', '描边 0% 时边框融进面板底色')
ok(fullBorder['--border'] !== noBorder['--border'], '描边强度确实改变输出')

// 阴影强度 0 必须真的「无阴影」，而不是留一点点
const noShadow = tokensToCssVars({ ...apple, shadowLevel: 0 }, 'light')
ok(noShadow['--shadow-card'].endsWith('0.000)'), '阴影强度 0 时 alpha 归零', noShadow['--shadow-card'])
ok(noShadow['--shadow'].endsWith('0.000)'), '阴影强度 0 时悬浮阴影同样归零', noShadow['--shadow'])

// 层次要递进：静置 < 悬浮 < 卡片投影，否则 hover 反馈会失去方向感
const alphaOf = v => Number(v.match(/([\d.]+)\)$/)[1])
ok(alphaOf(vars['--shadow-card']) < alphaOf(vars['--shadow'])
  && alphaOf(vars['--shadow']) < alphaOf(vars['--shadow-hover']),
  '阴影三层 alpha 递进：卡片 < 静置 < 悬浮',
  `${alphaOf(vars['--shadow-card'])} / ${alphaOf(vars['--shadow'])} / ${alphaOf(vars['--shadow-hover'])}`)

// 深色模式的阴影要更重，否则深底上看不见
const darkVars = tokensToCssVars(apple, 'dark')
eq(darkVars['--shadow-card'], '0 1px 4px rgba(0, 0, 0, 0.096)', '深色模式阴影按 2.4 倍放大')
eq(darkVars['--glass-bg'], 'rgba(44, 44, 48, 0.720)', '深色模式玻璃底色基于深色基准')
ok(darkVars['--glass-bg'] !== vars['--glass-bg'], '深浅模式的玻璃底色不同')

eq(tokensToCssVars(apple, 'nope')['--glass-bg'], vars['--glass-bg'], '未知主题模式回退到浅色基准')

eq(tokensToCssVars({ ...apple, glassAlpha: 100 }, 'light')['--glass-bg'], 'rgba(255, 255, 255, 1.000)', '面板不透明度 100% 为实心')
eq(tokensToCssVars({ ...apple, glassAlpha: 40 }, 'light')['--glass-bg'], 'rgba(255, 255, 255, 0.400)', '面板不透明度 40% 为半透')

eq(tokensToCssVars({ ...apple, cardAnim: false }, 'light')['--card-anim'], '0', '关闭动画时为乘数 0（calc 归零，无需条件类名）')
eq(tokensToCssVars({ ...apple, fontFamily: '不存在的字体' }, 'light')['--font'], FONT_STACKS.system, '未知字体族回退到系统栈')

// 每套方案 × 每种模式都得产出完整变量，且不含 NaN/undefined —— 否则会静默写坏全局样式
let emitOk = true
let emitWhy = ''
for (const s of SCHEMES) {
  for (const mode of ['light', 'dark']) {
    const v = tokensToCssVars(resolveTokens(s.id), mode)
    const bad = Object.entries(v).find(([, val]) => !val || /NaN|undefined/.test(val))
    if (bad) { emitOk = false; emitWhy = `${s.id}/${mode} → ${bad[0]} = ${bad[1]}`; break }
  }
  if (!emitOk) break
}
ok(emitOk, '所有方案在深浅模式下都产出干净变量', emitWhy)

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ ${failures.length} 条断言失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 视觉方案全部通过：${pass} 条断言`)