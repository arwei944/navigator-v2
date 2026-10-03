/**
 * 站点可用性判定的云端落点。
 *
 * 判定必须由**本机代理环境**产出（`shared/health-probe.mjs` 走 curl.exe），
 * 不能由浏览器或云端直连产出 —— 浏览器读不到跨域状态码，云端出网口在海外、
 * 与本机代理环境的可达性不是一回事。因此这里的职责只有两件：
 *   GET  公开读：把最近一次本机判定下发给前端（状态角标 / 失效清单的唯一来源）
 *   POST 鉴权写：接收本机探活结果，**按 code 重算 status** 后落 Blob
 *
 * 为什么要重算：客户端只提供事实（HTTP 码），不提供结论。
 * 这样即便某个旧版控制台/脚本用了过时口径，也不会把「限流」写成「失效」污染全站角标。
 */
import { get, put } from '@vercel/blob'
import { verdictOf, tally } from '../shared/health-rules.mjs'
import { checkAuthHeader } from '../shared/auth.mjs'

const PATHNAME = 'ops/health.json'
const SITES_PATHNAME = 'sites.json'
const MAX_RESULTS = 3000

const EMPTY = {
  version: 0,
  updatedAt: null,
  actor: '',
  proxy: '',
  counts: { total: 0, ok: 0, limited: 0, down: 0 },
  results: {},
}

async function readStored() {
  // useCache:false 绕过 Blob CDN 缓存：发布后首次读取即拿到最新判定
  const blob = await get(PATHNAME, { access: 'private', useCache: false })
  if (!blob || !blob.stream) return null
  const text = await new Response(blob.stream).text()
  return JSON.parse(text)
}

/**
 * 当前站点集（运行时权威表在 Blob sites.json，不是部署包里的 sites-data.json ——
 * 控制台可只做热更新而不重新部署，用部署包会漏掉刚新增的站点）。
 *
 * 读取失败返回 null，调用方据此**跳过剔除**：判定宁可多留一条，也不能因为
 * 读不到站点表就把整份判定清空。
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
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    noStore(res)
    try {
      const data = await readStored()
      if (data && data.results && Object.keys(data.results).length) {
        res.status(200).json(data)
        return
      }
    } catch {
      // 未存储或读取失败：返回空判定，前端据此显示「未探测」而不是报错
    }
    res.status(200).json(EMPTY)
    return
  }

  if (req.method === 'POST') {
    const auth = checkAuthHeader(req)
    if (!auth.ok) { res.status(auth.code).json({ error: auth.error }); return }

    let body
    try {
      body = await readBody(req)
    } catch {
      res.status(400).json({ error: 'Invalid JSON body' })
      return
    }

    const raw = Array.isArray(body.results) ? body.results : null
    if (!raw || raw.length === 0) { res.status(400).json({ error: 'Invalid results payload' }); return }
    if (raw.length > MAX_RESULTS) { res.status(400).json({ error: `results 超过上限 ${MAX_RESULTS} 条` }); return }

    const incoming = {}
    for (const r of raw) {
      const id = String((r && r.id) || '').trim()
      if (!id) continue
      const code = String(r.code == null || r.code === '' ? 'ERR' : r.code).trim() || 'ERR'
      const ms = Number(r.ms)
      incoming[id] = { code, status: verdictOf(code), ms: Number.isFinite(ms) ? Math.round(ms) : null }
    }
    const ids = Object.keys(incoming)
    if (!ids.length) { res.status(400).json({ error: 'results 中没有任何带 id 的记录' }); return }

    let prev = null
    try { prev = await readStored() } catch { /* 首次写入，无前值 */ }
    const prevResults = prev && prev.results && typeof prev.results === 'object' ? prev.results : {}

    // 合并而非整体覆盖：控制台 / CLI 都支持「只探某几个站点」（--ids / --limit），
    // 覆盖式写入会让没被探到的站点集体退回「未探测」，比不发布更糟。
    // 合并之后再按当前站点集剔除：站点删除后其判定必须一起消失，否则残留条目会
    // 被 counts 计入，也可能被未来同 id 的新站点继承（合并写入本身只增不删）。
    const known = await knownSiteIds()
    const merged = {}
    for (const [id, r] of Object.entries({ ...prevResults, ...incoming })) {
      if (!known || known.has(id)) merged[id] = r
    }
    const version = ((prev && Number(prev.version)) || 0) + 1

    const data = {
      version,
      updatedAt: new Date().toISOString(),
      actor: String(body.actor || auth.via || 'unknown').slice(0, 40),
      proxy: String(body.proxy || '').slice(0, 120),
      counts: { total: Object.keys(merged).length, ...tally(Object.values(merged)) },
      results: merged,
      patched: ids.length,
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