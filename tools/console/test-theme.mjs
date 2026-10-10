/**
 * 主题模型用例：零依赖、不联网、不起浏览器。
 *
 * 重点守三件事：
 *   1. 内置主题是**完整取值**（缺令牌会让切换残留上一套的值 —— 与视觉方案同一条守卫）；
 *   2. 自定义主题存的是「覆盖」，非法取值一律丢弃而不是让整份数据失效；
 *   3. 导入 / 分享码往返一致，且坏数据不会把界面搞坏。
 *
 * 运行：node tools/console/test-theme.mjs
 */
import {
  COLOR_KEYS, THEME_PRESETS, THEME_VERSION, blankCustomFrom, builtinThemes, colorsFromPreset,
  fromShareCode, isBuiltinId, isHexColor, normalizeCustom, parseThemes, schemeIdOf,
  serializeThemes, toShareCode
} from '../../src/utils/themeSchema.js'
import { SCHEMES, TOKENS, getScheme } from '../../src/utils/visualScheme.js'

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

/* ---------------- 配色预设 ---------------- */

const tokenKeys = Object.keys(TOKENS)
const presetIds = Object.keys(THEME_PRESETS)
ok(presetIds.length >= 6, '配色预设数量（含新增的宣纸 / 夜航）')

let presetOk = true
let presetWhy = ''
for (const [id, p] of Object.entries(THEME_PRESETS)) {
  if (p.id !== id) { presetOk = false; presetWhy = `${id} 的 id 与键不一致`; break }
  if (!p.name) { presetOk = false; presetWhy = `${id} 缺 name`; break }
  for (const k of COLOR_KEYS) {
    if (!isHexColor(p[k])) { presetOk = false; presetWhy = `${id}.${k} 不是合法颜色：${p[k]}`; break }
  }
  if (presetOk) {
    for (const k of COLOR_KEYS) {
      if (!isHexColor(p.dark?.[k])) { presetOk = false; presetWhy = `${id}.dark.${k} 不是合法颜色`; break }
    }
  }
}
ok(presetOk, '每套配色都有明暗两套合法色值', presetWhy)

ok(isHexColor('#fff'), '三位十六进制被接受')
ok(isHexColor('#0F766E'), '六位十六进制被接受（大小写均可）')
ok(!isHexColor('red'), '颜色名不被接受')
ok(!isHexColor('rgba(0,0,0,.5)'), 'rgba 不被接受（主题只收 hex）')
ok(!isHexColor('#12345'), '五位十六进制被拒')

{
  const c = colorsFromPreset('paper')
  eq(Object.keys(c.light).length, COLOR_KEYS.length, '取色覆盖全部颜色键（浅色）')
  eq(Object.keys(c.dark).length, COLOR_KEYS.length, '取色覆盖全部颜色键（深色）')
  const fallback = colorsFromPreset('不存在的预设')
  eq(fallback.light.accent, THEME_PRESETS.default.accent, '未知预设回落到默认配色')
}

/* ---------------- 内置主题 ---------------- */

const builtins = builtinThemes()
eq(builtins.length, SCHEMES.length, '每个视觉方案对应一个内置主题')

let bOk = true
let bWhy = ''
const seen = new Set()
for (const t of builtins) {
  if (t.kind !== 'builtin') { bOk = false; bWhy = 'kind 必须是 builtin'; break }
  if (seen.has(t.id)) { bOk = false; bWhy = `重复的主题 id：${t.id}`; break }
  seen.add(t.id)
  if (!isBuiltinId(t.id)) { bOk = false; bWhy = `${t.id} 不是内置 id 形式`; break }
  if (!t.name || !t.desc) { bOk = false; bWhy = `${t.id} 缺名称或描述`; break }
  // 令牌必须完整：缺项会让「切换主题」残留上一套的取值
  const missing = tokenKeys.filter(k => !(k in t.tokens))
  if (missing.length) { bOk = false; bWhy = `${t.id} 缺令牌：${missing.join(', ')}`; break }
  const scheme = getScheme(schemeIdOf(t.id))
  if (scheme.id !== schemeIdOf(t.id)) { bOk = false; bWhy = `${t.id} 找不到对应方案`; break }
  for (const mode of ['light', 'dark']) {
    if (Object.keys(t.colors[mode]).length !== COLOR_KEYS.length) {
      bOk = false; bWhy = `${t.id}.${mode} 颜色不全`; break
    }
  }
}
ok(bOk, '内置主题是完整、无重复、可解析的取值', bWhy)

eq(builtins.find(t => t.id === 'builtin:paper')?.name, '宣纸', '新增的宣纸主题在列')
eq(builtins.find(t => t.id === 'builtin:night')?.name, '夜航', '新增的夜航主题在列')

eq(schemeIdOf('builtin:glass'), 'glass', '能从主题 id 取回方案 id')
eq(isBuiltinId('user:abc'), false, '自定义 id 不被当作内置')
eq(isBuiltinId('builtin:x'), true, '内置 id 被识别')

/* ---------------- 自定义主题规范化 ---------------- */

const base = {
  id: 'user:test', name: '测试', base: 'paper',
  colors: { light: { accent: '#123456' }, dark: {} },
  tokens: { radiusCard: 16 }
}
{
  const t = normalizeCustom(base)
  eq(t.id, 'user:test', 'id 保留')
  eq(t.base, 'paper', '基础方案保留')
  eq(t.colors.light.accent, '#123456', '合法颜色保留')
  eq(t.tokens.radiusCard, 16, '合法令牌保留')
}

eq(normalizeCustom(null), null, 'null 被拒')
eq(normalizeCustom({ base: '不存在' }), null, '未知基础方案被拒')
eq(normalizeCustom({ base: 'paper', name: '   ' }).name, '我的主题', '空名称回落到默认名')

{
  const t = normalizeCustom({
    base: 'paper',
    colors: { light: { accent: 'red', bg: '#fff' } },
    tokens: { radiusCard: 9999, fontFamily: 'comic', cardAnim: 'yes', 未知: 1 }
  })
  eq(t.colors.light.accent, undefined, '非法颜色被丢弃（而不是让整份数据失效）')
  eq(t.colors.light.bg, '#fff', '合法颜色仍保留')
  eq(t.tokens.radiusCard, undefined, '超范围令牌被丢弃')
  eq(t.tokens.fontFamily, undefined, '不在选项内的 select 值被丢弃')
  eq(t.tokens.cardAnim, undefined, '非布尔 toggle 被丢弃')
  deepEq(t.tokens, {}, '结果里没有脏键')
}

{
  const t = normalizeCustom({ base: 'paper' })
  ok(t.id.startsWith('user:'), '没有 id 时自动分配 user: 前缀的 id')
  ok(t.name.length > 0, '总有名称')
}

{
  const a = blankCustomFrom('night', '夜')
  eq(a.base, 'night', '空白主题使用指定基础方案')
  eq(a.name, '夜', '名称被采纳')
  deepEq(a.tokens, {}, '空白主题没有任何令牌覆盖')
  eq(Object.keys(a.colors.light).length, COLOR_KEYS.length, '空白主题带上基础方案的完整配色')
}

/* ---------------- 导入 / 导出 ---------------- */

{
  const list = [normalizeCustom(base)]
  const text = serializeThemes(list)
  ok(text.includes(`"v": ${THEME_VERSION}`), '导出内容带版本号')
  const parsed = parseThemes(text)
  eq(parsed.themes.length, 1, '导出后能原样解析回来')
  eq(parsed.themes[0].colors.light.accent, '#123456', '往返后颜色不变')
}

{
  const parsed = parseThemes('[{"base":"paper"},{"base":"nope"},{"base":"night"}]')
  eq(parsed.themes.length, 2, '数组形式也接受')
  eq(parsed.skipped, 1, '无法识别的条目被计入 skipped')
}

eq(parseThemes('这不是 JSON').themes.length, 0, '坏 JSON 不抛错，返回空列表')
eq(parseThemes('').themes.length, 0, '空串返回空列表')
eq(parseThemes('{"themes":[]}').themes.length, 0, '空主题文件返回空列表')

/* ---------------- 分享码 ---------------- */

{
  const t = normalizeCustom(base)
  const code = toShareCode(t)
  ok(code.length > 0, '能生成分享码')
  const back = fromShareCode(code)
  eq(back.id, t.id, '分享码往返后 id 一致')
  eq(back.colors.light.accent, '#123456', '分享码往返后颜色一致')
  eq(fromShareCode('!!!not-base64!!!'), null, '坏分享码返回 null 而不是抛错')
  eq(fromShareCode(''), null, '空分享码返回 null')
}

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 主题模型 ${failures.length} 条断言失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 主题模型全部通过：${pass} 条断言`)
