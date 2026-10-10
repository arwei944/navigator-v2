/**
 * 便利贴 / 站点备注的同步内核用例：零依赖、不联网、不起浏览器。
 *
 * 覆盖三块最容易被改坏的规则：
 *   1. LWW 合并（含时钟相等时的取舍 —— 没有确定结果会让两端来回抖）；
 *   2. 墓碑（删除必须留痕，否则旧设备一同步就把删掉的条目复活）；
 *   3. 便利贴文本解析（清单勾选 / 粗体 / 链接，以及**不产生危险链接**）。
 *
 * 运行：node tools/console/test-notes.mjs
 */
import {
  LIMITS, TOMBSTONE_TTL, actionTime, clampText, estimateBytes, isNewer, isTombstone,
  makeEntry, mergeEntry, mergeMaps, pruneTombstones, tombstone
} from '../../src/utils/noteSync.js'
import { inlineParts, parseNoteLines, pendingTodos, toggleTodoLine } from '../../src/utils/noteText.js'

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

/* ---------------- LWW 合并 ---------------- */

const older = { text: 'A', rev: 1, updatedAt: 1000, deletedAt: null }
const newer = { text: 'B', rev: 2, updatedAt: 2000, deletedAt: null }

eq(actionTime(older), 1000, '无墓碑时动作时间取 updatedAt')
eq(actionTime({ updatedAt: 1000, deletedAt: 3000 }), 3000, '有墓碑时动作时间取 max')
eq(actionTime(null), 0, '空条目的动作时间为 0')

ok(isNewer(newer, older), '时间更晚的是新的')
ok(!isNewer(older, newer), '时间更早的不是新的')
ok(!isNewer(newer, newer), '完全相同不算新（相等取本地）')
ok(isNewer({ rev: 2, updatedAt: 1000 }, { rev: 1, updatedAt: 1000 }), '时间相等时比 rev')
ok(!isNewer({ rev: 1, updatedAt: 1000 }, { rev: 1, updatedAt: 1000 }), 'rev 也相等取本地')
ok(isNewer(older, null), '本地为空时远端胜出')
ok(!isNewer(null, older), '远端为空时不胜出')

eq(mergeEntry(older, newer), newer, '合并取较新的一条（返回原对象引用）')
eq(mergeEntry(newer, older), newer, '远端较旧时不覆盖本地')
eq(mergeEntry(null, newer), newer, '本地缺失时补进远端')
eq(mergeEntry(older, null), older, '远端缺失时保留本地')

// 幂等：同一条远端消息重复到达，结果必须一致（广播允许重复投递）
{
  const local = { a: older }
  const first = mergeMaps(local, { a: newer })
  const second = mergeMaps(first.merged, { a: newer })
  eq(second.changed, false, '重复投递同一条消息时 changed 为 false（幂等）')
  eq(second.merged.a, newer, '重复投递后仍是同一条胜出者')
}

{
  const { merged, changed, added } = mergeMaps({}, { a: older, b: newer })
  eq(changed, true, '新增条目算变更')
  deepEq(added.sort(), ['a', 'b'], '新增的 id 被列出')
  eq(Object.keys(merged).length, 2, '两条都进结果')
}

{
  // 时钟回拨 / 两端同时间戳：必须有一个确定结果，且不抖动
  const a = { text: 'x', rev: 1, updatedAt: 5000 }
  const b = { text: 'y', rev: 1, updatedAt: 5000 }
  eq(mergeEntry(a, b), a, '时间与 rev 都相等时取本地')
  eq(mergeEntry(b, a), b, '两端各自取本地 → 不会互相覆盖')
}

/* ---------------- 墓碑 ---------------- */

const dead = tombstone(newer)
eq(dead.deletedAt > 0, true, '墓碑有 deletedAt')
eq(dead.text, 'B', '墓碑保留原文（供撤销）')
ok(isTombstone(dead), '墓碑被识别为已删除')
ok(!isTombstone(newer), '正常条目不是墓碑')

eq(mergeEntry(newer, dead), dead, '较新的墓碑胜出（删除得以传播）')
eq(mergeEntry(dead, newer), dead, '较旧的正常条目不会复活墓碑')

{
  const now = Date.now()
  const fresh = { text: 'a', rev: 2, updatedAt: now - 1000, deletedAt: now - 500 }
  const stale = { text: 'b', rev: 2, updatedAt: now - TOMBSTONE_TTL - 5000, deletedAt: now - TOMBSTONE_TTL - 1 }
  const alive = { text: 'c', rev: 1, updatedAt: now - TOMBSTONE_TTL * 3, deletedAt: null }
  const { map, removed } = pruneTombstones({ fresh, stale, alive }, now, TOMBSTONE_TTL)
  eq(removed, 1, '只清理过期墓碑')
  ok('fresh' in map, '未过期的墓碑保留')
  ok('alive' in map, '普通条目不受墓碑清理影响')
  ok(!('stale' in map), '过期墓碑被清掉')
}

/* ---------------- 体量与截断 ---------------- */

eq(estimateBytes('abc'), 6, '字节估算按字符数上界')
ok(estimateBytes({ a: 1 }) > 0, '对象也能估算')

{
  const long = 'x'.repeat(LIMITS.SITE_NOTE_MAX) // 字符数 = 字节上限的一半，必然超
  const clamped = clampText(long, LIMITS.SITE_NOTE_MAX)
  ok(clamped.length < long.length, '超长文本被截断')
  ok(estimateBytes(clamped) <= LIMITS.SITE_NOTE_MAX, '截断后不超上限')
  eq(clampText('短', LIMITS.SITE_NOTE_MAX), '短', '未超限时原样返回')
}

{
  // 代理对不能被切一半
  const emoji = '😀'.repeat(100)
  const out = clampText(emoji, 20)
  ok(!/[\uD800-\uDBFF]$/.test(out), '截断不落在半个代理对上')
}

/* ---------------- 新条目的 rev 与时间由内核给 ---------------- */

{
  const prev = { text: 'a', rev: 3, updatedAt: 111 }
  const made = makeEntry({ text: 'b' }, prev)
  eq(made.rev, 4, 'rev 自增')
  ok(made.updatedAt >= 111, 'updatedAt 取当下')
  eq(made.deletedAt, null, '新条目没有墓碑')

  const forged = makeEntry({ text: 'c', rev: 999, updatedAt: 1 }, prev)
  eq(forged.rev, 4, '外部传的 rev 被忽略')
  ok(forged.updatedAt > 1, '外部传的 updatedAt 被忽略')
}

/* ---------------- 便利贴文本解析 ---------------- */

deepEq(parseNoteLines('- [x] 已完成').map(l => [l.type, l.done, l.text]), [['todo', true, '已完成']], '识别已勾选清单')
deepEq(parseNoteLines('- [ ] 未完成').map(l => [l.type, l.done, l.text]), [['todo', false, '未完成']], '识别未勾选清单')
eq(parseNoteLines('- 普通项')[0].type, 'bullet', '识别无序列表')
eq(parseNoteLines('正文')[0].type, 'text', '识别正文行')
eq(parseNoteLines('')[0].type, 'blank', '空行标为 blank')

{
  const lines = parseNoteLines('- [ ] A\n普通\n- [x] B')
  deepEq(lines.filter(l => l.type === 'todo').map(l => l.todoIdx), [0, 1], 'todoIdx 按清单项计数，与行号无关')
}

deepEq(pendingTodos('- [ ] A\n- [x] B\n- [ ] C'), ['A', 'C'], '只取未完成的清单项')
deepEq(pendingTodos('没有清单'), [], '没有清单时返回空')

eq(toggleTodoLine('- [ ] A\n- [x] B', 0), '- [x] A\n- [x] B', '按清单序号勾选第 0 项')
eq(toggleTodoLine('- [ ] A\n- [x] B', 1), '- [ ] A\n- [ ] B', '按清单序号取消第 1 项')
eq(toggleTodoLine('- [ ] A', 5), '- [ ] A', '越界序号不改动原文')

/* ---------------- 行内分段 ---------------- */

{
  const parts = inlineParts('**粗** 与普通')
  ok(parts.some(p => p.bold && p.text === '粗'), '粗体被识别')
}

{
  const parts = inlineParts('看 https://a.com 就好')
  const link = parts.find(p => p.url)
  eq(link?.url, 'https://a.com', 'http(s) 链接被识别')
  const safe = inlineParts('javascript:alert(1)').find(p => p.url)
  eq(safe, undefined, 'javascript: 不被当成链接（防注入的关键一条）')
}

{
  const parts = inlineParts('#标签 文本')
  ok(parts.some(p => p.tag && p.text === '#标签'), '标签被识别')
}

{
  const parts = inlineParts('**https://a.com**')
  eq(parts[0].bold, true, '链接在粗体里仍保留粗体标记')
  eq(parts[0].url, 'https://a.com', '粗体里的链接也能点')
}

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 备注与便签内核 ${failures.length} 条断言失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 备注与便签内核全部通过：${pass} 条断言`)
