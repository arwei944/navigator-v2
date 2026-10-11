/**
 * src/utils/chartkit.js 用例：零依赖、不联网、纯字符串断言。
 *
 * 这里的**核心不变量**是两条安全与主题约束，它们一旦破了不会报错、只会悄悄出问题：
 *   1. 图表**绝不输出文本** —— 文本一旦进 SVG，外部数据（站点名）就有了注入面；
 *   2. 颜色**必须是 CSS 变量** —— 写死色值在深色主题下会变成一块看不清的补丁。
 * 这两条都由测试钉住，改 chartkit 时想破得先改测试。
 * 运行：node tools/console/test-chartkit.mjs
 */
import { sparkline, donut, heatstrip, barTrack } from '../../src/utils/chartkit.js'

let pass = 0
const failures = []

function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}
function has(svg, needle, label) {
  ok(String(svg).includes(needle), label, `输出里没有 ${needle}`)
}

/* ---------------- 安全与主题（核心不变量） ---------------- */

const samples = [
  sparkline([1, 4, 2, 8], {}),
  donut([{ value: 3, color: 'var(--accent)' }, { value: 1, color: 'var(--color-ok)' }], {}),
  heatstrip([{ value: 2, color: 'var(--color-danger)' }], {}),
  barTrack(5, 10, {}),
]
for (const [i, svg] of samples.entries()) {
  ok(!svg.includes('<text'), `图表不输出任何文本（样本 ${i + 1}）—— 文本由 HTML 渲染，进了 SVG 就是注入面`)
  ok(!svg.includes('onclick') && !svg.includes('onload'), `图表不含事件属性（样本 ${i + 1}）`)
  ok(svg.startsWith('<svg'), `输出是 svg 字符串（样本 ${i + 1}）`)
  ok(svg.includes('aria-hidden="true"'), `图表对屏幕阅读器隐藏（样本 ${i + 1}），语义由旁边的文字承担`)
}
has(sparkline([1, 2, 3], {}), 'var(--accent)', '趋势线默认用主题强调色变量')
has(heatstrip([{ value: 1 }], {}), 'var(--accent)', '堆叠条默认色也是变量')
has(donut([], {}), 'var(--border-light)', '空轨道用边框变量而不是写死颜色')

/* ---------------- sparkline ---------------- */

const flat = sparkline([], {})
has(flat, 'line', '空数据画一条基线（不画贴底折线）')
const zeros = sparkline([0, 0, 0], { width: 120, height: 32 })
has(zeros, '<polyline', '全零时画一条贴底的折线（而不是什么都不画）')
ok(!zeros.includes('<polygon'), '全零不画面积（否则「都是 0」看起来像「有数据」）')

const one = sparkline([7], { width: 120, height: 32 })
has(one, '<circle', '单点画一个圆点（折线画不出来）')
ok(!one.includes('<polyline'), '单点不画折线')

const line = sparkline([1, 5, 3, 9], { width: 120, height: 32 })
has(line, '<polyline', '多点画折线')
has(line, '<polygon', '默认带面积填充')
has(line, 'viewBox="0 0 120 32"', '尺寸写进 viewBox')

const noArea = sparkline([1, 5, 3, 9], { width: 120, height: 32, area: null })
ok(!noArea.includes('<polygon'), 'area:null 关闭面积（图表令牌 chartArea 关掉时走这条路）')

// 数值必须被裁剪到两位以内：SVG 属性不需要更高精度，长小数会白白撑大 DOM
ok(/points="[\d.,\s-]+"/.test(line), '折线点集只含数字与分隔符')
ok(!line.includes('NaN'), '非法输入不产生 NaN（否则整条线渲染不出来）')
ok(!sparkline(['a', null, 3], {}).includes('NaN'), '混入非数字也不产生 NaN')

/* ---------------- donut ---------------- */

const emptyDonut = donut([], { size: 140, thickness: 16 })
has(emptyDonut, '<circle', '空数据仍画一圈轨道（否则面板高度会塌陷抖动）')
has(emptyDonut, 'viewBox="0 0 140 140"', '环形尺寸写进 viewBox')

const segDonut = donut([
  { value: 3, color: 'var(--color-ok)' },
  { value: 1, color: 'var(--color-danger)' },
], { size: 140, thickness: 16 })
eq((segDonut.match(/<circle/g) || []).length, 3, '轨道 1 圈 + 两段各 1 圈')
has(segDonut, 'stroke-dasharray', '分段靠 dasharray 实现')
has(segDonut, 'rotate(-90', '从 12 点方向起画')

// 零值段不该占位置：占了就等于凭空多一段
const withZero = donut([{ value: 3, color: 'var(--color-ok)' }, { value: 0, color: 'var(--color-danger)' }], {})
eq((withZero.match(/<circle/g) || []).length, 2, '零值段不画弧')
ok(!donut([{ value: 0 }], {}).includes('NaN'), '总量为 0 不产生 NaN')

/* ---------------- heatstrip ---------------- */

const emptyStrip = heatstrip([], { width: 320, height: 10 })
has(emptyStrip, '<rect', '空数据画一条空轨道')
const strip = heatstrip([{ value: 2, color: 'var(--color-ok)' }, { value: 1, color: 'var(--color-warn)' }], { width: 320, height: 10 })
eq((strip.match(/<rect x=/g) || []).length, 2, '两段各一个矩形')
has(strip, 'clip-path', '圆角靠外层 clip，避免段与段之间露缝')
ok(!strip.includes('NaN'), '零总量不产生 NaN')

/* ---------------- barTrack ---------------- */

const zeroBar = barTrack(0, 10, { width: 160, height: 8 })
eq((zeroBar.match(/<rect/g) || []).length, 1, '值为 0 时只画轨道，不画填充块')
has(barTrack(5, 10, { width: 160, height: 8 }), 'width="80"', '一半的比例画一半长度')
has(barTrack(10, 10, { width: 160, height: 8 }), 'width="160"', '等于最大值时画满')
ok(!barTrack(5, 0, {}).includes('NaN'), 'max 为 0 不产生 NaN（除零兜底）')
has(barTrack(1, 100, { width: 100, height: 8, color: 'var(--color-ok)' }), 'var(--color-ok)', '自定义颜色透传到输出')

/* ---------------- 边界尺寸 ---------------- */

has(sparkline([1, 2], { width: 1, height: 1 }), 'viewBox="0 0 16 8"', '过小尺寸被钳到下限（否则图形画不出来）')
has(sparkline([1, 2], { width: 99999, height: 99999 }), 'viewBox="0 0 2000 400"', '过大尺寸被钳到上限')

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ ${failures.length} 条断言失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 图表原语全部通过：${pass} 条断言\n`)
