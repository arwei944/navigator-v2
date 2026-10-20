/**
 * 定时备份调度器 —— 跑在**本机控制台**里，不在容器内。
 *
 * ## 为什么必须在本机
 *
 * 容器内的定时任务备份的是它自己的磁盘。容器被平台重建时，那份备份
 * 和被备份的数据一起消失 —— 等于没有备份。备份的意义就在于**离开故障域**，
 * 所以调度器只能跑在容器之外的地方。
 *
 * ## 为什么用「补跑」而不是纯 setInterval
 *
 * 本机不是常开服务器：关机、休眠、控制台没启动的时段都不会执行。
 * 纯 `setInterval` 的做法在重启后会重新计时，可能出现「连续两天没备份」。
 * 这里每次 tick 只判断一件事：**距上次成功备份是否已超过间隔**。
 * 这样无论中间停了多久，下次启动会立刻补一次，而不是再等一个周期。
 *
 * ## 失败不推进计时
 *
 * 备份失败（网络、平台故障）时不能把「上次成功」更新成现在 ——
 * 否则一次失败会让下一个周期从失败点开始算，等于把间隔拉长了一倍。
 */
import { checkFreshness, runBackup } from './backup.mjs'

/** 默认 6 小时。与「保留 24 份 = 6 天」配套 */
export const DEFAULT_INTERVAL_HOURS = 6

/** 首次检查延迟：让控制台先完成启动，不要和 UI 抢带宽 */
const BOOT_DELAY_MS = 60_000

/** tick 的最小间隔：太频繁没意义，反而干扰 */
const TICK_MS = 30 * 60_000

export const status = {
  enabled: false,
  started: false,
  intervalHours: DEFAULT_INTERVAL_HOURS,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastPhase: '',
  runs: 0,
  failures: 0,
}

let timer = null
let tickTimer = null

/**
 * 判断现在是否该备份。
 *
 * 直接复用 `checkFreshness` 而不是自己算时间 —— 那里已经处理了
 * 「从没备份过」「时间解析失败」等边界，两处各写一份必然漂移。
 */
function shouldRun(intervalHours) {
  const f = checkFreshness({ maxAgeHours: intervalHours })
  return { run: !f.ok, reason: f.reason }
}

async function tick(reason) {
  const { run, reason: why } = shouldRun(status.intervalHours)
  if (!run) {
    status.lastPhase = `跳过：${why}`
    return
  }

  status.lastAttemptAt = new Date().toISOString()
  status.lastPhase = `备份中（${reason}）`
  try {
    const r = await runBackup()
    if (r.ok) {
      status.runs += 1
      status.lastSuccessAt = new Date().toISOString()
      status.lastError = null
      status.lastPhase = `已备份 ${r.siteCount} 站点（${r.name}）`
      console.log(`[backup] ${status.lastPhase}`)
    } else {
      status.failures += 1
      status.lastError = r.error
      status.lastPhase = `失败：${r.error}`
      console.warn(`[backup] ${status.lastPhase}`)
    }
  } catch (e) {
    status.failures += 1
    status.lastError = String(e?.message || e)
    status.lastPhase = `失败：${status.lastError}`
    console.warn(`[backup] ${status.lastPhase}`)
  }
}

/**
 * 启动调度器。
 *
 * `intervalHours` 可经 `NAV_BACKUP_INTERVAL_HOURS` 调整；
 * 传 0 表示禁用（有些用户会自己接外部备份，不想这里重复跑）。
 */
export function start({ intervalHours = Number(process.env.NAV_BACKUP_INTERVAL_HOURS ?? DEFAULT_INTERVAL_HOURS) } = {}) {
  if (status.started) return status
  status.intervalHours = Number.isFinite(intervalHours) ? intervalHours : DEFAULT_INTERVAL_HOURS

  if (status.intervalHours <= 0) {
    status.lastPhase = '已禁用（NAV_BACKUP_INTERVAL_HOURS=0）'
    status.started = true
    return status
  }

  status.enabled = true
  status.started = true
  status.lastPhase = `已启动，${Math.round(BOOT_DELAY_MS / 1000)}s 后检查（间隔 ${status.intervalHours} 小时）`

  timer = setTimeout(() => {
    void tick('启动检查')
    tickTimer = setInterval(() => { void tick('周期检查') }, TICK_MS)
  }, BOOT_DELAY_MS)
  timer.unref?.()
  if (tickTimer) tickTimer.unref?.()

  return status
}

export function stop() {
  if (timer) clearTimeout(timer)
  if (tickTimer) clearInterval(tickTimer)
  timer = null
  tickTimer = null
  status.started = false
  status.enabled = false
  status.lastPhase = '已停止'
}

/** 供测试与手动触发：立即跑一次（仍遵守「是否该备份」的判断，除非 force） */
export async function runNow({ force = false } = {}) {
  if (force) {
    status.lastAttemptAt = new Date().toISOString()
    const r = await runBackup()
    if (r.ok) {
      status.runs += 1
      status.lastSuccessAt = new Date().toISOString()
      status.lastError = null
      status.lastPhase = `已备份 ${r.siteCount} 站点（${r.name}）`
    } else {
      status.failures += 1
      status.lastError = r.error
      status.lastPhase = `失败：${r.error}`
    }
    return r
  }
  await tick('手动触发')
  return { ok: !status.lastError, phase: status.lastPhase }
}
