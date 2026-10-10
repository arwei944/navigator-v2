/**
 * 站点元信息代理 API：抓取目标页，推断出收录一个站点所需的全部字段。
 * GET /api/metadata?url=https://example.com
 *
 * 返回 { name, desc, favicon, faviconUrl, domain, url, color, categoryId, categoryLabel,
 *        purposes, blocked, confidence, sources, warning,
 *        nameOriginal, descOriginal, translated, translateEngine }
 *
 * 推断逻辑全部在 shared/site-infer.mjs，分类白名单在 shared/categories.mjs ——
 * 与本地控制台 tools/console/lib/sites.mjs 同源，两个「新增站点」入口的推荐口径永远一致。
 * 自动翻译（非中文 → 中文）在 shared/translate.mjs，同样与本地控制台共用同一内核。
 * 这里只负责网络抓取、编码回退、翻译传输与安全校验。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { inferSite, decodeHtmlBytes, pickThemeColor, manifestHref, manifestThemeColor, BLOCKED_WARNING } from '../shared/site-infer.mjs'
import { translateSiteFields } from '../shared/translate.mjs'
import { categoryMeta } from '../shared/categories.mjs'
import { isBlockedHost } from '../shared/net-guard.mjs'
import { fetchCapped } from '../shared/http-fetch.mjs'

// 既有的 SSRF 用例（tools/console/test-guard.mjs）从这里 import，保持导出位置不变。
// 实现已搬到 shared/net-guard.mjs：字面规则与 IP 段规则要在「连接层的解析回调」里复用。
export { isBlockedHost }

// 已收录站点作为「像不像已有某站」的参照（域名同族 / 品牌词命中）。
// 用构建期快照即可：它只影响推荐权重，实时数据仍在 Vercel Blob。
const SEED_SITES = JSON.parse(
  readFileSync(fileURLToPath(new URL('./sites-data.json', import.meta.url)), 'utf-8')
)
const CATEGORY_META = categoryMeta()

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const MAX_BYTES = 256 * 1024 // 最多读取 256KB HTML，避免超大页面拖垮函数
const MAX_REDIRECTS = 4

/**
 * 总时间预算 9s：默认函数上限是 10s，而「抓取 8s + 翻译 6s」的最坏情况是 14s → 必然 504。
 *
 * 为什么不去 vercel.json 调 `maxDuration`：超过账户计划上限会让**整个部署失败**，
 * 属于「用整站可部署性赌一个字段」。真正的问题是内部预算没有上限，那就从内部收敛：
 * 抓取占前 6s，翻译用剩下的时间（并保证至少 2s），任何一步超时都退回原文/域名推断。
 */
const FETCH_BUDGET_MS = 6000
const TOTAL_BUDGET_MS = 9000
const TRANSLATE_MIN_MS = 2000

function blockedHostError() {
  const err = new Error('该地址指向内网或本机')
  err.code = 'BLOCKED_HOST'
  return err
}

/* ---------------- 公网滥用防护 ---------------- */

/**
 * 「新增站点」是**访客可见**的功能（任何访客都能在本机加一条），所以这里不能加登录鉴权 ——
 * 加了就把功能对普通访客关掉了。真正能加的是两道与功能无关的门：
 *
 *   1. **跨站调用拦下**：`Sec-Fetch-Site: cross-site` 表示请求来自别的站点。
 *      浏览器设置这个头、页面脚本改不了，于是「第三方网页把我们的接口当成开放抓取代理」
 *      这条路被堵死，而自家页面（same-origin）完全不受影响。
 *   2. **每实例每分钟的次数上限**：拦截单个实例上的高频刷取。诚实说明它的边界 ——
 *      serverless 是多实例的，Map 只活在一个热实例里，因此这是 best-effort，
 *      不是分布式限流；要做分布式就得每次请求都写 Blob，代价远大于收益。
 */
const RL_WINDOW_MS = 60_000
const RL_MAX_PER_WINDOW = 20
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
  if (hits.length >= RL_MAX_PER_WINDOW) {
    rlHits.set(ip, hits)
    return true
  }
  hits.push(now)
  rlHits.set(ip, hits)
  // 顺手清理：只在本实例记录的人多起来时才做一次全扫，避免每次请求都 O(n)
  if (rlHits.size > 2000) {
    for (const [k, v] of rlHits) {
      if (!v.some(t => now - t < RL_WINDOW_MS)) rlHits.delete(k)
    }
  }
  return false
}

/* ---------------- 抓取 ---------------- */

/**
 * 手动跟重定向：每跳都重新校验主机，否则「公网 URL 302 到内网」就能绕过字面检查。
 *
 * 注意字面检查（`isBlockedHost`）只是第一道门。真正的防线在 `fetchCapped` 内部：
 * 它把同一套 IP 规则挂到 `lookup` 上，于是**解析出的地址**在用于连接之前就被逐个校验，
 * DNS rebinding（域名先解析到公网、连接时再解析到内网）这条路也一并堵上。
 */
async function fetchHtml(startHref, signal, accept = 'text/html,application/xhtml+xml') {
  let href = startHref
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = new URL(href)
    if (isBlockedHost(u.hostname)) throw blockedHostError()
    const resp = await fetchCapped(href, {
      signal,
      headers: {
        'user-agent': UA,
        'accept-language': 'zh-CN,zh;q=0.9',
        'accept': accept,
      },
      maxBytes: MAX_BYTES,
    })
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.location
      if (!loc) return resp
      href = new URL(loc, href).href
      continue
    }
    return resp
  }
  const err = new Error('重定向次数过多')
  err.code = 'TOO_MANY_REDIRECTS'
  throw err
}

const okStatus = s => s >= 200 && s < 300

export default async function handler(req, res) {
  // 滥用防护先于一切：跨站调用直接拒，再按来源 IP 限一次速。
  // 放在最前面是因为这两条不依赖参数合法性 —— 一个打满配额的请求不该先花时间解析 URL。
  const fetchSite = String((req.headers && req.headers['sec-fetch-site']) || '').toLowerCase()
  if (fetchSite === 'cross-site') {
    res.status(403).json({ error: '该接口仅限站内调用' })
    return
  }
  const ip = clientIp(req)
  if (rateLimited(ip)) {
    res.setHeader('Retry-After', '60')
    res.status(429).json({ error: '请求过于频繁，请稍后再试' })
    return
  }

  const raw = req.query.url
  if (!raw) {
    res.status(400).json({ error: '缺少 url 参数' })
    return
  }

  let target
  try {
    target = new URL(raw.startsWith('http') ? raw : 'https://' + raw)
  } catch {
    res.status(400).json({ error: '无效的 URL' })
    return
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    res.status(400).json({ error: '仅支持 http/https' })
    return
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_BUDGET_MS)
  const startedAt = Date.now()

  // https 抓不到时回退 http：少数站点只在 http 上响应，直接判定失败会让用户白填一遍
  const grab = async (u) => {
    try {
      const resp = await fetchHtml(u.href, controller.signal)
      if (!okStatus(resp.status)) return { html: '', status: resp.status }
      return { html: decodeHtmlBytes(resp.body), status: resp.status }
    } catch (e) {
      if (e.code === 'BLOCKED_HOST' || u.protocol !== 'https:') throw e
      const httpU = new URL(u.href)
      httpU.protocol = 'http:'
      const resp = await fetchHtml(httpU.href, controller.signal)
      if (!okStatus(resp.status)) return { html: '', status: resp.status }
      return { html: decodeHtmlBytes(resp.body), status: resp.status }
    }
  }

  // 贴的是子页时并行补抓主域名首页：落库口径永远是主域名，元信息也应以主域名为准。
  // 并行而非串行 —— 两跳共享同一个 8s AbortController，串行会白吃掉一倍的超时预算。
  const wantsRoot = Boolean(target.pathname) && target.pathname !== '/'

  let html = ''
  let rootHtml = ''
  let manifestTheme = ''
  let warning = ''
  try {
    const [pageR, rootR] = await Promise.allSettled([
      grab(target),
      wantsRoot ? grab(new URL(target.origin + '/')) : Promise.resolve(null),
    ])
    if (rootR.status === 'fulfilled' && rootR.value?.html) rootHtml = rootR.value.html

    if (pageR.status === 'rejected') {
      // 子页抓失败但根页拿到了 → 按根页推断，不必再报「抓取失败」
      if (!rootHtml) throw pageR.reason
    } else {
      html = pageR.value.html
      if (!html && !rootHtml) warning = `目标站点返回 ${pageR.value.status}，已按域名推断，请复核名称与分类`
    }

    // 品牌色只写在 webmanifest 里的站点：页面没有「可用」的 meta theme-color 时补抓 manifest 取 theme_color。
    // 注意判据是「可用」而非「存在」—— 按配色方案声明 light #ffffff / dark #0a0b0d 的页面
    // 两条都不可用，只判存在会白白跳过 manifest，拿不到真正的品牌色。
    if (!pickThemeColor(html) && !pickThemeColor(rootHtml)) {
      const base = target.origin + '/'
      const mHref = manifestHref(html, base) || (rootHtml ? manifestHref(rootHtml, base) : '')
      if (mHref) {
        try {
          const mr = await fetchHtml(mHref, controller.signal, 'application/manifest+json,application/json,text/plain,*/*')
          if (okStatus(mr.status)) manifestTheme = manifestThemeColor(decodeHtmlBytes(mr.body))
        } catch { /* manifest 抓不到不影响主流程，色值退回其它来源 */ }
      }
    }
  } catch (e) {
    if (e.code === 'BLOCKED_HOST') {
      res.status(400).json({ error: e.message })
      return
    }
    warning = e.name === 'AbortError'
      ? '抓取超时，已按域名推断，请复核名称与分类'
      : '抓取失败（可能被反爬拦截），已按域名推断，请复核名称与分类'
  } finally {
    clearTimeout(timer)
  }

  // 抓不到页面不算失败：照常产出一份按域名推断的草稿，让用户只需复核而不是从零手填
  const info = inferSite({
    html,
    rootHtml,
    manifestTheme,
    url: target.href,
    existingSites: SEED_SITES,
    categoryMeta: CATEGORY_META,
  })

  // 挑战页返回 200，抓取层看不出异常，只有内容层知道这是拦截页：warning 必须盖过抓取层文案
  if (info.blocked) warning = BLOCKED_WARNING

  // 自动翻译：把非中文的名称 / 描述译成中文，原文一并回传，让 UI 能展示「译文 + 原文」对照。
  // 用**剩余预算**（至少 2s）而不是固定 6s —— 固定值会让「抓取用满 6s + 翻译用满 6s」
  // 顶到 12s，越过函数默认的 10s 上限直接 504。翻译是锦上添花，超时就保留原文。
  const tr = await autoTranslate(info, UA, Math.max(TRANSLATE_MIN_MS, TOTAL_BUDGET_MS - (Date.now() - startedAt)))

  // 抓取结果随目标页变动，不缓存，避免同域名二次抓取拿到旧标题
  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({
    ...info,
    favicon: info.faviconUrl,
    warning,
    nameOriginal: tr.original.name,
    descOriginal: tr.original.desc,
    translated: tr.translated,
    translateEngine: tr.engines,
  })
}

/**
 * 就地把 info.name / info.desc 换成中文译文，并返回原文与翻译状态。
 * 内核（shared/translate.mjs）负责「该不该译」，这里只提供传输层：
 * 复用与抓取相同的 UA，带**由调用方算好的剩余预算**做超时（不是固定值 —— 见 handler 里的注释），
 * 任何异常都静默退回原文。
 */
async function autoTranslate(info, ua, timeoutMs) {
  const fallback = {
    original: { name: info.name, desc: info.desc },
    translated: { name: false, desc: false },
    engines: { name: '', desc: '' },
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || TRANSLATE_MIN_MS))
  const fetchText = async (url) => {
    const r = await fetch(url, { headers: { 'user-agent': ua }, signal: controller.signal })
    if (!r.ok) throw new Error(`translate http ${r.status}`)
    return r.text()
  }
  try {
    const t = await translateSiteFields({ name: info.name, desc: info.desc }, { fetchText })
    info.name = t.name
    info.desc = t.desc
    return { original: t.original, translated: t.translated, engines: t.engines }
  } catch {
    return fallback
  } finally {
    clearTimeout(timer)
  }
}