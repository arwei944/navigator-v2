/**
 * 镜像同步调度器 —— 跑在本机控制台里。
 *
 * ## 与备份调度器的区别
 *
 * 备份关心的是「有没有一份可回滚的完整副本」，间隔按小时算就够。
 * 镜像关心的是「本地多快能看到云端的变化」，所以要短得多（默认 1 分钟）。
 *
 * 但两者的**正确性要求是同一个**：
 *   - 补跑而不是纯 setInterval：本机关机/休眠后重启，要立刻补一次，而不是再等一整个周期
 *   - 失败不推进计时：一次失败不能把下一次推迟一整个周期
 *
 * ## 为什么失败时游标不动就够了
 *
 * 游标语义是「已经应用到本地的最后一个 seq」。失败时不动它，
 * 下次从同一位置重试 —— 幂等，不会跳过任何变化。
 * 这一点由 `mirror.syncOnce` 保证，调度器只负责按节奏调用。
 */
import { syncOnce } from './mirror.mjs'

/** 默认 1 分钟。云端变化要「实时」到本地，但也不必秒级 —— 那是长连接该做的事 */
export const DEFAULT_INTERVAL_SEC = 60

/** 首次检查延迟：让控制台先启动完，不要和首屏抢带宽 */
const BOOT_DELAY_MS = 15_000

/** tick 的最小间隔（检查频率），不必等于同步间隔 */
const TICK_MS = 15_000

export const status = {
  enabled: false,
  started: false,
  intervalSec: DEFAULT_INTERVAL_SEC,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastPhase: '',
  runs: 0,
  failures: 0,
}

let timer = null

/** 距上次成功是否已超过间隔 */
function shouldRun(intervalSec) {
  if (!status.lastSuccessAt) return { run: true, reason: '从未同步过' }
  const age = Date.now() - new Date(status.lastSuccessAt).getTime()
  if (!Number.isFinite(age)) return { run: true, reason: '上次成功时间无法解析' }
  const need = intervalSec * 1000
  if (age >= need) return { run: true, reason: `距上次成功 ${Math.round(age / 1000)} 秒` }
  return { run: false, reason: `距上次成功 ${Math.round(age / 1000)} 秒，未到间隔` }
}

async function tick(reason) {
  const { run, reason: why } = shouldRun(status.intervalSec)
  if (!run) {
    status.lastPhase = `跳过：${why}`
    return
  }

  status.lastAttemptAt = new Date().toISOString()
  status.lastPhase = `同步中（${reason}）`
  try {
    const r = await syncOnce()
    if (r.ok) {
      status.runs += 1
      status.lastSuccessAt = new Date().toISOString()
      status.lastError = null
      status.lastPhase = `已同步 ${r.applied} 个变化（游标 ${r.cursor}）`
      if (r.applied > 0 || r.removed > 0 || r.fullResync) console.log(`[mirror] ${status.lastPhase}`)
    } else {
      status.failures += 1
      status.lastError = r.error
      status.lastPhase = `失败：${r.error}`
      console.warn(`[mirror] ${status.lastPhase}`)
    }
  } catch (e) {
    status.failures += 1
    status.lastError = String(e?.message || e)
    status.lastPhase = `异常：${status.lastError}`
    console.warn(`[mirror] ${status.lastPhase}`)
  }
}

/**
 * 启动调度器。`intervalSec = 0` 表示禁用（只保留手动同步）。
 */
export function start({ intervalSec = DEFAULT_INTERVAL_SEC } = {}) {
  const n = Number(intervalSec)
  if (Number.isFinite(n) && n <= 0) {
    status.enabled = false
    status.started = false
    status.lastPhase = '已禁用（NAV_MIRROR_INTERVAL_SEC=0）'
    return status
  }
  if (status.started) return status

  status.intervalSec = Number.isFinite(n) && n > 0 ? n : DEFAULT_INTERVAL_SEC
  status.enabled = true
  status.started = true

  setTimeout(() => { tick('启动补跑') }, BOOT_DELAY_MS)
  timer = setInterval(() => { tick('周期检查') }, TICK_MS)
  if (timer.unref) timer.unref()

  return status
}

export function stop() {
  if (timer) clearInterval(timer)
  timer = null
  status.started = false
  status.enabled = false
}
