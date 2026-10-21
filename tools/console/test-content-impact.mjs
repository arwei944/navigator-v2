/**
 * 阶段 3 门禁：影响评分、跨事件扩散、周报结构。
 */
import assert from 'node:assert/strict'
import {
  eventImpact, assessEvents, crossEventEntities, impactStats, buildActions,
} from '../../shared/content-impact.mjs'
import { weeklyReport, reportPeriod } from '../../shared/content-report.mjs'

let pass = 0
let fail = 0
function ok(name, fn) {
  try { fn(); pass += 1; console.log(`  ✓ ${name}`) }
  catch (e) { fail += 1; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0)
const HOUR = 3600000

function event(id, overrides = {}) {
  return {
    id,
    title: `事件 ${id}`,
    summary: '摘要',
    domain: 'ai-work',
    sourceCount: 1,
    entryCount: 1,
    lastSeen: NOW,
    firstSeen: NOW - HOUR,
    ...overrides,
  }
}

console.log('领域动态 · 阶段 3 影响与周报')

ok('影响评分：多源多实体突增事件为高影响', () => {
  const impact = eventImpact(event('e1', { sourceCount: 4, entryCount: 8 }), {
    entityCount: 4, maxZ: 6, sourceWeight: 6, now: NOW,
  })
  assert.equal(impact.level, 'high')
  assert.ok(impact.score >= 65)
  assert.ok(impact.reasons.some(r => r.includes('来源')))
})

ok('影响评分：单源单条为低影响', () => {
  const impact = eventImpact(event('e2'), { now: NOW })
  assert.equal(impact.level, 'low')
  assert.ok(impact.score < 40)
})

ok('影响评分：同样内容，旧事件分数更低', () => {
  const fresh = eventImpact(event('e3', { sourceCount: 3, entryCount: 4 }), {
    entityCount: 2, sourceWeight: 3, now: NOW,
  })
  const stale = eventImpact(event('e3', {
    sourceCount: 3, entryCount: 4, lastSeen: NOW - 96 * HOUR,
  }), { entityCount: 2, sourceWeight: 3, now: NOW })
  assert.ok(stale.score < fresh.score)
  assert.ok(stale.ageHours >= 96)
})

ok('建议：高影响与突增给出可执行动作', () => {
  const impact = { score: 80, level: 'high' }
  const actions = buildActions({}, impact, {
    entities: [{ id: 'openai' }], maxZ: 7, domains: ['ai-work', 'infra'],
  })
  assert.ok(actions.length >= 2)
  assert.ok(actions.some(a => a.includes('突增')))
})

ok('批量评估：按分数排序并附带实体', () => {
  const assessed = assessEvents({
    events: [
      event('small', { sourceCount: 1, entryCount: 1 }),
      event('big', { sourceCount: 5, entryCount: 9, lastSeen: NOW - HOUR }),
    ],
    entitiesByEvent: new Map([
      ['big', [{ id: 'openai', name: 'OpenAI', kind: 'company' }]],
      ['small', []],
    ]),
    trendsByEntity: new Map([['openai', 6]]),
    eventWeights: new Map([['big', 5], ['small', 1]]),
    now: NOW,
  })
  assert.equal(assessed[0].id, 'big')
  assert.equal(assessed[0].entities[0].name, 'OpenAI')
  assert.ok(assessed[0].impact.score > assessed[1].impact.score)
  assert.equal(impactStats(assessed).total, 2)
})

ok('跨事件扩散：同一实体出现在两个中影响事件', () => {
  const assessed = assessEvents({
    events: [
      event('a', { sourceCount: 3, entryCount: 3 }),
      event('b', { sourceCount: 3, entryCount: 3 }),
    ],
    entitiesByEvent: new Map([
      ['a', [{ id: 'openai', name: 'OpenAI', kind: 'company' }]],
      ['b', [{ id: 'openai', name: 'OpenAI', kind: 'company' }]],
    ]),
    eventWeights: new Map([['a', 3], ['b', 3]]),
    now: NOW,
  })
  const cross = crossEventEntities(assessed)
  assert.equal(cross.length, 1)
  assert.equal(cross[0].name, 'OpenAI')
  assert.equal(cross[0].events.length, 2)
})

ok('周报：包含概览、环比、事件、实体与建议', () => {
  const report = weeklyReport({
    now: NOW,
    events: [{
      ...event('e1', { sourceCount: 4, entryCount: 8 }),
      impact: { score: 78, level: 'high', reasons: [] },
      entities: [{ id: 'openai', name: 'OpenAI' }],
      actions: ['核对原始来源'],
    }],
    trends: [{
      entityId: 'openai', name: 'OpenAI', kind: 'company', current: 9, expected: 3, z: 3.4, sources: 4,
    }],
    domainHeat: [{ domain: 'ai-work', count: 12 }, { domain: 'infra', count: 3 }],
    stats: { sources: 20, total: 400, failing: 1 },
    alerts: [{ severity: 'high', title: 'OpenAI 突增', read: false }],
    prev: { added: 15, prevAdded: 10 },
    cross: [{
      id: 'openai', name: 'OpenAI', events: [{ title: '事件 A' }, { title: '事件 B' }],
    }],
  })
  assert.equal(report.type, 'weekly')
  assert.ok(report.markdown.includes('# 领域情报周报'))
  assert.ok(report.markdown.includes('+50%'))
  assert.ok(report.markdown.includes('OpenAI'))
  assert.ok(report.markdown.includes('跨事件扩散'))
  assert.ok(report.markdown.includes('下周建议'))
  assert.equal(report.counts.high, 1)
})

ok('周报：空数据不崩溃并明确写“暂无”', () => {
  const report = weeklyReport({ now: NOW })
  assert.ok(report.markdown.includes('暂无'))
  assert.equal(report.counts.events, 0)
})

ok('周报周期：默认 7 天', () => {
  const period = reportPeriod({ now: NOW, days: 7 })
  assert.equal(period.days, 7)
  assert.equal(period.end - period.start, 7 * 86400000)
  assert.match(period.label, /^\d{2}-\d{2} ~ \d{2}-\d{2}$/)
})

console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)