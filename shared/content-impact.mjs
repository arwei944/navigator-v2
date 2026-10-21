/**
 * 阶段 3：事件影响分析。
 *
 * 目标不是给事件打一个「绝对真理」的分数，而是把**排序依据讲清楚**：
 * 来源多少、报道多少、来源权重、涉及实体、实体是否在突增、事件有多新。
 * 分数用于排序与分级，`reasons` 用于让人判断它是否可信。
 */

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function round(n, digits = 1) {
  const p = 10 ** digits
  return Math.round(n * p) / p
}

const LEVELS = { high: 2, medium: 1, low: 0 }

/**
 * 单个事件的影响分（0–100）。
 *
 * 权重设计：
 *   - 多源覆盖最重要（log2 压缩，避免大事件碾压一切）
 *   - 报道数代表持续度
 *   - 来源权重 / 可信度代表信息质量
 *   - 涉及实体数与趋势强度代表影响面
 *   - 48 小时半衰期，旧事件自然下沉
 */
export function eventImpact(event = {}, {
  entityCount = 0, maxZ = 0, sourceWeight = 0, now = Date.now(),
} = {}) {
  const lastSeen = Number(event.lastSeen ?? event.last_seen) || now
  const ageHours = Math.max(0, (now - lastSeen) / 3600000)
  const fresh = Math.exp(-ageHours / 48)
  const sources = Number(event.sourceCount ?? event.source_count) || 0
  const entries = Number(event.entryCount ?? event.entry_count) || 0
  const weight = Math.max(0, Number(sourceWeight) || 0)
  const z = Math.max(0, Number(maxZ) || 0)

  const base =
    Math.log2(1 + sources) * 13 +
    Math.log2(1 + entries) * 7 +
    Math.log2(1 + weight) * 9 +
    Math.min(6, Math.max(0, entityCount)) * 3.5 +
    Math.min(10, z) * 2.6

  const score = Math.round(clamp(base * (0.55 + 0.45 * fresh), 0, 100))
  const level = score >= 65 ? 'high' : score >= 40 ? 'medium' : 'low'

  const reasons = []
  if (sources >= 3) reasons.push(`${sources} 个独立来源`)
  if (entries >= 5) reasons.push(`${entries} 条报道`)
  if (weight >= 3) reasons.push('来源权重较高')
  if (entityCount >= 3) reasons.push(`涉及 ${entityCount} 个实体`)
  if (z >= 3) reasons.push(`实体突增 z=${round(z, 1)}`)
  if (ageHours <= 6) reasons.push('6 小时内')
  if (!reasons.length) reasons.push('单一来源、报道量小')

  return { score, level, ageHours: round(ageHours), reasons }
}

/** 按影响等级给出可执行的下一步，而不是空泛的“关注” */
export function buildActions(event = {}, impact = {}, { entities = [], maxZ = 0, domains = [] } = {}) {
  const actions = []
  if (impact.level === 'high') {
    actions.push('核对原始来源与时间线，确认不是单一媒体的重复报道')
    actions.push('检查相关主体是否已发布官方声明或公告')
  } else if (impact.level === 'medium') {
    actions.push('加入观察列表，等待第二来源交叉验证')
  } else {
    actions.push('暂不处理，保留在时间线')
  }
  if (maxZ >= 5) actions.push('相关实体处于突增期，优先看该实体的最新报道')
  if (entities.length >= 4) actions.push('涉及多个主体，可按实体拆成专题跟踪')
  if (new Set(domains).size >= 2) actions.push('跨领域事件，留意上下游传导')
  return actions.slice(0, 4)
}

/**
 * 批量评估事件。
 *
 * @param {{
 *   events?:Array, entitiesByEvent?:Map, trendsByEntity?:Map,
 *   eventWeights?:Map<string, number>, now?:number, limit?:number
 * }} input
 */
export function assessEvents({
  events = [], entitiesByEvent = new Map(), trendsByEntity = new Map(),
  eventWeights = new Map(), now = Date.now(), limit = 20,
} = {}) {
  const assessed = (Array.isArray(events) ? events : []).map(event => {
    const entities = (entitiesByEvent.get(event.id) || []).slice(0, 8)
    const maxZ = entities.reduce((n, e) => Math.max(n, Number(trendsByEntity.get(e.id)) || 0), 0)
    const sourceWeight = Number(eventWeights.get(event.id)) || 0
    const impact = eventImpact(event, {
      entityCount: entities.length,
      maxZ,
      sourceWeight,
      now,
    })
    const actions = buildActions(event, impact, { entities, maxZ, domains: [event.domain] })
    return {
      ...event,
      entities,
      maxZ: round(maxZ),
      impact,
      actions,
    }
  })
  return assessed
    .sort((a, b) => b.impact.score - a.impact.score || Number(b.lastSeen) - Number(a.lastSeen))
    .slice(0, Math.max(1, Number(limit) || 20))
}

/**
 * 跨事件扩散：同一实体出现在多个高/中影响事件里，
 * 说明影响不是孤立的，而是同一股力量在推动。
 */
export function crossEventEntities(assessed = [], { minEvents = 2, minLevel = 'medium' } = {}) {
  const floor = LEVELS[minLevel] ?? LEVELS.medium
  const map = new Map()
  for (const item of assessed) {
    if ((LEVELS[item.impact?.level] ?? 0) < floor) continue
    for (const entity of item.entities || []) {
      if (!map.has(entity.id)) {
        map.set(entity.id, { id: entity.id, name: entity.name, kind: entity.kind, events: [] })
      }
      map.get(entity.id).events.push({
        id: item.id,
        title: item.title,
        score: item.impact?.score || 0,
        domain: item.domain,
      })
    }
  }
  return [...map.values()]
    .filter(x => x.events.length >= Math.max(2, Number(minEvents) || 2))
    .sort((a, b) => b.events.length - a.events.length || b.events[0].score - a.events[0].score)
}

export function impactStats(assessed = []) {
  const counts = { high: 0, medium: 0, low: 0 }
  for (const item of assessed) counts[item.impact?.level || 'low'] += 1
  return {
    total: assessed.length,
    ...counts,
    avgScore: assessed.length
      ? Math.round(assessed.reduce((n, x) => n + (x.impact?.score || 0), 0) / assessed.length)
      : 0,
  }
}