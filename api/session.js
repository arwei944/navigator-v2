/**
 * 会话数据同步 API（替代失效的 KV 云同步）
 * 独立于站点数据（sites.json），仅同步个人会话数据：收藏/待办/访问记录/偏好。
 * 以用户自定义的 session key 为隔离名，实现多设备一致。
 *
 * GET  /api/session?key=xxx          → 读取该会话快照
 * POST /api/session                  → body: { key, data }
 *
 * 鉴权：数据按 session key 隔离，key 即访问凭证（个人导航站，未下发管理密钥到浏览器）。
 * Blob 路径: session/<key>.json
 */
import { get, put } from '@vercel/blob'

function sanitizeKey(key) {
  // 仅允许字母数字-_ 等安全字符，防路径穿越
  return String(key || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
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
      const key = req.query.key || ''
      const data = await readSession(key)
      if (!data) {
        res.status(200).json({ version: 0, data: null, updatedAt: null })
        return
      }
      res.status(200).json({ version: data.version || 0, data: data.data || null, updatedAt: data.updatedAt || null })
      return
    }

    if (req.method === 'POST') {
      // 解析 body
      let body
      if (typeof req.body === 'string') body = JSON.parse(req.body)
      else if (req.body && typeof req.body.getReader === 'function') body = await new Response(req.body).json()
      else body = req.body

      const { key, data } = body || {}
      // 数据按 session key 隔离，key 即访问凭证（个人导航站不下发管理员密钥到浏览器）
      const name = sanitizeKey(key)
      if (!name || !data || typeof data !== 'object') {
        res.status(400).json({ error: 'Invalid session payload' })
        return
      }

      // 读旧快照，字段级合并：客户端传 replace 标记的字段整覆盖，否则合并对象
      const prev = await readSession(name)
      const prevData = (prev && prev.data) || {}
      const merged = { ...prevData }
      for (const [field, value] of Object.entries(data)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          // 对象字段深合并
          merged[field] = { ...(prevData[field] || {}), ...value }
        } else {
          merged[field] = value
        }
      }

      const version = (prev && prev.version ? prev.version : 0) + 1
      const snapshot = {
        version,
        data: merged,
        updatedAt: new Date().toISOString()
      }
      await put(`session/${name}.json`, JSON.stringify(snapshot), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true
      })
      res.status(200).json({ version, updatedAt: snapshot.updatedAt, fields: Object.keys(merged) })
      return
    }

    res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    res.status(500).json({ error: 'Session error: ' + e.message })
  }
}