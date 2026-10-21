/**
 * 趋势与异常检测（纯函数）。
 *
 * ## 口径
 *
 * 对每个实体统计「当前窗口内的条目数」与「过去 N 天同长度窗口的期望值」，
 * 用 `z = (current - expected) / sqrt(expected + 1)` 衡量偏离程度。
 * 只把 `current >= 3` 且 `z >= 2` 的实体视为突增，避免单个来源重复报道造成假信号。
 *
 * ## 为什么不用时间序列模型
 *
 * 本地数据量小（每天几百条），EWMA/ARIMA 会过拟合；简单的基线 + z-score
 * 可解释、可调参，而且能直接回答「为什么它被认为是异常」。
 */

function windowStartOf(now, hours) {
  return now - Math.max(1, Number(hours) || 24) * 3600000
}

/**
 * @param {{
 *   entries: object[],
 *   mentions: {entityId:string, entryId:string, at:number}[],
 *   names?: Map<string,{name:string,kind:string}>,
 *   now?: number, windowHours?: number, baselineDays?: number, limit?: number
 * }} input
 * @returns {{entityId:string,name:string,kind:string,current:number,expected:number,z:number,sources:number,latestAt:number}[]}
 */
export function computeTrends({
  entries = [], mentions = [], names = new Map(),
  now = Date.now(), windowHours = 24, baselineDays = 7, limit = 20,
} = {}) {
  const windowStart = windowStartOf(now, windowHours)
  const baselineStart = now - Math.max(1, baselineDays) * 86400000
  const entryById = new Map((entries || []).map(e => [String(e.id), e]))
  const stats = new Map()

  for (const mention of mentions || []) {
    const entry = entryById.get(String(mention.entryId))
    if (!entry) continue
    const at = Number(mention.at) || Number(entry.publishedAt) || 0
    if (at < baselineStart) continue
    const key = String(mention.entityId)
    if (!stats.has(key)) stats.set(key, { current: new Set(), baseline: new Set(), sources: new Set(), latestAt: 0 })
    const s = stats.get(key)
    if (at >= windowStart) {
      s.current.add(String(entry.id))
      if (entry.sourceId) s.sources.add(String(entry.sourceId))
      s.latestAt = Math.max(s.latestAt, at)
    } else {
      s.baseline.add(String(entry.id))
    }
  }

  // 基线窗口数：7 天 / 24h ≈ 7；期望值 = 基线条目数 / 窗口数
  const windowsInBaseline = Math.max(1, (Math.max(1, baselineDays) * 24) / Math.max(1, windowHours))
  const out = []
  for (const [entityId, s] of stats) {
    const current = s.current.size
    const expected = s.baseline.size / windowsInBaseline
    const z = (current - expected) / Math.sqrt(expected + 1)
    const meta = names.get(entityId) || { name: entityId, kind: 'unknown' }
    out.push({
      entityId,
      name: meta.name,
      kind: meta.kind,
      current,
      expected: Math.round(expected * 100) / 100,
      z: Math.round(z * 100) / 100,
      sources: s.sources.size,
      latestAt: s.latestAt,
    })
  }
  return out
    .sort((a, b) => (b.z - a.z) || (b.current - a.current))
    .slice(0, Math.max(1, Number(limit) || 20))
}

/** 窗口内各领域的条目数与来源数 */
export function domainHeat(entries = [], { now = Date.now(), windowHours = 24 } = {}) {
  const since = windowStartOf(now, windowHours)
  const map = new Map()
  for (const entry of entries || []) {
    if (Number(entry.publishedAt) < since) continue
    const key = String(entry.domain || 'unknown')
    if (!map.has(key)) map.set(key, { domain: key, count: 0, sources: new Set() })
    const item = map.get(key)
    item.count += 1
    if (entry.sourceId) item.sources.add(String(entry.sourceId))
  }
  return [...map.values()]
    .map(x => ({ domain: x.domain, count: x.count, sources: x.sources.size }))
    .sort((a, b) => b.count - a.count)
}

/** 从趋势里挑出告警候选 */
export function alertCandidates(trends = [], { minZ = 3, minCount = 5 } = {}) {
  return (trends || [])
    .filter(t => Number(t.z) >= minZ && Number(t.current) >= minCount)
    .map(t => ({
      type: 'entity_spike',
      severity: Number(t.z) >= 5 ? 'high' : 'medium',
      entityId: t.entityId,
      title: `${t.name} 出现突增`,
      detail: `近窗口 ${t.current} 条（基线期望 ${t.expected}，z=${t.z}，${t.sources} 个来源）`,
      key: `entity_spike:${t.entityId}`,
    }))
}

/** 关键词命中：给告警用 */
export function keywordHits(entries = [], keywords = [], { now = Date.now(), windowHours = 24 } = {}) {
  const since = windowStartOf(now, windowHours)
  const hits = []
  const list = (keywords || []).map(k => String(k).trim()).filter(Boolean)
  if (!list.length) return hits
  for (const entry of entries || []) {
    if (Number(entry.publishedAt) < since) continue
    const hay = `${entry.title || ''} ${entry.summary || ''} ${entry.content || ''}`.toLowerCase()
    for (const keyword of list) {
      if (!hay.includes(keyword.toLowerCase())) continue
      hits.push({
        type: 'keyword',
        severity: 'medium',
        title: `命中关键词「${keyword}」`,
        detail: String(entry.titleZh || entry.title || '').slice(0, 160),
        key: `keyword:${keyword}:${entry.id}`,
        entryId: entry.id,
      })
    }
  }
  return hits
}