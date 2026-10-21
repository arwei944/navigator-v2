/**
 * 内容源抓取器。
 *
 * ## 安全
 *
 * 所有请求走 `shared/http-fetch.mjs`：它把「校验用的 IP」与「连接用的 IP」
 * 锁成同一个，挡 DNS rebinding 与内网地址。重定向**逐跳跟随、逐跳校验**，
 * 不接受 `Location` 跳到 127.0.0.1。
 *
 * ## 礼貌
 *
 * - 条件请求：`If-None-Match` / `If-Modified-Since`，304 不重复下载；
 * - robots.txt：按 `User-agent: *` 的 Disallow 做保守判断，缓存 24 小时；
 * - 单源超时 15s、响应上限 1 MB、并发 4；
 * - 失败不重试整轮，交由下一次调度按指数退避重试。
 *
 * ## 只做「抓 + 解析」
 *
 * 写库与调度在调用方（`content-store` / `content-cron`），这样抓取器可以
 * 用本地 HTTP 服务做端到端测试，不必碰真实数据库。
 */
import { fetchCapped } from '../shared/http-fetch.mjs'
import {
  parseFeed, parseJsonFeed, parseHn, parseGithubRepos, parseV2exTopics,
} from '../shared/content-core.mjs'
import { CONTENT_DEFAULTS } from '../shared/content-sources.mjs'
import { insertEntries, recordFetch, saveSourceCursor, dueSources, getSource, listSources } from './content-store.mjs'

const UA = 'NavContentBot/0.1 (+local navigation content aggregator)'
const MAX_REDIRECTS = 4
const ROBOTS_TTL = 24 * 60 * 60 * 1000
const robotsCache = new Map()

async function fetchFollow(url, { headers = {}, timeoutMs = CONTENT_DEFAULTS.timeoutMs, maxBytes = CONTENT_DEFAULTS.maxBytes } = {}) {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const res = await fetchCapped(current, {
      headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, application/json, text/xml;q=0.9, */*;q=0.5', ...headers },
      maxBytes,
      signal: AbortSignal.timeout(timeoutMs),
    })
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.location || res.headers.Location
      if (!loc) return { ...res, finalUrl: current }
      current = new URL(String(loc), current).toString()
      continue
    }
    return { ...res, finalUrl: current }
  }
  throw new Error('重定向次数过多')
}

function headerValue(headers, name) {
  const key = Object.keys(headers || {}).find(k => k.toLowerCase() === name.toLowerCase())
  return key ? headers[key] : ''
}

/** 保守的 robots 判断：只处理 `User-agent: *` 段；取不到 robots 就放行 */
async function robotsAllows(url) {
  try {
    const origin = new URL(url).origin
    const cached = robotsCache.get(origin)
    if (cached && cached.expires > Date.now()) return cached.allows

    let rules = []
    try {
      const res = await fetchFollow(`${origin}/robots.txt`, { timeoutMs: CONTENT_DEFAULTS.robotsTimeoutMs, maxBytes: 128 * 1024 })
      if (res.status === 200) {
        const text = res.body.toString('utf8')
        let inStar = false
        for (const line of text.split(/\r?\n/)) {
          const clean = line.replace(/#.*$/, '').trim()
          if (!clean) continue
          const [rawKey, ...rest] = clean.split(':')
          const key = rawKey.trim().toLowerCase()
          const value = rest.join(':').trim()
          if (key === 'user-agent') inStar = value === '*'
          else if (inStar && (key === 'disallow' || key === 'allow') && value) {
            rules.push({ allow: key === 'allow', path: value })
          }
        }
      }
    } catch { /* robots 不可用 → 放行 */ }

    const pathname = new URL(url).pathname
    const disallow = rules.filter(r => !r.allow && pathname.startsWith(r.path))
    const allow = rules.filter(r => r.allow && pathname.startsWith(r.path))
    const longest = arr => arr.reduce((n, r) => Math.max(n, r.path.length), -1)
    // 最长匹配优先：更长的 Allow 可以覆盖更短的 Disallow
    const allows = !disallow.length || longest(allow) >= longest(disallow)
    robotsCache.set(origin, { allows, expires: Date.now() + ROBOTS_TTL })
    return allows
  } catch {
    return true
  }
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (cursor < list.length) {
      const i = cursor
      cursor += 1
      out[i] = await fn(list[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

function conditionalHeaders(source) {
  const headers = {}
  if (source.etag) headers['if-none-match'] = source.etag
  if (source.lastModified) headers['if-modified-since'] = source.lastModified
  return headers
}

async function fetchHn(source, now) {
  const top = await fetchFollow(source.url, { headers: conditionalHeaders(source) })
  if (top.status === 304) return { status: 'not-modified', httpStatus: 304, entries: [], bytes: top.body.length }
  if (top.status !== 200) return { status: 'error', httpStatus: top.status, entries: [], bytes: top.body.length, error: `HTTP ${top.status}` }

  let ids = []
  try { ids = JSON.parse(top.body.toString('utf8')) } catch { return { status: 'error', httpStatus: 200, entries: [], error: 'topstories 解析失败' } }
  const selected = ids.slice(0, Math.max(1, Number(source.maxItems) || 30))
  const items = await mapLimit(selected, 4, async id => {
    try {
      const r = await fetchFollow(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { timeoutMs: 8000, maxBytes: 128 * 1024 })
      return r.status === 200 ? JSON.parse(r.body.toString('utf8')) : null
    } catch { return null }
  })
  return {
    status: 'ok',
    httpStatus: 200,
    entries: parseHn(items.filter(Boolean), { now }),
    bytes: top.body.length,
    etag: headerValue(top.headers, 'etag'),
    lastModified: headerValue(top.headers, 'last-modified'),
  }
}

async function fetchGithub(source) {
  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  // URL 里已经写成 `%3E{since}`，这里只替换日期，避免二次编码
  const url = String(source.url).replace('{since}', since)
  const res = await fetchFollow(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...conditionalHeaders(source),
    },
  })
  if (res.status === 304) return { status: 'not-modified', httpStatus: 304, entries: [], bytes: res.body.length }
  if (res.status !== 200) return { status: 'error', httpStatus: res.status, entries: [], bytes: res.body.length, error: `HTTP ${res.status}` }
  return {
    status: 'ok',
    httpStatus: 200,
    entries: parseGithubRepos(res.body.toString('utf8')),
    bytes: res.body.length,
    etag: headerValue(res.headers, 'etag'),
    lastModified: headerValue(res.headers, 'last-modified'),
  }
}

async function fetchV2ex(source) {
  const res = await fetchFollow(source.url, { headers: conditionalHeaders(source) })
  if (res.status === 304) return { status: 'not-modified', httpStatus: 304, entries: [], bytes: res.body.length }
  if (res.status !== 200) return { status: 'error', httpStatus: res.status, entries: [], bytes: res.body.length, error: `HTTP ${res.status}` }
  return {
    status: 'ok',
    httpStatus: 200,
    entries: parseV2exTopics(res.body.toString('utf8')).slice(0, Number(source.maxItems) || 30),
    bytes: res.body.length,
    etag: headerValue(res.headers, 'etag'),
    lastModified: headerValue(res.headers, 'last-modified'),
  }
}

async function fetchRss(source, now) {
  const res = await fetchFollow(source.url, { headers: conditionalHeaders(source) })
  if (res.status === 304) return { status: 'not-modified', httpStatus: 304, entries: [], bytes: res.body.length }
  if (res.status !== 200) return { status: 'error', httpStatus: res.status, entries: [], bytes: res.body.length, error: `HTTP ${res.status}` }

  // 截断的 XML 会在 CDATA 中间断开，报「CDATA is not closed」——先把真实原因说清楚
  if (res.truncated) {
    return {
      status: 'error', httpStatus: 200, entries: [], bytes: res.body.length,
      error: `响应超过 ${Math.round(CONTENT_DEFAULTS.maxBytes / 1024 / 1024)} MB 被截断`,
    }
  }

  const text = res.body.toString('utf8')
  let entries = []
  let feedTitle = ''
  const type = source.type
  try {
    if (type === 'jsonfeed' || text.trimStart().startsWith('{')) {
      const parsed = parseJsonFeed(text, { now })
      entries = parsed.items
      feedTitle = parsed.feedTitle
    } else {
      const parsed = parseFeed(text, { baseUrl: res.finalUrl || source.url, now })
      entries = parsed.items
      feedTitle = parsed.feedTitle
    }
  } catch (e) {
    return { status: 'error', httpStatus: 200, entries: [], bytes: res.body.length, error: `解析失败：${e.message}` }
  }

  const limit = Math.max(1, Number(source.maxItems) || 60)
  const deduped = []
  const seen = new Set()
  for (const entry of entries) {
    if (!entry.title) continue
    const key = entry.url || entry.guid || entry.title
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(entry)
    if (deduped.length >= limit) break
  }
  return {
    status: deduped.length ? 'ok' : 'empty',
    httpStatus: 200,
    entries: deduped,
    bytes: res.body.length,
    feedTitle,
    etag: headerValue(res.headers, 'etag'),
    lastModified: headerValue(res.headers, 'last-modified'),
  }
}

/** 抓一个源，返回抓取结果（不写库） */
export async function fetchSource(source, { now = Date.now() } = {}) {
  const started = Date.now()
  try {
    /**
     * 官方 API 不做 robots 判定：robots.txt 约束的是网页抓取，
     * HN / arXiv / GitHub / V2EX 的公开 API 有各自的使用条款；
     * 且这些 API 的 robots 常常是「禁止网页路径」而不是「禁止 API」。
     */
    const isApi = ['hn', 'arxiv', 'github', 'v2ex'].includes(source.type)
    if (!isApi && !(await robotsAllows(source.url))) {
      return { status: 'error', httpStatus: null, entries: [], bytes: 0, error: 'robots.txt 禁止抓取', durationMs: Date.now() - started }
    }
    let result
    if (source.type === 'hn') result = await fetchHn(source, now)
    else if (source.type === 'github') result = await fetchGithub(source)
    else if (source.type === 'v2ex') result = await fetchV2ex(source)
    else result = await fetchRss(source, now)
    return { ...result, durationMs: Date.now() - started }
  } catch (e) {
    return {
      status: 'error', httpStatus: null, entries: [], bytes: 0,
      error: String(e?.message || e), durationMs: Date.now() - started,
    }
  }
}

let running = false

/**
 * 抓取一批源（默认取 dueSources），并发写入。
 * @returns {Promise<{running:boolean, results:object[], totals:{sources:number, added:number, failed:number}}>}
 */
export async function refreshSources({ sourceIds = [], force = false, concurrency = CONTENT_DEFAULTS.concurrency, intervalMinutes = CONTENT_DEFAULTS.intervalMinutes, now = Date.now() } = {}) {
  if (running) return { running: true, results: [], totals: { sources: 0, added: 0, failed: 0 } }
  running = true
  try {
    const list = sourceIds.length
      ? sourceIds.map(getSource).filter(Boolean)
      // 手动刷新传 force：不等到期时间，方便失败后立即重试
      : force
        ? listSources().filter(s => s.enabled)
        : dueSources(now)
    const results = await mapLimit(list, Math.max(1, Math.min(Number(concurrency) || 4, 8)), async source => {
      const r = await fetchSource(source, { now })
      let added = 0
      if (r.status === 'ok' && r.entries.length) {
        added = insertEntries(source, r.entries)
      }
      // 304 / 空响应没有新游标：保留旧的，否则下一轮会退化成无条件请求
      if (r.etag || r.lastModified) {
        saveSourceCursor(source.id, {
          etag: r.etag || source.etag || null,
          lastModified: r.lastModified || source.lastModified || null,
        })
      }
      recordFetch({
        source, status: r.status, httpStatus: r.httpStatus, bytes: r.bytes,
        durationMs: r.durationMs, added, error: r.error || '', intervalMinutes,
      })
      return {
        sourceId: source.id, label: source.label, status: r.status,
        httpStatus: r.httpStatus, added, fetched: r.entries.length,
        durationMs: r.durationMs, error: r.error || '',
      }
    })
    const failed = results.filter(r => r.status === 'error').length
    const added = results.reduce((n, r) => n + (Number(r.added) || 0), 0)
    return { running: false, results, totals: { sources: results.length, added, failed } }
  } finally {
    running = false
  }
}

export function isRefreshing() {
  return running
}