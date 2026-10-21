/**
 * 阶段 3 编排：影响分析、图谱视图、周报、反馈副作用。
 *
 * 纯计算放在 `shared/`，这里只做「取数 → 调纯函数 → 落库/返回」。
 * 所有函数都可以被 API 直接调用，也可以被处理管道复用。
 */
import {
  stats as entryStats, listSources, listEvents, getEventEntries, setEntryFlags,
  countEntriesBetween, saveReport, getReport, latestReport, listReports,
} from './content-store.mjs'
import {
  eventEntities, trendInputs, graphData, entityNeighbors, listAlerts,
  addFeedback, listFeedback, feedbackScoreMap, entityEntries,
} from './content-insights-store.mjs'
import { computeTrends, domainHeat } from '../shared/content-trends.mjs'
import { assessEvents, crossEventEntities, impactStats } from '../shared/content-impact.mjs'
import { graphLayout, graphSummary } from '../shared/content-graph.mjs'
import { weeklyReport, reportPeriod } from '../shared/content-report.mjs'

const HOUR = 3600000
const DAY = 86400000

/** 来源的真实影响力：人工权重 × 可信度 × 反馈系数 */
function sourceInfluence() {
  const feedback = feedbackScoreMap()
  return new Map(listSources().map(s => [
    s.id,
    (Number(s.weight) || 1) * (Number(s.credibility) || 1) * (feedback.get(s.id) || 1),
  ]))
}

function eventSourceWeights(events, influence) {
  const weights = new Map()
  for (const event of events) {
    const seen = new Set()
    let sum = 0
    for (const entry of getEventEntries(event.id)) {
      if (seen.has(entry.sourceId)) continue
      seen.add(entry.sourceId)
      sum += influence.get(entry.sourceId) || 1
    }
    weights.set(event.id, sum)
  }
  return weights
}

/**
 * 事件影响列表。
 *
 * @param {{domain?:string, hours?:number, limit?:number, now?:number}} options
 */
export function impactEvents({ domain = '', hours = 24, limit = 20, now = Date.now() } = {}) {
  const events = listEvents({
    domain,
    since: now - Math.max(1, Number(hours) || 24) * HOUR,
    limit: Math.max(20, Math.min(Number(limit) || 20, 80)),
  })
  if (!events.length) {
    return { items: [], stats: impactStats([]), cross: [], domainHeat: [], trends: [] }
  }

  const influence = sourceInfluence()
  const entitiesByEvent = new Map(events.map(e => [e.id, eventEntities(e.id)]))
  const input = trendInputs({ days: 7 })
  const allTrends = computeTrends({
    entries: input.entries,
    mentions: input.mentions,
    names: input.names,
    now,
    windowHours: 24,
    baselineDays: 7,
    limit: 100,
  })
  const assessed = assessEvents({
    events,
    entitiesByEvent,
    trendsByEntity: new Map(allTrends.map(t => [t.entityId, t.z])),
    eventWeights: eventSourceWeights(events, influence),
    now,
    limit,
  })
  return {
    items: assessed,
    stats: impactStats(assessed),
    cross: crossEventEntities(assessed),
    trends: allTrends.slice(0, 20),
    domainHeat: domainHeat(input.entries, { now, windowHours: 24 }),
  }
}

/** 图谱 + 确定性布局 */
export function graphView({ hours = 168, maxNodes = 40, minCo = 2 } = {}) {
  const graph = graphData({ hours, maxNodes, minCo })
  const nodes = graphLayout(graph.nodes, graph.edges)
  return {
    hours: Number(hours) || 168,
    nodes,
    edges: graph.edges,
    summary: graphSummary(graph),
    size: { width: 760, height: 420 },
  }
}

export function entityDetail(entityId, { limit = 40 } = {}) {
  return {
    neighbors: entityNeighbors(entityId),
    entries: entityEntries(entityId, { limit }),
  }
}

/**
 * 生成（或复用）最近 7 天周报。
 * 规则版每次 force 会重算，保证清洗与聚类更新后数字不会停在旧版本。
 */
export async function ensureWeeklyReport({ now = Date.now(), force = false, days = 7 } = {}) {
  const period = reportPeriod({ now, days })
  const id = `weekly-${period.endDate}`
  if (!force) {
    const existing = getReport(id)
    if (existing) return existing
  }

  const impact = impactEvents({ hours: days * 24, limit: 40, now })
  const stats_ = entryStats(now)
  const alerts = listAlerts({ limit: 50 })
  const added = countEntriesBetween(period.start, period.end)
  const prevAdded = countEntriesBetween(period.start - days * DAY, period.start)
  const report = weeklyReport({
    now,
    days,
    events: impact.items,
    trends: impact.trends,
    entities: impact.items.flatMap(e => e.entities || []),
    domainHeat: impact.domainHeat,
    stats: stats_,
    alerts,
    prev: { added, prevAdded },
    cross: impact.cross,
  })

  return saveReport({
    id,
    type: 'weekly',
    periodStart: period.start,
    periodEnd: period.end,
    contentMd: report.markdown,
    status: 'rule',
  })
}

/**
 * 反馈副作用：
 *   - hide / irrelevant → 隐藏，并从时间线与聚类中排除
 *   - pin / important  → 置顶
 *   - unhide / unpin   → 恢复
 * 反馈本身也写库，后续用于调整来源权重。
 */
const ACTIONS = new Set(['hide', 'unhide', 'pin', 'unpin', 'irrelevant', 'important'])

export function applyFeedback({ targetType = 'entry', targetId, action, note = '' } = {}) {
  const act = String(action || '')
  if (!ACTIONS.has(act)) throw new Error(`未知反馈动作：${act || '(空)'}`)
  const type = String(targetType || 'entry')
  let changed = 0
  if (type === 'entry') {
    if (act === 'hide' || act === 'irrelevant') changed = setEntryFlags([targetId], { hidden: true })
    else if (act === 'unhide') changed = setEntryFlags([targetId], { hidden: false })
    else if (act === 'pin' || act === 'important') changed = setEntryFlags([targetId], { pinned: true })
    else if (act === 'unpin') changed = setEntryFlags([targetId], { pinned: false })
  }
  const feedback = addFeedback({ targetType: type, targetId, action: act, note })
  return { changed, feedback }
}

export function feedbackView({ targetType = '', targetId = '', limit = 50 } = {}) {
  const items = listFeedback({ targetType, targetId, limit })
  const counts = items.reduce((acc, item) => {
    acc[item.action] = (acc[item.action] || 0) + 1
    return acc
  }, {})
  return { items, counts }
}

export { latestReport, listReports }