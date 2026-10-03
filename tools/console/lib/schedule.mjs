/**
 * 定时巡检：按配置周期性探活全站，把「新失效 / 已恢复」收敛成通知。
 *
 * 为什么不是「再跑一次探活」：可用性看板已经能手动探活，缺的是「没人盯着的时候出了事」。
 * 因此巡检的核心不是探活本身，而是**与上一轮的差集** —— 只有状态发生翻转的站点才值得打扰人，
 * 一直宕着的站不该每轮都刷一条新通知（这由 notify-core 的冷却期再兜一层）。
 *
 * 调度有两种入口，共用同一份 runInspection：
 *   ① 控制台进程内定时器（本机开着控制台时生效）
 *   ② 外部计划任务 / CLI 显式触发（控制台未运行时也能巡检）
 * 因此配置与「上次巡检结果」必须落盘，不能只放内存。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.mjs'
import { readSites } from './data.mjs'
import { probeMany, tally } from '../../../shared/health-probe.mjs'
import * as health from './health.mjs'
import * as notify from './notify.mjs'
import * as jobs from './jobs.mjs'
import { record } from './audit.mjs'

const DATA_DIR = join(ROOT, 'tools', 'console', '.data')
const CONFIG_FILE = join(DATA_DIR, 'schedule.json')

export const JOB_TITLE = '定时巡检'

const DEFAULTS = {
  enabled: false,
  intervalMs: 6 * 3600e3,
  timeout: 12,
  concurrency: 12,
  attempts: 2,
  lastRunAt: null,
  lastRun: null,
}

let timer = null

/* ---------------- 配置 ---------------- */

export function config() {
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) }
  } catch {
    return { ...DEFAULTS }
  }
}

function persist(next) {
  mkdirSync(DATA_DIR, { recursive: true })
  const tmp = `${CONFIG_FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8')
  renameSync(tmp, CONFIG_FILE)
}

/** 保存配置（局部更新）。启用状态变化会即时重排定时器。 */
export function saveConfig(patch = {}) {
  const next = { ...config(), ...patch }
  next.intervalMs = Math.max(5 * 60e3, Number(next.intervalMs) || DEFAULTS.intervalMs)
  next.enabled = Boolean(next.enabled)
  persist(next)
  if (next.enabled) startScheduler()
  else stopScheduler()
  return status()
}

export function status() {
  const c = config()
  return {
    ...c,
    running: timer !== null,
    nextRunAt: c.enabled && c.lastRunAt ? new Date(Date.parse(c.lastRunAt) + c.intervalMs).toISOString() : null,
    intervalLabel: c.intervalMs >= 3600e3 ? `${(c.intervalMs / 3600e3).toFixed(1)} 小时` : `${Math.round(c.intervalMs / 60e3)} 分钟`,
  }
}

/* ---------------- 巡检 ---------------- */

/** 上一轮探活里判定为「需处理」的站点 id 集合 */
function downSetOf(run) {
  if (!run?.results) return new Set()
  return new Set(Object.entries(run.results).filter(([, r]) => r.status === 'down').map(([id]) => id))
}

/**
 * 执行一次巡检并落通知。返回摘要，供 UI / CLI 直接展示。
 * @param {{trigger?:string, actor?:string}} opts
 */
export async function runInspection({ trigger = 'manual', actor = 'console' } = {}) {
  const sites = readSites()
  const before = health.latest()
  const prevDown = downSetOf(before)

  const results = await probeMany(sites, {
    timeout: config().timeout,
    concurrency: config().concurrency,
    attempts: config().attempts,
  })
  const saved = health.saveRun(results, { actor })

  // 巡检同样要发布：它是「没人盯着的时候」跑的那一轮，前端角标更需要它来保持新鲜
  const published = await health.publishRun(results, { actor })

  const nowDown = results.filter(r => r.status === 'down')
  const nowDownIds = new Set(nowDown.map(r => r.id))
  const fresh = nowDown.filter(r => !prevDown.has(r.id))
  const recovered = results.filter(r => prevDown.has(r.id) && r.status !== 'down')
  const c = tally(results)

  for (const r of fresh) {
    notify.push({
      kind: 'health.down', target: r.id, actor,
      title: `${r.name} 不可达`,
      body: `${r.url} · HTTP ${r.code}${r.attempts > 1 ? ` · 重试 ${r.attempts} 次` : ''}`,
      link: r.url,
      meta: { code: r.code, ms: r.ms, id: r.id },
    })
  }
  for (const r of recovered) {
    notify.push({
      kind: 'health.recovered', target: r.id, actor,
      title: `${r.name} 已恢复`,
      body: `${r.url} · HTTP ${r.code}`,
      meta: { code: r.code, ms: r.ms, id: r.id },
    })
  }
  notify.push({
    kind: 'schedule.summary', actor,
    title: fresh.length ? `巡检发现 ${fresh.length} 个新失效站点` : '巡检完成，无新增异常',
    body: `${sites.length} 站点 · 正常 ${c.ok} / 可忽略 ${c.limited} / 需处理 ${c.down}${fresh.length ? `（新增 ${fresh.length}）` : ''}${recovered.length ? ` · 恢复 ${recovered.length}` : ''}`,
    meta: { run: saved.run, counts: c, fresh: fresh.map(r => r.id), recovered: recovered.map(r => r.id), trigger },
  })

  const next = {
    ...config(),
    lastRunAt: new Date().toISOString(),
    lastRun: { run: saved.run, counts: c, total: sites.length, fresh: fresh.length, recovered: recovered.length, trigger },
  }
  persist(next)

  record({
    action: 'health.probe', actor, target: `巡检 run ${saved.run}`,
    result: c.down > 0 ? 'fail' : 'ok',
    detail: `${sites.length} 站点 · 正常 ${c.ok} / 可忽略 ${c.limited} / 需处理 ${c.down} · 新增 ${fresh.length} / 恢复 ${recovered.length}`,
  })

  return { run: saved.run, ts: saved.ts, total: sites.length, counts: c, fresh, recovered, saved: saved.saved, published }
}

/** 起一个巡检任务：进度走 SSE，结束落通知 */
export function startInspection({ trigger = 'manual', actor = 'console' } = {}) {
  const job = jobs.createJob(JOB_TITLE)
  ;(async () => {
    const sites = readSites()
    jobs.log(job, `开始巡检 ${sites.length} 个站点 · 触发来源 ${trigger}`, 'info')
    const t0 = Date.now()
    const r = await runInspection({ trigger, actor })
    jobs.emitEvent(job, 'verdict', { ok: r.counts.down === 0, ...r.counts })
    for (const s of r.fresh) jobs.log(job, `需处理：${s.id} ${s.name}（HTTP ${s.code}）`, 'stderr')
    for (const s of r.recovered) jobs.log(job, `已恢复：${s.id} ${s.name}（HTTP ${s.code}）`, 'success')
    jobs.log(
      job,
      `巡检完成（${((Date.now() - t0) / 1000).toFixed(1)}s）：正常 ${r.counts.ok} / 可忽略 ${r.counts.limited} / 需处理 ${r.counts.down}`,
      r.counts.down ? 'stderr' : 'success',
    )
    if (r.published?.ok) jobs.log(job, `判定已发布到云端 version=${r.published.version}（代理 ${r.published.proxy}）`, 'success')
    else jobs.log(job, `判定发布到云端失败：${r.published?.error || '未知原因'}`, 'stderr')
    jobs.finish(job, 0)
  })().catch(e => {
    jobs.log(job, `巡检异常：${e.message}`, 'stderr')
    jobs.finish(job, -1)
  })
  return job
}

/* ---------------- 进程内调度 ---------------- */

export function startScheduler() {
  stopScheduler()
  const c = config()
  if (!c.enabled) return false
  // 每分钟对一次表：间隔可能是小时级，用细粒度 tick 才能支持运行中改配置
  timer = setInterval(() => {
    const cur = config()
    if (!cur.enabled) return
    if (jobs.listJobs().some(j => j.title === JOB_TITLE && j.status === 'running')) return
    const due = !cur.lastRunAt || Date.now() - Date.parse(cur.lastRunAt) >= cur.intervalMs
    if (due) startInspection({ trigger: 'schedule' })
  }, 60e3)
  timer.unref?.()
  return true
}

export function stopScheduler() {
  if (timer) { clearInterval(timer); timer = null }
  return true
}

export const SCHEDULE_FILE = CONFIG_FILE