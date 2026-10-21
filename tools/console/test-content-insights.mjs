/**
 * 阶段 2 门禁：实体抽取、趋势、告警候选。
 */
import assert from 'node:assert/strict'
import { extractEntities } from '../../shared/content-entities.mjs'
import {
  computeTrends, domainHeat, alertCandidates, keywordHits,
} from '../../shared/content-trends.mjs'

let pass = 0
let fail = 0
function ok(name, fn) {
  try { fn(); pass += 1; console.log(`  ✓ ${name}`) }
  catch (e) { fail += 1; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0)
const HOUR = 3600000

console.log('领域动态 · 阶段 2 洞察')

ok('实体抽取：公司、模型、中文别名', () => {
  const a = extractEntities('OpenAI releases GPT-5 while Anthropic ships Claude')
  assert.ok(a.some(x => x.id === 'openai'))
  assert.ok(a.some(x => x.id === 'anthropic'))
  const b = extractEntities('英伟达发布新芯片，OpenAI 回应')
  assert.ok(b.some(x => x.id === 'nvidia'))
  assert.ok(b.some(x => x.id === 'openai'))
})

ok('实体抽取：英文词边界，避免子串误报', () => {
  const list = extractEntities('The securities regulator issued a statement')
  assert.ok(!list.some(x => x.id === 'sec'))
})

ok('实体抽取数量受 max 限制', () => {
  const list = extractEntities('OpenAI Anthropic Google DeepMind Microsoft NVIDIA Bitcoin Ethereum Solana', { max: 3 })
  assert.equal(list.length, 3)
})

ok('趋势：当前窗口相对基线突增', () => {
  const entries = []
  const mentions = []
  // 当前窗口 6 条 OpenAI；基线过去 7 天总共 2 条
  for (let i = 0; i < 6; i += 1) {
    const id = `cur-${i}`
    entries.push({ id, publishedAt: NOW - i * HOUR, sourceId: `s${i % 3}`, domain: 'ai-work' })
    mentions.push({ entityId: 'openai', entryId: id, at: NOW - i * HOUR })
  }
  for (let i = 0; i < 2; i += 1) {
    const id = `old-${i}`
    entries.push({ id, publishedAt: NOW - 3 * 86400000 - i * HOUR, sourceId: 's0', domain: 'ai-work' })
    mentions.push({ entityId: 'openai', entryId: id, at: NOW - 3 * 86400000 - i * HOUR })
  }
  const trends = computeTrends({
    entries, mentions, now: NOW, windowHours: 24, baselineDays: 7,
    names: new Map([['openai', { name: 'OpenAI', kind: 'company' }]]),
  })
  const openai = trends.find(t => t.entityId === 'openai')
  assert.ok(openai)
  assert.equal(openai.current, 6)
  assert.ok(openai.z > 2)
  assert.equal(openai.sources, 3)
  const alerts = alertCandidates(trends, { minZ: 2, minCount: 3 })
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].type, 'entity_spike')
})

ok('趋势：无当前条目时不高亮', () => {
  const trends = computeTrends({
    entries: [{ id: 'old', publishedAt: NOW - 3 * 86400000, sourceId: 's', domain: 'ai-work' }],
    mentions: [{ entityId: 'x', entryId: 'old', at: NOW - 3 * 86400000 }],
    now: NOW,
    names: new Map([['x', { name: 'X', kind: 'company' }]]),
  })
  assert.equal(trends[0].current, 0)
  assert.equal(alertCandidates(trends, { minZ: 2, minCount: 1 }).length, 0)
})

ok('领域热度按窗口统计', () => {
  const heat = domainHeat([
    { publishedAt: NOW, domain: 'ai-work', sourceId: 'a' },
    { publishedAt: NOW, domain: 'ai-work', sourceId: 'b' },
    { publishedAt: NOW, domain: 'onchain', sourceId: 'c' },
    { publishedAt: NOW - 48 * HOUR, domain: 'infra', sourceId: 'd' },
  ], { now: NOW, windowHours: 24 })
  assert.equal(heat.find(x => x.domain === 'ai-work').count, 2)
  assert.equal(heat.find(x => x.domain === 'onchain').count, 1)
  assert.ok(!heat.find(x => x.domain === 'infra'))
})

ok('关键词命中生成告警候选', () => {
  const hits = keywordHits([
    { id: 'e1', title: 'OpenAI 发布新模型', summary: '', publishedAt: NOW },
    { id: 'e2', title: '无关内容', summary: '', publishedAt: NOW },
  ], ['openai'], { now: NOW, windowHours: 24 })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].type, 'keyword')
  assert.equal(hits[0].entryId, 'e1')
})

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)