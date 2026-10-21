/**
 * 阶段 3 门禁：隐藏/置顶、反馈权重、共现边落库、周报落库。
 *
 * 使用临时数据库，不触碰 `server/data/store.db`，也不触碰真实 `data/content.db`。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'nav-content-stage3-'))
process.env.NAV_CONTENT_DB = join(dir, 'content.db')

const store = await import('../../server/content-store.mjs')
const insights = await import('../../server/content-insights-store.mjs')
const analytics = await import('../../server/content-analytics.mjs')

let pass = 0
let fail = 0
async function ok(name, fn) {
  try { await fn(); pass += 1; console.log(`  ✓ ${name}`) }
  catch (e) { fail += 1; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

const NOW = Date.now()
const source = {
  id: 's1',
  label: 'Source 1',
  type: 'rss',
  url: 'https://example.com/feed',
  domain: 'ai-work',
  categoryId: 'learning',
  weight: 1,
  maxItems: 60,
}

store.upsertSource(source)

store.insertEntries(source, [
  {
    title: 'OpenAI and Microsoft expand partnership',
    url: 'https://example.com/1',
    guid: 'g1',
    summary: 'OpenAI and Microsoft announced a new deal',
    publishedAt: NOW,
  },
  {
    title: 'Bitcoin ETF sees record inflows',
    url: 'https://example.com/2',
    guid: 'g2',
    summary: 'Bitcoin funds attract capital',
    publishedAt: NOW - 60_000,
  },
])

console.log('领域动态 · 阶段 3 反馈与存储')

await ok('隐藏：默认列表排除，includeHidden 可见', () => {
  const first = store.listEntries({})[0]
  store.setEntryFlags([first.id], { hidden: true })
  assert.equal(store.listEntries({}).length, 1)
  assert.equal(store.listEntries({ includeHidden: true }).length, 2)
  assert.equal(store.stats().hidden, 1)
  // 恢复，避免影响后续图谱测试
  store.setEntryFlags([first.id], { hidden: false })
  assert.equal(store.listEntries({}).length, 2)
})

await ok('置顶：排序优先于时间', () => {
  const list = store.listEntries({})
  const target = list[list.length - 1]
  store.setEntryFlags([target.id], { pinned: true })
  assert.equal(store.listEntries({})[0].id, target.id)
})

await ok('反馈：写库并调整来源系数', () => {
  const target = store.listEntries({})[0]
  insights.addFeedback({ targetType: 'entry', targetId: target.id, action: 'important' })
  assert.equal(insights.listFeedback({ targetId: target.id }).length, 1)
  const afterImportant = insights.feedbackScoreMap().get('s1')
  assert.ok(afterImportant > 1)
  insights.addFeedback({ targetType: 'entry', targetId: target.id, action: 'irrelevant' })
  assert.ok(insights.feedbackScoreMap().get('s1') < afterImportant)
})

await ok('反馈动作：hide / unhide 立即生效', () => {
  const visible = store.listEntries({})
  const second = visible[visible.length - 1]
  const hidden = analytics.applyFeedback({ targetId: second.id, action: 'hide' })
  assert.equal(hidden.changed, 1)
  assert.ok(!store.listEntries({}).some(x => x.id === second.id))
  analytics.applyFeedback({ targetId: second.id, action: 'unhide' })
  assert.ok(store.listEntries({}).some(x => x.id === second.id))
})

await ok('索引与共现边：同实体两条报道生成边', () => {
  store.insertEntries(source, [{
    title: 'OpenAI Microsoft cloud deal deepens',
    url: 'https://example.com/3',
    guid: 'g3',
    summary: 'OpenAI and Microsoft cloud',
    publishedAt: NOW - 120_000,
  }])
  const synced = insights.syncInsights({ days: 30 })
  assert.ok(synced.scanned >= 2)
  const rebuilt = insights.rebuildEntityEdges({ days: 30, minCo: 2 })
  assert.ok(rebuilt.edges >= 1)
  const graph = analytics.graphView({ hours: 720, maxNodes: 20, minCo: 2 })
  assert.ok(graph.nodes.length >= 2)
  assert.ok(graph.edges.length >= 1)
  assert.ok(graph.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)))
})

await ok('周报：生成并落库', async () => {
  const report = await analytics.ensureWeeklyReport({ force: true })
  assert.ok(report.contentMd.includes('领域情报周报'))
  assert.equal(store.latestReport('weekly').id, report.id)
  const count = store.countEntriesBetween(NOW - 86400000, NOW + 1000)
  assert.ok(count >= 1)
})

await ok('影响分析：无事件时返回空结构', () => {
  const impact = analytics.impactEvents({ hours: 24 })
  assert.ok(Array.isArray(impact.items))
  assert.equal(impact.items.length, 0)
  assert.equal(impact.stats.total, 0)
})

await ok('来源间隔：默认 20 分钟，可更新', () => {
  const src = store.getSource('s1')
  assert.equal(src.intervalMin, 20)
  const updated = store.upsertSource({ id: 's1', intervalMin: 5 })
  assert.equal(updated.intervalMin, 5)
})

try { store.db.close() } catch { /* 已关闭 */ }
try { rmSync(dir, { recursive: true, force: true }) } catch { /* Windows 可能暂时占用 */ }

console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)