/**
 * 图片获取 **提供者注册表（热拔插）** —— 图标与封面共用一套机制。
 *
 * ## 为什么图标与封面共用一套
 *
 * 两者本质是同一件事：**给定站点，拿到一张图（bytes + 格式）**。
 * 差别只在「从哪拿」——
 *   · favicon：页面里的 icon 声明 → `/favicon.ico` → 第三方图标 API；
 *   · 封面：页面里的 `og:image` / `twitter:image`。
 * 差异封在各自 provider 里，机制（注册、排序、回退）只有一份。
 *
 * ## 与既有引擎同构
 *
 * 与 `shared/site-engine.mjs`、`shared/translate-engine.mjs` 同一套形态：
 *   · 注册表 + **有序链** + 回退优先（任一 provider 失败静默换下一个，绝不抛给调用方）；
 *   · 环境变量可换序 / 裁剪（`NAV_ICON_PROVIDERS` / `NAV_COVER_PROVIDERS`）；
 *   · 每个 provider 自带契约测试（`tools/console/test-image-engine.mjs`）。
 *
 * ## 注入式设计（为什么 provider 不自己抓网络）
 *
 * provider 用调用方给的 `ctx`（`fetchBuf` / `fetchCapped` …）出网，而不是自己 import。
 * 因为两边出网纪律不同：
 *   · `scripts/fetch-favicons.mjs` 是本地脚本，可以直连、可以全局 fetch；
 *   · `api/cover.js` 是**公网可触达**端点，出网必须走 `fetchCapped`（SSRF 防护）。
 * 把出网方式留在调用方，provider 只描述「怎么找、怎么判」，这份差异就不会被抹平。
 *
 * ## 「热拔插」的确切含义
 *
 *   · 换供应商 = 改一个环境变量，不碰调用方代码；
 *   · 新增供应商 = 多一次 `registerImageProvider()`；
 *   · provider 全失败 → 返回 `null`，调用方按「这一站没有图」处理（降级而非报错）。
 */

const registry = new Map()
let seq = 0

/** 内置默认 UA：与 scripts/fetch-favicons.mjs 保持一致，避免换实现后站点行为突变 */
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/* ---------------- 注册表 ---------------- */

/**
 * 注册一个图片提供者。同 id 覆盖（便于测试与热替换）。
 *
 * @param {{
 *   id: string,
 *   label?: string,
 *   kind: 'favicon' | 'cover',
 *   order?: number,                       // 越小越先试；缺省按注册顺序追加到 100 之后
 *   available?: () => boolean,            // 缺省恒 true（如第三方源可用开关关掉）
 *   fetch: (site: object, ctx: object) => Promise<{buf: Buffer, ext: string, mime?: string} | null>,
 * }} spec
 *
 * **ext 契约：一律不带点**（`'png'` 而非 `'.png'`，与 detectExt 的返回一致）。
 * 拼接点号、决定落盘路径是调用方的事 —— 两处约定不同曾导致 `siteId + ext` 拼出
 * `abc.png` 与 `abc.png` 看似一样、实则一个来自 `'.png'` 一个来自 `'png'`，
 * 在 `--no-ext` 之类的路径上立刻错位。
 */
export function registerImageProvider(spec) {
  if (!spec || !spec.id) throw new Error('图片提供者必须提供 id')
  if (typeof spec.fetch !== 'function') throw new Error(`图片提供者 ${spec.id} 缺少 fetch`)
  if (spec.kind !== 'favicon' && spec.kind !== 'cover') throw new Error(`图片提供者 ${spec.id} 的 kind 必须是 favicon 或 cover`)
  const entry = {
    id: String(spec.id),
    label: spec.label ? String(spec.label) : String(spec.id),
    kind: spec.kind,
    order: Number.isFinite(spec.order) ? Number(spec.order) : 100 + seq,
    available: typeof spec.available === 'function' ? spec.available : () => true,
    fetch: spec.fetch,
  }
  seq += 1
  registry.set(entry.id, entry)
  return entry
}

/** 提供者清单（供控制台/接口展示，顺序即默认尝试顺序） */
export function listImageProviders({ kind, check = true } = {}) {
  return [...registry.values()]
    .filter(p => !kind || p.kind === kind)
    .sort((a, b) => a.order - b.order)
    .map(p => ({
      id: p.id,
      label: p.label,
      kind: p.kind,
      order: p.order,
      available: check ? Boolean(p.available()) : true,
    }))
}

const ENV_BY_KIND = { favicon: 'NAV_ICON_PROVIDERS', cover: 'NAV_COVER_PROVIDERS' }

/**
 * 产出实际要跑的提供者链。
 * 优先级：显式传入 → 环境变量 → 注册顺序；然后过滤掉不可用项。
 *
 * 容错语义（与 translatorChain 一致，配置写错不该让链路整体失效）：
 *   · 列出的部分 id 未注册 → 忽略未注册的，其余照用；
 *   · 列出的 id **一个都没匹配上** → 回退全量（多为配置事故，不静默失效）；
 *   · `NAV_ICON_PROVIDERS=none`（或 off / 0）→ 显式清空链。
 */
export function imageChain(kind = 'favicon', explicit) {
  const all = [...registry.values()].filter(p => p.kind === kind).sort((a, b) => a.order - b.order)
  const raw = explicit !== undefined && explicit !== null
    ? String(explicit)
    : String(process.env[ENV_BY_KIND[kind] || ''] || '')
  const ids = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (ids.length === 1 && ['none', 'off', '0'].includes(ids[0])) return []
  const matched = ids.map(id => all.find(p => p.id === id)).filter(Boolean)
  const chosen = matched.length ? matched : all
  return chosen.filter(p => p.available())
}

/**
 * 按链依次尝试取图。任一 provider 成功即返回；全部失败返回 null。
 *
 * @param {object} site 站点对象（至少要有 url；封面场景可能还要 icon）
 * @param {{ kind?: 'favicon'|'cover', chain?: object[], ctx?: object }} opts
 * @returns {Promise<{ buf: Buffer, ext: string, mime?: string, provider: string } | null>}
 */
export async function resolveImage(site, { kind = 'favicon', chain, ctx = {} } = {}) {
  const list = Array.isArray(chain) ? chain : imageChain(kind)
  for (const p of list) {
    try {
      const out = await p.fetch(site, ctx)
      if (out && out.buf && out.buf.length) return { ...out, provider: p.id }
    } catch { /* 换下一个 provider */ }
  }
  return null
}

/* ---------------- 通用工具（favicon 与 cover 都可能用） ---------------- */

/** 补协议：站点表里的 url 多数是裸域名 */
export function normalizeSiteUrl(url) {
  const s = String(url || '').trim()
  return s.includes('://') ? s : `https://${s}`
}

/** 去协议、去路径、去 www 的主机名 */
export function normalizeHost(url) {
  return String(url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')
}

/** 按 magic bytes 判格式（顺序有讲究：PNG 与 ICO 的前几字节都是 0x00 开头，PNG 先判） */
export function detectExt(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'ico'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  if (buf.length >= 6 && buf.toString('latin1', 0, 4) === 'GIF8') return 'gif'
  if (buf.length >= 12 && buf.toString('latin1', 0, 12) === '\x00\x00\x00\x1cftypavif') return 'avif'
  const head = buf.toString('latin1', 0, 200)
  if (head.includes('<svg') || head.includes('<?xml')) return 'svg'
  return 'bin'
}

/** 解出 data: 的绝对地址；抑制型 data: 与非法值返回 null */
export function toAbsolute(href, base) {
  const h = String(href || '').trim()
  if (!h) return null
  // `data:,`（抑制 favicon 请求）等于没声明；`data:image/…` 是真实内联图标，原样保留
  if (h.startsWith('data:')) {
    const comma = h.indexOf(',')
    if (comma < 0 || !/^image\//i.test(h.slice(5, comma))) return null
    return h.slice(comma + 1).trim() ? h : null
  }
  try { return new URL(h, base).href } catch { return null }
}

/** 内联 data: 图片解码为 Buffer；非 data: 或解码失败返回 null */
export function decodeDataUri(uri) {
  const comma = String(uri || '').indexOf(',')
  if (comma < 0) return null
  const meta = uri.slice(5, comma)
  const payload = uri.slice(comma + 1)
  try {
    return /;base64/i.test(meta)
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8')
  } catch { return null }
}

/**
 * 取标签属性值，按定界引号配对。
 * 不能用 `[^"']+`：内联 SVG 的 href 值是双引号包裹、内部含单引号
 * （`href="data:image/svg+xml,%3Csvg xmlns='…'"`），会从第一个单引号处被截断。
 */
export function attrValue(tag, name) {
  const quoted = tag.match(new RegExp(name + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", 'i'))
  if (quoted) return quoted[2]
  const bare = tag.match(new RegExp(name + '\\s*=\\s*([^\\s>]+)', 'i'))
  return bare ? bare[1] : ''
}

/** 从 HTML 里抽 icon 声明并按「更像正牌图标」排序 */
export function extractIconLinks(html, base) {
  const links = []
  const re = /<link[^>]+rel=["']([^"']*icon[^"']*)["'][^>]*>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    const rel = m[1].toLowerCase()
    const href = attrValue(m[0], 'href')
    if (!href) continue
    const abs = toAbsolute(href, base)
    if (!abs) continue
    links.push({ url: abs, rel, sizes: attrValue(m[0], 'sizes') })
  }
  links.sort((a, b) => {
    const rank = (l) => {
      if (l.rel.includes('apple-touch-icon')) return 0
      if (l.sizes.includes('180') || l.sizes.includes('192') || l.sizes.includes('96') || l.sizes.includes('128')) return 1
      return 2
    }
    return rank(a) - rank(b)
  })
  return links
}

/**
 * favicon.im 对查不到图标的域名会返回 200 + 灰色占位 SVG（灰圆 + 斜体 f），
 * 体积小、格式合法，若不识别会被当成真图标落盘。
 */
export function isPlaceholderIcon(buf) {
  if (buf.length > 512) return false
  const text = buf.toString('utf8')
  return text.includes('<svg') && text.includes('#808080') && /<text[^>]*>\s*f\s*<\/text>/i.test(text)
}

/** 默认出网实现（本地脚本场景）；调用方可用 ctx.fetchBuf 覆盖 */
export async function defaultFetchBuf(url, { timeoutMs = 12000, headers, maxBytes } = {}) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': DEFAULT_UA, Accept: '*/*', ...(headers || {}) },
      redirect: 'follow',
      signal: ctl.signal,
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length) throw new Error('empty')
    if (maxBytes && buf.length > maxBytes) throw new Error('too large')
    return buf
  } finally { clearTimeout(timer) }
}

/** 下载并校验一张候选图；不合规直接抛（由 resolveImage 换成下一个候选） */
export async function downloadImage(url, ctx = {}) {
  const buf = url.startsWith('data:') ? decodeDataUri(url) : await (ctx.fetchBuf || defaultFetchBuf)(url, ctx.fetchOpts || {})
  if (!buf || !buf.length) throw new Error('empty')
  const ext = detectExt(buf)
  if (ext === 'bin') throw new Error('unknown format')
  if (isPlaceholderIcon(buf)) throw new Error('placeholder icon (source has no real favicon)')
  return { buf, ext }
}

/* ---------------- 内建 favicon 三源（原 scripts/fetch-favicons.mjs 的三级回退链） ---------------- */

registerImageProvider({
  id: 'page-links',
  label: '页面 icon 声明',
  kind: 'favicon',
  order: 100,
  fetch: async (site, ctx) => {
    const base = normalizeSiteUrl(site && site.url)
    const fetchBuf = ctx.fetchBuf || defaultFetchBuf
    const html = (await fetchBuf(base, ctx.fetchOpts || {})).toString('utf8')
    const links = extractIconLinks(html, base)
    for (const l of links.slice(0, ctx.maxCandidates || 3)) {
      try { return await downloadImage(l.url, ctx) } catch { /* 换下一个候选 */ }
    }
    return null
  },
})

registerImageProvider({
  id: 'favicon-ico',
  label: '/favicon.ico',
  kind: 'favicon',
  order: 200,
  fetch: async (site, ctx) => {
    const base = normalizeSiteUrl(site && site.url)
    const u = new URL('/favicon.ico', base).href
    try { return await downloadImage(u, ctx) } catch { return null }
  },
})

registerImageProvider({
  id: 'favicon-im',
  label: 'favicon.im（第三方兜底）',
  kind: 'favicon',
  order: 300,
  /** 第三方源可以被显式关掉（离线构建、隐私敏感环境） */
  available: () => process.env.NAV_ICON_DISABLE_THIRD_PARTY !== '1',
  fetch: async (site, ctx) => {
    const base = normalizeSiteUrl(site && site.url)
    const host = normalizeHost(base)
    try { return await downloadImage(`https://favicon.im/${host}?format=png&size=128`, ctx) } catch { return null }
  },
})
