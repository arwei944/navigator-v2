/**
 * 健康判定的**合并口径**守卫（v10）。
 *
 * 这段逻辑原来是 api/health.js 内部的实现块，v10 抽出成纯函数给「接口 POST」与
 * 「服务端定时巡检」共用。共用带来一个必须被钉住的前提：**两处口径必须一致**。
 * 漂移的后果不是报错，而是**死链悄悄从体检清单里消失**（覆盖式写入会把没探到的站点
 * 集体打回「未探测」，或剔除逻辑分歧导致计数虚高）—— 这类退化极难靠界面发现。
 *
 * 覆盖：合并而非覆盖 / 按当前站点集剔除 / 读不到站点表时跳过剔除 / version 递增 /
 * 计数口径 / toIncoming 的 code→verdict 归一。
 *
 * 运行：node tools/console/test-health.mjs
 */
import { verdictOf, tally, buildHealthPayload, toIncoming, STATUS_LABEL } from '../../shared/health-rules.mjs'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

/* ---------------- 分级口径（原样继承，抽函数不能改语义） ---------------- */

eq(verdictOf(200), 'ok', '2xx → ok')
eq(verdictOf(302), 'ok', '3xx → ok（fetchCapped 不跟重定向，3xx 仍是可达）')
eq(verdictOf(429), 'limited', '429 → limited（限流不算失效）')
eq(verdictOf(403), 'limited', '403 → limited（反爬不算失效）')
eq(verdictOf(404), 'down', '404 → down')
eq(verdictOf('ERR'), 'down', 'ERR → down')
eq(verdictOf('000'), 'down', '000 → down')
eq(STATUS_LABEL.down, '需处理', 'down 的展示文案')

/* ---------------- toIncoming 归一 ---------------- */

{
  const inc = toIncoming([
    { id: 'a', code: 200, ms: 12.4 },
    { id: ' b ', code: '404', ms: 30 },
    { id: '', code: 200 },          // 无 id → 丢弃
    { id: 'c', code: '', ms: 5 },   // 空码 → ERR（down）
    { id: 'd', code: 429, ms: null }, // ms 非数字 → null
  ])
  eq(Object.keys(inc).sort().join(','), 'a,b,c,d', 'toIncoming 只保留有 id 的记录')
  eq(inc.a.status, 'ok', 'toIncoming 按 code 归一分级')
  eq(inc.a.ms, 12, 'ms 四舍五入到整数')
  eq(inc.c.code, 'ERR', '空码归一为 ERR')
  eq(inc.c.status, 'down', 'ERR → down')
  // 注意：Number(null) === 0，所以 ms:null 会落成 0 —— 这是**原实现就有的行为**，
  // 抽函数时保持一致（语义等价优先于顺手改），此处钉住以免漂移
  eq(inc.d.ms, 0, 'ms:null 落成 0（沿用原实现口径，钉住防漂移）')
  eq(toIncoming([{ id: 'e', code: 200, ms: 'abc' }]).e.ms, null, '真非法值（NaN）才归一为 null')
}

/* ---------------- buildHealthPayload 合并语义 ---------------- */

const prev = {
  version: 7,
  updatedAt: '2026-10-11T00:00:00.000Z',
  results: {
    keep: { code: '200', status: 'ok', ms: 10 },
    overwrite: { code: '404', status: 'down', ms: 99 },
    gone: { code: '200', status: 'ok', ms: 20 },   // 站点已从站点表删除 → 应被剔除
  },
}

{
  // 只探了 1 个站：另一个必须**保留旧判定**（覆盖式写入会让它集体退回「未探测」）
  const p = buildHealthPayload({
    prev,
    incoming: { overwrite: { code: '200', status: 'ok', ms: 15 } },
    knownIds: new Set(['keep', 'overwrite']),
    actor: 'cron',
  })
  eq(p.version, 8, 'version 递增')
  eq(p.results.overwrite.code, '200', '同一站的新判定覆盖旧判定')
  eq(p.results.keep.code, '200', '没被探到的站点保留旧判定（合并而非覆盖）')
  ok(!p.results.gone, '站点表里已删除的站点，其判定一并剔除')
  eq(p.counts.total, 2, '计数 total 与实际条目一致')
  eq(p.counts.ok, 2, '计数按分级汇总')
  eq(p.actor, 'cron', 'actor 落库')
  ok(Number.isFinite(Date.parse(p.updatedAt)), 'updatedAt 可解析')
}

{
  // 读不到站点表（knownIds=null）→ 跳过剔除：宁可多留一条，也不能整份清空
  const p = buildHealthPayload({ prev, incoming: {}, knownIds: null })
  eq(Object.keys(p.results).length, 3, '站点表不可用时保留全部旧判定')
  eq(p.counts.total, 3, '计数随之保留')
}

{
  // 首次写入（无前值）
  const p = buildHealthPayload({ incoming: { x: { code: '200', status: 'ok', ms: 5 } }, knownIds: new Set(['x']) })
  eq(p.version, 1, '首次写入 version 从 1 起')
  eq(p.counts.total, 1, '首次写入计数正确')
  eq(p.counts.ok, 1, '首次写入分级正确')
}

{
  // tally 与 counts 口径一致（前端看板直接用 counts）
  const rows = [{ status: 'ok' }, { status: 'ok' }, { status: 'limited' }, { status: 'down' }]
  eq(JSON.stringify(tally(rows)), JSON.stringify({ ok: 2, limited: 1, down: 1 }), 'tally 口径')
}

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 健康判定合并 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 健康判定合并全部通过：${pass} 条断言`)
process.exit(0)