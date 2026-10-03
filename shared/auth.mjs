/**
 * 管理后台登录认证内核（**仅服务端**：依赖 node:crypto，前端不得 import）。
 *
 * 为什么不接 SSO：本站是单管理员、无 IdP、部署在 Vercel Hobby，接第三方登录要额外
 * 账号体系与回调域名；而现有的 `SITES_ADMIN_KEY` 是永久明文共享密钥 —— 一旦泄露
 * 无法过期、无法登出、无法区分是谁在用。这里用最小代价补上「用户名 + 口令 →
 * 有期限的签名会话」，同时**保留**共享密钥作为兼容凭据（CLI / 脚本 / 旧客户端不受影响）。
 *
 * 设计取舍：
 *  - 会话 token 无状态（HMAC 签名 + 过期时间），服务端不存会话表。原因是每个受保护
 *    请求都去读一次 Blob 会让热更新接口明显变慢，得不偿失。payload 里预留 jti，
 *    将来要做「强制下线 / 设备管理」时再加吊销表即可。
 *  - 口令只以 scrypt 加盐哈希形式存在于环境变量，绝不明文入库 / 进 git；比对走
 *    timingSafeEqual。用户名比对同样走常量时间，避免靠计时枚举出管理员账号。
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 「记住此设备」的会话有效期（90 天）。
 *
 * 为什么敢放这么长：会话 token 是 HMAC 签名的无状态凭据，泄露面取决于它落在哪 ——
 * 这里只落在管理员本机的 localStorage，而口令本身仍是 scrypt 哈希、不会被延长。
 * 单管理员场景下，把「每 7 天手打一次 20 位随机口令」换成「一季度一次」，
 * 减少的是最容易被偷窥的一步（输入口令），而不是鉴权强度。
 * 需要立即收回时：轮换 AUTH_SECRET 并重新部署，所有已签发会话同时失效。
 */
export const SESSION_TTL_LONG_MS = 90 * 24 * 60 * 60 * 1000

/** 登录失败限流：同一来源连续失败达阈值，锁定一个窗口 */
export const LOGIN_MAX_FAILS = 8
export const LOGIN_WINDOW_MS = 10 * 60 * 1000

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 32

/* ---------------- 常量时间比较 ---------------- */

/** 长度不同直接判否（timingSafeEqual 对不等长会抛错） */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''))
  const bb = Buffer.from(String(b ?? ''))
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/* ---------------- 口令哈希 ---------------- */

/** 生成 `scrypt$N$saltB64$hashB64`，可直接写入 ADMIN_PASSWORD_HASH */
export function hashPassword(password, { N = SCRYPT_N, r = SCRYPT_R, p = SCRYPT_P } = {}) {
  const salt = randomBytes(16)
  const hash = scryptSync(String(password), salt, KEY_LEN, { N, r, p })
  return `scrypt$${N}$${salt.toString('base64')}$${hash.toString('base64')}`
}

/** 校验口令；stored 非法 / 缺失一律返回 false，不抛错 */
export function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$')
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false
  const N = Number(parts[1])
  if (!Number.isFinite(N) || N <= 0) return false
  let salt
  let expected
  try {
    salt = Buffer.from(parts[2], 'base64')
    expected = Buffer.from(parts[3], 'base64')
  } catch {
    return false
  }
  if (!salt.length || !expected.length) return false
  let actual
  try {
    actual = scryptSync(String(password), salt, expected.length, { N, r: SCRYPT_R, p: SCRYPT_P })
  } catch {
    return false
  }
  return safeEqual(actual, expected)
}

/* ---------------- 会话 token ---------------- */

function sign(body, secret) {
  return createHmac('sha256', String(secret)).update(body).digest('base64url')
}

/** 签发会话：token = base64url(payload) + '.' + base64url(HMAC) */
export function issueSession({ username, secret, ttl = SESSION_TTL_MS, now = Date.now() } = {}) {
  if (!secret) throw new Error('缺少会话签名密钥（AUTH_SECRET 或 SITES_ADMIN_KEY）')
  const payload = {
    sub: String(username || 'admin'),
    iat: now,
    exp: now + ttl,
    jti: randomBytes(9).toString('base64url'),
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return { token: `${body}.${sign(body, secret)}`, payload, expiresAt: payload.exp }
}

/** 验签 + 过期校验。reason 用于前端区分「过期」与「伪造」，便于提示。 */
export function verifySession(token, secret, now = Date.now()) {
  const raw = String(token || '')
  if (!secret) return { ok: false, reason: 'no-secret' }
  const dot = raw.lastIndexOf('.')
  if (dot <= 0 || dot === raw.length - 1) return { ok: false, reason: 'malformed' }
  const body = raw.slice(0, dot)
  if (!safeEqual(sign(body, secret), raw.slice(dot + 1))) return { ok: false, reason: 'bad-signature' }
  let payload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'))
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!payload || typeof payload.exp !== 'number') return { ok: false, reason: 'malformed' }
  if (now >= payload.exp) return { ok: false, reason: 'expired', payload }
  return { ok: true, username: payload.sub, expiresAt: payload.exp, payload }
}

/* ---------------- 配置与统一鉴权 ---------------- */

/**
 * 解析鉴权配置。
 * `loginReady` 表示能否走登录（需口令哈希 + 签名密钥齐备）；
 * `keyReady` 表示能否走共享密钥直连（CLI / 脚本路径）。
 * 签名密钥缺省回退到 SITES_ADMIN_KEY —— 让既有部署零配置即可用上会话能力。
 */
export function authConfig(env = process.env) {
  const secret = String(env.AUTH_SECRET || env.SITES_ADMIN_KEY || '')
  const passwordHash = String(env.ADMIN_PASSWORD_HASH || '')
  return {
    username: String(env.ADMIN_USERNAME || 'admin'),
    passwordHash,
    secret,
    loginReady: Boolean(passwordHash && secret),
    keyReady: Boolean(env.SITES_ADMIN_KEY),
  }
}

/** 从请求头取 Bearer 凭据 */
export function bearerOf(req) {
  const auth = (req && req.headers && req.headers.authorization) || ''
  const raw = String(auth)
  return /^Bearer\s+/i.test(raw) ? raw.replace(/^Bearer\s+/i, '').trim() : raw.trim()
}

/**
 * 受保护接口的统一鉴权：先按会话 token 验签，再回落比对共享密钥。
 * 返回 `{ ok: true, via, username }` 或 `{ ok: false, code, error }`（与既有调用方约定一致）。
 * `via` 用于审计区分「登录态」与「密钥直连」。
 */
export function checkAuthHeader(req, env = process.env, now = Date.now()) {
  const cfg = authConfig(env)
  if (!cfg.secret) return { ok: false, code: 500, error: '鉴权未配置：请设置 SITES_ADMIN_KEY（或 AUTH_SECRET）' }
  const token = bearerOf(req)
  if (!token) return { ok: false, code: 401, error: 'Unauthorized' }
  const session = verifySession(token, cfg.secret, now)
  if (session.ok) return { ok: true, via: 'session', username: session.username }
  if (cfg.keyReady && safeEqual(token, env.SITES_ADMIN_KEY)) return { ok: true, via: 'key', username: 'key' }
  return { ok: false, code: 401, error: 'Unauthorized' }
}

/* ---------------- 登录限流 ---------------- */

/** 读限流状态：返回 { locked, retryAfterMs, fails } */
export function loginLockState(entry, now = Date.now()) {
  const e = entry || {}
  if (!e.until || now >= e.until) return { locked: false, retryAfterMs: 0, fails: 0 }
  return { locked: true, retryAfterMs: e.until - now, fails: e.fails || 0 }
}

/** 记一次失败：窗口内累加，达阈值即锁定一个窗口 */
export function registerFail(entry, now = Date.now()) {
  const fresh = entry && now - (entry.ts || 0) < LOGIN_WINDOW_MS ? { ...entry } : { fails: 0, ts: now }
  fresh.fails = (fresh.fails || 0) + 1
  fresh.ts = now
  if (fresh.fails >= LOGIN_MAX_FAILS) fresh.until = now + LOGIN_WINDOW_MS
  return fresh
}