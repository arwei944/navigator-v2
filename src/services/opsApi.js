/**
 * 线上运维面的前端封装：发布历史、通知中心、快照回滚。
 *
 * 与数据面（`/api/sites` 的站点读写）分开，是因为两者鉴权与语义不同：
 * 数据面是「把站点数据推上去」，运维面是「看这次推上去之后发生了什么」。
 * 所有调用都带 Bearer 凭据；凭据不存在时由调用方先行拦截，避免打出必失败的请求。
 *
 * ## 凭据存哪里（改这块前必读）
 *
 * 用 **localStorage**（2026-10-16 起从 sessionStorage 改过来，见下方权衡）。
 *
 *   - **绝不存共享密钥**：`SITES_ADMIN_KEY` 是**永久**凭据，落在浏览器里等于长期泄露，
 *     XSS 或恶意扩展拿到之后只能靠轮换密钥 + 重新部署才能止损。所以它不进代码、不进产物，
 *     登录走「用户名 + 口令 → 有期限的会话 token」（`api/auth.js`）。
 *   - **为什么从 sessionStorage 改成 localStorage**：原先关掉标签页就得重登，实际使用中
 *     一天要输好几次；「记住此设备」承诺的 90 天有效期被 sessionStorage 直接抹掉了 ——
 *     服务端签了 90 天的 token，客户端却存不过一次关标签页，这个承诺是假的。
 *     现在存 localStorage，**服务端签发的有效期成为真正的上限**。
 *   - **代价（如实记录）**：暴露窗口从「一次标签页」变成「直到过期」。缓解手段是
 *     `getAdminKey()` 里**每次读取都校验 exp，过期就地清除**，以及退出登录立即删除。
 *     浏览器里没有能挡住 XSS 的加密（token 本身就在 XSS 可达范围内），
 *     真正有效的只有「缩短有效期」，所以配口令登录时不要填一个很长的 TTL。
 *   - 旧版存在 localStorage 的 `nav_admin_key`（共享密钥明文）在这里**主动清除**，
 *     不做迁移 —— 那和现在的 token 不是一回事。
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
  try {
    token = localStorage.getItem(TOKEN_STORE) || ''
    // 旧版存过 sessionStorage：读得到就搬过来（迁移一次），随后清掉，避免两处不一致
    if (!token) {
      const legacy = sessionStorage.getItem(TOKEN_STORE) || ''
      if (legacy) {
        localStorage.setItem(TOKEN_STORE, legacy)
        const legacyExp = sessionStorage.getItem(EXPIRES_STORE)
        if (legacyExp) localStorage.setItem(EXPIRES_STORE, legacyExp)
        sessionStorage.removeItem(TOKEN_STORE)
        sessionStorage.removeItem(EXPIRES_STORE)
        token = legacy
      }
    }
  } catch { return '' }
  if (!token) return ''
  let exp = 0
  try { exp = Number(localStorage.getItem(EXPIRES_STORE) || 0) } catch { exp = 0 }
  // exp 为 0 表示服务端没给有效期（如密钥直连的兜底路径），交给服务端判
  if (exp && Date.now() > exp) { clearAdminKey(); return '' }
  return token
}

/** 写入凭据（登录签发的会话 token，或未配置口令登录时的密钥兜底） */
export function setAdminKey(key, expiresAt) {
  try {
    if (key) localStorage.setItem(TOKEN_STORE, key)
    else localStorage.removeItem(TOKEN_STORE)
    if (key && expiresAt) localStorage.setItem(EXPIRES_STORE, String(expiresAt))
    else localStorage.removeItem(EXPIRES_STORE)
    // 顺带清掉旧位置，别在两处各留一份
    sessionStorage.removeItem(TOKEN_STORE)
    sessionStorage.removeItem(EXPIRES_STORE)
  } catch { /* 存储不可用时退化为「本页内存中的 ref」，不阻断后台使用 */ }
}

export function clearAdminKey() {
  try {
    localStorage.removeItem(TOKEN_STORE)
    localStorage.removeItem(EXPIRES_STORE)
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
  const k = key || getAdminKey()
  const res = await fetch(url, {
    method,
    headers: {
      // 双头并发：Authorization 给本机直连，X-Nav-Key 穿透发布沙箱的网关
      // （网关会改写 Authorization，见 shared/auth.mjs#bearerOf）
      Authorization: `Bearer ${k}`,
      'X-Nav-Key': k,
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
  /**
   * 仪表盘摘要：发布历史 / 审计 / 通知三份数据的总量，**一次请求**拿全。
   * 后台首屏是 12 张模块卡片，没有它就得分三次读；而且这三份汇总由服务端用
   * 与各自面板相同的读者与汇总函数算出，所以卡片上的数字与进去看到的必然一致。
   */
  dashboardSummary: (key) => call('/api/ops?summary=1', { key }),

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
  /** 备份与恢复（P5）：GET 导出 / POST 覆盖恢复。响应可能是文件，这里不走 res.json 的失败分支 */
  backup: (key) => call('/api/backup', { key }),
  restoreBackup: (key, data) => call('/api/backup', { key, method: 'POST', body: { data } }),
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