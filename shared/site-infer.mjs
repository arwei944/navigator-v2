/**
 * 站点元信息推断引擎：给一份 HTML + 目标地址，推出收录一个站点所需的全部字段。
 *
 * 纯函数、零依赖、无 I/O —— 被两个入口复用，保证推荐口径永远一致：
 *   - api/metadata.js              线上前端「添加站点」
 *   - tools/console/lib/sites.mjs  本地控制台「新增站点」
 *
 * 设计取舍：
 *   - 每个字段都带兜底值。因为「只填一个网址」时 name / desc 必须非空才允许落库，
 *     拿不到官方描述时用 generatedDesc() 生成，并用 confidence 标注为 low，
 *     让 UI 能提示「这条是猜的」，而不是静默写进脏数据。
 *   - 分类用加权打分而非首个命中：关键词只是信号之一，域名同族与品牌词命中权重更高。
 */
import { inferPurposes } from './purposes.mjs'

/* ---------------- 文本与标签工具 ---------------- */

export function decodeEntities(str) {
  return String(str)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

/**
 * 取标签属性值，按定界引号配对。
 * 不能用 `[^"']+`：内联 SVG 的 href 是双引号包裹、内部含单引号
 * （`href="data:image/svg+xml,%3Csvg xmlns='…'"`），会从第一个单引号处被截断。
 */
export function attrValue(tag, name) {
  const src = String(tag)
  const quoted = src.match(new RegExp(name + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", 'i'))
  if (quoted) return quoted[2]
  const bare = src.match(new RegExp(name + '\\s*=\\s*([^\\s>]+)', 'i'))
  return bare ? bare[1] : ''
}

/** 按 property/name/itemprop 取 <meta> 内容；属性书写顺序颠倒的页面也能命中 */
export function metaContent(html, keys) {
  const want = keys.map(k => String(k).toLowerCase())
  for (const tag of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    const t = tag[0]
    const key = (attrValue(t, 'property') || attrValue(t, 'name') || attrValue(t, 'itemprop') || '').toLowerCase()
    if (!want.includes(key)) continue
    const content = attrValue(t, 'content')
    if (content) return decodeEntities(content).trim()
  }
  return ''
}

function stripTags(html) {
  return String(html)
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
}

function clip(str, max = 120) {
  const s = String(str).replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max).replace(/[\s，,、。.；;:：-]+$/, '') : s
}

/* ---------------- 字节解码 ---------------- */

/**
 * 把 HTML 字节解成字符串，多编码回退：声明编码 → utf-8 → gb18030 → big5 → latin1。
 * 只在 utf-8 出现较多替换字符（≥3 个，说明确实不是 UTF-8）时才换编码，
 * 避免一个坏字节就把整页判成 gb18030；latin1 永远能解出干净结果，故只作最后兜底。
 */
export function decodeHtmlBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const dec = enc => new TextDecoder(enc).decode(u8)
  const badCount = s => (s.match(/\uFFFD/g) || []).length

  let best = dec('utf-8')
  let bestBad = badCount(best)
  if (bestBad < 3) return best

  const declared = (best.match(/charset\s*=\s*["']?([\w-]+)/i) || [])[1]?.toLowerCase()
  const order = [...(declared && declared !== 'utf-8' ? [declared] : []), 'gb18030', 'gbk', 'big5', 'latin1']
  for (const enc of order) {
    try {
      const alt = dec(enc)
      const bad = badCount(alt)
      if (bad < bestBad) {
        best = alt
        bestBad = bad
        if (bad === 0) break
      }
    } catch { /* 该编码不可用则尝试下一个 */ }
  }
  return best
}

/* ---------------- 地址 ---------------- */

export function hostOf(url) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  try {
    const u = new URL(raw.includes('://') ? raw : 'https://' + raw)
    return u.hostname.replace(/^www\./, '').toLowerCase()
  } catch { return '' }
}

const MULTI_TLD = new Set(['co.uk', 'com.cn', 'com.hk', 'com.tw', 'com.au', 'co.jp', 'co.kr', 'com.sg', 'org.cn', 'net.cn', 'gov.cn'])
const TOKEN_STOP = new Set([
  'www', 'com', 'net', 'org', 'io', 'app', 'co', 'cn', 'xyz', 'site', 'web', 'shop',
  'online', 'store', 'dev', 'top', 'vip', 'cc', 'me', 'info', 'biz', 'pro', 'link',
  'live', 'fun', 'space', 'website', 'page', 'blog', 'www2',
])

/** 域名主体拆词：`chat.openai.com` → ['chat','openai']，用于品牌识别与分类推断 */
export function domainTokens(host) {
  const parts = String(host || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean)
  if (parts.length < 2) return parts.filter(t => !TOKEN_STOP.has(t))
  const cut = MULTI_TLD.has(parts.slice(-2).join('.')) ? 2 : 1
  return parts.slice(0, parts.length - cut)
    .flatMap(p => p.split(/[-_]/))
    .filter(t => t.length >= 2 && !TOKEN_STOP.has(t))
}

/* ---------------- 站点名称 ---------------- */

const TITLE_SPLIT = /\s*[|｜丨/·・]\s*|\s*[:：]\s*|\s+[-–—]\s+|>>/
const GENERIC_NAME = /^(首页|主页|官网|官方网站|官方|登录|注册|home|homepage|index|welcome|official|official site|login|sign in|中文|中文站|网站首页)$/i

/**
 * 错误页 / 占位页标题。这类 <title> 语法上完全正常，但它描述的是「这个页面不存在」而不是站点本身，
 * 且长度、形态都像品牌名（"404 Not Found"），会被打分逻辑当成好候选写进导航卡片。
 * 所以必须直接剔除而不是扣分 —— 扣分在「没有竞争者」时仍会胜出。
 * 数字状态码要求独立成词，避免误伤名字里本来带数字的站点。
 */
const ERROR_TITLE = /(?:^|[\s\-–—|·:：（(])(?:4\d{2}|5\d{2})(?:$|[\s\-–—|·:：)）])|not\s*found|页面不存在|找不到(?:该)?页面|网页不存在|无法(?:访问|打开|显示)|访问受限|access\s*denied|^\s*forbidden\s*$|error\s*(?:page|code)|出错了|系统错误/i

function cleanName(s) {
  return decodeEntities(String(s))
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-|·:：]+|[\s\-|·:：]+$/g, '')
    .replace(/^(首页|主页|官网|官方网站)\s*[-|·:：]\s*/i, '')
    .replace(/\s*(官网|官方网站|官网首页|官方网站首页|中文站|官方站点|official site|homepage)$/i, '')
    .trim()
}

function titleCandidates(html) {
  const out = []
  const og = metaContent(html, ['og:title', 'twitter:title'])
  if (og) out.push(og)
  const t = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (t) out.push(decodeEntities(t[1]).replace(/\s+/g, ' ').trim())
  const h1 = String(html).match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (h1) out.push(decodeEntities(stripTags(h1[1])).replace(/\s+/g, ' ').trim())
  return out.filter(Boolean)
}

/**
 * 推断站点名（导航卡片上要短，例如 "ChatGPT" 而不是 "ChatGPT: 免费AI对话助手"）。
 * 候选来自 og:site_name / og:title / <title> / <h1>，按「是否含域名品牌词、长度是否像品牌名」打分。
 * og:site_name 只给很小的加权：它常常是公司名（OpenAI）而站点本身叫别的（ChatGPT）。
 * skipTitle 用于反爬挑战页：那里的 <title> 是 "Just a moment..."，宁可退回域名取名。
 */
export function pickName(html, host, { skipTitle = false } = {}) {
  const tokens = domainTokens(host)
  const seen = new Set()
  const cands = []
  const push = (raw, bonus, source) => {
    for (const part of String(raw).split(TITLE_SPLIT)) {
      const value = cleanName(part)
      const key = value.toLowerCase()
      if (!value || seen.has(key)) continue
      if (ERROR_TITLE.test(value)) continue
      seen.add(key)
      cands.push({ value, bonus, source })
    }
  }

  const siteName = metaContent(html, ['og:site_name', 'application-name', 'apple-mobile-web-app-title'])
  if (siteName) push(siteName, 1, 'og:site_name')
  if (!skipTitle) for (const raw of titleCandidates(html)) push(raw, 0, 'title')

  let best = null
  for (const c of cands) {
    const low = c.value.toLowerCase()
    let score = c.bonus
    if (GENERIC_NAME.test(c.value)) score -= 6
    if (tokens.some(t => t.length >= 3 && low.includes(t))) score += 3
    // 导航卡片要的是品牌名。2~22 字符像品牌，23 字以上更像标语/SEO 标题，予以扣分
    if (low.length >= 2 && low.length <= 22) score += 2
    else if (low.length > 40) score -= 4
    else score -= 1
    if (/[\u4e00-\u9fa5]/.test(c.value) && low.length <= 12) score += 1
    if (!best || score > best.score) best = { value: c.value, score, source: c.source }
  }

  if (best && best.score > 0) {
    return { name: best.value.slice(0, 40), source: best.source, confidence: best.score >= 5 ? 'high' : 'medium' }
  }
  const guess = [...tokens].sort((a, b) => b.length - a.length)[0] || host.split('.')[0] || '未命名站点'
  return { name: guess.charAt(0).toUpperCase() + guess.slice(1), source: 'domain', confidence: 'low' }
}

/* ---------------- 站点描述 ---------------- */

const BLOCK_RE = /just a moment|attention required|checking your browser|enable javascript and cookies|are you a robot|cf-browser-verification|access denied|403 forbidden/i

/** Cloudflare 拦截页 / 反爬挑战页会有一个像样的 <title>，必须单独识别，否则会写进"Just a moment..." */
export function looksBlocked(html) {
  return BLOCK_RE.test(String(html).slice(0, 8192))
}

/**
 * 挑战页返回 200，抓取层看不出异常，只有内容层知道这是拦截页。
 * 文案放这里导出，保证线上 Serverless 与控制台提示一致。
 */
export const BLOCKED_WARNING = '疑似反爬挑战页（抓到的是拦截页而非真实页面），名称与描述为推断值，请复核'

function pickJsonLdField(html, field) {
  for (const m of String(html).matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const hit = m[1].match(new RegExp('"' + field + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"', 'i'))
    if (!hit) continue
    try { return decodeEntities(JSON.parse('"' + hit[1] + '"')) } catch { return decodeEntities(hit[1]) }
  }
  return ''
}

function firstParagraph(html) {
  const body = String(html)
    .replace(/<(script|style|noscript|svg|template|nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, ' ')
  for (const m of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = decodeEntities(stripTags(m[1])).replace(/\s+/g, ' ').trim()
    if (text.length >= 30) return text
  }
  return ''
}

const DESC_NOISE = /^(欢迎访问|欢迎来到|本站|这是一个|welcome to|this site|loading|请开启\s*javascript)/i

/**
 * 「官方 meta」这一组内部的取值顺序不再由文档顺序决定。
 * 原实现用 metaContent 一次传多个键，返回的是**文档里最先出现**的那个 —— 同一页面
 * 把 og:description 写在 description 之前，取到的就是社交分享文案而非页面摘要。
 * 现在改为固定优先级，并在同组内取最长的一条（更长的通常信息量更大，短的常是被压缩的标语）。
 */
const DESC_META_KEYS = ['description', 'og:description', 'twitter:description', 'og:summary', 'weibo:description']

// 长度下限用来滤掉 "Home"、"首页"、"Loading" 这类噪声。中文信息密度高，
// 不能按英文字符数一刀切，12 个汉字已是一句完整的站点简介。
function usable(text, min = 12, name = '') {
  const s = String(text || '').trim()
  if (s.length < min) return false
  if (DESC_NOISE.test(s)) return false
  if (name && s.toLowerCase() === String(name).trim().toLowerCase()) return false
  return true
}

function generatedDesc({ name, host, categoryLabel }) {
  const who = name || host
  return categoryLabel
    ? `${who}（${host}）——${categoryLabel}方向的常用站点，点击直达官网。`
    : `${who}（${host}）——点击直达官网。`
}

/**
 * 推断描述，按可靠性依次回退：
 * og/meta description → twitter → JSON-LD → keywords → 正文首段 → 生成兜底
 * 返回的 source 让 UI 能区分「站点自己写的」与「我们编的」。
 *
 * blocked=true 时直接跳到生成兜底：挑战页的 meta description 常是
 * "Enable JavaScript and cookies to continue"，看着像正经描述，采信它就是写脏数据。
 * （pickName 用 skipTitle 处理同一件事，这里用 blocked 短路。）
 */
export function pickDesc(html, { name = '', host = '', categoryLabel = '', blocked = false } = {}) {
  if (!blocked) {
    let meta = ''
    for (const key of DESC_META_KEYS) {
      const v = metaContent(html, [key])
      if (usable(v, 12, name) && v.length > meta.length) meta = v
    }
    if (meta) return { desc: clip(meta), source: 'meta' }

    const ld = pickJsonLdField(html, 'description')
    if (usable(ld, 12, name)) return { desc: clip(ld), source: 'json-ld' }

    const kw = metaContent(html, ['keywords', 'og:keywords'])
    if (usable(kw, 12, name)) return { desc: clip(kw), source: 'keywords' }

    const para = firstParagraph(html)
    if (usable(para, 30, name)) return { desc: clip(para), source: 'paragraph' }
  }

  return { desc: generatedDesc({ name, host, categoryLabel }), source: 'generated' }
}

/* ---------------- 图标 ---------------- */

export function isInlineImage(uri) {
  const comma = String(uri).indexOf(',')
  if (comma < 0) return false
  if (!/^image\//i.test(String(uri).slice(5, comma))) return false
  return String(uri).slice(comma + 1).trim().length > 0
}

/** `data:,`（example.com 等用它抑制 favicon 请求）等于没声明；`data:image/…` 才是真图标 */
export function resolveIconHref(href, base) {
  const h = String(href || '').trim()
  if (!h) return ''
  if (h.startsWith('data:')) return isInlineImage(h) ? h : ''
  try { return new URL(h, base).href } catch { return '' }
}

/**
 * 取图标地址：apple-touch-icon（分辨率最高）→ rel=icon → mask-icon → /favicon.ico。
 * mask-icon 是单色蒙版图，优先级排在最后，避免拿到一个只有轮廓的图标。
 */
export function pickFavicon(html, base) {
  const resolved = (re) => {
    for (const m of String(html).matchAll(re)) {
      const href = resolveIconHref(attrValue(m[0], 'href'), base)
      if (href) return href
    }
    return ''
  }
  return resolved(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*>/gi)
    || resolved(/<link[^>]+rel=["'][^"']*(?:shortcut\s+)?icon[^"']*["'][^>]*>/gi)
    || resolved(/<link[^>]+rel=["'][^"']*mask-icon[^"']*["'][^>]*>/gi)
    || new URL('/favicon.ico', base).href
}

/**
 * 多页取图标：子页声明优先（更具体），子页没声明时才看根页。
 * pickFavicon 永远会返回一个地址（兜底 /favicon.ico），所以「有没有声明」要靠
 * 「返回值是否等于那个兜底地址」来判断 —— 否则根页声明的 apple-touch-icon 永远轮不到。
 */
export function pickFaviconPrefer(htmls, base) {
  const bare = new URL('/favicon.ico', base).href
  for (const html of htmls) {
    const href = pickFavicon(html, base)
    if (href && href !== bare) return href
  }
  return bare
}

/* ---------------- 配色 ---------------- */

/** 归一化为小写 #rrggbb；近白/近黑/全透明一律弃用（做卡片底色没有辨识度） */
export function normalizeColor(input) {
  const s = String(input || '').trim().toLowerCase()
  if (!s) return ''
  let hex = ''
  if (/^#[0-9a-f]{3}$/.test(s)) hex = '#' + s.slice(1).split('').map(c => c + c).join('')
  else if (/^#[0-9a-f]{6}$/.test(s)) hex = s
  else {
    const m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/)
    if (!m) return ''
    if (m[4] !== undefined && Number(m[4]) === 0) return ''
    hex = '#' + [m[1], m[2], m[3]].map(n => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')
  }
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luma > 0.9 || luma < 0.05 ? '' : hex
}

function hslToHex(h, s, l) {
  const f = n => {
    const k = (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0')
  }
  return '#' + f(0) + f(8) + f(4)
}

/** 无任何品牌色线索时按域名散列出一个稳定颜色，同一站点每次结果一致 */
export function hashColor(seed) {
  const s = String(seed || 'site')
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return hslToHex(Math.abs(h) % 360, 0.58, 0.46)
}

/**
 * 页面声明的品牌色（`<meta name="theme-color">`），返回**第一条可用**的值。
 *
 * 现代站点常按配色方案声明多条（light `#ffffff` / dark `#0a0b0d`），而这两个值都会被
 * normalizeColor 判为「没辨识度」而不适合做卡片底色。只取文档里第一条会拿到不可用的白色，
 * 于是白白错过后面可能存在的品牌色。这里遍历全部声明取第一条可用的；
 * 都不可用则返回空串，让调用方继续去找 manifest 的 theme_color。
 */
export function pickThemeColor(html) {
  for (const m of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attrValue(m[0], 'name') || attrValue(m[0], 'property') || '').toLowerCase()
    if (key !== 'theme-color') continue
    const v = decodeEntities(attrValue(m[0], 'content')).trim()
    if (v && normalizeColor(v)) return v
  }
  return ''
}

/**
 * 页面声明的 webmanifest 地址（`<link rel="manifest" href="…">`）。
 * 不少站点只把品牌色写在 manifest 的 `theme_color` 里，页面 `<head>` 并不声明
 * `<meta name="theme-color">`（OpenChainBench 即如此），只读 meta 会退化成散列色。
 * 返回空串表示页面没声明 manifest 或地址不可解析。
 */
export function manifestHref(html, base) {
  for (const m of String(html).matchAll(/<link\b[^>]*>/gi)) {
    const rel = attrValue(m[0], 'rel').toLowerCase()
    if (!/(?:^|\s)manifest(?:\s|$)/.test(rel)) continue
    const raw = attrValue(m[0], 'href').trim()
    if (!raw || raw.startsWith('data:')) continue
    try { return new URL(raw, base).href } catch { /* 坏地址忽略，继续找下一个 */ }
  }
  return ''
}

/** 从 manifest JSON 文本里取 `theme_color`；解析失败或字段缺失返回空串 */
export function manifestThemeColor(text) {
  try {
    const j = JSON.parse(String(text || ''))
    return typeof j?.theme_color === 'string' ? j.theme_color : ''
  } catch { return '' }
}

/**
 * 品牌色取值优先级：页面 `meta theme-color` → manifest `theme_color` → `msapplication-TileColor`。
 * 前两者都是站点自声明的品牌色，但页面 meta 是逐页声明、更贴近当前视图，故排最前；
 * manifest 是应用级品牌色，补上「只写在 manifest」的站点；tile 是 IE/Windows 磁贴遗留字段，排最后。
 * 三者都没有才退回分类色 / 散列色。
 */
export function inferColor({ themeColor = '', manifestTheme = '', tileColor = '', categoryColor = '', seed = '' } = {}) {
  const candidates = [
    ['meta', themeColor],
    ['manifest', manifestTheme],
    ['meta', tileColor],
  ]
  for (const [source, raw] of candidates) {
    const color = normalizeColor(raw)
    if (color) return { color, source }
  }
  if (categoryColor) return { color: categoryColor, source: 'category' }
  return { color: hashColor(seed), source: 'hash' }
}

/* ---------------- 分类 ---------------- */

/**
 * 分类线索表。每项拆成两组，权重不同：
 *   - brand   品牌 / 产品名。出现在站名或域名里就是强信号（如域名含 uniswap）。
 *   - generic 泛词。命中只算弱信号，单独出现不足以定论。
 *
 * 表内顺序有意义：同分时靠前的分类胜出（越具体的分类越应写在前面）。
 * 字母序曾经决定平局，导致 "Learn & Earn" 判成空投、Cloudflare 判成云服务器。
 *
 * 中文泛词必须写「词组」而不是「单字词」：CJK 词允许连同描述一起匹配，
 * 而描述是自然语言，裸词必撞 —— `浏览器` 命中过「浏览器扩展」、
 * `节点` 命中过「多节点部署」、`代理` 命中过「授权代理商」。
 */
export const CATEGORY_HINTS = [
  { cat: 'sms',      brand: /jiema|sms-activate|sms-man|sms24/i,                     generic: /sms|接码|验证码|短信/i },
  { cat: 'aiapi',    brand: /openai|claude|gpt|deepseek|gemini|qwen|moonshot|grok/i, generic: /api|llm|大模型|model|router|网关|gateway|token\s*计费|中转/i },
  { cat: 'dex',      brand: /uniswap|pancake|raydium|orca|hyperliquid|1inch|jupiter/i, generic: /swap|dex|perp|永续|聚合器/i },
  { cat: 'cex',      brand: /binance|okx|bybit|coinbase|bitget|kraken|kucoin|mexc/i, generic: /gate\.io|exchange|cex|交易所|交易平台|数字资产交易/i },
  { cat: 'defi',     brand: /compound|aave|curve|pendle|eigenlayer/i,                generic: /defi|lend|yield|vault|借贷|质押收益/i },
  { cat: 'wallet',   brand: /metamask|tokenpocket|phantom|trustwallet|imtoken/i,     generic: /wallet|钱包/i },
  { cat: 'nft',      brand: /opensea|magic.?eden|blur|rarible/i,                     generic: /nft|collectible|数字藏品/i },
  { cat: 'security', brand: /slowmist|certik|peckshield|immunefi/i,                  generic: /security|audit|hack|vuln|审计|漏洞/i },
  { cat: 'chain',    brand: /etherscan|dune|debank|defillama|arkham/i,               generic: /blockchain|explorer|scan|区块浏览器|链上/i },
  { cat: 'coding',   brand: /github|gitlab|vercel|netlify|cursor|replit/i,           generic: /code|coding|developer|deploy|编程|开发/i },
  { cat: 'design',   brand: /dribbble|behance|figma|canva|midjourney/i,              generic: /design|\bui\b|ui[-_ ]?kit|设计/i },
  { cat: 'learning', brand: /coursera|udemy|khanacademy/i,                           generic: /learn|course|tutorial|school|prompt|教程|课程|学习/i },
  { cat: 'airdrop',  brand: /galxe|layer3|zealy/i,                                   generic: /airdrop|earn|空投/i },
  { cat: 'domain',   brand: /namesilo|cloudflare|godaddy|namecheap|porkbun/i,        generic: /domain|域名|注册商/i },
  { cat: 'proxy',    brand: /cpolar|clash|v2ray|shadowrocket/i,                      generic: /proxy|vpn|机场|科学上网|代理服务|代理工具|节点订阅/i },
  { cat: 'account',  brand: /gmail|outlook/i,                                        generic: /卡密|账号|account|shop|购买|充值/i },
  { cat: 'cloud',    brand: /digitalocean|linode|vultr|hetzner|oracle/i,             generic: /vps|cloud|server|云服务器|主机/i },
  { cat: 'data',     brand: /coingecko|coinmarketcap|tradingview/i,                  generic: /token|chart|行情|数据分析|数据看板|链上数据|analytics|terminal|dashboard|research|研报/i },
  { cat: 'media',    brand: /wublockchain|coindesk|theblock/i,                       generic: /media|news|feed|blog|媒体|资讯/i },
]

const BRAND_SCORE = 6
const GENERIC_SCORE = 4

/**
 * 把每条 hint 编译成可执行的正则。
 * 品牌词只匹配站名 / 关键词 / 域名 / 路径（strong），泛词里的纯 ASCII 词同样只匹配 strong；
 * 含中文的泛词歧义低，允许连同描述一起匹配（描述里常出现「数字货币交易平台」这类定性词）。
 * 这里直接按 `|` 切分：现有 hint 均为平铺的 `a|b|c` 写法，不含分组或转义竖线。
 */
const COMPILED_HINTS = CATEGORY_HINTS.map((h, order) => {
  const split = re => {
    const alts = String(re?.source || '').split('|').filter(Boolean)
    return {
      ascii: alts.filter(a => !/[\u4e00-\u9fa5]/.test(a)),
      cjk: alts.filter(a => /[\u4e00-\u9fa5]/.test(a)),
    }
  }
  const brand = split(h.brand)
  const generic = split(h.generic)
  const re = list => (list.length ? new RegExp(list.join('|'), 'i') : null)
  return {
    cat: h.cat,
    order,
    label: String(h.generic?.source || h.brand?.source || '').slice(0, 28),
    brand: re([...brand.ascii, ...brand.cjk]),
    genAscii: re(generic.ascii),
    genCjk: re(generic.cjk),
  }
})

function normBrand(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '')
}

/**
 * 域名词与已收录站名的品牌匹配。
 * 不能简单用互相 includes：'chat' 会被 'chatgpt' 包含，于是任何 chat.* 域名都会继承
 * ChatGPT 的分类。要求「完全相等」或「共享 ≥5 字符前缀」或「一方 ≥6 字符且被另一方包含」。
 */
function brandHit(brand, token) {
  if (!brand || !token) return false
  if (brand === token) return true
  if (brand.length >= 5 && token.length >= 5 && (brand.startsWith(token) || token.startsWith(brand))) return true
  if (token.length >= 6 && brand.includes(token)) return true
  if (brand.length >= 6 && token.includes(brand)) return true
  return false
}

/**
 * 分类推断：关键词命中只是基础分，域名同族（app.uniswap.org vs uniswap.org）与
 * 品牌词命中已有站点（chat.deepseek.com vs 已收录的 DeepSeek）权重更高，
 * 这样「同一个品牌的新入口」不会因为标题里没有关键词而掉进默认分类。
 *
 * 返回 confidence：high（强信号）/ medium（有信号但不唯一）/ low（勉强猜的或走了兜底），
 * UI 据此提示用户复核，避免静默写错分类。
 */
export function inferCategory({ name = '', desc = '', keywords = '', domain = '', path = '' } = {}, existingSites = [], categoryMeta = {}, { fallback = '' } = {}) {
  const hasMeta = Object.keys(categoryMeta).length > 0
  const strong = `${name} ${keywords} ${domain} ${path}`.toLowerCase()
  const withDesc = `${strong} ${desc}`.toLowerCase()
  const hits = new Map()
  // order 参与平局判定：同分时取「在 CATEGORY_HINTS 里声明更靠前」的分类。
  // 已收录站点给出的信号最可靠，固定用 -1 抢在关键词之前。
  const bump = (cat, score, reason, order) => {
    if (!cat || (hasMeta && !categoryMeta[cat])) return
    const cur = hits.get(cat) || { score: 0, reasons: [], order: Number.MAX_SAFE_INTEGER }
    cur.score += score
    cur.order = Math.min(cur.order, order)
    if (reason && !cur.reasons.includes(reason)) cur.reasons.push(reason)
    hits.set(cat, cur)
  }

  for (const h of COMPILED_HINTS) {
    // 品牌词只认站名/关键词/域名/路径；泛词的 ASCII 词同理（`account` 撞「Sign in to your
    // account」会把 AI 站点判成账号类），只有含中文的泛词才允许连描述一起匹配。
    if (h.brand && h.brand.test(strong)) bump(h.cat, BRAND_SCORE, `品牌词 ${h.label}`, h.order)
    const genericHit = (h.genAscii && h.genAscii.test(strong)) || (h.genCjk && h.genCjk.test(withDesc))
    if (genericHit) bump(h.cat, GENERIC_SCORE, `关键词 ${h.label}`, h.order)
  }

  const host = String(domain || '').toLowerCase().replace(/^www\./, '')
  const tokens = domainTokens(host)
  for (const s of existingSites) {
    const sh = hostOf(s.url)
    if (!sh) continue
    if (sh === host) { bump(s.categoryId, 12, `同域名 ${s.id}`, -1); continue }
    if (host.endsWith('.' + sh) || sh.endsWith('.' + host)) { bump(s.categoryId, 9, `同族域名 ${s.id}`, -1); continue }
    const brand = normBrand(s.name)
    if (brand.length >= 4 && tokens.some(t => brandHit(brand, t))) {
      bump(s.categoryId, 6, `品牌词命中「${s.name}」`, -1)
    }
  }

  const ranked = [...hits.entries()].sort((a, b) =>
    b[1].score - a[1].score || a[1].order - b[1].order || a[0].localeCompare(b[0]))
  if (!ranked.length) {
    return { categoryId: fallback, score: 0, confidence: 'low', reasons: [] }
  }
  const [categoryId, info] = ranked[0]
  const runnerUp = ranked[1]?.[1].score || 0
  const confidence = info.score >= 9 ? 'high' : info.score - runnerUp >= 2 ? 'medium' : 'low'
  return { categoryId, score: info.score, confidence, reasons: info.reasons, runnerUp }
}

/**
 * 找「这个域名是否已被收录」的参照站点：先精确同域名，再退到同族域名
 * （app.uniswap.org ↔ uniswap.org）。抓不到页面时用它复用已收录的站名。
 */
function knownSiteFor(host, existingSites) {
  const h = String(host || '').toLowerCase()
  if (!h) return null
  let family = null
  for (const s of existingSites) {
    const sh = hostOf(s?.url)
    if (!sh) continue
    if (sh === h) return { site: s, exact: true }
    if (!family && (h.endsWith('.' + sh) || sh.endsWith('.' + h))) family = { site: s, exact: false }
  }
  return family
}

/* ---------------- 主入口 ---------------- */

/**
 * 由 HTML 与地址推出收录所需的全部字段。
 * existingSites / categoryMeta 用于「像不像已收录的某站」这类推断，缺失时退化为纯关键词。
 *
 * rootHtml：目标地址是子页时，调用方额外抓来的主域名首页。**收录的永远是主域名**
 * （两个入口都把地址收敛成域名），所以站点级元信息应以主域名为准 —— 否则贴一个
 * `/platform/windows` 会把整站描述写成「51 款 Windows 客户端」，而卡片链接指向主域名。
 *
 * manifestTheme：调用方从页面声明的 webmanifest 里抓到的 `theme_color`（本模块无 I/O）。
 * 仅在页面未声明 `meta theme-color` 时才需要传，作为品牌色的次级来源。
 */
export function inferSite({ html, rootHtml = '', manifestTheme = '', url, existingSites = [], categoryMeta = {}, fallbackCategory = '' }) {
  const raw = String(url || '').trim()
  let target
  try { target = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw) } catch { throw new Error(`地址无法解析：${url}`) }
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('仅支持 http/https 地址')

  const host = target.hostname.replace(/^www\./, '').toLowerCase()
  const base = target.origin + '/'
  const pageSource = String(html || '')
  const rootSource = String(rootHtml || '')

  // 根页在前、子页兜底；两者内容相同（子页 302 回首页）或没传根页时不重复计算
  const hasRoot = Boolean(rootSource) && rootSource !== pageSource
  const pages = (hasRoot
    ? [{ html: rootSource, scope: 'root' }, { html: pageSource, scope: 'page' }]
    : [{ html: pageSource, scope: 'page' }]
  ).map(p => ({ ...p, blocked: looksBlocked(p.html) }))

  // 只有「所有页都被拦截」才算被拦截：根页正常时我们手上是有真实内容的，不该提示反爬
  const blocked = pages.every(p => p.blocked)
  const pool = blocked ? pages : pages.filter(p => !p.blocked)

  let nameInfo = null
  for (const p of pool) {
    const r = pickName(p.html, host, { skipTitle: p.blocked })
    if (r.source !== 'domain') { nameInfo = { ...r, scope: p.scope }; break }
  }
  if (!nameInfo) nameInfo = { ...pickName('', host, {}), scope: pool[0]?.scope || 'page' }

  // 页面抓不到（反爬/超时）时名字只能靠域名拼，如 chat.openai.com → "Openai"。
  // 若这个域名已收录过，直接沿用已收录的名字（ChatGPT）比拼域名靠谱得多。
  if (nameInfo.source === 'domain') {
    const known = knownSiteFor(host, existingSites)
    if (known?.site?.name) {
      nameInfo = { ...nameInfo, name: known.site.name, source: 'known', confidence: known.exact ? 'high' : 'medium' }
    }
  }

  // 分类把各页文本合起来判断：子页常带栏目关键词，根页常带整站定性词，合起来信号更全
  const joinMeta = keys => pool.map(p => metaContent(p.html, keys)).filter(Boolean).join(' ')
  const category = inferCategory({
    name: nameInfo.name,
    desc: joinMeta(['description', 'og:description']),
    keywords: joinMeta(['keywords', 'og:keywords']),
    domain: host,
    path: target.pathname,
  }, existingSites, categoryMeta, { fallback: fallbackCategory })

  const categoryLabel = categoryMeta[category.categoryId]?.label || ''

  let descInfo = null
  for (const p of pool) {
    const r = pickDesc(p.html, { name: nameInfo.name, host, categoryLabel, blocked: p.blocked })
    if (r.source !== 'generated') { descInfo = { ...r, scope: p.scope }; break }
  }
  if (!descInfo) descInfo = { ...pickDesc('', { name: nameInfo.name, host, categoryLabel }), scope: pool[0]?.scope || 'page' }

  const themeColor = pickThemeColor(pageSource)
    || (hasRoot ? pickThemeColor(rootSource) : '')
  const tileColor = metaContent(pageSource, ['msapplication-tilecolor', 'msapplication-navbutton-color'])
    || (hasRoot ? metaContent(rootSource, ['msapplication-tilecolor', 'msapplication-navbutton-color']) : '')
  // manifestTheme 由调用方抓取后传入（本模块无 I/O）：页面 meta 已声明主题色时调用方会跳过抓取，
  // 所以这里的值通常只在「主题色只写在 manifest」的站点上非空
  const colorInfo = inferColor({
    themeColor,
    manifestTheme,
    tileColor,
    categoryColor: categoryMeta[category.categoryId]?.color || '',
    seed: host,
  })

  // 用途与分类正交：分类是归属（唯一），用途是「拿它干什么」（可多选）。
  // 用推断出的分类做基线打底，再用站名 / 描述 / 关键词命中补充，
  // 口径与 shared/purposes.mjs 同源，保证线上与控制台两个入口结果一致。
  const purposes = inferPurposes({
    categoryId: category.categoryId,
    name: nameInfo.name,
    desc: descInfo.desc,
    keywords: joinMeta(['keywords', 'og:keywords']),
    url: target.href,
  })

  return {
    url: target.href,
    domain: host,
    name: nameInfo.name,
    desc: descInfo.desc,
    faviconUrl: pickFaviconPrefer(hasRoot ? [pageSource, rootSource] : [pageSource], base),
    color: colorInfo.color,
    categoryId: category.categoryId,
    categoryLabel,
    purposes,
    blocked,
    // 该字段取自根页还是子页：贴子页时 UI 要说明「描述来自主域名」，否则用户对不上当前页面
    scope: { name: nameInfo.scope, desc: descInfo.scope },
    sources: {
      name: nameInfo.source,
      desc: descInfo.source,
      category: category.reasons,
      color: colorInfo.source,
    },
    confidence: {
      name: nameInfo.confidence,
      desc: descInfo.source === 'generated' ? 'low' : 'medium',
      category: category.confidence,
      // 分类色只是「没有品牌色时的兜底」，不该和站点自己声明的 theme-color 同档
      color: colorInfo.source === 'meta' || colorInfo.source === 'manifest' ? 'high' : colorInfo.source === 'category' ? 'medium' : 'low',
    },
  }
}