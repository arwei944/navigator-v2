/**
 * 封面图来源：页面 `og:image` 的**提供者实现**（注册 id = `og-image`）。
 *
 * ## 为什么单独放 shared/ 而不是留在 api/cover.js
 *
 * 机制（注册表、排序、回退）在 `shared/image-engine.mjs`；实现若留在 `api/cover.js`，
 * 注册表就**只在 serverless 进程里成立** —— 测试、控制台、任何其他消费方都看不到它。
 * （这是实际踩到的：写契约测试时 `imageChain('cover')` 返回空数组，因为没人 import 那个 api 文件。）
 * 放这里，三方共用一份语义。
 *
 * ## 出网纪律由调用方经 ctx 注入
 *
 * `fetchCapped`、超时、跳数、体积上限全部走 `ctx`（`fetchOpts`/`fetchCapped`…）——
 * 因为那些数字是**平台约束逼出来的**（发布沙箱会回收长请求），属于部署知识而不是抓取知识。
 * provider 只描述「怎么找这张图、怎么判它合不合规」。
 */
import { pickCoverPrefer, decodeHtmlBytes } from './site-infer.mjs'
import { registerImageProvider } from './image-engine.mjs'

/** 缺省值 = api/cover.js 的既有常量；调用方可以覆盖（测试、其他部署形态） */
const DEFAULTS = {
  hopTimeoutMs: 2200,
  maxHops: 1,
  imageTimeoutMs: 2500,
  maxBytes: 1.5 * 1024 * 1024,
  pageMaxBytes: 256 * 1024,
  ua: 'Mozilla/5.0 (compatible; NavigatorCoverBot/1.0)',
}

/** 缺省 mime→ext；api/cover.js 会传入它的权威表（EXTS），避免两份漂移 */
const DEFAULT_EXT_BY_MIME = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
  'image/gif': '.gif', 'image/avif': '.avif', 'image/svg+xml': '.svg',
}

/** 诊断对象（调用方传 ctx.debug；没传就写进这个丢弃对象，逻辑零分支） */
const NOOP_DEBUG = {}

/**
 * 抓页面（**手动跟重定向**）。
 *
 * 为什么不用自动跟随：`fetchCapped` 刻意**不跟**重定向 —— 自动跟随会把请求带到
 * 未校验的目标，绕过 SSRF 防护（这层是公网可触达端点的底线）。代价是：绝大多数站点
 * 会 301/302 到规范地址（apex→www、http→https、语言前缀），于是拿到一个空 body、
 * 解析不出任何 meta —— 实测命中率只有 1/10。
 *
 * 所以自己跟：每一跳都用 fetchCapped 重新校验目标（内网/本机照样被拦），
 * 只接受 http(s) 的 Location，并保留相对地址的解析基准。
 */
async function fetchHtmlFollowing(startUrl, ctx) {
  const fetchCapped = ctx.fetchCapped
  if (typeof fetchCapped !== 'function') throw new Error('缺少 ctx.fetchCapped（封面出网必须走 SSRF 防护）')
  const hopTimeoutMs = ctx.hopTimeoutMs || DEFAULTS.hopTimeoutMs
  const maxHops = ctx.maxHops === undefined ? DEFAULTS.maxHops : ctx.maxHops
  const maxBytes = ctx.pageMaxBytes || DEFAULTS.pageMaxBytes
  const ua = ctx.ua || DEFAULTS.ua

  let url = startUrl
  let hops = 0
  let last = null
  while (hops <= maxHops) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), hopTimeoutMs)
    try {
      const r = await fetchCapped(url, { signal: ctl.signal, headers: { 'user-agent': ua }, maxBytes })
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

/**
 * 抓页面 → 取 og:image → 下载。返回 `{buf, ext, mime}`；失败返回 null。
 * 落盘与负缓存不在这里 —— 那是调用方（api/cover.js 的 fetchAndStore）的职责。
 */
async function fetchCoverViaOgImage(site, ctx = {}) {
  const debug = ctx.debug || NOOP_DEBUG
  const raw = String((site && site.url) || '').trim()
  const pageUrl = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`

  let coverHref = ''
  const page = await fetchHtmlFollowing(pageUrl, ctx)
  if (!page.res) {
    debug.reason = `页面抓取失败：${page.error || '未知错误'}`
  } else {
    debug.pageStatus = Number(page.res.status) || 0
    debug.contentType = String(page.res.headers['content-type'] || '')
    debug.finalUrl = page.finalUrl
    debug.stage = page.hops ? `页面已取回（跟了 ${page.hops} 跳）` : '页面已取回'
    if (/^text\/html/i.test(debug.contentType)) {
      const html = decodeHtmlBytes(page.res.body).toString('utf8')
      debug.stage = '解析 og:image'
      // 相对地址要按**最终 URL** 解析（跟跳转后基准变了）
      coverHref = pickCoverPrefer([html], page.finalUrl)
      if (!coverHref) debug.reason = `页面里没有 og:image/twitter:image（HTML ${html.length} 字节）`
    } else {
      debug.reason = `页面不是 HTML：${debug.contentType || '未知类型'}（HTTP ${debug.pageStatus}）`
    }
  }

  if (!coverHref) return null

  const extByMime = ctx.extByMime || DEFAULT_EXT_BY_MIME
  const imgCtl = new AbortController()
  const imgTimer = setTimeout(() => imgCtl.abort(), ctx.imageTimeoutMs || DEFAULTS.imageTimeoutMs)
  try {
    const r = await ctx.fetchCapped(coverHref, {
      signal: imgCtl.signal,
      headers: { 'user-agent': ctx.ua || DEFAULTS.ua },
      maxBytes: ctx.maxBytes || DEFAULTS.maxBytes,
    })
    debug.stage = '下载封面'
    debug.imageStatus = Number(r.status) || 0
    const mime = String(r.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    debug.imageMime = mime
    const ext = extByMime[mime]
    if (!ext) { debug.reason = `封面地址返回的不是图片：${mime || '未知类型'}`; return null }
    // 契约：provider 返回的 ext **不带点**（ctx.extByMime 沿用 cover.js 的 `.png` 表，这里归一化）
    return { buf: r.body, ext: String(ext).replace(/^\./, ''), mime }
  } finally { clearTimeout(imgTimer) }
}

registerImageProvider({
  id: 'og-image',
  label: 'og:image',
  kind: 'cover',
  order: 100,
  fetch: fetchCoverViaOgImage,
})

export { fetchCoverViaOgImage, fetchHtmlFollowing }
