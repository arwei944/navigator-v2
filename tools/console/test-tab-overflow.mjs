/**
 * 顶部标签溢出计算：computeVisibleCount。
 *
 * 盯的是两类事故：
 *   ① 模块从界面上消失（既不在可见区、也不在「更多」里）；
 *   ② 「更多」按钮出现后反过来挤掉标签，形成抖动。
 */
import { computeVisibleCount, MORE_BTN_WIDTH } from '../../src/utils/tabOverflow.js'

let pass = 0
const failures = []
function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${expected}，实得 ${actual}`)
}

// 13 个模块的真实占位宽度（约值：2 字标签 ~66，6 字标签 ~110）
const W = [78, 104, 78, 104, 104, 104, 104, 118, 104, 104, 104, 118, 92]

/* ---- 装得下：不显示「更多」，全部可见 ---- */
eq(computeVisibleCount(W, 2000), 13, '宽度充裕时全部可见')
eq(computeVisibleCount([50, 50], 100), 2, '刚好相等也算装得下（不预留更多）')
eq(computeVisibleCount(W, W.reduce((a, b) => a + b, 0)), 13, '总和正好等于可用宽度 → 全部可见')

/* ---- 装不下：预留「更多」后再贪心 ---- */
const avail = 700
const n = computeVisibleCount(W, avail)
ok(n < 13, '13 个装不下时会收进「更多」', `可见 ${n} 个`)
const used = W.slice(0, n).reduce((a, b) => a + b, 0)
ok(used <= avail - MORE_BTN_WIDTH, '可见标签 + 「更多」不超出可用宽度',
  `${used} + ${MORE_BTN_WIDTH} ≤ ${avail}`)
ok(used + W[n] > avail - MORE_BTN_WIDTH, '再多放一个就会挤到「更多」',
  `${used + W[n]} > ${avail - MORE_BTN_WIDTH}`)

/* ---- 可见 + 收起 = 全部：一个都不能少（这是这个模块唯一的硬不变量）---- */
for (const a of [420, 560, 700, 860, 1000]) {
  const k = computeVisibleCount(W, a)
  ok(k >= 1 && k <= 13, `可用 ${a} 时可见数为 1..13`, String(k))
  ok(k === 13 || W.slice(0, k).length + W.slice(k).length === W.length,
    `可用 ${a} 时可见 + 收起 = 全部`)
}

/* ---- 极端窄：至少留一个标签 ---- */
eq(computeVisibleCount(W, 60), 1, '极窄时至少留 1 个标签（不能整条只剩「更多」）')
eq(computeVisibleCount(W, 0), 1, '可用宽度为 0 也留 1 个')
eq(computeVisibleCount(W, -50), 1, '负数可用宽度容错')
eq(computeVisibleCount(W, MORE_BTN_WIDTH + 10), 1, '预算只够一个标签时给 1 个')

/* ---- 空与脏数据 ---- */
eq(computeVisibleCount([], 800), 0, '没有标签时返回 0')
eq(computeVisibleCount(null, 800), 0, '入参为 null 容错')
eq(computeVisibleCount([null, undefined, 60], 800), 3, '宽度数组里的空值按 0 算')
eq(computeVisibleCount(['80', 80], 800), 2, '字符串宽度也能算')

/* ---- 单调性：可用宽度越大，可见数不减（否则会来回抖）---- */
let prev = 0
let mono = true
for (let a = 100; a <= 1400; a += 20) {
  const k = computeVisibleCount(W, a)
  if (k < prev) { mono = false; break }
  prev = k
}
ok(mono, '可用宽度单调增时可见数不减少')

/* ---- 不修改入参 ---- */
const snapshot = JSON.stringify(W)
computeVisibleCount(W, 500)
eq(JSON.stringify(W), snapshot, '不修改传入的宽度数组')

console.log(`\n标签溢出计算：${pass} 通过 / ${failures.length} 失败`)
if (failures.length) {
  for (const f of failures) console.log('  ✖ ' + f)
  process.exit(1)
}
