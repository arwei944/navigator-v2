/**
 * 三端同步的前端封装。
 *
 * 同步**不新开写通道**：服务端把最新的一份推到落后端的 `POST /api/sites`，
 * 那里有 CAS 与写前快照。前端只负责触发与展示计划，不拼装站点数据。
 */
import { getAdminKey } from './opsApi'

const BASE = '/api/sync'

function headers(key) {
  const k = key || getAdminKey()
  return k ? { Authorization: `Bearer ${k}`, 'X-Nav-Key': k } : null
}

async function call(method, body, key) {
  const h = headers(key)
  if (!h) return { ok: false, error: '未登录' }
  const res = await fetch(BASE, {
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

export const syncApi = {
  status(key) {
    return call('GET', null, key)
  },
  /** dryRun=true 只出计划，不写任何一端 */
  run(key, { dryRun = false } = {}) {
    return call('POST', { dryRun, trigger: 'admin-ui' }, key)
  },
}