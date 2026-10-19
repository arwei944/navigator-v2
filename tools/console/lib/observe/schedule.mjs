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
import { ROOT } from '../core/env.mjs'
import { readSites } from '../content/data.mjs'
import { probeMany, tally } from '../../../../shared/health-probe.mjs'
import * as health from './health.mjs'
import * as notify from './notify.mjs'
import * as jobs from '../core/jobs.mjs'
import { record } from '../core/audit.mjs'

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
  // 定时发布（与巡检共用同一个配置文件与调度器）
  publishEnabled: false,
  publishAt: '03:00',
  publishAuto: false,
  lastPublishDate: null,
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
  // 定时发布：时间归一 + 布尔化（其余字段原样透传）
  if (patch.publishAt !== undefined) next.publishAt = normalizeHm(patch.publishAt)
  if (patch.publishEnabled !== undefined) next.publishEnabled = Boolean(patch.publishEnabled)
  if (patch.publishAuto !== undefined) next.publishAuto = Boolean(patch.publishAuto)
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

/* ---------------- 定时发布 ---------------- */

/** 'H:M' / 'HH:MM' → 'HH:MM'；非法值退回 fallback（默认为默认时间） */
export function normalizeHm(v, fallback = DEFAULTS.publishAt) {
  const m = String(v || '').match(/^(\d{1,2}):(\d{1,2})$/)
  if (!m) return fallback
  const h = Number(m[1]); const min = Number(m[2])
  if (h > 23 || min > 59) return fallback
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function todayStr(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * 「定时发布是否到点」——纯函数、可测。
 *
 * 判据：已启用 且 当前时刻已过 publishAt 且 **今天还没触发过**。
 * `lastPublishDate` 记的是**日期**而不是时间戳：这样「今天 03:05 才打开控制台」只会补触发一次，
 * 不会因为迟到而在这一分钟里反复触发。跨天自然重置。
 */
export function isPublishDue(cfg, now = new Date()) {
  if (!cfg || !cfg.publishEnabled) return false
  const at = normalizeHm(cfg.publishAt, '')
  if (!at) return false
  if (cfg.lastPublishDate === todayStr(now)) return false
  const [h, m] = at.split(':').map(Number)
  return (now.getHours() * 60 + now.getMinutes()) >= h * 60 + m
}

/**
 * 定时发布的到点处理（每分钟 tick 调用一次）。
 *
 * **默认只提醒、不自动执行**：发布会提交、推送、重新部署线上 —— 无人监督地自动做这些，
 * 一旦本地有半成品改动就会直接发到线上。要「到点自动跑」必须显式打开 `publishAuto`，
 * 届时走的仍是同一条 `startRelease` 流水线，日志与中止方式完全一致（能在「流水线」面板看到）。
 */
async function checkScheduledPublish(cur) {
  if (!isPublishDue(cur)) return
  persist({ ...cur, lastPublishDate: todayStr() })
  if (cur.publishAuto) {
    const { startRelease, RELEASE_JOB_TITLE } = await import('../publish/release.mjs')
    if (jobs.listJobs().some(j => j.title === RELEASE_JOB_TITLE && j.status === 'running')) return
    startRelease({ trigger: 'schedule', actor: 'schedule' })
    notify.push({ kind: 'publish.scheduled', title: '定时发布已启动', body: `按配置自动执行流水线（${cur.publishAt}）` })
  } else {
    notify.push({
      kind: 'publish.due', title: '定时发布到点（仅提醒）',
      body: `已到 ${cur.publishAt}。当前设置只提醒、不自动执行 —— 去「流水线」面板点「立即发布」即可。`,
    })
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
  timer = setInterval(async () => {
    const cur = config()
    if (cur.enabled) {
      const busy = jobs.listJobs().some(j => j.title === JOB_TITLE && j.status === 'running')
      const due = !cur.lastRunAt || Date.now() - Date.parse(cur.lastRunAt) >= cur.intervalMs
      if (due && !busy) startInspection({ trigger: 'schedule' })
    }
    try { await checkScheduledPublish(cur) } catch { /* 定时发布的异常不能拖垮调度器 */ }
  }, 60e3)
  timer.unref?.()
  return true
}

export function stopScheduler() {
  if (timer) { clearInterval(timer); timer = null }
  return true
}

export const SCHEDULE_FILE = CONFIG_FILE