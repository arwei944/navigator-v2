/**
 * 内容动态的核心纯函数：解析订阅源、清洗文本、指纹去重、分类、退避。
 *
 * ## 边界
 *
 * 这里**不做网络请求、不碰数据库**，所以可以在 Node 里直接断言。
 * 抓取失败、条件请求、robots 在 `server/content-fetch.mjs`；
 * 存储与 30 天清理在 `server/content-store.mjs`。
 *
 * ## 为什么先支持 RSS/Atom/JSON Feed
 *
 * 它们是发布方**主动提供**的结构化数据：有标题、时间、链接、摘要，
 * 不需要正文抽取，也不需要猜测页面结构。优先级：
 * RSS/Atom → JSON Feed → 官方 API（HN/arXiv/GitHub/V2EX）→ 页面变更（后续阶段）。
 */
import { createHash } from 'node:crypto'
import { XMLParser } from 'fast-xml-parser'
import { CATEGORY_GROUPS } from './categories.mjs'
import { normalizeUrl } from './ingest-core.mjs'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '#cdata',
  trimValues: true,
  parseTagValue: false,
  processEntities: true,
})

const HTML_ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
}

/** HTML → 纯文本：去标签、解码常见实体、压空白 */
export function stripHtml(input) {
  let text = String(input || '')
  if (!text) return ''
  text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ')
  text = text.replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, ' ')
  text = text.replace(/<br\s*\/?>/gi, ' ')
  text = text.replace(/<[^>]+>/g, ' ')
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    text = text.split(entity).join(char)
  }
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  return text.replace(/\s+/g, ' ').trim()
}

export function truncate(text, max = 600) {
  const value = String(text || '').trim()
  if (value.length <= max) return value
  return `${value.slice(0, max - 1).trim()}…`
}

export function cleanTitle(raw) {
  return truncate(stripHtml(raw).replace(/\s*[-|–—]\s*[^-|–—]{1,40}$/u, '').trim(), 200)
}

function asArray(value) {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function textOf(value) {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'object') {
    if (value['#cdata'] != null) return textOf(value['#cdata'])
    if (value['#text'] != null) return textOf(value['#text'])
    if (value._ != null) return textOf(value._)
  }
  return ''
}

function hrefOf(value, baseUrl) {
  const raw = typeof value === 'string' ? value : (value?.['@_href'] || value?.['@_url'] || textOf(value))
  if (!raw) return ''
  try { return new URL(raw, baseUrl || undefined).toString() } catch { return String(raw) }
}

function parseDate(value, fallback) {
  const raw = textOf(value) || String(value || '')
  const t = Date.parse(raw)
  return Number.isFinite(t) ? t : fallback
}

/** 统一条目形状；后续存储与去重只认这一个结构 */
export function makeEntry(input = {}) {
  const now = Number(input.now) || Date.now()
  const title = cleanTitle(input.title)
  const url = String(input.url || '').trim()
  const summary = truncate(stripHtml(input.summary || input.content || ''), input.summaryMax || 600)
  return {
    guid: String(input.guid || url || title || ''),
    url,
    title,
    summary,
    author: truncate(stripHtml(input.author || ''), 80),
    publishedAt: Number(input.publishedAt) || now,
    fetchedAt: now,
  }
}

/** 解析 RSS 2.0 / Atom / RDF；返回统一条目 */
export function parseFeed(xml, { baseUrl = '', now = Date.now() } = {}) {
  const doc = parser.parse(String(xml || ''))
  const items = []
  let feedTitle = ''

  const rss = doc?.rss?.channel
  if (rss) {
    feedTitle = textOf(rss.title)
    for (const item of asArray(rss.item)) {
      const link = hrefOf(item.link, baseUrl)
      items.push(makeEntry({
        guid: textOf(item.guid) || link || textOf(item.title),
        url: link,
        title: textOf(item.title),
        summary: textOf(item['content:encoded']) || textOf(item.description) || textOf(item.summary),
        author: textOf(item['dc:creator']) || textOf(item.author),
        publishedAt: parseDate(item.pubDate || item['dc:date'] || item.published, now),
        now,
      }))
    }
    return { feedTitle, items }
  }

  const rdf = doc?.['rdf:RDF'] || doc?.RDF
  if (rdf) {
    feedTitle = textOf(rdf.channel?.title)
    for (const item of asArray(rdf.item)) {
      const link = hrefOf(item.link, baseUrl)
      items.push(makeEntry({
        guid: textOf(item['@_about']) || link || textOf(item.title),
        url: link,
        title: textOf(item.title),
        summary: textOf(item.description),
        author: textOf(item['dc:creator']),
        publishedAt: parseDate(item['dc:date'], now),
        now,
      }))
    }
    return { feedTitle, items }
  }

  const atom = doc?.feed
  if (atom) {
    feedTitle = textOf(atom.title)
    for (const entry of asArray(atom.entry)) {
      const links = asArray(entry.link)
      const alt = links.find(l => l?.['@_rel'] === 'alternate') || links[0]
      const link = hrefOf(alt, baseUrl)
      items.push(makeEntry({
        guid: textOf(entry.id) || link,
        url: link,
        title: textOf(entry.title),
        summary: textOf(entry.summary) || textOf(entry.content),
        author: textOf(entry.author?.name) || textOf(entry.author),
        publishedAt: parseDate(entry.published || entry.updated, now),
        now,
      }))
    }
    return { feedTitle, items }
  }

  return { feedTitle, items }
}

/** JSON Feed 1.x */
export function parseJsonFeed(json, { now = Date.now() } = {}) {
  const doc = typeof json === 'string' ? JSON.parse(json) : (json || {})
  const items = asArray(doc.items).map(item => makeEntry({
    guid: item.id || item.url,
    url: item.url || item.external_url,
    title: item.title,
    summary: item.content_text || item.summary || item.content_html,
    author: asArray(item.authors).map(a => a?.name).filter(Boolean).join(', '),
    publishedAt: parseDate(item.date_published || item.date_modified, now),
    now,
  }))
  return { feedTitle: doc.title || '', items }
}

/** Hacker News：从 `topstories` + item 详情转条目 */
export function parseHn(items, { now = Date.now(), baseUrl = 'https://news.ycombinator.com/item?id=' } = {}) {
  return asArray(items)
    .filter(item => item && item.type === 'story' && item.title)
    .map(item => makeEntry({
      guid: `hn-${item.id}`,
      url: item.url || `${baseUrl}${item.id}`,
      title: item.title,
      summary: item.text || `Hacker News · ${item.score || 0} 分 · ${item.descendants || 0} 条评论`,
      author: item.by,
      publishedAt: (Number(item.time) || 0) * 1000 || now,
      now,
    }))
}

/** GitHub Search API 结果 */
export function parseGithubRepos(json, { now = Date.now() } = {}) {
  const doc = typeof json === 'string' ? JSON.parse(json) : (json || {})
  return asArray(doc.items).map(repo => makeEntry({
    guid: `gh-${repo.id}`,
    url: repo.html_url,
    title: repo.full_name,
    summary: [repo.description, repo.language, `★ ${repo.stargazers_count || 0}`].filter(Boolean).join(' · '),
    author: repo.owner?.login,
    publishedAt: parseDate(repo.pushed_at || repo.created_at, now),
    now,
  }))
}

/** V2EX 热门主题 */
export function parseV2exTopics(json, { now = Date.now() } = {}) {
  const list = typeof json === 'string' ? JSON.parse(json) : (json || [])
  return asArray(list).map(topic => makeEntry({
    guid: `v2ex-${topic.id}`,
    url: topic.url,
    title: topic.title,
    summary: [topic.content, topic.node?.title].filter(Boolean).join(' · '),
    author: topic.member?.username,
    publishedAt: (Number(topic.created) || 0) * 1000 || now,
    now,
  }))
}

/** 内容指纹：标题 + 规范化 URL；同一事件的不同摘要不会因此变成两条 */
export function entryFingerprint(entry) {
  const title = String(entry?.title || '').trim().toLowerCase().replace(/\s+/g, ' ')
  // 与浏览器导入共用同一套 URL 归一化：协议 / www / query / 尾斜杠差异不产生新条目
  const url = normalizeUrl(entry?.url) || String(entry?.url || '').trim().toLowerCase()
  return createHash('sha256').update(`${title}\n${url}`).digest('hex')
}

const CATEGORY_INDEX = new Map()
for (const group of CATEGORY_GROUPS) {
  for (const cat of group.categories) CATEGORY_INDEX.set(cat.id, { groupId: group.id, label: cat.label })
}

/** 各域可用的分类（用于把源的默认值约束在合法集合内） */
const DOMAIN_CATEGORIES = {
  'ai-work': new Set(CATEGORY_GROUPS.find(g => g.id === 'ai')?.categories.map(c => c.id) || []),
  research: new Set(CATEGORY_GROUPS.find(g => g.id === 'ai')?.categories.map(c => c.id) || []),
  onchain: new Set(CATEGORY_GROUPS.find(g => g.id === 'crypto')?.categories.map(c => c.id) || []),
  infra: new Set([
    ...(CATEGORY_GROUPS.find(g => g.id === 'tools')?.categories.map(c => c.id) || []),
    ...(CATEGORY_GROUPS.find(g => g.id === 'basics')?.categories.map(c => c.id) || []),
  ]),
}

/** 保守的标题关键词覆盖：只在非常明确时改分类，其余沿用源配置 */
const TITLE_RULES = [
  [/\b(openai|anthropic|claude|gpt|gemini|deepseek|llm|agent|rag|transformer|diffusion)\b/i, 'ai-work', 'learning'],
  [/\b(bitcoin|ethereum|solana|defi|stablecoin|token|wallet|exchange|layer ?2|rollup)\b/i, 'onchain', 'data'],
  [/\b(kubernetes|docker|rust|typescript|database|postgres|sqlite|security|infra)\b/i, 'infra', 'projects'],
]

export function classifyEntry(entry, source) {
  const fallbackDomain = String(source?.domain || 'ai-work')
  const fallbackCategory = String(source?.categoryId || 'learning')
  const hay = `${entry?.title || ''} ${entry?.summary || ''}`
  for (const [re, domain, categoryId] of TITLE_RULES) {
    if (!re.test(hay)) continue
    const allowed = DOMAIN_CATEGORIES[domain]
    if (allowed && allowed.has(categoryId)) return { domain, categoryId }
  }
  const allowed = DOMAIN_CATEGORIES[fallbackDomain]
  return {
    domain: fallbackDomain,
    categoryId: allowed && allowed.has(fallbackCategory) ? fallbackCategory : [...(allowed || ['learning'])][0],
  }
}

/** 来源失败退避：5m → 15m → 1h → 6h → 24h 封顶 */
export function backoffDelayMs(failCount) {
  const ladder = [5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000]
  const index = Math.min(Math.max(0, Number(failCount) - 1), ladder.length - 1)
  return ladder[index]
}

/** 条目与抓取日志的保留截止时间 */
export function ttlCutoff(days, now = Date.now()) {
  return now - Math.max(1, Number(days) || 30) * 86400000
}

/** 该源是否到了下一次抓取时间 */
export function isSourceDue(source, now = Date.now()) {
  if (!source || source.enabled === 0 || source.enabled === false) return false
  return Number(source.next_fetch_at || 0) <= now
}

export { CATEGORY_INDEX, DOMAIN_CATEGORIES }