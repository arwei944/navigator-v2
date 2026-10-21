/**
 * 内容动态的前端封装。
 *
 * 读接口公开（本地内容页无需登录）；写接口带管理凭据。
 * 抓取是异步的：`refresh()` 立即返回，页面轮询 `stats` 看进度。
 */
import { getAdminKey } from './opsApi'

const BASE = '/api/content'

function headers(key, body) {
  const k = key || getAdminKey()
  return {
    ...(k ? { Authorization: `Bearer ${k}`, 'X-Nav-Key': k } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  }
}

async function call(method, { body, query } = {}, key) {
  const qs = query ? `?${new URLSearchParams(query)}` : ''
  const res = await fetch(BASE + qs, {
    method,
    headers: headers(key, body),
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) window.dispatchEvent(new CustomEvent('nav-auth-expired'))
  if (!res.ok && data.ok !== false) {
    return { ok: false, error: data.error || `请求失败（${res.status}）` }
  }
  return { ok: Boolean(data.ok), ...data }
}

export const contentApi = {
  list(params = {}, key) {
    const query = {}
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue
      query[k] = String(v)
    }
    return call('GET', { query }, key)
  },
  stats(key) {
    return call('GET', { query: { stats: '1' } }, key)
  },
  sources(key) {
    return call('GET', { query: { sources: '1' } }, key)
  },
  entry(key, id) {
    return call('GET', { query: { entry: id } }, key)
  },
  events(key, params = {}) {
    const query = { events: '1' }
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') query[k] = String(v)
    }
    return call('GET', { query }, key)
  },
  event(key, id) {
    return call('GET', { query: { event: id } }, key)
  },
  digest(key, date = '') {
    return call('GET', { query: date ? { digest: '1', date } : { digest: '1' } }, key)
  },
  processing(key) {
    return call('GET', { query: { processing: '1' } }, key)
  },
  insights(key, { hours = 24 } = {}) {
    return call('GET', { query: { insights: '1', hours: String(hours) } }, key)
  },
  entities(key, { hours = 24 } = {}) {
    return call('GET', { query: { entities: '1', hours: String(hours) } }, key)
  },
  entity(key, id, { limit = 50 } = {}) {
    return call('GET', { query: { entity: id, limit: String(limit) } }, key)
  },
  alerts(key, { limit = 20, unread = false } = {}) {
    return call('GET', { query: { alerts: '1', limit: String(limit), unread: unread ? '1' : '' } }, key)
  },
  markAlertsRead(key, ids) {
    return call('POST', { body: { ids }, query: { action: 'alert-read' } }, key)
  },
  setKeywords(key, keywords) {
    return call('POST', { body: { keywords }, query: { action: 'set-keywords' } }, key)
  },
  setCredibility(key, id, value) {
    return call('POST', { body: { id, value }, query: { action: 'credibility' } }, key)
  },
  insightsRefresh(key) {
    return call('POST', { body: {}, query: { action: 'insights' } }, key)
  },
  graph(key, { hours = 168, nodes = 40 } = {}) {
    return call('GET', { query: { graph: '1', hours: String(hours), nodes: String(nodes) } }, key)
  },
  impact(key, { domain = '', hours = 24, limit = 20 } = {}) {
    return call('GET', { query: { impact: '1', domain, hours: String(hours), limit: String(limit) } }, key)
  },
  reports(key, { type = 'weekly', limit = 12 } = {}) {
    return call('GET', { query: { reports: '1', type, limit: String(limit) } }, key)
  },
  report(key, { type = 'weekly', id = '' } = {}) {
    return call('GET', { query: { report: type, id } }, key)
  },
  generateReport(key, { force = true } = {}) {
    return call('POST', { body: { force }, query: { action: 'report' } }, key)
  },
  feedback(key, { id, targetType = 'entry', feedback, note = '' }) {
    return call('POST', {
      body: { id, targetId: id, targetType, feedback, note },
      query: { action: 'feedback' },
    }, key)
  },
  process(key, { wait = false, extractLimit, summaryLimit } = {}) {
    return call('POST', {
      body: { wait, extractLimit, summaryLimit },
      query: { action: 'process' },
    }, key)
  },
  refresh(key, { wait = false, sourceIds = [] } = {}) {
    return call('POST', { body: { wait, sourceIds }, query: { action: 'refresh' } }, key)
  },
  saveSource(key, source) {
    return call('POST', { body: source, query: { action: 'source' } }, key)
  },
  deleteSource(key, id) {
    return call('POST', { body: { id }, query: { action: 'delete-source' } }, key)
  },
  testSource(key, id) {
    return call('POST', { body: { id }, query: { action: 'source-test' } }, key)
  },
  markRead(key, ids, read = true) {
    return call('POST', { body: { ids, read }, query: { action: 'read' } }, key)
  },
  markSaved(key, ids, saved = true) {
    return call('POST', { body: { ids, saved }, query: { action: 'save' } }, key)
  },
}