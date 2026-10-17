/**
 * 会话冲突口径一致性用例（F8）：零依赖、不联网、不碰 DOM。
 *
 * 「同字段双方都改怎么办」的规则分两层，任何一层被单独改动都会让多设备漂移：
 *   · 顶层字段层 → `shared/session-merge.mjs#mergeSessionData`（服务端实际用它写快照）
 *   · 条目层   → `src/utils/noteSync.js#mergeEntry / mergeMaps`（客户端合并）
 *
 * 本用例的关键价值在**第三段**：把两层拼起来，模拟「两台设备各自离线改动、恢复后互推」，
 * 断言端到端结果符合口径声明 —— 单测任何一层都发现不了「两层假设不一致」这种漂移。
 *
 * 运行：node tools/console/test-session-merge.mjs
 */
import { mergeSessionData } from '../../shared/session-merge.mjs'
import { mergeEntry, mergeMaps, makeEntry, tombstone, isTombstone } from '../../src/utils/noteSync.js'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

/* ============ 一、服务端字段级合并 ============ */
{
  // 同字段、不同 key → 两边都保留
  const m1 = mergeSessionData(
    { siteNotes: { a: { v: 1 }, b: { v: 2 } } },
    { siteNotes: { c: { v: 3 } } }
  )
  eq(Object.keys(m1.siteNotes).sort().join(','), 'a,b,c', '同字段不同 key：浅合并后三者都在')

  // 同字段、同 key → 客户端覆盖远端
  const m2 = mergeSessionData({ siteNotes: { a: { v: 1 } } }, { siteNotes: { a: { v: 9 } } })
  eq(m2.siteNotes.a.v, 9, '同字段同 key：客户端值覆盖远端')

  // 未传的字段原样保留
  const m3 = mergeSessionData({ favorites: [1, 2], history: [3] }, { siteNotes: { a: {} } })
  eq(JSON.stringify(m3.favorites), '[1,2]', '未传的顶层字段原样保留（字段级无副作用）')

  // 非对象值：整字段覆盖
  const m4 = mergeSessionData({ prefs: { theme: 'light', x: 1 } }, { prefs: 'reset' })
  eq(m4.prefs, 'reset', '非对象值：整字段覆盖')

  // 不改入参（纯函数）
  const prev = { siteNotes: { a: { v: 1 } } }
  const patch = { siteNotes: { b: { v: 2 } } }
  mergeSessionData(prev, patch)
  eq(Object.keys(prev.siteNotes).join(','), 'a', '不修改入参 prev')
  eq(Object.keys(patch.siteNotes).join(','), 'b', '不修改入参 patch')

  // 空 / 缺省容错
  eq(JSON.stringify(mergeSessionData(null, null)), '{}', 'null 入参 → 空对象不崩')
}

/* ============ 二、客户端条目级 LWW ============ */
{
  const older = { text: 'old', updatedAt: 100, rev: 1 }
  const newer = { text: 'new', updatedAt: 200, rev: 1 }
  eq(mergeEntry(older, newer).text, 'new', 'updatedAt 更大者胜')
  eq(mergeEntry(newer, older).text, 'new', '顺序无关（交换入参结果一致）')

  const r1 = { text: 'x', updatedAt: 100, rev: 1 }
  const r2 = { text: 'y', updatedAt: 100, rev: 2 }
  eq(mergeEntry(r1, r2).text, 'y', '时间相等比 rev，rev 大者胜')

  const same1 = { text: 'local', updatedAt: 100, rev: 1 }
  const same2 = { text: 'remote', updatedAt: 100, rev: 1 }
  eq(mergeEntry(same1, same2).text, 'local', '全相等取本地')

  // 墓碑：删除必须赢过更早的更新
  const alive = { text: 'alive', updatedAt: 100, rev: 1 }
  const dead = tombstone(alive)
  ok(isTombstone(dead), 'tombstone() 产出墓碑')
  ok(isTombstone(mergeEntry(alive, dead)), '墓碑胜出（删除不被复活）')

  // mergeMaps 幂等：同一远端重复合并，第二次 changed=false
  const local = { a: { text: 'a', updatedAt: 10, rev: 1 } }
  const first = mergeMaps(local, { a: { text: 'a2', updatedAt: 20, rev: 1 }, b: { text: 'b', updatedAt: 5, rev: 1 } })
  ok(first.changed, '首次合并有变化')
  const second = mergeMaps(first.merged, { a: { text: 'a2', updatedAt: 20, rev: 1 }, b: { text: 'b', updatedAt: 5, rev: 1 } })
  ok(!second.changed, '重复合并同一远端 → 无变化（幂等）')
}

/* ============ 三、跨层端到端：两台设备离线互改后合并 ============ */
{
  // 设备 A 与设备 B 从同一份初始快照出发
  const base = makeEntry({ text: '原文', color: 'bg' })
  const initial = { siteNotes: { x: base }, notes: {} }

  // A 改 x 的文本；B 改 y（另一个条目）—— 模拟「改了不同条目」
  const aSnap = { siteNotes: { x: makeEntry({ text: 'A 改的文本' }, base) } }
  const bSnap = { siteNotes: { y: makeEntry({ text: 'B 新加的' }) } }

  // 服务端先收 A，再收 B → 字段级浅合并
  const serverAfterA = mergeSessionData(initial, aSnap)
  const serverFinal = mergeSessionData(serverAfterA, bSnap)
  eq(Object.keys(serverFinal.siteNotes).sort().join(','), 'x,y',
    '两台设备改不同条目：合并后两条都在（浅合并保住了 A 的 x，也收下了 B 的 y）')
  eq(serverFinal.siteNotes.x.text, 'A 改的文本', 'A 对 x 的改动保留')

  // 同一条目被两边都改：条目层 LWW 整条择一（**不做属性级合并** —— 明文取舍）
  const a2 = makeEntry({ text: 'A 文本', color: 'blue' }, base)
  const b2 = makeEntry({ text: 'B 文本', color: 'red' }, base)
  // b2 的 updatedAt 更晚（用户后改的）
  const bLater = { ...b2, updatedAt: (Number(a2.updatedAt) || 0) + 1000 }
  const winner = mergeEntry(a2, bLater)
  eq(winner.text, 'B 文本', '同一条目双方都改：时间更晚的整条胜')
  eq(winner.color, 'red', '胜者整条生效（属性级不混合：A 的 color 不会漏进来）')

  // 一端删除：墓碑跨设备生效，不会被另一端「不传」复活
  const deleted = tombstone(base)
  const afterDelete = mergeSessionData({ siteNotes: { x: base } }, { siteNotes: { x: deleted } })
  ok(isTombstone(afterDelete.siteNotes.x), '删除以墓碑形式落库')
  // 另一台设备推它本地仍持有的旧版本（没有墓碑）→ 浅合并会用它覆盖墓碑吗？
  const resurrectAttempt = mergeSessionData(afterDelete, { siteNotes: { x: base } })
  // 浅合并是客户端 key 覆盖远端 → 无墓碑的旧版本会把墓碑盖掉，这正是**必须两侧都用墓碑**的理由
  ok(!isTombstone(resurrectAttempt.siteNotes.x),
    '若另一端推的是无墓碑旧版本，浅合并会覆盖墓碑 —— 记录该风险，故客户端必须先本地合并再推（mergeMaps）')
  // 正确姿势：客户端推送前先 mergeMaps 合并本地与远端，墓碑胜出后才推
  const clientMerged = mergeMaps({ x: deleted }, { x: base })
  ok(isTombstone(clientMerged.merged.x), '客户端先 mergeMaps：墓碑胜出，推送的版本仍带墓碑（删除不会被复活）')

  // 幂等：同一份快照重复推送，合并结果稳定
  const once = mergeSessionData(initial, aSnap)
  const twice = mergeSessionData(mergeSessionData(initial, aSnap), aSnap)
  eq(JSON.stringify(once), JSON.stringify(twice), '同一 patch 合并两次结果相同（重放幂等）')
}

/* ---------------- 报告 ---------------- */
console.log(`\n会话冲突口径一致性用例（F8）：${pass} 通过，${failures.length} 失败`)
if (failures.length) {
  for (const f of failures) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('  ✓ 全部通过')
