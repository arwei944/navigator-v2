/**
 * 浏览器同步的临时工作区核心（纯函数，无 IO）。
 *
 * ## 为什么要有「临时工作区」
 *
 * 浏览器历史动辄几千条：导航站、搜索结果页、登录跳转、一次性文档……
 * 直接进主库会瞬间把 300 条精心维护的站点表冲成垃圾场，而且 `sanitizeSites`
 * 只挡结构错误，挡不住「结构合法但没价值」。
 *
 * 所以原始条目先落到 `staging/`（独立对象前缀，**绝不写 sites.json**），
 * 经过分类、筛选、人工确认后才 `promote` 进主库。工作区可以随时整批丢弃。
 *
 * ## 标准化口径
 *
 * 输出的是与主库完全一致的站点对象（15 个字段），不是另一种中间格式 ——
 * 否则入主库时还要再转换一次，两套字段迟早漂移。
 *
 * ## 去重
 *
 * 归一化 URL（去协议 / www / query / hash / 尾斜杠）后比较：
 *   - 批次内重复：合并为一条，访问次数累加；
 *   - 与主库重复：标 `duplicateOf`，默认跳过，用户可显式覆盖。
 */
import { createHash } from 'node:crypto'

/** 浏览器里那些永远不该成为站点的协议 / 域名 */
const INVALID_PATTERNS = [
  /^(chrome|edge|about|chrome-extension|moz-extension|file|javascript|data|blob):/i,
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i,
  /^\[::1\]/i,
]

/** 域名 / 标题 → 分类建议（顺序即优先级；命中即停） */
const CATEGORY_RULES = [
  [/(github|gitlab|gitee|stackoverflow|npmjs|pypi|developer\.mozilla|dev\.to|vercel|netlify)/i, 'coding'],
  [/(figma|dribbble|behance|canva|unsplash|adobe|sketch)/i, 'design'],
  [/(notion|obsidian|roamresearch|logseq|craft|typora)/i, 'writing'],
  [/(openai|chatgpt|claude|gemini|deepseek|kimi|moonshot|doubao|perplexity|copilot|midjourney|huggingface)/i, 'starter'],
  [/(binance|okx|coinbase|kraken|bybit|bitget|gate\.io)/i, 'cex'],
  [/(uniswap|pancakeswap|curve|1inch|jupiter|raydium)/i, 'dex'],
  [/(aave|compound|makerdao|lido|eigenlayer|pendle|morpho)/i, 'defi'],
  [/(etherscan|dune\.com|defillama|coingecko|coinmarketcap|nansen|arkham|tradingview)/i, 'data'],
  [/(metamask|phantom|rabby|walletconnect|safe\.global)/i, 'wallet'],
  [/(namecheap|godaddy|aliyun|dnspod|cloudflare|tencent)/i, 'domain'],
  [/(vultr|digitalocean|linode|aws\.amazon|azure|cloud\.google|oracle\.com)/i, 'cloud'],
  [/(v2ray|clash|surge|shadowsocks|wireguard|tailscale|vpn)/i, 'proxy'],
  [/(sms|receive-sms|smspool|接码)/i, 'sms'],
  [/(coursera|udemy|khanacademy|arxiv|scholar\.google|papers)/i, 'learning'],
  [/(medium|substack|reddit|hacker ?news|twitter|x\.com|weibo|36kr|sspai)/i, 'media'],
  [/(chat|assistant)/i, 'starter'],
]

/**
 * URL 归一化：**保留路径**，去掉协议、www、query、hash、尾斜杠。
 *
 * 为什么保留路径：导航站里 `github.com/user/repo` 与 `github.com` 是两个用途；
 * 但 query 常用于 utm / 会话参数，必须去掉，否则同一页面每次都是新条目。
 */
export function normalizeUrl(raw) {
  let input = String(raw || '').trim()
  if (!input) return ''
  if (!/^https?:\/\//i.test(input)) input = `https://${input}`
  try {
    const u = new URL(input)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    let path = u.pathname.replace(/\/+$/, '')
    if (path === '/') path = ''
    return `${host}${path}`.toLowerCase()
  } catch {
    return ''
  }
}

export function domainOf(raw) {
  try {
    const u = new URL(/^https?:\/\//i.test(String(raw)) ? String(raw) : `https://${raw}`)
    return u.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function isIngestable(raw) {
  const text = String(raw || '').trim()
  if (!text) return { ok: false, reason: '空链接' }
  if (INVALID_PATTERNS.some(re => re.test(text))) return { ok: false, reason: '浏览器内部页面或本机地址' }
  const host = domainOf(text)
  if (!host || !host.includes('.')) return { ok: false, reason: '域名不完整' }
  return { ok: true }
}

function hash8(text) {
  return createHash('sha1').update(String(text)).digest('hex').slice(0, 8)
}

function initialOf(name) {
  const first = String(name || '').trim().charAt(0)
  return first ? first.toUpperCase() : '#'
}

export function categoryColor(categoryId, categories) {
  for (const g of Array.isArray(categories) ? categories : []) {
    const hit = (g.categories || []).find(c => c.id === categoryId)
    if (hit) return hit.dotColor || '#64748b'
  }
  return '#64748b'
}

/** 分类建议：返回一个**已登记**的 id，找不到就用回退分类 */
export function suggestCategory(url, title, categories, fallback = 'starter') {
  const hay = `${domainOf(url)} ${title || ''}`
  for (const [re, id] of CATEGORY_RULES) {
    if (re.test(hay) && isAllowedCategory(id, categories)) return id
  }
  if (isAllowedCategory(fallback, categories)) return fallback
  const first = (categories || [])[0]?.categories?.[0]?.id
  return first || fallback
}

export function isAllowedCategory(id, categories) {
  if (!id) return false
  return (Array.isArray(categories) ? categories : []).some(g =>
    (g.categories || []).some(c => c.id === id),
  )
}

/** 在给定分类表里查标签 */
export function categoryLabel(id, categories) {
  for (const g of Array.isArray(categories) ? categories : []) {
    const hit = (g.categories || []).find(c => c.id === id)
    if (hit) return { groupId: g.id, groupLabel: g.label, id: hit.id, label: hit.label }
  }
  return null
}

/**
 * 单条浏览器记录 → 标准站点对象。
 *
 * @param {{url:string,title?:string,visitCount?:number,lastVisitTime?:number,source?:string}} raw
 * @param {{categories?:object[], now?:number, sortOrder?:number}} opts
 */
export function toSite(raw, opts = {}) {
  const categories = opts.categories || []
  const now = Number(opts.now) || Date.now()
  const url = normalizeUrl(raw?.url)
  const domain = domainOf(raw?.url)
  const name = String(raw?.title || '').trim() || domain || url
  const categoryId = suggestCategory(url, name, categories)
  const sourceLabel = raw?.source === 'bookmark' ? '书签' : raw?.source === 'tab' ? '当前标签页' : '浏览历史'
  const visit = Math.max(0, Number(raw?.visitCount) || 0)

  return {
    // 稳定 id：同一个网址重复同步不会造出新站点
    id: `ing-${hash8(url)}`,
    name: name.length > 80 ? `${name.slice(0, 77)}…` : name,
    url,
    desc: `来自浏览器${sourceLabel}：${domain}${visit > 1 ? `（访问 ${visit} 次）` : ''}`,
    categoryId,
    color: categoryColor(categoryId, categories),
    initial: initialOf(name),
    sortOrder: Number(opts.sortOrder) || 0,
    visitCount: visit,
    createdAt: Number(raw?.lastVisitTime) || now,
    updatedAt: now,
    icon: '',
    aliases: [],
    purposes: [],
    position: {
      domain: '',
      stage: 'inbox',
      source: 'browser',
      confidence: 0.3,
      reason: '浏览器同步，待整理',
    },
  }
}

/**
 * 把一批浏览器记录整理成批次。
 *
 * @param {object[]} rawItems
 * @param {{categories?:object[], existingSites?:object[], now?:number, limit?:number, batchId?:string}} opts
 */
export function buildBatch(rawItems, opts = {}) {
  const categories = opts.categories || []
  const existing = Array.isArray(opts.existingSites) ? opts.existingSites : []
  const now = Number(opts.now) || Date.now()
  const limit = Math.max(1, Number(opts.limit) || 2000)
  const existingByUrl = new Map(
    existing.map(s => [normalizeUrl(s?.url), String(s?.id || '')]).filter(([u]) => u),
  )

  const byUrl = new Map()
  const invalid = []
  for (const raw of Array.isArray(rawItems) ? rawItems : []) {
    if (byUrl.size >= limit) break
    const check = isIngestable(raw?.url)
    if (!check.ok) {
      invalid.push({ url: String(raw?.url || '').slice(0, 200), reason: check.reason })
      continue
    }
    const url = normalizeUrl(raw.url)
    if (!url) {
      invalid.push({ url: String(raw?.url || '').slice(0, 200), reason: '无法解析' })
      continue
    }
    const prev = byUrl.get(url)
    if (prev) {
      // 同一网址在历史里出现多次：访问次数相加，标题取更长的那个
      prev.visitCount += Math.max(0, Number(raw?.visitCount) || 0)
      if (String(raw?.title || '').length > String(prev.rawTitle || '').length) {
        prev.rawTitle = String(raw.title)
        prev.title = String(raw.title)
      }
      continue
    }
    byUrl.set(url, {
      key: url,
      url,
      title: String(raw?.title || ''),
      rawTitle: String(raw?.title || ''),
      visitCount: Math.max(0, Number(raw?.visitCount) || 0),
      lastVisitTime: Number(raw?.lastVisitTime) || 0,
      source: String(raw?.source || 'history'),
    })
  }

  const items = [...byUrl.values()].map((item, index) => {
    const site = toSite(item, { categories, now, sortOrder: index + 1 })
    const duplicateOf = existingByUrl.get(item.url) || null
    return {
      key: item.key,
      url: item.url,
      title: item.title,
      source: item.source,
      visitCount: item.visitCount,
      lastVisitTime: item.lastVisitTime,
      duplicateOf,
      status: 'pending',
      site,
    }
  })

  const batch = {
    kind: 'nav-ingest-batch',
    schema: 1,
    id: opts.batchId || `batch-${now}-${hash8(`${now}:${items.length}`)}`,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    source: 'browser',
    status: 'staging',
    stats: {
      incoming: Array.isArray(rawItems) ? rawItems.length : 0,
      deduped: items.length,
      newSites: items.filter(i => !i.duplicateOf).length,
      duplicates: items.filter(i => i.duplicateOf).length,
      invalid: invalid.length,
    },
    items,
    invalid: invalid.slice(0, 200),
  }
  return batch
}

/**
 * 把选中的工作区条目合并进主库（纯函数）。
 *
 * @param {object[]} sites 当前主库站点
 * @param {object} batch
 * @param {{keys?:string[], strategy?:'skip'|'overwrite'|'new-id', categoryOverrides?:Record<string,string>}} opts
 */
export function mergeBatchInto(sites, batch, opts = {}) {
  const strategy = ['skip', 'overwrite', 'new-id'].includes(opts.strategy) ? opts.strategy : 'skip'
  const wanted = Array.isArray(opts.keys) && opts.keys.length
    ? new Set(opts.keys.map(String))
    : new Set((batch.items || []).map(i => String(i.key)))
  const overrides = opts.categoryOverrides || {}
  const next = [...(Array.isArray(sites) ? sites : [])]
  const byUrl = new Map(next.map(s => [normalizeUrl(s?.url), s]))
  const usedIds = new Set(next.map(s => String(s?.id || '')))
  let maxSort = next.reduce((m, s) => Math.max(m, Number(s?.sortOrder) || 0), 0)

  const promoted = []
  const skipped = []
  const updated = []

  for (const item of batch.items || []) {
    if (!wanted.has(String(item.key))) continue
    if (item.status === 'promoted' || item.status === 'discarded') continue
    const site = { ...(item.site || {}) }
    const override = overrides[item.key]
    if (override) {
      site.categoryId = override
      // 颜色跟随覆盖后的分类（由调用方传入的 site 可能还是旧色，这里保持简单不重算）
    }

    const url = normalizeUrl(site.url)
    const hit = byUrl.get(url)
    if (hit) {
      if (strategy === 'skip') { skipped.push(item.key); continue }
      if (strategy === 'overwrite') {
        const merged = {
          ...site,
          id: hit.id,
          sortOrder: hit.sortOrder,
          createdAt: hit.createdAt,
          // 本地状态以主库为准
          archived: hit.archived === true ? true : undefined,
          pinned: hit.pinned === true ? true : undefined,
          visitCount: Math.max(Number(hit.visitCount) || 0, Number(site.visitCount) || 0),
        }
        const idx = next.findIndex(s => s.id === hit.id)
        if (idx >= 0) next[idx] = merged
        byUrl.set(url, merged)
        updated.push(item.key)
        promoted.push(item.key)
        continue
      }
      // new-id：同一网址也新建一条，id 必须重新生成
    }

    let id = String(site.id || `ing-${hash8(url)}`)
    if (usedIds.has(id)) {
      let n = 2
      while (usedIds.has(`${id}-${n}`)) n += 1
      id = `${id}-${n}`
    }
    usedIds.add(id)
    maxSort += 1
    const created = { ...site, id, sortOrder: maxSort }
    next.push(created)
    byUrl.set(url, created)
    promoted.push(item.key)
  }

  return {
    sites: next,
    promoted,
    updated,
    skipped,
    stats: {
      before: Array.isArray(sites) ? sites.length : 0,
      after: next.length,
      added: next.length - (Array.isArray(sites) ? sites.length : 0),
      updated: updated.length,
      skipped: skipped.length,
    },
  }
}

/** 批次摘要（列表用，不返回整批 items） */
export function summarizeBatch(batch) {
  return {
    id: batch.id,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    status: batch.status,
    source: batch.source,
    stats: batch.stats,
    pending: (batch.items || []).filter(i => i.status === 'pending').length,
    promoted: (batch.items || []).filter(i => i.status === 'promoted').length,
  }
}