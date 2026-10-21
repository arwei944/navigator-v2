/**
 * 浏览器临时工作区的前端封装。
 *
 * 所有写入先落 `staging/`，只有 `promote` 会碰主库；面板里必须把这一步
 * 做成显式按钮，不能自动执行。
 */
import { getAdminKey } from './opsApi'

const BASE = '/api/ingest'

function headers(key) {
  const k = key || getAdminKey()
  return k ? { Authorization: `Bearer ${k}`, 'X-Nav-Key': k } : null
}

async function call(method, { body, query } = {}, key) {
  const h = headers(key)
  if (!h) return { ok: false, error: '未登录' }
  const qs = query ? `?${new URLSearchParams(query)}` : ''
  const res = await fetch(BASE + qs, {
    method,
    headers: { ...h, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) window.dispatchEvent(new CustomEvent('nav-auth-expired'))
  if (!res.ok && data.ok !== false) {
    return { ok: false, error: data.error || `请求失败（${res.status}）` }
  }
  return { ok: Boolean(data.ok), ...data }
}

export const ingestApi = {
  list(key) {
    return call('GET', {}, key)
  },
  detail(key, batchId) {
    return call('GET', { query: { batch: batchId } }, key)
  },
  categories(key) {
    return call('GET', { query: { categories: '1' } }, key)
  },
  discard(key, batchId) {
    return call('DELETE', { query: { batch: batchId } }, key)
  },
  /**
   * @param {{batchId:string, keys:string[], strategy:'skip'|'overwrite'|'new-id', categoryOverrides?:object}} payload
   */
  promote(key, payload) {
    return call('POST', { body: payload, query: { action: 'promote' } }, key)
  },
}