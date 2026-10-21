/**
 * 阶段 2 洞察编排：实体 → 趋势 → 告警。
 *
 * 每次处理（抓取后的 process）都会跑一遍：
 *   1. 增量索引：倒排词项 + 实体提及（每条只做一次）；
 *   2. 事件实体关联；
 *   3. 趋势：当前 24h vs 过去 7 天基线；
 *   4. 告警：实体突增、关键词命中、来源连续失败；
 *   5. 可选 webhook（`NAV_ALERT_WEBHOOK_URL`）。
 *
 * 所有步骤都是旁路：失败只记录，不影响内容入库。
 */
import {
  syncInsights, linkEventEntities, rebuildEntityEdges, trendInputs, topEntities, listAlerts,
  saveAlerts, failingSources, allEntities,
} from './content-insights-store.mjs'
import {
  computeTrends, domainHeat, alertCandidates, keywordHits,
} from '../shared/content-trends.mjs'
import { getMeta, setMeta } from './content-store.mjs'

const KEYWORDS_META = 'alert_keywords'

export function getAlertKeywords() {
  return String(getMeta(KEYWORDS_META) || '')
    .split(/[,，\n]/).map(s => s.trim()).filter(Boolean)
}

export function setAlertKeywords(keywords = []) {
  const list = (Array.isArray(keywords) ? keywords : String(keywords).split(/[,，\n]/))
    .map(s => String(s).trim()).filter(Boolean).slice(0, 30)
  setMeta(KEYWORDS_META, list.join(','))
  return list
}

function buildTrends({ now = Date.now(), days = 7, windowHours = 24 } = {}) {
  const input = trendInputs({ days })
  const trends = computeTrends({
    entries: input.entries,
    mentions: input.mentions,
    names: input.names,
    now,
    windowHours,
    baselineDays: days,
    limit: 20,
  })
  return {
    trends,
    domainHeat: domainHeat(input.entries, { now, windowHours }),
    entries: input.entries,
  }
}

function sourceFailureAlerts() {
  return failingSources({ threshold: 3 }).map(source => ({
    type: 'source_failing',
    severity: 'medium',
    title: `来源连续失败：${source.label}`,
    detail: `连续失败 ${source.failCount} 次${source.error ? ` · ${source.error}` : ''}`,
    key: `source_failing:${source.id}`,
  }))
}

async function sendWebhook(alerts) {
  const raw = String(process.env.NAV_ALERT_WEBHOOK_URL || '').trim()
  if (!raw || !alerts.length) return { sent: 0 }
  let sent = 0
  for (const url of raw.split(',').map(s => s.trim()).filter(Boolean)) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'content-intel',
          at: new Date().toISOString(),
          alerts: alerts.map(a => ({ type: a.type, severity: a.severity, title: a.title, detail: a.detail })),
        }),
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) sent += 1
    } catch { /* webhook 是旁路 */ }
  }
  return { sent }
}

/** 实时读取洞察，不写库 */
export function getInsights({ hours = 24 } = {}) {
  const { trends, domainHeat: heat } = buildTrends({ windowHours: hours })
  return {
    at: new Date().toISOString(),
    windowHours: hours,
    trends,
    domainHeat: heat,
    entities: topEntities({ hours, limit: 20 }),
    alerts: listAlerts({ limit: 20 }),
    keywords: getAlertKeywords(),
  }
}

/** 处理管道末尾调用：写索引、关联事件、生成趋势与告警 */
export async function refreshInsights({ now = Date.now() } = {}) {
  const out = {
    sync: null, eventLinks: 0, edges: 0, trends: [], domainHeat: [],
    alertsAdded: 0, webhook: null, errors: [],
  }

  // 索引覆盖完整保留期（30 天），趋势仍只比较最近 7 天
  try { out.sync = syncInsights({ days: 30 }) }
  catch (e) { out.errors.push({ step: 'sync', error: String(e?.message || e) }) }

  try { out.eventLinks = linkEventEntities() }
  catch (e) { out.errors.push({ step: 'event-links', error: String(e?.message || e) }) }

  // 实体共现边：7 天窗口、至少 2 次共现
  try { out.edges = rebuildEntityEdges({ days: 7 }).edges }
  catch (e) { out.errors.push({ step: 'edges', error: String(e?.message || e) }) }

  let trends = []
  let entries = []
  try {
    const built = buildTrends({ now })
    trends = built.trends
    entries = built.entries
    out.trends = trends
    out.domainHeat = built.domainHeat
  } catch (e) {
    out.errors.push({ step: 'trends', error: String(e?.message || e) })
  }

  try {
    const candidates = [
      ...alertCandidates(trends, { minZ: 3, minCount: 5 }),
      ...keywordHits(entries, getAlertKeywords(), { now }),
      ...sourceFailureAlerts(),
    ]
    const saved = saveAlerts(candidates, { now })
    out.alertsAdded = saved.added
    out.webhook = await sendWebhook(saved.fresh)
  } catch (e) {
    out.errors.push({ step: 'alerts', error: String(e?.message || e) })
  }

  return out
}

export { allEntities }