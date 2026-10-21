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