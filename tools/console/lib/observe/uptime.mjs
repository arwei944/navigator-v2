/**
 * 本站可用性的「探」与「存」。
 *
 * 注意与 `tools/console/lib/observe/health.mjs` 的区别：
 *   - health.mjs  → 探**我们收录的 300 个站点**（内容层面的可用性）
 *   - 本模块      → 探**我们自己部署的站点**（navigator-v2 是否可访问）
 * 两者都叫「可用性」，混起来看结论会完全错。
 *
 * 落盘成 JSONL（`data/uptime.jsonl`，`/data/` 已 gitignore）：
 * 可用率问的是「一直不稳，还是刚抖了一下」，单次快照答不了。
 */
import { appendFileSync, mkdirSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ROOT } from '../core/env.mjs'
import { resolvePublisher } from '../../../../shared/publisher.mjs'
import { classifyProbe, KIND } from '../../../../shared/uptime.mjs'

// 允许换路径：测试要往临时文件写，部署上也有人想把它放到数据盘
const LOG = process.env.NAV_UPTIME_LOG || join(ROOT, 'data', 'uptime.jsonl')
const MAX_BODY = 400

// 监测按计划任务每几分钟一条 —— 不设上限就是无界增长。
// 超了就重写成「最近 KEEP_LINES 行」：保留可用率统计够用的历史，又不让文件无限长。
export const MAX_BYTES = 4 * 1024 * 1024
export const KEEP_LINES = 40000

export function logPath() { return LOG }

/** 探测目标：发布通道当前指向的站点地址（不硬编码，通道一切换就跟着走） */
export function siteUrl() {
  return String(resolvePublisher().siteUrl || '').replace(/\/+$/, '')
}

/** 超上限就把日志裁到最后 KEEP_LINES 行。返回是否真的裁了。 */
export function trimIfNeeded({ maxBytes = MAX_BYTES, keepLines = KEEP_LINES } = {}) {
  try {
    if (!existsSync(LOG) || statSync(LOG).size <= maxBytes) return false
    const lines = readFileSync(LOG, 'utf8').split('\n').filter(l => l.trim())
    writeFileSync(LOG, lines.slice(-keepLines).join('\n') + '\n')
    return true
  } catch { return false }   // 裁不动也不该让监测中断
}

export function append(event) {
  mkdirSync(dirname(LOG), { recursive: true })
  appendFileSync(LOG, JSON.stringify(event) + '\n')
  trimIfNeeded()
}

/**
 * 读日志。坏行直接跳过并计数 —— 断电写一半的行不该让整份历史读不出来，
 * 但也不能假装没发生（skip 会如实返回）。
 */
export function read({ since = 0, limit = 0 } = {}) {
  if (!existsSync(LOG)) return { events: [], skipped: 0, total: 0 }
  const lines = readFileSync(LOG, 'utf8').split('\n').filter(l => l.trim())
  const events = []
  let skipped = 0
  for (const line of lines) {
    try {
      const e = JSON.parse(line)
      if (!e || !Number.isFinite(e.at)) { skipped++; continue }
      if (e.at < since) continue
      events.push(e)
    } catch { skipped++ }
  }
  events.sort((a, b) => a.at - b.at)
  return {
    events: limit > 0 ? events.slice(-limit) : events,
    skipped,
    total: events.length,
  }
}

/** 探一次：返回一条完整事件（含判定结果、耗时、原始状态与响应体片段） */
export async function probeOnce({ url = '', timeoutMs = 12000, path = '/api/health' } = {}) {
  const base = String(url || siteUrl()).replace(/\/+$/, '')
  const target = base + path
  const at = Date.now()
  const t0 = Date.now()
  let status = 0
  let body = ''
  let error = ''
  try {
    const res = await fetch(target, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' })
    status = res.status
    body = (await res.text().catch(() => '')).slice(0, MAX_BODY)
  } catch (e) {
    error = String(e?.name === 'TimeoutError' ? 'timeout' : (e?.message || e))
  }
  const kind = classifyProbe({ status, body, error })
  return {
    at,
    kind,
    ok: kind === KIND.OK,
    status: status || null,
    ms: Date.now() - t0,
    url: target,
    error: error || undefined,
    // 只留开头一小段：够判定、又不至于把日志撑大
    body: body ? body.replace(/\s+/g, ' ').slice(0, 160) : undefined,
  }
}

/** 日志里最后一条样本（用来判断「这次和上次比有没有变化」） */
export function lastEvent() {
  const { events } = read({ limit: 1 })
  return events[0] || null
}

/**
 * 持续探测。onSample(event, count, prev) 每次都会拿到；调用方自己决定怎么显示。
 * prev 是**上一次落盘的样本**（不是上一次调用），所以「一次跑一个样本」的计划任务
 * 同样能靠它识别出状态变化 —— 这正是掉线/恢复通知的判据。
 * 返回一个 stop() —— 便于 Ctrl+C 或测试里收尾。
 */
export function watch({ intervalMs = 60000, timeoutMs = 12000, url = '', onSample = null, maxSamples = 0 } = {}) {
  let stopped = false
  let timer = null
  let count = 0

  const tick = async () => {
    if (stopped) return
    const prev = lastEvent()
    const ev = await probeOnce({ url, timeoutMs })
    append(ev)
    count++
    try { onSample?.(ev, count, prev) } catch { /* 显示层出错不该中断监测 */ }
    if (stopped) return
    if (maxSamples && count >= maxSamples) { stopped = true; return }
    timer = setTimeout(tick, intervalMs)
    if (timer.unref) timer.unref()
  }

  tick()
  return {
    stop() { stopped = true; if (timer) clearTimeout(timer) },
    get count() { return count },
  }
}
