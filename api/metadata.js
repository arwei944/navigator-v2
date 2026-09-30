/**
 * 站点元信息代理 API：抓取目标页，推断出收录一个站点所需的全部字段。
 * GET /api/metadata?url=https://example.com
 *
 * 返回 { name, desc, favicon, faviconUrl, domain, url, color, categoryId, categoryLabel,
 *        blocked, confidence, sources, warning }
 *
 * 推断逻辑全部在 shared/site-infer.mjs，分类白名单在 shared/categories.mjs ——
 * 与本地控制台 tools/console/lib/sites.mjs 同源，两个「新增站点」入口的推荐口径永远一致。
 * 这里只负责网络抓取、编码回退与安全校验。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { inferSite, decodeHtmlBytes, BLOCKED_WARNING } from '../shared/site-infer.mjs'
import { categoryMeta } from '../shared/categories.mjs'

// 已收录站点作为「像不像已有某站」的参照（域名同族 / 品牌词命中）。
// 用构建期快照即可：它只影响推荐权重，实时数据仍在 Vercel Blob。
const SEED_SITES = JSON.parse(
  readFileSync(fileURLToPath(new URL('./sites-data.json', import.meta.url)), 'utf-8')
)
const CATEGORY_META = categoryMeta()

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const MAX_BYTES = 256 * 1024 // 最多读取 256KB HTML，避免超大页面拖垮函数
const MAX_REDIRECTS = 4

/* ---------------- SSRF 防护 ---------------- */

// 这是面向公网的抓取代理，若不校验目标，用户可用它探测内网/本机服务
// （云元数据 169.254.169.254、内网管理口等）。域名交给 URL 解析后已归一化，
// 十进制/十六进制写的 IP（如 http://2130706433/）会被 WHATWG URL 还原成点分十进制。
const PRIVATE_V4 = [
  /^0\./, /^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^192\.0\.0\./,
  /^192\.0\.2\./, /^198\.18\./, /^198\.51\.100\./, /^203\.0\.113\./,
]

function isPrivateV4(ip) {
  if (PRIVATE_V4.some(re => re.test(ip))) return true
  const [a, b] = ip.split('.').map(Number)
  if (a === 172 && b >= 16 && b <= 31) return true   // 172.16.0.0/12
  if (a === 100 && b >= 64 && b <= 127) return true  // 100.64.0.0/10 运营商级 NAT
  if (a >= 224) return true                          // 组播与保留段
  return false
}

export function isBlockedHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (!h) return true
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.home.arpa')) return true
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return isPrivateV4(h)
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true
    if (/^f[cd][0-9a-f]{2}:/.test(h)) return true      // fc00::/7 唯一本地地址
    if (/^fe[89ab][0-9a-f]:/.test(h)) return true      // fe80::/10 链路本地
    const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateV4(mapped[1])
  }
  return false
}

/* ---------------- 抓取 ---------------- */

async function readCapped(resp) {
  const reader = resp.body.getReader()
  const chunks = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
    if (total > MAX_BYTES) {
      reader.cancel().catch(() => {})
      break
    }
  }
  return Buffer.concat(chunks).subarray(0, MAX_BYTES)
}

/**
 * 手动跟重定向：每跳都重新校验主机，否则「公网 URL 302 到内网」就能绕过上面的检查
 * （fetch 的 redirect:'follow' 不会给我们插话的机会）。
 */
async function fetchHtml(startHref, signal) {
  let href = startHref
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = new URL(href)
    if (isBlockedHost(u.hostname)) {
      const err = new Error('该地址指向内网或本机')
      err.code = 'BLOCKED_HOST'
      throw err
    }
    const resp = await fetch(href, {
      headers: {
        'user-agent': UA,
        'accept-language': 'zh-CN,zh;q=0.9',
        'accept': 'text/html,application/xhtml+xml'
      },
      redirect: 'manual',
      signal
    })
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get('location')
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

export default async function handler(req, res) {
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
  const timer = setTimeout(() => controller.abort(), 8000)

  // https 抓不到时回退 http：少数站点只在 http 上响应，直接判定失败会让用户白填一遍
  const grab = async (u) => {
    try {
      const resp = await fetchHtml(u.href, controller.signal)
      if (!resp.ok) return { html: '', status: resp.status }
      return { html: decodeHtmlBytes(await readCapped(resp)), status: resp.status }
    } catch (e) {
      if (e.code === 'BLOCKED_HOST' || u.protocol !== 'https:') throw e
      const httpU = new URL(u.href)
      httpU.protocol = 'http:'
      const resp = await fetchHtml(httpU.href, controller.signal)
      if (!resp.ok) return { html: '', status: resp.status }
      return { html: decodeHtmlBytes(await readCapped(resp)), status: resp.status }
    }
  }

  // 贴的是子页时并行补抓主域名首页：落库口径永远是主域名，元信息也应以主域名为准。
  // 并行而非串行 —— 两跳共享同一个 8s AbortController，串行会白吃掉一倍的超时预算。
  const wantsRoot = Boolean(target.pathname) && target.pathname !== '/'

  let html = ''
  let rootHtml = ''
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
    url: target.href,
    existingSites: SEED_SITES,
    categoryMeta: CATEGORY_META,
  })

  // 挑战页返回 200，抓取层看不出异常，只有内容层知道这是拦截页：warning 必须盖过抓取层文案
  if (info.blocked) warning = BLOCKED_WARNING

  // 抓取结果随目标页变动，不缓存，避免同域名二次抓取拿到旧标题
  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({ ...info, favicon: info.faviconUrl, warning })
}