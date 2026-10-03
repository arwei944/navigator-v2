/**
 * 线上运维面的前端封装：发布历史、通知中心、快照回滚。
 *
 * 与数据面（`/api/sites` 的站点读写）分开，是因为两者鉴权与语义不同：
 * 数据面是「把站点数据推上去」，运维面是「看这次推上去之后发生了什么」。
 * 所有调用都带 Bearer 密钥；密钥不存在时由调用方先行拦截，避免打出必失败的请求。
 */

const KEY_STORE = 'nav_admin_key'

export function getAdminKey() {
  return localStorage.getItem(KEY_STORE) || ''
}

/** 写入凭据（登录签发的会话 token，或直接粘贴的共享密钥） */
export function setAdminKey(key) {
  if (key) localStorage.setItem(KEY_STORE, key)
  else localStorage.removeItem(KEY_STORE)
}

export function clearAdminKey() {
  localStorage.removeItem(KEY_STORE)
}

function qs(params = {}) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    sp.set(k, String(v))
  }
  return sp.toString()
}

async function call(url, { key, method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key || getAdminKey()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // 凭据失效（过期 / 轮换）时广播一次，由 AdminView 统一退回登录闸门，
    // 避免每个面板各自弹一遍「Unauthorized」
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('nav-auth-expired'))
    }
    throw new Error(data.error || `HTTP ${res.status}`)
  }
  return data
}

export const opsApi = {
  /** 发布历史（新 → 旧），附概览统计 */
  history: (key, params = {}) => call(`/api/ops?${qs({ limit: 30, ...params })}`, { key }),

  /** 通知中心列表，附概览统计 */
  notifications: (key, params = {}) => call(`/api/ops?${qs({ notifications: 1, limit: 50, ...params })}`, { key }),

  markRead: (key, ids = []) => call('/api/ops', { key, method: 'POST', body: { action: 'notify.read', ids } }),
  clearNotifications: (key) => call('/api/ops', { key, method: 'POST', body: { action: 'notify.clear' } }),
  appendHistory: (key, record) => call('/api/ops', { key, method: 'POST', body: { action: 'history.append', record } }),
  pushNotification: (key, notification) => call('/api/ops', { key, method: 'POST', body: { action: 'notify.push', notification } }),

  /** 操作审计日志列表，附概览统计与动作字典 */
  audit: (key, params = {}) => call(`/api/ops?${qs({ audit: 1, limit: 200, ...params })}`, { key }),

  /** 追加一条审计记录（旁路，失败不影响主流程） */
  appendAudit: (key, entry) => call('/api/ops', { key, method: 'POST', body: { action: 'audit.append', entry } }),

  /** 云端快照清单（回滚的可选目标） */
  snapshots: (key) => call('/api/sites?snapshots=1', { key }),

  /** 一键回滚到指定快照 */
  rollback: (key, snapshot) => call('/api/sites', { key, method: 'POST', body: { action: 'rollback', snapshot } }),

  /**
   * 发布站点数据到云端（数据面，与 api/sites.js POST 对应）。
   * categories 缺省不传 → 服务端沿用云端已有分类表，CLI / 旧客户端发布不会清空它。
   */
  publish: (key, sites, categories) => call('/api/sites', {
    key,
    method: 'POST',
    body: categories ? { sites, categories } : { sites },
  }),
}