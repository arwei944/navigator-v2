/**
 * 登录认证的前端封装。
 *
 * 只做三件事：登录换 token、自检 token 是否仍有效、登出。
 * token 统一存进 `nav_admin_key`（与共享密钥同一个槽位）—— 这样数据面 / 运维面
 * 所有既有调用方无需改动即可继续用 Bearer 发请求。
 */

const BASE = '/api/auth'

async function post(body, { key } = {}) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export const authApi = {
  /** 服务端认证配置（是否已配好登录口令 / 是否可用密钥直连） */
  async status() {
    const res = await fetch(BASE, { headers: { 'Cache-Control': 'no-cache' } })
    const data = await res.json().catch(() => ({}))
    return { loginReady: Boolean(data.loginReady), keyReady: Boolean(data.keyReady), username: data.username || 'admin' }
  },

  /** 用户名 + 口令换会话 token；remember=true 时有效期 90 天（默认 7 天） */
  login: (username, password, remember = false) => post({ action: 'login', username, password, remember: Boolean(remember) }),

  /** 校验当前凭据；valid=false 时 reason 可区分 'expired' 与 'bad-signature' */
  verify: (key) => post({ action: 'verify' }, { key }),

  logout: (key) => post({ action: 'logout' }, { key }).catch(() => ({ ok: true })),
}