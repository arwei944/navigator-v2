import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { get, put } from '@vercel/blob'

// 数据真相源：Vercel Blob 上的 sites.json（运行时权威数据）。
// 以下 SEED_SITES 仅作为 Blob 为空时的本地兜底，由 scripts/publish.mjs 保持与 Blob 同步，
// 不做每天都写入。本地 api/sites-data.json 是 SEED + 发布源。
const SEED_SITES = JSON.parse(
  readFileSync(fileURLToPath(new URL('./sites-data.json', import.meta.url)), 'utf-8')
)

const PATHNAME = 'sites.json'

async function readStored() {
  const blob = await get(PATHNAME, { access: 'private' })
  if (!blob || !blob.stream) return null
  const text = await new Response(blob.stream).text()
  return JSON.parse(text)
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // 关键：禁止 CDN 缓存，确保每次轮询都回源读最新数据，实现真正的实时热更新
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')

    try {
      const data = await readStored()
      if (data && Array.isArray(data.sites) && data.sites.length > 0) {
        res.status(200).json(data)
        return
      }
    } catch {
      // 未存储或读取失败时使用本地种子兜底
    }

    const seeded = {
      version: 1,
      sites: SEED_SITES,
      updatedAt: new Date().toISOString()
    }
    await put(PATHNAME, JSON.stringify(seeded), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true
    })
    res.status(200).json(seeded)
    return
  }

  if (req.method === 'POST') {
    const adminKey = process.env.SITES_ADMIN_KEY
    if (!adminKey) {
      res.status(500).json({ error: 'SITES_ADMIN_KEY not configured' })
      return
    }

    // 鉴权走请求头，不在请求体明文携带管理密钥
    const auth = (req.headers && req.headers.authorization) || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth.trim()

    let body
    if (typeof req.body === 'string') {
      body = JSON.parse(req.body)
    } else if (req.body && typeof req.body.getReader === 'function') {
      body = await new Response(req.body).json()
    } else {
      body = req.body
    }
    const { sites } = body

    if (token !== adminKey) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    if (!Array.isArray(sites) || sites.length === 0) {
      res.status(400).json({ error: 'Invalid sites payload' })
      return
    }

    let version = 1
    try {
      const prev = await readStored()
      if (prev && prev.version) version = prev.version + 1
    } catch {
      // 首次发布，版本从 1 开始
    }

    const data = {
      version,
      sites,
      updatedAt: new Date().toISOString()
    }
    await put(PATHNAME, JSON.stringify(data), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true
    })
    res.status(200).json(data)
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
