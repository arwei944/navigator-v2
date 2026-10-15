/**
 * 「连续不可达」计数与自动归档判据守卫：零依赖、不联网。
 *
 * 守的核心：
 *  1. `fails` 只在**连续** down 时累加，一旦探到 ok/limited 立即归零，没探到则原样保留
 *     —— 把「没探」误当成「好了」清零，会让「一直坏」的站点永远攒不到阈值；
 *  2. `buildHealthPayload` 合并时把计数接上（既有站点的 fails 不能因为一次合并就丢）；
 *  3. `pickAutoArchive` 的阈值语义：<=0 关闭，达到才挑出。
 *
 * 运行：node tools/console/test-health-fails.mjs
 */
import { nextResult, buildHealthPayload, pickAutoArchive } from '../../shared/health-rules.mjs'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

/* ---------------- nextResult：连续计数 ---------------- */

eq(nextResult(null, { code: '200', status: 'ok', ms: 5 }).fails, 0, '探到 ok → fails 归零')
eq(nextResult({ status: 'down', fails: 3 }, { code: '404', status: 'down', ms: 9 }).fails, 4, '连续 down 累加')
eq(nextResult({ status: 'down', fails: 3 }, { code: '429', status: 'limited', ms: 9 }).fails, 0, 'limited 也归零（站点实际可用）')
eq(nextResult({ status: 'down', fails: 3 }, { code: '200', status: 'ok', ms: 9 }).fails, 0, 'ok 归零')
// 本次没探到（inc 缺失）→ 保留旧值，**不清零**
eq(nextResult({ status: 'down', fails: 5 }, undefined).fails, 5, '没探到则保留计数（不误清零）')
eq(nextResult({ status: 'down', fails: 5 }, undefined).status, 'down', '没探到则保留原判定')
// 旧数据没有 fails 字段 → 从 0 起算
eq(nextResult({ status: 'down', code: '404' }, { code: '404', status: 'down' }).fails, 1, '旧数据无 fails 时从 1 起算')
// 全新站点第一次就 down
eq(nextResult(null, { code: 'ERR', status: 'down' }).fails, 1, '首探即 down → 1')
// 空旧值且没探到 → 兜底 unknown
eq(nextResult(null, undefined).status, 'unknown', '既无旧值又无新值 → unknown 兜底')

/* ---------------- buildHealthPayload：合并时接上计数 ---------------- */

const prev = {
  version: 3,
  results: {
    a: { code: '404', status: 'down', ms: 9, fails: 4 },
    b: { code: '200', status: 'ok', ms: 5, fails: 0 },
  },
}

// a 又失败一次 → 5；b 没被探到 → 保留
const p1 = buildHealthPayload({ prev, incoming: { a: { code: '404', status: 'down', ms: 9 } }, knownIds: new Set(['a', 'b']) })
eq(p1.results.a.fails, 5, '合并时连续 count 接上（4 → 5）')
eq(p1.results.b.fails, 0, '未探到的站点计数保留')
eq(p1.results.a.status, 'down', '判定仍为 down')

// a 恢复 → 归零
const p2 = buildHealthPayload({ prev, incoming: { a: { code: '200', status: 'ok', ms: 5 } }, knownIds: new Set(['a', 'b']) })
eq(p2.results.a.fails, 0, '恢复后计数归零')
eq(p2.counts.ok, 2, '计数口径不受 fails 影响')

/* ---------------- pickAutoArchive：阈值语义 ---------------- */

const results = {
  a: { status: 'down', fails: 5 },
  b: { status: 'down', fails: 2 },
  c: { status: 'ok', fails: 0 },
  d: { status: 'limited', fails: 0 },
  e: { status: 'down', fails: 9 },
}

eq(JSON.stringify(pickAutoArchive(results, 5).sort()), JSON.stringify(['a', 'e']), '达到阈值才挑出（>=5）')
eq(JSON.stringify(pickAutoArchive(results, 2).sort()), JSON.stringify(['a', 'b', 'e']), '阈值为 2 时含 b')
eq(pickAutoArchive(results, 0).length, 0, '阈值 0 = 关闭')
eq(pickAutoArchive(results, -1).length, 0, '负阈值 = 关闭')
eq(pickAutoArchive(null, 5).length, 0, '无判定表安全')
eq(pickAutoArchive({ x: { status: 'down' } }, 1).length, 0, '缺 fails 字段时不误判（视为 0）')

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 连续失败计数 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 连续失败计数与自动归档判据：${pass} 条断言`)
process.exit(0)
