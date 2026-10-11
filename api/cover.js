/**
 * 封面图服务（P3）。
 *
 * ## 形态：按需抓取 + 落盘缓存，而不是在补全时抓
 *
 * 在 `/api/metadata` 里顺手抓封面有三个问题：① 每次补全都多一次下载，而补全本来就慢；
 * ② 抓下来的图没地方放（补全结果不落库）；③ 失败会污染补全响应。
 * 所以拆成独立的 `GET /api/cover?site=<id>`：卡片要用时才来一次，命中本地缓存直接回字节。
 *
 * ## 为什么服务端下载而不是前端热链
 *
 *  - 防盗链：大量 CDN 对 Referer 敏感的站点会给热链返回 403 或占位图。
 *  - 不泄漏用户：热链会把访问者的浏览器暴露给对方的统计系统。
 *  - 稳定：对方今天给图、明天换掉，卡片不会一夜之间全变样。
 *
 * ## 安全
 *
 *  - 目标地址**只能来自站点表**，不接受调用方传任意 URL —— 否则这就是个开放代理。
 *  - 两跳出网都走 `fetchCapped`：字面主机名拦截 + pinned lookup 防 DNS rebinding。
 *  - 体积封顶 1.5MB、只认 image/*；非图片一律当「没有封面」。
 *
 * ## 缓存
 *
 *  - 图片落 `data/covers/<siteId>.<ext>`；「这站没有封面」落 `data/covers/<siteId>.none`
 *    作负缓存，省得每次滚动都重抓一遍（没有封面是最常见的情况）。
 *  - 命中缓存的响应带一年 immutable：卡片反复渲染不会重复下载。
 *  - 没有封面回 204，卡片 `onerror` 隐藏图层，降级到原有图标 / 字母块。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { get, put } from '#store'
import { fetchCapped } from '../shared/http-fetch.mjs'
import { pickCoverPrefer, decodeHtmlBytes } from '../shared/site-infer.mjs'

const ROOT = dirname(fileURLToPath(import.meta.url))
const COVER_DIR = join(ROOT, 'data', 'covers')
const MAX_BYTES = 1.5 * 1024 * 1024
const PAGE_MAX_BYTES = 256 * 1024
/**
 * 超时**刻意压得很紧**（页面 3.5s + 图片 3.5s）。原因：发布沙箱每个请求一个新进程，
 * 请求处理太久进程会在响应前被回收（实测：抓 GitHub 首页 8s 超时的请求，
 * 客户端拿到的是空响应而不是 204）。所以这条链路只能赌「快」：
 * 快的站直接拿到图，慢的站回 204 降级 —— 反正封面本来就允许没有。
 */
/**
 * 超时与跳数都卡得很死（单跳 2.2s、最多 1 跳、图片 2.5s）。
 *
 * 这是被平台逼出来的：沙箱每请求一个新进程，**处理超过几秒的请求会在响应前被回收**
 *（实测：抓 GitHub 首页的请求，客户端拿到的是空响应，不是 204）。
 * 所以这条链路的选择只有两个 —— 快速给答案，或者根本没答案。
 * 快速失败 + 负缓存（`<id>.none`）意味着：第一次慢就记下「这站没封面」，
 * 卡片下次直接拿 204，不再拖累任何一次交互。封面本来就是锦上添花。
 */
const HOP_TIMEOUT_MS = 2200
const MAX_HOPS = 1
const IMAGE_TIMEOUT_MS = 2500
const UA = 'Mozilla/5.0 (compatible; NavigatorCoverBot/1.0)'

const EXTS = [
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.avif', 'image/avif'],
  ['.svg', 'image/svg+xml'],
]
const EXT_BY_MIME = Object.fromEntries(EXTS.map(([ext, mime]) => [mime, ext]))

/** 站点 id 会拼进文件名，只允许安全字符 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

function ensureDir() {
  if (!existsSync(COVER_DIR)) mkdirSync(COVER_DIR, { recursive: true })
}

function readText(pathname) {
  const blob = get(pathname, { access: 'private' })
  return blob.then(
    b => (b && b.stream ? new Response(b.stream).text() : ''),
    () => ''
  ).then(t => { try { return JSON.parse(t) } catch { return null } })
}

function cachedCover(siteId) {
  for (const [ext, mime] of EXTS) {
    const p = join(COVER_DIR, siteId + ext)
    if (existsSync(p)) return { path: p, mime }
  }
  return null
}

function hasNegativeCache(siteId) {
  return existsSync(join(COVER_DIR, siteId + '.none'))
}

function markNoCover(siteId) {
  try { writeFileSync(join(COVER_DIR, siteId + '.none'), 'none') } catch { /* 写不了就算了，下次重抓 */ }
}

function sendImage(res, file) {
  let body = null
  try { body = readFileSync(file.path) } catch { body = null }
  if (!body) { res.status(404).end(); return }
  res.setHeader('Content-Type', file.mime)
  res.setHeader('Content-Length', String(body.length))
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  res.end(body)
}

/** 最近一次抓取的诊断信息（`/api/cover?site=x&debug=1` 会回它）—— 出问题时唯一能看的线索 */
export const coverDebug = { siteId: '', pageUrl: '', stage: '', pageStatus: 0, contentType: '', coverHref: '', imageStatus: 0, imageMime: '', reason: '', at: 0 }

/**
 * 抓页面（**手动跟重定向**，最多 3 跳）。
 *
 * 为什么不用自动跟随：`fetchCapped` 刻意**不跟**重定向 —— 自动跟随会把请求带到
 * 未校验的目标，绕过 SSRF 防护（这层是公网可触达端点的底线）。代价是：绝大多数站点
 * 会 301/302 到规范地址（apex→www、http→https、语言前缀），于是拿到一个空 body、
 * 解析不出任何 meta —— 实测命中率只有 1/10。
 *
 * 所以自己跟：每一跳都用 fetchCapped 重新校验目标（内网/本机照样被拦），
 * 只接受 http(s) 的 Location，并保留相对地址的解析基准。
 *
 * 只跟 1 跳：多跳在慢站上会把请求拖到「拿不到响应」的长度，而多出来的封面收益很小。
 */
async function fetchHtmlFollowing(startUrl, { maxHops = MAX_HOPS } = {}) {
  let url = startUrl
  let hops = 0
  let last = null
  while (hops <= maxHops) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), HOP_TIMEOUT_MS)
    try {
      const r = await fetchCapped(url, { signal: ctl.signal, headers: { 'user-agent': UA }, maxBytes: PAGE_MAX_BYTES })
      last = r
      const status = Number(r.status) || 0
      const loc = r.headers && r.headers.location
      if (status >= 300 && status < 400 && loc && hops < maxHops) {
        let next = ''
        try { next = new URL(String(loc), url).href } catch { next = '' }
        if (next && /^https?:\/\//i.test(next)) { url = next; hops++; continue }
      }
      return { res: r, finalUrl: url, hops }
    } catch (e) {
      return { res: null, finalUrl: url, hops, error: String((e && e.message) || e) }
    } finally {
      clearTimeout(timer)
    }
  }
  return { res: last, finalUrl: url, hops, error: '跳转次数超限' }
}

/** 抓页面 → 取 og:image → 下载落盘。返回落盘信息；失败返回 null（调用方回 204） */
async function fetchAndStore(siteId, pageUrl) {
  ensureDir()

  let coverHref = ''
  const page = await fetchHtmlFollowing(pageUrl)
  if (!page.res) {
    coverDebug.reason = `页面抓取失败：${page.error || '未知错误'}`
  } else {
    coverDebug.pageStatus = Number(page.res.status) || 0
    coverDebug.contentType = String(page.res.headers['content-type'] || '')
    coverDebug.finalUrl = page.finalUrl
    coverDebug.stage = page.hops ? `页面已取回（跟了 ${page.hops} 跳）` : '页面已取回'
    if (/^text\/html/i.test(coverDebug.contentType)) {
      const html = decodeHtmlBytes(page.res.body).toString('utf8')
      coverDebug.stage = '解析 og:image'
      // 相对地址要按**最终 URL** 解析（跟跳转后基准变了）
      coverHref = pickCoverPrefer([html], page.finalUrl)
      if (!coverHref) coverDebug.reason = `页面里没有 og:image/twitter:image（HTML ${html.length} 字节）`
    } else {
      coverDebug.reason = `页面不是 HTML：${coverDebug.contentType || '未知类型'}（HTTP ${coverDebug.pageStatus}）`
    }
  }

  if (!coverHref) { markNoCover(siteId); return null }

  const imgCtl = new AbortController()
  const imgTimer = setTimeout(() => imgCtl.abort(), IMAGE_TIMEOUT_MS)
  try {
    const r = await fetchCapped(coverHref, { signal: imgCtl.signal, headers: { 'user-agent': UA }, maxBytes: MAX_BYTES })
    coverDebug.stage = '下载封面'
    coverDebug.imageStatus = Number(r.status) || 0
    const mime = String(r.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    coverDebug.imageMime = mime
    const ext = EXT_BY_MIME[mime]
    if (!ext) { coverDebug.reason = `封面地址返回的不是图片：${mime || '未知类型'}`; markNoCover(siteId); return null }
    const path = join(COVER_DIR, siteId + ext)
    writeFileSync(path, r.body)
    return { path, mime }
  } finally { clearTimeout(imgTimer) }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return }

  const siteId = String((req.query && req.query.site) || '').trim()
  const debug = Boolean(req.query && req.query.debug)
  if (!SAFE_ID.test(siteId)) { res.status(400).json({ error: '缺少合法的 site 参数' }); return }

  const hit = cachedCover(siteId)
  if (hit) return sendImage(res, hit)
  if (hasNegativeCache(siteId)) { res.status(204).end(); return }

  const data = await readText('sites.json')
  const site = data && Array.isArray(data.sites) ? data.sites.find(s => s && s.id === siteId) : null
  if (!site || typeof site.url !== 'string' || !site.url.trim()) { res.status(404).json({ error: '站点不存在' }); return }

  const raw = site.url.trim()
  const pageUrl = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  coverDebug.siteId = siteId
  coverDebug.pageUrl = pageUrl
  coverDebug.stage = '开始'
  coverDebug.reason = ''
  coverDebug.coverHref = ''
  coverDebug.at = Date.now()
  try {
    const saved = await fetchAndStore(siteId, pageUrl)
    if (debug) { res.status(200).json({ ok: true, saved: Boolean(saved), ...coverDebug }); return }
    if (!saved) { res.status(204).end(); return }
    sendImage(res, saved)
  } catch (e) {
    // 抓不到就当没有封面（204）—— 图层失败绝不该冒泡成接口错误
    coverDebug.reason = String((e && e.message) || e)
    if (debug) { res.status(200).json({ ok: false, ...coverDebug }); return }
    res.status(204).end()
  }
}

/** 清某个站点的封面缓存（改了站点地址后用；调试也用） */
export function dropCover(siteId) {
  if (!SAFE_ID.test(String(siteId || ''))) return false
  let dropped = false
  for (const [ext] of EXTS) {
    const p = join(COVER_DIR, siteId + ext)
    if (existsSync(p)) { try { unlinkSync(p); dropped = true } catch { /* 忽略 */ } }
  }
  const neg = join(COVER_DIR, siteId + '.none')
  if (existsSync(neg)) { try { unlinkSync(neg); dropped = true } catch { /* 忽略 */ } }
  return dropped
}

/** 缓存概况（运维用：有没有在涨、有没有失效文件） */
export function coverStats() {
  ensureDir()
  const files = readdirSync(COVER_DIR)
  const byExt = {}
  let bytes = 0
  for (const f of files) {
    const ext = f.slice(f.lastIndexOf('.'))
    byExt[ext] = (byExt[ext] || 0) + 1
    try { bytes += readFileSync(join(COVER_DIR, f)).length } catch { /* 忽略 */ }
  }
  return { count: files.length, byExt, bytes }
}

export const __testing = { COVER_DIR, MAX_BYTES, HOP_TIMEOUT_MS, MAX_HOPS, IMAGE_TIMEOUT_MS }
export { fetchHtmlFollowing }