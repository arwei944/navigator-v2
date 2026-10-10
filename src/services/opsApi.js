/**
 * 线上运维面的前端封装：发布历史、通知中心、快照回滚。
 *
 * 与数据面（`/api/sites` 的站点读写）分开，是因为两者鉴权与语义不同：
 * 数据面是「把站点数据推上去」，运维面是「看这次推上去之后发生了什么」。
 * 所有调用都带 Bearer 凭据；凭据不存在时由调用方先行拦截，避免打出必失败的请求。
 *
 * ## 凭据存哪里（改这块前必读）
 *
 * 用 **sessionStorage**，不用 localStorage，也不再接受共享密钥：
 *
 *   - 共享密钥（`SITES_ADMIN_KEY`）是**永久**凭据，一旦落在浏览器里就等于长期泄露；
 *     XSS 或恶意扩展拿到之后只能靠轮换密钥 + 重新部署才能止损。所以它不再进浏览器，
 *     登录改为「用户名 + 口令 → 有期限的会话 token」（`api/auth.js`）。
 *   - 会话 token 用 sessionStorage 而不是 localStorage：**关掉标签页即失效**。
 *     浏览器里没有能挡住 XSS 的加密（密钥本身也在 XSS 可达范围内），
 *     真正有效的只有「缩短有效期 + 缩短暴露窗口」，而这两条 sessionStorage 天然满足后者。
 *   - 旧版存在 localStorage 的 `nav_admin_key`（共享密钥明文）在这里**主动清除**，
 *     不做迁移 —— 把它搬进 sessionStorage 只是把同一个问题换个位置。
 */

const TOKEN_STORE = 'nav_admin_token'
const EXPIRES_STORE = 'nav_admin_token_exp'
/** 旧版遗留：localStorage 里的共享密钥明文，读到就删 */
const LEGACY_KEY_STORE = 'nav_admin_key'

/** 取当前会话凭据；已过期则就地清掉并返回空串 */
export function getAdminKey() {
  try {
    if (localStorage.getItem(LEGACY_KEY_STORE) !== null) {
      localStorage.removeItem(LEGACY_KEY_STORE)
    }
  } catch { /* 无痕模式下 localStorage 可能抛，忽略 */ }
  let token = ''
  try { token = sessionStorage.getItem(TOKEN_STORE) || '' } catch { return '' }
  if (!token) return ''
  const exp = Number(sessionStorage.getItem(EXPIRES_STORE) || 0)
  // exp 为 0 表示服务端没给有效期（如密钥直连的兜底路径），交给服务端判
  if (exp && Date.now() > exp) { clearAdminKey(); return '' }
  return token
}

/** 写入凭据（登录签发的会话 token，或未配置口令登录时的密钥兜底） */
export function setAdminKey(key, expiresAt) {
  try {
    if (key) sessionStorage.setItem(TOKEN_STORE, key)
    else sessionStorage.removeItem(TOKEN_STORE)
    if (key && expiresAt) sessionStorage.setItem(EXPIRES_STORE, String(expiresAt))
    else sessionStorage.removeItem(EXPIRES_STORE)
  } catch { /* 存储不可用时退化为「本页内存中的 ref」，不阻断后台使用 */ }
}

export function clearAdminKey() {
  try {
    sessionStorage.removeItem(TOKEN_STORE)
    sessionStorage.removeItem(EXPIRES_STORE)
  } catch { /* 同上 */ }
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