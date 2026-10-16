/**
 * 侧栏宽度取值范围：clampSideWidth。
 *
 * 盯的是两类事故：
 *   ① 把侧栏拖成「看不见也点不到」的宽度（下限必须是图标的物理下限）；
 *   ② 拖拽事件偶尔给出 NaN/字符串，写进 store 之后布局直接塌掉。
 */
import {
  clampSideWidth, isIconOnlyWidth, MIN_SIDE_W, MAX_SIDE_W, DEFAULT_SIDE_WIDTH, ICON_ONLY_W,
} from '../../src/utils/sideWidth.js'

let pass = 0
const failures = []
function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

/* ---- 正常值原样通过 ---- */
eq(clampSideWidth(240), 240, '默认宽度原样通过')
eq(clampSideWidth(300), 300, '中间值原样通过')

/* ---- 边界：下限是图标的物理下限，不能拖成看不见 ---- */
eq(clampSideWidth(10), MIN_SIDE_W, '拖得太窄 → 收到下限（图标栏）')
eq(clampSideWidth(0), MIN_SIDE_W, '拖到 0 → 收到下限（不是隐藏）')
eq(clampSideWidth(-500), MIN_SIDE_W, '负值 → 收到下限')
eq(clampSideWidth(MIN_SIDE_W), MIN_SIDE_W, '下限本身合法')
eq(clampSideWidth(MAX_SIDE_W), MAX_SIDE_W, '上限本身合法')
eq(clampSideWidth(9999), MAX_SIDE_W, '拖得太宽 → 收到上限')

/* ---- 脏数据：拖拽事件偶尔给 NaN / 字符串 ---- */
eq(clampSideWidth(NaN), DEFAULT_SIDE_WIDTH, 'NaN → 回落默认宽度')
eq(clampSideWidth(undefined), DEFAULT_SIDE_WIDTH, 'undefined → 回落默认')
eq(clampSideWidth(null), DEFAULT_SIDE_WIDTH, 'null → 回落默认（不按 0 处理，避免塌成图标栏）')
eq(clampSideWidth(''), DEFAULT_SIDE_WIDTH, '空字符串 → 回落默认')
eq(clampSideWidth('300'), 300, '字符串数字也能用')
eq(clampSideWidth('abc'), DEFAULT_SIDE_WIDTH, '非数字字符串 → 回落默认')
eq(clampSideWidth(NaN, 280), 280, '可以指定回落值（右栏用 280）')
eq(clampSideWidth(180.6), 181, '小数取整（半像素宽度会让边界发虚）')

/* ---- 图标态判定：拖到某一档就自动收标签 ---- */
eq(isIconOnlyWidth(60), true, '图标栏宽度 → 图标态')
eq(isIconOnlyWidth(ICON_ONLY_W), true, '正好在阈值上 → 图标态')
eq(isIconOnlyWidth(ICON_ONLY_W + 1), false, '刚过阈值 → 显示标签')
eq(isIconOnlyWidth(300), false, '宽栏 → 显示标签')

/* ---- 常量之间的关系（范围本身要成立）---- */
ok(MIN_SIDE_W < DEFAULT_SIDE_WIDTH && DEFAULT_SIDE_WIDTH < MAX_SIDE_W,
  '常量关系：下限 < 默认 < 上限', `${MIN_SIDE_W} < ${DEFAULT_SIDE_WIDTH} < ${MAX_SIDE_W}`)
ok(ICON_ONLY_W > MIN_SIDE_W, '图标阈值大于下限（否则「图标态」这一档不存在）', `${ICON_ONLY_W} > ${MIN_SIDE_W}`)

console.log(`\n侧栏宽度：${pass} 通过 / ${failures.length} 失败`)
if (failures.length) {
  for (const f of failures) console.log('  ✖ ' + f)
  process.exit(1)
}
