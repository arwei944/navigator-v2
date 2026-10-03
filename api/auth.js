/**
 * 管理后台登录认证：用户名 + 口令 → 有期限的签名会话 token。
 *
 * GET  /api/auth                → { ok, loginReady, keyReady }（不鉴权；前端据此决定显示登录表单还是密钥直连）
 * POST /api/auth {action:login}  → 校验口令，签发会话 token
 * POST /api/auth {action:verify} → 校验 Bearer 凭据是否仍有效（前端进入后台时自检）
 * POST /api/auth {action:logout} → 无状态会话，服务端仅确认；客户端自行丢弃 token
 *
 * 限流是 best-effort：落 Blob 记录失败次数，Blob 不可用时**放行但仍走口令校验** ——
 * 不能因为限流组件故障就把管理员挡在门外。scrypt 本身约 100ms 的计算开销
 * 也构成一道天然的暴力破解成本。
 */
import { get, put } from '@vercel/blob'
import {
  authConfig, verifyPassword, issueSession, verifySession,
  bearerOf, safeEqual, loginLockState, registerFail, SESSION_TTL_MS, SESSION_TTL_LONG_MS,
} from '../shared/auth.mjs'
import { normalizeEntry } from '../shared/ops/audit-core.mjs'

const ATTEMPTS_PATH = 'ops/auth-attempts.json'
const AUDIT_PATH = 'ops/audit.json'
const AUDIT_KEEP = 2000

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
}

function readBody(req) {
  if (typeof req.body === 'string') return JSON.parse(req.body)
  if (req.body && typeof req.body.getReader === 'function') return new Response(req.body).json()
  return Promise.resolve(req.body || {})
}

/** 取来源 IP：Vercel 走 x-forwarded-for，本地直连回落 socket */
function clientIp(req) {
  const headers = (req && req.headers) || {}
  const fwd = headers['x-forwarded-for'] || headers['x-real-ip'] || ''
  const first = String(fwd).split(',')[0].trim()
  return first || (req && req.socket && req.socket.remoteAddress) || 'unknown'
}

async function readAttempts() {
  try {
    const blob = await get(ATTEMPTS_PATH, { access: 'private', useCache: false })
    if (!blob || !blob.stream) return {}
    const data = JSON.parse(await new Response(blob.stream).text())
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch {
    return {}
  }
}

async function writeAttempts(map) {
  try {
    await put(ATTEMPTS_PATH, JSON.stringify(map), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    })
  } catch {
    /* 限流落盘失败不阻断登录 */
  }
}

/**
 * 登录事件审计：与 `api/ops.js` 落在同一个 `ops/audit.json`（同一套 normalizeEntry 结构）。
 * 必须在服务端记录 —— 客户端埋点可以跳过，登录这类安全事件不能。
 * 依旧是旁路：写失败只吞掉，绝不把管理员挡在门外。
 */
async function appendAudit(input) {
  try {
    let items = []
    try {
      const blob = await get(AUDIT_PATH, { access: 'private', useCache: false })
      if (blob && blob.stream) {
        const data = JSON.parse(await new Response(blob.stream).text())
        if (Array.isArray(data)) items = data
      }
    } catch {
      /* 首次写入 / 读取失败都从空开始，不阻断 */
    }
    await put(AUDIT_PATH, JSON.stringify([normalizeEntry(input), ...items].slice(0, AUDIT_KEEP)), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    })
  } catch {
    /* 旁路 */
  }
}

export default async function handler(req, res) {
  noStore(res)
  const cfg = authConfig()

  if (req.method === 'GET') {
    res.status(200).json({ ok: true, loginReady: cfg.loginReady, keyReady: cfg.keyReady, username: cfg.username })
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' })
    return
  }

  let body
  try {
    body = await readBody(req)
  } catch {
    res.status(400).json({ ok: false, error: 'Invalid JSON body' })
    return
  }
  const action = String((body && body.action) || '')

  if (action === 'verify') {
    const token = bearerOf(req)
    const session = verifySession(token, cfg.secret)
    if (session.ok) {
      res.status(200).json({ ok: true, valid: true, via: 'session', username: session.username, expiresAt: session.expiresAt })
      return
    }
    if (cfg.keyReady && safeEqual(token, process.env.SITES_ADMIN_KEY)) {
      res.status(200).json({ ok: true, valid: true, via: 'key', username: 'key', expiresAt: null })
      return
    }
    res.status(200).json({ ok: true, valid: false, reason: session.reason })
    return
  }

  if (action === 'logout') {
    // 无状态会话：服务端没有可撤销的记录，登出即客户端丢弃 token。
    // 保留此动作是为了让前端/审计有明确语义，也为将来加吊销表留出接口。
    res.status(200).json({ ok: true })
    return
  }

  if (action === 'login') {
    if (!cfg.loginReady) {
      res.status(500).json({
        ok: false,
        error: cfg.secret
          ? '未配置登录口令：请设置 ADMIN_PASSWORD_HASH（可用 npm run auth:hash 生成）'
          : '鉴权未配置：请设置 SITES_ADMIN_KEY 或 AUTH_SECRET',
      })
      return
    }

    const ip = clientIp(req)
    const username = String((body && body.username) || '').trim()
    const password = String((body && body.password) || '')

    const attempts = await readAttempts()
    const lock = loginLockState(attempts[ip])
    if (lock.locked) {
      await appendAudit({
        action: 'auth.lockout',
        target: username || '(空)',
        result: 'rejected',
        detail: `来源 ${ip} · 窗口内已失败 ${lock.fails} 次`,
        actor: username || 'anonymous',
      })
      res.status(429).json({
        ok: false,
        error: `登录失败次数过多，请约 ${Math.ceil(lock.retryAfterMs / 60000)} 分钟后再试`,
        retryAfterMs: lock.retryAfterMs,
      })
      return
    }

    // 两个校验都无条件执行：避免用「用户名错就提前返回」的计时差枚举出管理员账号
    const userOk = safeEqual(username, cfg.username)
    const passOk = verifyPassword(password, cfg.passwordHash)

    if (!userOk || !passOk) {
      const next = registerFail(attempts[ip])
      await writeAttempts({ ...attempts, [ip]: next })
      await appendAudit({
        action: 'auth.loginFail',
        target: username || '(空)',
        result: 'fail',
        detail: `来源 ${ip} · 连续失败 ${next.fails} 次`,
        actor: username || 'anonymous',
      })
      res.status(401).json({ ok: false, error: '用户名或口令不正确' })
      return
    }

    if (attempts[ip]) {
      const next = { ...attempts }
      delete next[ip]
      await writeAttempts(next)
    }

    // 「记住此设备」只影响会话有效期，不影响鉴权强度（口令仍是 scrypt 哈希）
    const remember = Boolean(body && body.remember)
    const ttl = remember ? SESSION_TTL_LONG_MS : SESSION_TTL_MS
    const { token, expiresAt } = issueSession({ username: cfg.username, secret: cfg.secret, ttl })
    await appendAudit({
      action: 'auth.login',
      target: cfg.username,
      result: 'ok',
      detail: `来源 ${ip} · 有效期 ${remember ? '90 天（记住此设备）' : '7 天'}`,
      actor: cfg.username,
    })
    res.status(200).json({ ok: true, token, username: cfg.username, expiresAt, ttl, remember })
    return
  }

  res.status(400).json({ ok: false, error: `未知动作：${action || '(空)'}` })
}