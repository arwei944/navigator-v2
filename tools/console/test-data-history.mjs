#!/usr/bin/env node
/**
 * 体检趋势自测：不联网、不碰数据库。
 *
 * 覆盖：
 *   ① 从报告提取摘要（字段齐全、缺失指标按 0）
 *   ② 读路径净化：坏条目丢弃、字符串数字收敛、按时间排序
 *   ③ 追加与去抖：同版本同问题数在窗口内不重复；窗口外或数字变化则追加
 *   ④ 保留上限：只留最近的 keep 条
 *   ⑤ 序列输出：不插值、不补零
 */
import assert from 'node:assert/strict'

import {
  summaryFromReport, sanitizeHistory, appendHistory, seriesOf,
  HISTORY_KEEP, HISTORY_DEDUPE_MS,
} from '../../shared/data-history.mjs'

let pass = 0
let fail = 0
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass += 1 } catch (e) { console.log('  ✖ ' + name + ' — ' + e.message); fail += 1 }
}

function report(over = {}) {
  return {
    total: 300,
    issueCount: 172,
    fields: [{ key: 'aliases', missingCount: 93 }, { key: 'icon', missingCount: 7 }],
    inference: { lowConfidence: new Array(71).fill({}) },
    duplicates: { urls: [], names: [], ids: [] },
    orphanCategories: [],
    emptyCategories: [{ id: 'x' }],
    resources: { iconMissing: [] },
    ...over,
  }
}

console.log('\n[1] 摘要提取')
check('关键数字齐全', () => {
  const s = summaryFromReport(report(), { version: 3, now: 1_700_000_000_000 })
  assert.equal(s.version, 3)
  assert.equal(s.total, 300)
  assert.equal(s.issueCount, 172)
  assert.equal(s.lowConfidence, 71)
  assert.equal(s.missingAliases, 93)
  assert.equal(s.emptyCategories, 1)
  assert.equal(s.at, new Date(1_700_000_000_000).toISOString())
})
check('缺失结构按 0 处理而不抛错', () => {
  const s = summaryFromReport({ total: 5 })
  assert.equal(s.issueCount, 0)
  assert.equal(s.lowConfidence, 0)
  assert.equal(s.missingAliases, 0)
  assert.equal(s.duplicateUrls, 0)
})
check('null 报告不抛错', () => {
  assert.doesNotThrow(() => summaryFromReport(null))
})

console.log('\n[2] 读路径净化')
check('非数组输入返回空', () => {
  assert.deepEqual(sanitizeHistory(null), [])
  assert.deepEqual(sanitizeHistory({ items: [] }), [])
})
check('缺 at 的条目被丢弃', () => {
  assert.equal(sanitizeHistory([{ issueCount: 1 }, { at: '2026-01-01T00:00:00.000Z', issueCount: 2 }]).length, 1)
})
check('字符串数字被收敛', () => {
  const [e] = sanitizeHistory([{ at: '2026-01-01T00:00:00.000Z', issueCount: '12', total: '300' }])
  assert.equal(e.issueCount, 12)
  assert.equal(e.total, 300)
})
check('乱序输入按时间排序', () => {
  const list = sanitizeHistory([
    { at: '2026-02-01T00:00:00.000Z', issueCount: 2 },
    { at: '2026-01-01T00:00:00.000Z', issueCount: 1 },
  ])
  assert.equal(list[0].issueCount, 1)
})
check('找不回的数字收敛为 0 而不是 NaN', () => {
  const [e] = sanitizeHistory([{ at: '2026-01-01T00:00:00.000Z', issueCount: 'abc' }])
  assert.equal(e.issueCount, 0)
})

console.log('\n[3] 追加与去抖')
const t0 = Date.parse('2026-01-01T00:00:00.000Z')
const mk = (offsetMs, over = {}) => ({
  at: new Date(t0 + offsetMs).toISOString(),
  version: 1,
  total: 300,
  issueCount: 172,
  ...over,
})

check('空历史追加一条', () => {
  const r = appendHistory([], mk(0))
  assert.equal(r.added, true)
  assert.equal(r.items.length, 1)
})
check('同版本同问题数在窗口内不重复记录', () => {
  const r = appendHistory([mk(0)], mk(60_000))
  assert.equal(r.added, false)
  assert.equal(r.reason, 'duplicate')
  assert.equal(r.items.length, 1)
})
check('超过去抖窗口则追加', () => {
  const r = appendHistory([mk(0)], mk(HISTORY_DEDUPE_MS + 1))
  assert.equal(r.added, true)
  assert.equal(r.items.length, 2)
})
check('问题数变化则追加（即使窗口内）', () => {
  const r = appendHistory([mk(0)], mk(60_000, { issueCount: 170 }))
  assert.equal(r.added, true)
})
check('版本变化但问题数相同，窗口内仍视为同一次', () => {
  const r = appendHistory([mk(0)], mk(60_000, { version: 2 }))
  assert.equal(r.added, false, '窗口内只看问题数，避免「发布一次产生一个点」')
})
check('无效条目被拒', () => {
  const r = appendHistory([mk(0)], { issueCount: 1 })
  assert.equal(r.added, false)
  assert.equal(r.reason, 'invalid')
})
check('超过保留上限只留最近 N 条', () => {
  let items = []
  for (let i = 0; i < HISTORY_KEEP + 20; i += 1) {
    items = appendHistory(items, mk(i * (HISTORY_DEDUPE_MS + 1000), { issueCount: i })).items
  }
  assert.equal(items.length, HISTORY_KEEP)
  assert.equal(items[items.length - 1].issueCount, HISTORY_KEEP + 19)
})
check('输入数组不被就地修改', () => {
  const input = [mk(0)]
  appendHistory(input, mk(HISTORY_DEDUPE_MS + 1))
  assert.equal(input.length, 1)
})

console.log('\n[4] 序列输出')
check('按时间输出指标序列', () => {
  const s = seriesOf([mk(0), mk(1000, { issueCount: 5 })], 'issueCount')
  assert.equal(s.length, 2)
  assert.equal(s[1].value, 5)
  assert.ok(s[0].at < s[1].at)
})
check('未知指标收敛为 0', () => {
  assert.equal(seriesOf([mk(0)], 'nope')[0].value, 0)
})
check('空输入返回空数组', () => assert.deepEqual(seriesOf(null), []))

console.log(`\n结果：${pass} 通过，${fail} 失败`)
if (fail) process.exitCode = 1
