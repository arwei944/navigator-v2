/**
 * 内容抓取调度器。
 *
 * 只在 `NAV_CONTENT_ENABLED=1` 时启动（默认关闭）：内容库是本地能力，
 * 不应该在线上沙箱里悄悄抓取外网。
 *
 * 每轮取「到点」的源（`next_fetch_at <= now`），并发抓取、写库、回写游标；
 * 失败的源按 5m → 15m → 1h → 6h → 24h 退避，不会每轮重撞。
 */
import { refreshSources, isRefreshing } from './content-fetch.mjs'
import { processContent } from './content-process.mjs'
import { prune, setMeta, getMeta, stats } from './content-store.mjs'
import { CONTENT_DEFAULTS } from '../shared/content-sources.mjs'

export const status = {
  enabled: false,
  started: false,
  running: false,
  intervalMinutes: CONTENT_DEFAULTS.intervalMinutes,
  lastRunAt: null,
  lastResult: null,
  lastError: null,
}

let timer = null
let inFlight = false

async function runOnce(reason = 'schedule') {
  if (inFlight || isRefreshing()) return { skipped: true }
  inFlight = true
  status.running = true
  const started = Date.now()
  try {
    const r = await refreshSources({
      concurrency: Number(process.env.NAV_CONTENT_CONCURRENCY) || CONTENT_DEFAULTS.concurrency,
      intervalMinutes: status.intervalMinutes,
    })
    // 抓取之后处理积压：正文 → 翻译/摘要 → 聚类 → 简报
    let processed = null
    try {
      processed = await processContent({
        extractLimit: Number(process.env.NAV_CONTENT_EXTRACT_LIMIT) || 12,
        summaryLimit: Number(process.env.NAV_CONTENT_SUMMARY_LIMIT) || 12,
      })
    } catch (e) {
      processed = { error: String(e?.message || e) }
    }

    const cleaned = prune()
    const snapshot = stats()
    const result = {
      reason,
      at: new Date().toISOString(),
      seconds: Math.round((Date.now() - started) / 100) / 10,
      sources: r.totals.sources,
      added: r.totals.added,
      failed: r.totals.failed,
      processed: processed ? {
        extract: processed.extract ? { ok: processed.extract.ok, failed: processed.extract.failed } : null,
        summarize: processed.summarize ? {
          summarized: processed.summarize.summarized,
          translated: processed.summarize.translated,
          fallback: processed.summarize.fallback,
          skippedBudget: processed.summarize.skippedBudget,
        } : null,
        cluster: processed.cluster || null,
        digest: processed.digest ? { date: processed.digest.date, status: processed.digest.llmStatus } : null,
        llm: processed.llm,
        translation: processed.translation,
      } : null,
      pruned: cleaned,
      total: snapshot.total,
      unread: snapshot.unread,
      failures: r.results.filter(x => x.status === 'error').slice(0, 10),
    }
    status.lastRunAt = Date.now()
    status.lastResult = result
    status.lastError = null
    setMeta('last_run_at', String(status.lastRunAt))
    return result
  } catch (e) {
    status.lastError = String(e?.message || e)
    return { error: status.lastError }
  } finally {
    inFlight = false
    status.running = false
  }
}

export function startContentCron() {
  if (timer) return { started: false, reason: '已在运行' }
  const enabled = process.env.NAV_CONTENT_ENABLED === '1'
  status.enabled = enabled
  if (!enabled) return { started: false, reason: '未开启' }

  status.intervalMinutes = Math.max(5, Number(process.env.NAV_CONTENT_INTERVAL_MIN) || CONTENT_DEFAULTS.intervalMinutes)
  status.started = true
  const intervalMs = status.intervalMinutes * 60000

  // 启动后先让服务就绪，再跑首轮
  setTimeout(() => { runOnce('startup').catch(() => {}) }, 3000)
  timer = setInterval(() => { runOnce('schedule').catch(() => {}) }, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  return { started: true, intervalMinutes: status.intervalMinutes }
}

/** 请求驱动的一小步（线上无长驻进程时用；本地通常不需要） */
export function tickOnDemand() {
  if (!status.enabled || inFlight) return Promise.resolve({ skipped: true })
  const last = Number(getMeta('last_run_at')) || 0
  if (Date.now() - last < status.intervalMinutes * 60000) return Promise.resolve({ skipped: true })
  return runOnce('ondemand')
}

export function stopContentCron() {
  if (!timer) return { stopped: false }
  clearInterval(timer)
  timer = null
  status.started = false
  return { stopped: true }
}

export function getContentStatus() {
  return {
    ...status,
    lastRunAtIso: status.lastRunAt ? new Date(status.lastRunAt).toISOString() : null,
  }
}

export { runOnce as runContentRefreshNow }