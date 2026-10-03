/**
 * 点击统计的云端落点：**全局聚合**每个站点的点击量。
 *
 * 与 `api/health.js` 同构（同样是「本机/访客产出事实 → 云端归一 → 前端只读」），
 * 但有一处关键差异：健康判定必须鉴权写（只由本机探活产出），而点击量是**访客行为**，
 * 只能匿名写。因此这里用「批量 + 钳制 + 尽力限流」把匿名写入的风险压到可控：
 *   GET  公开读：把全局点击量下发给前端（卡片角标 / 排行 / 后台看板的唯一来源）
 *   POST 匿名写：接收一批增量 `{ clicks: [{ id, n }] }`，**逐站点累加**后落 Blob
 *
 * 为什么是「累加」而不是「覆盖」：点击天然是增量，多个访客并发上报时覆盖会互相抹掉。
 * 因此这里读 → 加 → 写。Serverless 无共享状态，理论上存在并发丢更新（与 health 同源问题），
 * 但点击统计允许这种量级的误差，换取实现的简单与稳定。
 *
 * 写入前按当前站点集剔除：站点删除后其点击必须一起消失（同 health.js 的口径）。
 */
import { get, put } from '@vercel/blob'
import { normalizeIncrements, mergeClicks, tallyClicks, EMPTY_CLICKS } from '../shared/clicks-core.mjs'

const PATHNAME = 'ops/clicks.json'
const SITES_PATHNAME = 'sites.json'

/* ---------------- 尽力限流（单实例内存窗口，够挡住脚本刷量） ---------------- */

const RATE_WINDOW_MS = 60 * 1000
const RATE_MAX_WRITES = 60
const rateHits = new Map()

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  const raw = Array.isArray(fwd) ? fwd[0] : fwd
  return String(raw || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()
}

function rateLimited(ip, now = Date.now()) {
  const kept = (rateHits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS)
  if (kept.length >= RATE_MAX_WRITES) {
    rateHits.set(ip, kept)
    return true
  }
  kept.push(now)
  rateHits.set(ip, kept)
  // 兜底防内存膨胀：实例长期存活时清一次即可，限流精度不依赖它
  if (rateHits.size > 5000) rateHits.clear()
  return false
}

/* ---------------- Blob 读写 ---------------- */

async function readStored() {
  const blob = await get(PATHNAME, { access: 'private', useCache: false })
  if (!blob || !blob.stream) return null
  const text = await new Response(blob.stream).text()
  return JSON.parse(text)
}

/**
 * 当前站点集（运行时权威表在 Blob sites.json，不是部署包里的 sites-data.json）。
 * 读取失败返回 null，调用方据此跳过剔除 —— 判定宁可多留一条，也不能因读不到站点表清空统计。
 */
async function knownSiteIds() {
  try {
    const blob = await get(SITES_PATHNAME, { access: 'private', useCache: false })
    if (!blob || !blob.stream) return null
    const data = JSON.parse(await new Response(blob.stream).text())
    if (!Array.isArray(data.sites)) return null
    return new Set(data.sites.map(s => s.id))
  } catch {
    return null
  }
}

function readBody(req) {
  if (typeof req.body === 'string') return JSON.parse(req.body)
  if (req.body && typeof req.body.getReader === 'function') return new Response(req.body).json()
  return Promise.resolve(req.body || {})
}

function noStore(res) {
  // 点击量要尽量新鲜：禁用 CDN 缓存，每次读取都回源
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
}

export default async function handler(req, res) {
  noStore(res)

  if (req.method === 'GET') {
    try {
      const data = await readStored()
      if (data && data.clicks && typeof data.clicks === 'object') {
        res.status(200).json(data)
        return
      }
    } catch {
      // 未存储或读取失败：返回空统计，前端显示「暂无点击数据」
    }
    res.status(200).json(EMPTY_CLICKS)
    return
  }

  if (req.method === 'POST') {
    if (rateLimited(clientIp(req))) {
      res.status(429).json({ error: '上报过于频繁，请稍后再试' })
      return
    }

    let body
    try {
      body = await readBody(req)
    } catch {
      res.status(400).json({ error: 'Invalid JSON body' })
      return
    }

    const normalized = normalizeIncrements(body && body.clicks)
    if (!normalized.sites) { res.status(400).json({ error: 'clicks 中没有任何有效增量' }); return }

    let prev = null
    try { prev = await readStored() } catch { /* 首次写入，无前值 */ }
    const prevClicks = prev && prev.clicks && typeof prev.clicks === 'object' ? prev.clicks : {}

    const known = await knownSiteIds()
    const merged = mergeClicks(prevClicks, normalized.entries, { known })
    const counts = tallyClicks(merged)

    const data = {
      version: ((prev && Number(prev.version)) || 0) + 1,
      updatedAt: new Date().toISOString(),
      sites: counts.sites,
      total: counts.total,
      clicks: merged,
      patched: normalized.sites,
      added: normalized.total,
    }
    await put(PATHNAME, JSON.stringify(data), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    })
    res.status(200).json(data)
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}