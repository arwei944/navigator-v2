/**
 * 离线编辑队列用例（F8）：零依赖、不联网、不碰 DOM（localStorage 用内存桩）。
 *
 * 守的核心是**合并语义与边界**，不是「能存进去」：
 *   · 同 kind + 同 siteId 的重复编辑必须合并（离线改同一个站十遍只需同步一次）；
 *   · 不同 kind / 不同 siteId 绝不误合并；
 *   · 无 kind 的非法操作被忽略（不污染队列）；
 *   · 超限丢最旧、坏数据不崩。
 *
 * 运行：node tools/console/test-offline-queue.mjs
 */
import { clearOffline, enqueueEdit, loadOffline, offlineSummary, replayOffline, OFFLINE_MAX } from '../../src/utils/offlineQueue.js'

const mem = new Map()
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
}

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

clearOffline()
eq(loadOffline().length, 0, '初始为空')

/* ---- 合并去重 ---- */
enqueueEdit({ kind: 'session', at: 1000 })
eq(loadOffline().length, 1, '入队一条')

enqueueEdit({ kind: 'session', at: 2000 }) // 同 kind、同（空）siteId
eq(loadOffline().length, 1, '同 kind 同 siteId 合并去重')
eq(loadOffline()[0].at, 2000, '合并时保留最新一条的时间戳')

enqueueEdit({ kind: 'session', siteId: 'a', at: 3000 })
eq(loadOffline().length, 2, '不同 siteId 不合并')

enqueueEdit({ kind: 'edit', siteId: 'a', at: 4000 })
eq(loadOffline().length, 3, '不同 kind 不合并')

/* ---- 非法输入 ---- */
enqueueEdit({ at: 5000 })
eq(loadOffline().length, 3, '无 kind 的操作被忽略')
enqueueEdit(null)
enqueueEdit('nope')
eq(loadOffline().length, 3, '非对象输入被忽略')

/* ---- 上限：丢最旧、留最新 ---- */
for (let i = 0; i < OFFLINE_MAX + 20; i++) enqueueEdit({ kind: 'k', siteId: 's' + i, at: i })
eq(loadOffline().length, OFFLINE_MAX, `队列长度封顶 ${OFFLINE_MAX}`)
ok(loadOffline().some(o => o.siteId === 's' + (OFFLINE_MAX + 19)), '超限时保留最新入队的')
ok(!loadOffline().some(o => o.siteId === 's0'), '超限时丢掉最旧的')

/* ---- 摘要 ---- */
ok(offlineSummary(loadOffline()).includes(String(OFFLINE_MAX)), '摘要里含条数')
eq(offlineSummary([]), '', '空队列摘要为空串')
eq(offlineSummary(null), '', '非法输入摘要为空串不崩')

/* ---- 坏数据容错 ---- */
mem.set('nav-offline-edits', '{ not json')
eq(loadOffline().length, 0, '坏 JSON 容错为空')
mem.set('nav-offline-edits', '{"a":1}')
eq(loadOffline().length, 0, '非数组容错为空')

/* ---- 清空 ---- */
clearOffline()
eq(loadOffline().length, 0, '清空后为空')

/* ---- 重放：按序 / 幂等 / 可丢弃 / 可回溯 / 冷却不消耗 ---- */

// (1) 不可发送（离线 / 冷却中）→ deferred，队列原样保留
clearOffline()
enqueueEdit({ kind: 'session', at: 1000 })
enqueueEdit({ kind: 'edit', siteId: 'a', at: 2000 })
const beforeCount = loadOffline().length
let deferredCalls = 0
const deferred = await replayOffline({ push: () => { deferredCalls++ }, canSend: () => false })
ok(deferred.deferred === true, '不可发送时 deferred=true')
eq(deferredCalls, 0, 'deferred 时不调用 push')
eq(loadOffline().length, beforeCount, 'deferred 不消耗队列（离线/冷却时不丢编辑）')

// (2) 正常重放：按 at 升序逐条 push，成功后清空
const order = []
const r = await replayOffline({ push: op => { order.push(`${op.kind}:${op.siteId}`) } })
eq(r.replayed, 2, '两条都重放成功')
eq(order.join(','), 'session:,edit:a', '按 at 升序重放（session 的 at 更小）')
eq(loadOffline().length, 0, '全部成功后队列清空')

// (3) 幂等：队列已空时再重放不发任何请求
let againCalls = 0
const r2 = await replayOffline({ push: () => { againCalls++ } })
eq(againCalls, 0, '重放成功后再重放不重复推送（幂等）')
eq(r2.replayed, 0, '空队列重放 replayed=0')

// (4) 失败保留 + 计数；达到 maxAttempts 才丢弃（可丢弃，且留痕可回溯）
clearOffline()
enqueueEdit({ kind: 'session', at: 10 })
const fail = await replayOffline({ push: () => { throw new Error('网络挂了') }, maxAttempts: 3 })
eq(fail.replayed, 0, 'push 抛错 → replayed=0')
eq(fail.kept, 1, '未到上限的失败条目保留在队列')
eq(loadOffline()[0].attempts, 1, '失败计数 +1（跨重放累计）')
await replayOffline({ push: () => { throw new Error('网络挂了') }, maxAttempts: 3 })
const third = await replayOffline({ push: () => { throw new Error('网络还是不行') }, maxAttempts: 3 })
eq(third.dropped.length, 1, '达到 maxAttempts → 丢弃该条目')
ok(/网络还是不行/.test(third.dropped[0].error), '丢弃记录带最后一次错误（可回溯）')
eq(third.dropped[0].kind, 'session', '丢弃记录带原始 kind（可回溯）')
eq(loadOffline().length, 0, '丢弃后队列里不再有它（不会卡死整条队列）')

// (5) 一条失败不影响同批次其它条目
clearOffline()
enqueueEdit({ kind: 'a', at: 1 })
enqueueEdit({ kind: 'b', at: 2 })
const mixed = await replayOffline({
  push: op => { if (op.kind === 'a') throw new Error('a 不行') },
  maxAttempts: 1,
})
eq(mixed.replayed, 1, '同批次里成功的条目照常重放')
eq(mixed.dropped.length, 1, '同批次里达上限的条目按规则丢弃')
eq(loadOffline().length, 0, '一失败一成功后队列为空')

/* ---- 报告 ---- */
console.log(`\n离线编辑队列用例（F8）：${pass} 通过，${failures.length} 失败`)
if (failures.length) {
  for (const f of failures) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('  ✓ 全部通过')
