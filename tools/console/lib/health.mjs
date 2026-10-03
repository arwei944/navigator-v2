/**
 * 站点可用性看板：探活结果按天落 JSONL，供控制台展示状态徽标与响应时间趋势。
 *
 * 为什么落盘而不是只放内存：可用性问的是「这站最近一直不稳，还是刚抖了一下」，
 * 单次快照答不了。按天一个文件（`YYYY-MM-DD.jsonl`）即可满足短时趋势，
 * 不必为此给零依赖控制台引 SQLite。
 *
 * 分级口径与探测方式全部来自 `shared/health-probe.mjs`，本模块只管「存与读」。
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ROOT } from './env.mjs'
import { probeMany, tally, STATUS_LABEL } from '../../../shared/health-probe.mjs'
import { readSites } from './data.mjs'
import * as jobs from './jobs.mjs'
import { record } from './audit.mjs'
import { publishHealth } from './cloud.mjs'
import { resolveProxyUrl } from '../../../shared/proxy.mjs'

const DATA_DIR = join(ROOT, 'tools', 'console', '.data', 'health')
const KEEP_DAYS = 30

export { STATUS_LABEL }

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10)
}

function fileFor(day) {
  return join(DATA_DIR, `${day}.jsonl`)
}

/** 可用的历史文件（新 → 旧）；顺带清理超期文件 */
function dayFiles() {
  let names = []
  try { names = readdirSync(DATA_DIR) } catch { return [] }
  const days = names.filter(n => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).map(n => n.replace(/\.jsonl$/, '')).sort().reverse()
  for (const stale of days.slice(KEEP_DAYS)) {
    try { rmSync(fileFor(stale), { force: true }) } catch { /* 清理失败不影响读取 */ }
  }
  return days.slice(0, KEEP_DAYS).map(fileFor)
}

function readLines(file) {
  try {
    return readFileSync(file, 'utf-8').split('\n')
      .map(l => l.trim()).filter(Boolean)
      .map(l => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)
  } catch { return [] }
}

function countsOf(items) {
  const c = tally(items.map(i => ({ status: i.status })))
  return { total: items.length, ok: c.ok || 0, limited: c.limited || 0, down: c.down || 0 }
}

/* ---------------- 写入 ---------------- */

/**
 * 落盘一次探活结果。同一 run 的每条记录共用 run id，便于按轮次聚合。
 * 写入失败只警告，不让看板把探活本身搞失败。
 */
export function saveRun(results, { actor = 'console' } = {}) {
  const run = randomUUID().slice(0, 8)
  const ts = new Date().toISOString()
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    const lines = results.map(r => JSON.stringify({
      ts, run, actor,
      id: r.id, name: r.name, url: r.url,
      code: r.code, status: r.status, ms: r.ms, attempts: r.attempts,
    }))
    appendFileSync(fileFor(dayKey()), `${lines.join('\n')}\n`, 'utf-8')
  } catch {
    return { run, ts, saved: false }
  }
  const c = countsOf(results)
  record({
    action: 'health.probe', actor, target: `run ${run}`,
    result: c.down > 0 ? 'fail' : 'ok',
    detail: `${c.total} 站点 · 正常 ${c.ok} / 可忽略 ${c.limited} / 需处理 ${c.down}`,
  })
  return { run, ts, saved: true, counts: c }
}

/* ---------------- 读取 ---------------- */

/** 最近一轮探活（跨天查找，读到第一个有内容的文件即止） */
export function latest() {
  for (const file of dayFiles()) {
    const lines = readLines(file)
    if (!lines.length) continue
    const run = lines[lines.length - 1].run
    const items = lines.filter(l => l.run === run)
    const results = {}
    for (const it of items) results[it.id] = { status: it.status, code: it.code, ms: it.ms, ts: it.ts }
    return {
      run,
      ts: items[items.length - 1].ts,
      counts: countsOf(items),
      results,
    }
  }
  return null
}

/** 最近若干轮的概要（新 → 旧） */
export function runs({ limit = 20 } = {}) {
  const seen = new Map()
  for (const file of dayFiles()) {
    for (const l of readLines(file)) {
      const g = seen.get(l.run)
      if (g) { g.items.push(l); g.ts = l.ts }
      else seen.set(l.run, { run: l.run, ts: l.ts, actor: l.actor || '', items: [l] })
    }
    if (seen.size >= limit) break
  }
  return [...seen.values()]
    .sort((a, b) => (a.ts < b.ts ? 1 : -1))
    .slice(0, Math.max(1, limit))
    .map(g => ({ run: g.run, ts: g.ts, actor: g.actor, ...countsOf(g.items) }))
}

/** 单站历史趋势（新 → 旧），用于「最近一直不稳」的判读 */
export function history(id, { limit = 20 } = {}) {
  const out = []
  for (const file of dayFiles()) {
    const lines = readLines(file)
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i]
      if (l.id !== id) continue
      out.push({ ts: l.ts, run: l.run, status: l.status, code: l.code, ms: l.ms })
      if (out.length >= limit) return out
    }
  }
  return out
}

/**
 * 每个站点最近若干轮的状态序列（新 → 旧）。
 * 一次读盘算全量，避免看板为每行单独发请求（300 站 × 12 轮会在前端打出一片并发）。
 */
export function recentTrends({ limit = 12 } = {}) {
  const order = []
  for (const file of dayFiles()) {
    const groups = new Map()
    for (const l of readLines(file)) {
      if (!groups.has(l.run)) groups.set(l.run, [])
      groups.get(l.run).push(l)
    }
    for (const [run, items] of [...groups.entries()].reverse()) {
      order.push({ run, items })
      if (order.length >= limit) break
    }
    if (order.length >= limit) break
  }
  const trends = {}
  for (const { run, items } of order) {
    for (const it of items) {
      if (!trends[it.id]) trends[it.id] = []
      trends[it.id].push({ run, status: it.status, code: it.code, ms: it.ms })
    }
  }
  return { runs: order.map(o => o.run), trends }
}

/* ---------------- 发布到云端 ---------------- */

/**
 * 把一轮探活结果发布到云端 —— 前端状态角标 / 失效清单的唯一判定来源。
 *
 * 为什么必须由本机发布：判定要「以本地自带代理环境」为准。浏览器读不到跨域状态码，
 * 云端出网口在海外、与本机可达性不是一回事，只有本机 curl.exe（走系统代理）才是真口径。
 * 发布失败不抛错：本地已落盘，云端没更新只是角标暂时偏旧，不该让探活任务整体失败。
 */
export async function publishRun(results, { actor = 'console' } = {}) {
  const r = await publishHealth(results, { actor })
  const proxy = (await resolveProxyUrl()) || '未设置'
  record({
    action: 'health.publish',
    actor,
    result: r.ok ? 'ok' : 'fail',
    target: r.ok ? `v${r.version}` : '云端判定',
    detail: r.ok
      ? `${r.counts.total} 站点 · 正常 ${r.counts.ok} / 可忽略 ${r.counts.limited} / 需处理 ${r.counts.down} · 代理 ${proxy}`
      : `发布失败：${r.error}`,
  })
  return { ...r, proxy }
}

/** 把最近一轮本地探活重新发布到云端（不重新探测） */
export async function publishLatest({ actor = 'console' } = {}) {
  const last = latest()
  if (!last) return { ok: false, error: '本地还没有探活记录，请先探活' }
  const results = Object.entries(last.results).map(([id, r]) => ({ id, code: r.code, ms: r.ms }))
  return publishRun(results, { actor })
}

/* ---------------- 探活任务 ---------------- */

/** 起一个探活任务：进度走 SSE，结果落盘，最后写审计 */
export function startProbe({ ids = null, limit = 0, timeout = 12, concurrency = 12, attempts = 2 } = {}) {
  const all = readSites()
  let targets = all
  if (Array.isArray(ids) && ids.length) {
    const set = new Set(ids)
    targets = all.filter(s => set.has(s.id))
  }
  if (limit > 0) targets = targets.slice(0, limit)

  const job = jobs.createJob(`可用性探活（${targets.length} 站）`)
  ;(async () => {
    if (!targets.length) {
      jobs.log(job, '没有可探测的站点', 'stderr')
      jobs.finish(job, 1)
      return
    }
    jobs.log(job, `开始探活 ${targets.length} 个站点 · 并发 ${concurrency} · 超时 ${timeout}s · 失败重试 ${attempts - 1} 次`, 'info')
    const t0 = Date.now()
    const results = await probeMany(targets, {
      timeout, concurrency, attempts,
      onProgress: ({ done, total, chunk }) => {
        const c = tally(chunk)
        jobs.emitEvent(job, 'progress', { done, total, ok: c.ok, limited: c.limited, down: c.down })
        const bad = chunk.filter(r => r.status === 'down')
        if (bad.length) jobs.log(job, `需处理：${bad.map(r => `${r.id}(${r.code})`).join(' ')}`, 'stderr')
        if (done % 50 === 0 || done === total) jobs.log(job, `进度 ${done}/${total}`)
      },
    })
    const c = tally(results)
    const saved = saveRun(results, { actor: 'console' })
    jobs.emitEvent(job, 'result', { run: saved.run, counts: countsOf(results), results })
    jobs.log(job, `探活完成（${((Date.now() - t0) / 1000).toFixed(1)}s）：正常 ${c.ok} / 可忽略 ${c.limited} / 需处理 ${c.down}`, c.down ? 'stderr' : 'success')
    if (saved.saved) jobs.log(job, `已落盘快照 run=${saved.run}`, 'success')
    else jobs.log(job, '快照落盘失败（结果仅本次可见）', 'stderr')

    // 探活完自动发布到云端：前端角标的判定来源就是这一份。
    // 不发布的话云端仍停在上一轮，用户会以为「探了活但角标没变」。
    const pub = await publishRun(results, { actor: 'console' })
    if (pub.ok) jobs.log(job, `判定已发布到云端 version=${pub.version}（代理 ${pub.proxy}）`, 'success')
    else jobs.log(job, `判定发布到云端失败：${pub.error}`, 'stderr')

    jobs.finish(job, 0)
  })().catch(e => {
    jobs.log(job, `探活异常：${e.message}`, 'stderr')
    jobs.finish(job, -1)
  })
  return job
}

export const HEALTH_DIR = DATA_DIR