/**
 * 会话数据同步 API（替代失效的 KV 云同步）
 * 独立于站点数据（sites.json），仅同步个人会话数据：收藏/待办/访问记录/偏好。
 * 以用户自定义的 session key 为隔离名，实现多设备一致。
 *
 * GET  /api/session   → 读取该会话快照     （key 走 Authorization: Bearer <key>）
 * POST /api/session   → body: { data }     （key 同上，体里不再带 key）
 *
 * 鉴权：数据按 session key 隔离，key 即访问凭证（个人导航站，未下发管理密钥到浏览器）。
 *
 * 为什么 key 必须走请求头而不是 query string：
 *   query 会进入 Vercel 函数日志、CDN 日志、浏览器历史、以及跨站请求的 Referer。
 *   key 是这份数据的唯一凭证，出现在任何一条日志里都等于长期泄露。
 *   旧的 `?key=` 写法已停用 —— 前端与后端同批发布，PWA 会自动更新，残留的旧页面
 *   会收到 400 与明确的「请刷新页面」提示，不会静默失效。
 *
 * 体积门禁：写入前既看 `content-length` 也看合并后的实际大小。这条是「任何人可无限次
 * POST 任意大小 JSON 灌满 Blob」的正解 —— 限流是 best-effort，体积上限是硬门禁。
 */
import { get, put } from '@vercel/blob'

/**
 * 单次写入的体量上限。
 *
 * 256KB 是「只有收藏/待办/历史/偏好」时期定的；v8 起会话里多了站点备注与便利贴
 * （各限 80KB，见 utils/noteSync.js#LIMITS），再加上历史与偏好就顶到边了，故放宽到 512KB。
 * 客户端在推送前会先自检（见 SessionSyncSection 的配额检查），
 * 这里的门禁是最后一道：任何人可无限次 POST，限流只能 best-effort，体积上限才是硬的。
 */
const MAX_BODY_BYTES = 512 * 1024
const MAX_KEY_LEN = 64

/* 写入限流：per-instance，best-effort。诚实说明边界 —— serverless 是多实例的，
 * 这个 Map 只活在一个热实例里，因此它挡的是「同一个实例上被连打」，不是分布式限流。
 * 做分布式限流得每次请求都写一次 Blob，代价远大于收益（会话同步本就低频）。 */
const RL_WINDOW_MS = 60_000
const RL_MAX_PER_WINDOW = 30
const rlHits = new Map()

function clientIp(req) {
  const headers = (req && req.headers) || {}
  const fwd = headers['x-forwarded-for'] || headers['x-real-ip'] || ''
  const first = String(fwd).split(',')[0].trim()
  return first || (req && req.socket && req.socket.remoteAddress) || 'unknown'
}

function rateLimited(ip) {
  const now = Date.now()
  const hits = (rlHits.get(ip) || []).filter(t => now - t < RL_WINDOW_MS)
  if (hits.length >= RL_MAX_PER_WINDOW) { rlHits.set(ip, hits); return true }
  hits.push(now)
  rlHits.set(ip, hits)
  if (rlHits.size > 2000) {
    for (const [k, v] of rlHits) if (!v.some(t => now - t < RL_WINDOW_MS)) rlHits.delete(k)
  }
  return false
}

/** 仅允许字母数字-_ 等安全字符，防路径穿越 */
function sanitizeKey(key) {
  return String(key || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, MAX_KEY_LEN)
}

/** 从 Authorization 头取 key；**不再接受 query** */
function keyOf(req) {
  const auth = String((req.headers && req.headers.authorization) || '')
  const m = auth.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : ''
}

function tooBig(req) {
  const len = Number((req.headers && req.headers['content-length']) || 0)
  return Number.isFinite(len) && len > MAX_BODY_BYTES
}

async function readSession(key) {
  if (!key) return null
  const name = sanitizeKey(key)
  if (!name) return null
  try {
    const blob = await get(`session/${name}.json`, { access: 'private' })
    if (!blob || !blob.stream) return null
    const text = await new Response(blob.stream).text()
    return JSON.parse(text)
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
      const key = keyOf(req)
      if (!key && req.query && req.query.key) {
        res.status(400).json({ error: '会话凭据已改为 Authorization 头，请刷新页面', reason: 'key-in-query-removed' })
        return
      }
      const data = await readSession(key)
      if (!data) {
        res.status(200).json({ version: 0, data: null, updatedAt: null })
        return
      }
      res.status(200).json({ version: data.version || 0, data: data.data || null, updatedAt: data.updatedAt || null })
      return
    }

    if (req.method === 'POST') {
      const key = keyOf(req)
      // 同上：旧的「key 放 body」写法一并停用，避免凭据散落在请求体里被日志采到
      if (!key) {
        res.status(400).json({ error: '缺少会话凭据（Authorization: Bearer <key>）', reason: 'key-header-required' })
        return
      }
      if (tooBig(req)) {
        res.status(413).json({ error: `请求体过大（上限 ${Math.round(MAX_BODY_BYTES / 1024)}KB）` })
        return
      }
      const ip = clientIp(req)
      if (rateLimited(ip)) {
        res.setHeader('Retry-After', '60')
        res.status(429).json({ error: '写入过于频繁，请稍后再试' })
        return
      }

      // 解析 body
      let body
      if (typeof req.body === 'string') {
        if (Buffer.byteLength(req.body) > MAX_BODY_BYTES) { res.status(413).json({ error: '请求体过大' }); return }
        body = JSON.parse(req.body)
      } else if (req.body && typeof req.body.getReader === 'function') {
        body = await new Response(req.body).json()
      } else {
        body = req.body
      }

      // key 只认请求头：旧的「key 放请求体」写法一并停用 —— 凭据散落在请求体里
      // 同样会被日志/抓包采到，留一条兼容路径等于把刚去掉的问题又请回来。
      const name = sanitizeKey(key)
      const data = body && body.data
      if (!name || !data || typeof data !== 'object' || Array.isArray(data)) {
        res.status(400).json({ error: 'Invalid session payload', reason: 'key-header-required' })
        return
      }

      // 读旧快照，字段级合并：客户端传 replace 标记的字段整覆盖，否则合并对象
      const prev = await readSession(name)
      const prevData = (prev && prev.data) || {}
      const merged = { ...prevData }
      for (const [field, value] of Object.entries(data)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          merged[field] = { ...(prevData[field] || {}), ...value }
        } else {
          merged[field] = value
        }
      }

      const version = (prev && prev.version ? prev.version : 0) + 1
      const snapshot = { version, data: merged, updatedAt: new Date().toISOString() }
      const payload = JSON.stringify(snapshot)

      // 合并后的**实际**大小才是真门禁：单看 content-length 挡不住「多次小写入把快照喂大」
      if (Buffer.byteLength(payload) > MAX_BODY_BYTES) {
        res.status(413).json({
          error: `合并后的会话数据超过上限（${Math.round(MAX_BODY_BYTES / 1024)}KB），请清理收藏/历史后再同步`,
        })
        return
      }

      await put(`session/${name}.json`, payload, {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
      })
      res.status(200).json({ version, updatedAt: snapshot.updatedAt, fields: Object.keys(merged) })
      return
    }

    res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    res.status(500).json({ error: 'Session error: ' + e.message })
  }
}
