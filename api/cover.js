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
import { dirname, join, sep } from 'node:path'
import { get, put } from '#store'
import { fetchCapped } from '../shared/http-fetch.mjs'
import { resolveImage, registerImageProvider } from '../shared/image-engine.mjs'
// 封面 provider（og:image）的实现放在 shared：它的注册必须在任何非 serverless 消费方
// （测试/控制台）里也成立 —— 留在本文件会让注册只在 serverless 进程里存在。
import { fetchHtmlFollowing } from '../shared/cover-source.mjs'

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
/** 反向映射（提供者只回 ext 时补 mime）；ico 不在 EXTS 里，单独补 */
const MIME_BY_EXT = { ...Object.fromEntries(EXTS.map(([ext, mime]) => [ext.slice(1), mime])), ico: 'image/x-icon' }

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
 * 抓页面（手动跟重定向）**已移至 `shared/cover-source.mjs`** ——
 * 那里是「封面 provider」的共同实现，出网纪律（fetchCapped / 超时 / 跳数 / 体积）
 * 由本文件经 ctx 注入，因为那些数字是发布平台约束逼出来的部署知识。
 * 本文件只保留落盘、负缓存与诊断。
 */

/** 读 public/ 下的图标（供 favicon-as-cover 用）；越界或不存在返回 null */
function readPublicIcon(rel) {
  const base = join(process.cwd(), 'public')
  const abs = join(base, String(rel || '').replace(/^\/+/, ''))
  if (!abs.startsWith(base + sep)) return null
  try { return existsSync(abs) ? readFileSync(abs) : null } catch { return null }
}

/**
 * 可选的第二来源：把站点**已经抓到的图标**当封面（零网络，秒回）。
 *
 * **默认关闭**（`NAV_COVER_FAVICON_FALLBACK=1` 才启用）——
 * 它会把「og:image 抓不到 → 204 无封面」变成「拿图标顶上」，
 * 这是产品行为变化，不该由一次重构悄悄带来。
 */
registerImageProvider({
  id: 'favicon-as-cover',
  label: '图标作封面（本地，零网络）',
  kind: 'cover',
  order: 200,
  available: () => process.env.NAV_COVER_FAVICON_FALLBACK === '1',
  fetch: async (site) => {
    const rel = String((site && site.icon) || '').trim()
    if (!rel) return null
    const ext = ((rel.match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase().replace('jpeg', 'jpg')
    if (!MIME_BY_EXT[ext]) return null
    const buf = readPublicIcon(rel)
    if (!buf || !buf.length) return null
    return { buf, ext, mime: MIME_BY_EXT[ext] }
  },
})

/** 按提供者链取封面并落盘。返回落盘信息；失败返回 null（调用方回 204） */
async function fetchAndStore(siteId, site) {
  ensureDir()
  // 出网纪律全部经 ctx 注入：provider 只管「怎么找、怎么判」，不掌握部署参数
  const out = await resolveImage(site, {
    kind: 'cover',
    ctx: {
      fetchCapped,
      debug: coverDebug,
      extByMime: EXT_BY_MIME,
      ua: UA,
      hopTimeoutMs: HOP_TIMEOUT_MS,
      maxHops: MAX_HOPS,
      imageTimeoutMs: IMAGE_TIMEOUT_MS,
      maxBytes: MAX_BYTES,
      pageMaxBytes: PAGE_MAX_BYTES,
    },
  })
  if (!out) { markNoCover(siteId); return null }
  // provider 的 ext 契约是不带点（见 shared/image-engine.mjs），落盘方负责拼点
  const path = join(COVER_DIR, siteId + '.' + out.ext)
  writeFileSync(path, out.buf)
  return { path, mime: out.mime || MIME_BY_EXT[out.ext] || 'application/octet-stream' }
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
    const saved = await fetchAndStore(siteId, site)
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