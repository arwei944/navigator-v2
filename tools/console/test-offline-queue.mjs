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
import { clearOffline, enqueueEdit, loadOffline, offlineSummary, OFFLINE_MAX } from '../../src/utils/offlineQueue.js'

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

/* ---- 报告 ---- */
console.log(`\n离线编辑队列用例（F8）：${pass} 通过，${failures.length} 失败`)
if (failures.length) {
  for (const f of failures) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('  ✓ 全部通过')
