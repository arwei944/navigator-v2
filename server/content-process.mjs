/**
 * 阶段 1 处理管道：正文抽取 → 翻译 → LLM 摘要 → 事件聚类 → 每日简报。
 *
 * ## 降级是有意设计
 *
 * 当前环境可能没有配置 LLM / 翻译端点。管道不会因此停摆：
 *   - 没有 LLM → 用原文摘要（或翻译后的摘要），标记 `fallback`；
 *   - 没有翻译引擎 → 保留原文，不阻塞摘要；
 *   - 正文抽取失败 → 用 RSS 摘要，不阻塞。
 * 配置好 `data/ai-config.json`（或 AI_BASE_URL / AI_API_KEY）后，下一轮自动升级为 LLM 摘要。
 *
 * ## 成本控制
 *
 * 只处理新条目；每日 LLM 调用上限（默认 100 条）；同一条失败后标记 fallback，
 * 不在每轮重复烧钱。正文抽取限制在最近 48 小时、每轮 12 条。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseHTML } from 'linkedom'
import { Readability } from '@mozilla/readability'
import { fetchPage, robotsAllows } from './content-fetch.mjs'
import { stripHtml, truncate } from '../shared/content-core.mjs'
import {
  clusterDocuments, heatScore, eventTitle, eventSummary, ruleDigest,
  parseJsonLoose, isMostlyChinese,
} from '../shared/content-text.mjs'
import { chatWithChain } from '../shared/llm-engine.mjs'
import { translateWithChain, translatorChain } from '../shared/translate-engine.mjs'
import {
  entriesForExtraction, saveExtraction, entriesForSummary, saveTranslation, saveSummary,
  recentEntriesForCluster, replaceEvents, listEvents, listSources,
  getDigest, saveDigest, getMeta, setMeta,
} from './content-store.mjs'

const AI_FILE = join(process.cwd(), 'data', 'ai-config.json')

function aiConfig() {
  let file = {}
  try { file = JSON.parse(readFileSync(AI_FILE, 'utf8')) } catch { /* 没有文件 */ }
  return {
    baseURL: String(process.env.AI_BASE_URL || file.baseURL || '').trim(),
    apiKey: String(process.env.AI_API_KEY || file.apiKey || '').trim(),
    model: String(process.env.AI_MODEL || file.model || 'gpt-4o-mini').trim(),
  }
}

export function llmAvailable() {
  const cfg = aiConfig()
  return Boolean(cfg.baseURL && cfg.apiKey)
}

export function translationAvailable() {
  return translatorChain().length > 0
}

async function fetchText(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`翻译请求 HTTP ${res.status}`)
  const text = await res.text()
  if (text.length > 2_000_000) throw new Error('翻译响应过大')
  return text
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

/* ---------------- 正文抽取 ---------------- */

export async function extractEntries({ limit = 12, concurrency = 3 } = {}) {
  const pending = entriesForExtraction({ limit, hours: 48 })
  const results = await mapLimit(pending, concurrency, async entry => {
    if (!/^https?:/i.test(entry.url)) {
      saveExtraction(entry.id, { status: 'failed', error: '非 http 链接' })
      return { id: entry.id, status: 'failed', error: '非 http' }
    }
    try {
      if (!(await robotsAllows(entry.url))) {
        saveExtraction(entry.id, { status: 'failed', error: 'robots 禁止' })
        return { id: entry.id, status: 'failed', error: 'robots' }
      }
      const res = await fetchPage(entry.url, { timeoutMs: 20000, maxBytes: 4 * 1024 * 1024 })
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
      if (res.truncated) throw new Error('页面超过 4 MB 被截断')
      const html = res.body.toString('utf8')
      const { document } = parseHTML(html)
      const article = new Readability(document, { charThreshold: 200 }).parse()
      const text = truncate(stripHtml(article?.textContent || ''), 4000)
      if (!text || text.length < 80) {
        saveExtraction(entry.id, { content: text, status: 'failed', error: '正文过短' })
        return { id: entry.id, status: 'failed', error: '正文过短' }
      }
      saveExtraction(entry.id, { content: text, status: 'ok' })
      return { id: entry.id, status: 'ok', chars: text.length }
    } catch (e) {
      saveExtraction(entry.id, { status: 'failed', error: String(e?.message || e) })
      return { id: entry.id, status: 'failed', error: String(e?.message || e) }
    }
  })
  return {
    requested: pending.length,
    ok: results.filter(r => r.status === 'ok').length,
    failed: results.filter(r => r.status === 'failed').length,
    results,
  }
}

/* ---------------- 翻译 + 摘要 ---------------- */

function budgetKey(date) { return `llm_budget_${date}` }
/** 简报按**本地日期**归档：UTC 日期会让东八区凌晨生成的简报显示成前一天 */
function today() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function dailyLimit() { return Math.max(0, Number(process.env.NAV_CONTENT_LLM_DAILY_MAX) || 100) }

function budgetUsed() {
  return Number(getMeta(budgetKey(today()))) || 0
}

function consumeBudget(n = 1) {
  setMeta(budgetKey(today()), String(budgetUsed() + n))
}

async function summarizeOne(entry, { titleZh, summaryZh } = {}) {
  const cfg = aiConfig()
  const title = titleZh || entry.title
  const body = truncate(entry.content || entry.summary || '', 1200)
  if (!body) return null
  const messages = [
    {
      role: 'system',
      content: '你是科技情报编辑。用中文为给定内容生成摘要与“为什么重要”。只输出 JSON，不要代码块或解释。格式：{"summary":"80-120字中文摘要","why":"30-50字，说明对从业者的意义"}',
    },
    {
      role: 'user',
      content: `标题：${title}\n来源：${entry.sourceId}\n内容：${body}`,
    },
  ]
  const { text } = await chatWithChain(messages, {
    config: cfg, maxTokens: 500, temperature: 0.2, timeoutMs: 60000,
  })
  const parsed = parseJsonLoose(text)
  if (!parsed || typeof parsed !== 'object') return null
  const summary = String(parsed.summary || parsed.summary_zh || '').trim()
  const why = String(parsed.why || '').trim()
  if (!summary) return null
  return { summary, why }
}

export async function translateAndSummarize({ limit = 12 } = {}) {
  const pending = entriesForSummary({ limit, hours: 72 })
  const out = {
    requested: pending.length,
    translated: 0,
    summarized: 0,
    fallback: 0,
    skippedBudget: 0,
    errors: [],
  }
  const canTranslate = translationAvailable()
  const canSummarize = llmAvailable()

  for (const entry of pending) {
    let titleZh = entry.titleZh
    let summaryZh = entry.summaryZh

    // 1) 非中文标题才翻译；失败保留原文，不阻塞后续摘要
    if (canTranslate && !isMostlyChinese(`${entry.title} ${entry.summary || ''}`)) {
      try {
        const src = `${entry.title}\n---\n${truncate(entry.summary || entry.content || '', 600)}`
        const r = await translateWithChain(src, { fetchText, from: 'en', to: 'zh-CN' })
        if (r.text) {
          const parts = r.text.split(/\n---\n/)
          titleZh = (parts[0] || titleZh || '').trim()
          summaryZh = (parts[1] || summaryZh || '').trim()
          saveTranslation(entry.id, { titleZh, summaryZh })
          out.translated += 1
        }
      } catch (e) {
        out.errors.push({ id: entry.id, step: 'translate', error: String(e?.message || e) })
      }
    }

    // 2) LLM 摘要；预算用尽或未配置则降级
    if (canSummarize && budgetUsed() < dailyLimit()) {
      try {
        const s = await summarizeOne(entry, { titleZh, summaryZh })
        if (s) {
          saveSummary(entry.id, { summaryZh: s.summary, why: s.why, status: 'ok' })
          consumeBudget(1)
          out.summarized += 1
          continue
        }
      } catch (e) {
        out.errors.push({ id: entry.id, step: 'summarize', error: String(e?.message || e) })
      }
    } else if (canSummarize) {
      out.skippedBudget += 1
    }

    saveSummary(entry.id, {
      summaryZh: summaryZh || entry.summary || '',
      why: '',
      status: 'fallback',
    })
    out.fallback += 1
  }
  return out
}

/* ---------------- 事件聚类 ---------------- */

function mode(list) {
  const count = new Map()
  for (const item of list) {
    if (!item) continue
    count.set(item, (count.get(item) || 0) + 1)
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
}

export function rebuildEvents({ hours = 72, threshold } = {}) {
  const entries = recentEntriesForCluster({ hours, limit: 600 })
  const weights = new Map(listSources().map(s => [s.id, Number(s.weight) || 1]))
  const docs = entries.map(e => ({
    id: e.id,
    title: e.titleZh || e.title,
    summary: e.summaryZh || e.summary || e.content || '',
    publishedAt: e.publishedAt,
    sourceId: e.sourceId,
    domain: e.domain,
    categoryId: e.categoryId,
  }))
  const clusters = clusterDocuments(docs, {
    threshold: Number(threshold ?? process.env.NAV_CONTENT_CLUSTER_THRESHOLD) || 0.55,
    minSize: 2,
    maxDocs: 600,
  })
  const now = Date.now()
  const events = clusters.map(cluster => {
    const ids = cluster.members.map(m => m.id).sort()
    const sources = new Set(cluster.members.map(m => m.sourceId))
    const weightSum = [...sources].reduce((n, s) => n + (weights.get(s) || 1), 0)
    const primary = [...cluster.members].sort((a, b) => b.publishedAt - a.publishedAt)[0]
    return {
      id: `evt-${createHash('sha256').update(ids.join(',')).digest('hex').slice(0, 16)}`,
      title: eventTitle(cluster),
      summary: eventSummary(cluster),
      domain: mode(cluster.members.map(m => m.domain)) || 'ai-work',
      categoryId: mode(cluster.members.map(m => m.categoryId)) || 'learning',
      firstSeen: cluster.firstSeen,
      lastSeen: cluster.lastSeen,
      sourceCount: sources.size,
      entryCount: cluster.members.length,
      heat: heatScore({
        size: cluster.members.length,
        sources: sources.size,
        weight: weightSum,
        latestAt: cluster.lastSeen,
        now,
      }),
      primaryEntryId: primary?.id || null,
      members: ids,
    }
  })
  replaceEvents(events, now - hours * 3600000)
  return { entries: entries.length, events: events.length }
}

/* ---------------- 每日简报 ---------------- */

async function llmDigest({ date, events, entries }) {
  const cfg = aiConfig()
  const payload = events.slice(0, 12).map(e => ({
    title: e.title, summary: e.summary, domain: e.domain, sources: e.sourceCount,
  }))
  const messages = [
    {
      role: 'system',
      content: '你是科技情报编辑。根据给定事件生成一份中文每日简报，使用 Markdown，按领域分组，突出“为什么重要”。总长 500-800 字，不要编造未提供的信息。',
    },
    { role: 'user', content: JSON.stringify({ date, events: payload, fallbackEntries: entries.slice(0, 8).map(e => ({ title: e.titleZh || e.title, source: e.sourceId })) }) },
  ]
  const { text } = await chatWithChain(messages, {
    config: cfg, maxTokens: 1400, temperature: 0.3, timeoutMs: 60000,
  })
  return String(text || '').trim()
}

export async function ensureDigest({ date } = {}) {
  const day = date || today()
  const existing = getDigest(day)
  // LLM 简报保留；规则简报每轮重算，保证清洗/聚类更新后内容不会停在旧版本
  if (existing && existing.llmStatus === 'ok') return existing
  const since = Date.now() - 24 * 3600000
  const events = listEvents({ limit: 20, since })
  const entries = recentEntriesForCluster({ hours: 24, limit: 80 })

  let content = ''
  let status = 'rule'
  if (llmAvailable() && events.length) {
    try {
      content = await llmDigest({ date: day, events, entries })
      if (content.length > 80) status = 'ok'
      else content = ''
    } catch { content = '' }
  }
  if (!content) content = ruleDigest({ events, entries, date: day })
  saveDigest(day, content, status)
  return getDigest(day)
}

/* ---------------- 编排 ---------------- */

let processing = false

export function isProcessing() {
  return processing
}

export async function processContent({ extractLimit = 12, summaryLimit = 12 } = {}) {
  if (processing) return { running: true }
  processing = true
  try {
  const out = {
    at: new Date().toISOString(),
    llm: llmAvailable(),
    translation: translationAvailable(),
    extract: null,
    summarize: null,
    cluster: null,
    digest: null,
    errors: [],
  }
  try { out.extract = await extractEntries({ limit: extractLimit }) }
  catch (e) { out.errors.push({ step: 'extract', error: String(e?.message || e) }) }
  try { out.summarize = await translateAndSummarize({ limit: summaryLimit }) }
  catch (e) { out.errors.push({ step: 'summarize', error: String(e?.message || e) }) }
  try { out.cluster = rebuildEvents() }
  catch (e) { out.errors.push({ step: 'cluster', error: String(e?.message || e) }) }
  try { out.digest = await ensureDigest() }
  catch (e) { out.errors.push({ step: 'digest', error: String(e?.message || e) }) }
  return out
  } finally {
    processing = false
  }
}