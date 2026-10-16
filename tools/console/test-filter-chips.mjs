/**
 * 筛选条第二行取数：pickInlineChips。
 *
 * 盯的是两类事故：
 *   ① 已选中的标签被挤出第二行 —— 用户看不见自己选了什么；
 *   ② 计数相同时顺序不稳定 —— 每次刷新换一批标签。
 */
import { pickInlineChips, INLINE_MAX } from '../../src/utils/filterChips.js'

let pass = 0
const failures = []
function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}
function ids(list) { return list.map(c => c.id) }
function deepEq(actual, expected, label) {
  ok(JSON.stringify(actual) === JSON.stringify(expected), label,
    `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

const chip = (id, count) => ({ id, label: id, count })

/* ---- 基本：按站点数降序取前 N ---- */
const many = [chip('a', 3), chip('b', 9), chip('c', 5), chip('d', 7), chip('e', 1),
  chip('f', 8), chip('g', 2), chip('h', 6), chip('i', 4), chip('j', 10)]
deepEq(ids(pickInlineChips(many)), ['j', 'b', 'f', 'd', 'h', 'c', 'i', 'a'], '按 count 降序取前 8')
eq(pickInlineChips(many).length, INLINE_MAX, '行内上限正好是 INLINE_MAX')

/* ---- 不足 N 个时全给 ---- */
deepEq(ids(pickInlineChips([chip('a', 1), chip('b', 2)])), ['b', 'a'], '候选不足时全部显示')
deepEq(pickInlineChips([]), [], '没有候选时返回空')

/* ---- 已选中的标签永远留在行内，且排在最前 ---- */
const pinnedChip = chip('c', 1) // 计数最低，若只按 count 排序会被挤出前 8
deepEq(ids(pickInlineChips(many, [pinnedChip])).slice(0, 1), ['c'], '已选中的标签排第一')
ok(ids(pickInlineChips(many, [pinnedChip])).includes('c'), '计数最低也不被挤出')
eq(pickInlineChips(many, [pinnedChip]).length, INLINE_MAX, '加了 pinned 仍是上限个')

/* ---- pinned 与候选重复时只出现一次 ---- */
const dup = pickInlineChips(many, [chip('j', 10)])
eq(dup.filter(c => c.id === 'j').length, 1, 'pinned 与候选重复时不重复渲染')
eq(ids(dup)[0], 'j', '重复时仍排第一')

/* ---- pinned 不在候选里也要显示（用途是另一条轴，不在分类候选内） ---- */
const purposePin = { id: 'reading', label: '查资料', count: 68, kind: 'purpose' }
const withPurpose = pickInlineChips(many, [purposePin])
eq(ids(withPurpose)[0], 'reading', '跨轴的已选项（用途）也留在行内')
eq(withPurpose.find(c => c.id === 'reading').kind, 'purpose', 'pinned 的额外字段原样带出')

/* ---- 两个 pinned：保持传入顺序，分类在前、用途在后 ---- */
deepEq(ids(pickInlineChips(many, [pinnedChip, purposePin])).slice(0, 2), ['c', 'reading'],
  '多个 pinned 保持传入顺序')

/* ---- 计数相同：保持传入顺序（稳定），不随刷新抖动 ---- */
const ties = [chip('x', 5), chip('y', 5), chip('z', 5), chip('w', 5)]
deepEq(ids(pickInlineChips(ties)), ['x', 'y', 'z', 'w'], '计数相同保持原顺序')
deepEq(ids(pickInlineChips(ties.map(c => ({ ...c })))), ['x', 'y', 'z', 'w'], '同样输入两次结果一致')

/* ---- pinned 超过上限时截断（上限是硬约束，保证第二行只有一行） ---- */
const lots = Array.from({ length: 12 }, (_, i) => chip('p' + i, i))
eq(pickInlineChips(many, lots).length, INLINE_MAX, 'pinned 超额时按上限截断')

/* ---- 不修改入参 ---- */
const original = [chip('a', 1), chip('b', 2)]
const snapshot = JSON.stringify(original)
pickInlineChips(original, [chip('z', 0)])
eq(JSON.stringify(original), snapshot, '不修改传入的候选数组')

/* ---- 脏数据不炸：count 缺失 / 空对象 ---- */
deepEq(ids(pickInlineChips([{ id: 'n' }, chip('m', 3)])), ['m', 'n'], '缺 count 视为 0')
deepEq(ids(pickInlineChips([null, undefined, chip('a', 1)])), ['a'], '候选里的空值被跳过')
deepEq(ids(pickInlineChips(many, [null])).slice(0, 1), ['j'], 'pinned 里的空值被跳过')

/* ---- 与「更多」面板的配合：面板显示完整分组表，行内是它的子集 ---- */
const all = pickInlineChips(many, [pinnedChip])
ok(all.every(c => many.some(m => m.id === c.id)), '行内标签都来自候选（不会凭空多出来）')

console.log(`\n筛选条取数：${pass} 通过 / ${failures.length} 失败`)
if (failures.length) {
  for (const f of failures) console.log('  ✖ ' + f)
  process.exit(1)
}
