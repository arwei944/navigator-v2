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
 * 因此这里读 → 加 → 写。
 *
 * ## 并发保护（CAS + 重试）
 *
 * 旧实现是无条件 `put`，两个访客同时上报时会静默丢一方的增量 —— 注释里写着
 * 「允许这种量级误差」。但项目已有 CAS 能力（`server/store.mjs` 的 `ifMatch`），
 * `api/sites.js` 一直在用，这里没有理由例外：点击量是「热度排行」的唯一依据，
 * 静默丢更新会让排行榜长期低估，且没有任何征兆。
 *
 * 现在读到的 etag 会作为 `ifMatch` 传回；冲突（409）则重读重算，最多重试 RETRIES 次。
 * 仍失败时**返回 409 而不写**：宁可让前端下次重试（pending 队列会保留），
 * 也不要写入一份基于过期快照的数据。
 *
 * 写入前按当前站点集剔除：站点删除后其点击必须一起消失（同 health.js 的口径）。
 */
import { get, put } from '#store'
import { checkAuthHeader } from '../shared/auth.mjs'
import { normalizeIncrements, mergeClicks, tallyClicks, applySeries, filterSeries, EMPTY_CLICKS } from '../shared/clicks-core.mjs'

const PATHNAME = 'ops/clicks.json'
const SITES_PATHNAME = 'sites.json'

/* ---------------- 尽力限流（单实例内存窗口，够挡住脚本刷量） ---------------- */

const RATE_WINDOW_MS = 60 * 1000
const RATE_MAX_WRITES = 60
/** 受限流跟踪的 IP 上限。超出时淘汰**最久未出现**的，而不是清空。 */
const RATE_MAX_IPS = 5000
const rateHits = new Map()

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  const raw = Array.isArray(fwd) ? fwd[0] : fwd
  return String(raw || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()
}

/**
 * 淘汰最久未活动的 IP，而不是 `clear()` 全部清空。
 *
 * 旧实现是 `if (rateHits.size > 5000) rateHits.clear()` —— 任何能构造 5000 个不同
 * 来源的请求者都能在触发清空的瞬间让**所有** IP 的计数归零，等于给刷量脚本开了后门。
 * 现在改为淘汰最久未出现的那一个：容量有界，但不会牵连其他 IP 的计数。
 */
function evictOldest() {
  let oldestIp = null
  let oldestAt = Infinity
  for (const [ip, times] of rateHits) {
    const last = times.length ? times[times.length - 1] : 0
    if (last < oldestAt) { oldestAt = last; oldestIp = ip }
  }
  if (oldestIp !== null) rateHits.delete(oldestIp)
}

function rateLimited(ip, now = Date.now()) {
  const kept = (rateHits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS)
  if (kept.length >= RATE_MAX_WRITES) {
    rateHits.set(ip, kept)
    return true
  }
  kept.push(now)
  // 重新插入以获得 Map 的自然顺序（越靠前 = 越久未更新）
  rateHits.delete(ip)
  rateHits.set(ip, kept)
  while (rateHits.size > RATE_MAX_IPS) evictOldest()
  return false
}

/* ---------------- Blob 读写（带 etag，供 CAS 使用） ---------------- */

/** CAS 冲突时的重试次数。点击是高频低价值写，重试 3 次足够消化正常并发。 */
const CAS_RETRIES = 3

/**
 * 读存储，同时返回 etag。
 * etag 有两个位置（适配层给 `blob.blob.etag`，Vercel Blob 给 `blob.etag`），
 * 与 `api/sites.js` 的取值口径保持一致。
 */
async function readStoredWithEtag() {
  const blob = await get(PATHNAME, { access: 'private', useCache: false })
  if (!blob || !blob.stream) return { data: null, etag: null }
  const text = await new Response(blob.stream).text()
  const etag = (blob.blob && blob.blob.etag) || blob.etag || null
  return { data: JSON.parse(text), etag }
}

/** 只要数据的简化读法（GET 路径用，不需要 etag） */
async function readStored() {
  const { data } = await readStoredWithEtag()
  return data
}

/** CAS 冲突判定：适配层抛的是 BlobPreconditionFailedError，按名字判以免强依赖类身份 */
function isPreconditionFailed(e) {
  return e?.name === 'BlobPreconditionFailedError' || e?.status === 412 || e?.statusCode === 412
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

    const known = await knownSiteIds()

    /*
     * 读 → 算 → CAS 写，冲突则重读重算。
     * 每次重试都必须重新读：拿旧快照重算只会算出同一份过期结果。
     */
    for (let attempt = 0; attempt < CAS_RETRIES; attempt += 1) {
      let prev = null
      let etag = null
      try {
        const r = await readStoredWithEtag()
        prev = r.data
        etag = r.etag
      } catch {
        // 读失败按「首次写入」处理；此时 etag 为 null，下面会用 createOnly 兜底
      }

      const prevClicks = prev && prev.clicks && typeof prev.clicks === 'object' ? prev.clicks : {}
      const merged = mergeClicks(prevClicks, normalized.entries, { known })
      const counts = tallyClicks(merged)

      // 时间分桶与累计值同源同步：都用同一份 known 剔除、都在这一次写入里落库。
      // 分成两次写会出现「有总数没趋势」的中间态，趋势图就得为它写降级分支。
      const prevSeries = prev && prev.series && typeof prev.series === 'object' ? prev.series : {}
      const series = filterSeries(applySeries(prevSeries, normalized.entries, { today: new Date() }), known)

      const data = {
        version: ((prev && Number(prev.version)) || 0) + 1,
        updatedAt: new Date().toISOString(),
        sites: counts.sites,
        total: counts.total,
        clicks: merged,
        series,
        patched: normalized.sites,
        added: normalized.total,
      }

      try {
        await put(PATHNAME, JSON.stringify(data), {
          access: 'private',
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: 'application/json',
          // 有 etag 走条件写；没有（首次写入）走 createOnly，防止并发首写互相覆盖
          ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
        })
        res.status(200).json(data)
        return
      } catch (e) {
        if (isPreconditionFailed(e) && attempt < CAS_RETRIES - 1) continue
        // 重试用尽仍冲突：不写，让前端的 pending 队列下次再发（比写入过期快照安全）
        res.status(409).json({ error: '点击数据并发写入冲突，请稍后重试', retryable: true })
        return
      }
    }
    return
  }

  /*
   * DELETE：管理员清空全部点击统计。
   *
   * 为什么需要这个端点：POST 是匿名写入，只能累加，没有任何合法途径把脏数据或
   * 测试数据清掉。而点击量是「热度排行」的唯一依据 —— 口径错了没有别的办法纠正，
   * 只能手工改存储。加一个受鉴权的清空入口，比留一条「改数据靠人肉」的暗路更安全。
   *
   * 鉴权走既有的 `checkAuthHeader`（与 api/health.js 同一套），不是新造机制。
   * 匿名请求一律 401，不做「先清空再报错」这种危险顺序。
   */
  if (req.method === 'DELETE') {
    const auth = checkAuthHeader(req)
    if (!auth?.ok) {
      res.status(401).json({ error: '需要管理员鉴权才能清空点击统计' })
      return
    }
    try {
      await put(PATHNAME, JSON.stringify(EMPTY_CLICKS), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
      })
      res.status(200).json({ ok: true, ...EMPTY_CLICKS })
    } catch (e) {
      res.status(500).json({ error: `清空失败：${e.message}` })
    }
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}