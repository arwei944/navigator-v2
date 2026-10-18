/**
 * 格式化函数的**全项目唯一实现** —— 前端、控制台 UI、CLI 都从这里取。
 *
 * 为什么放在 `shared/`：与 `host.mjs` 同一个理由。这套实现曾经散成三摊：
 *   - 前端 `src/` 里 11 个组件各写一份（`fmt(ts)` 逐字相同的就有 4 份，另有
 *     2 份同族却漏了非法输入护栏，还有 6 处内联）；
 *   - 控制台 UI `tools/console/ui/*.js` 里 6 份（其中 5 份逐字相同）；
 *   - CLI `tools/cli/commands/*.mjs` 里 2 份。
 * 三摊各改各的，同一个时间在两个界面上显示不同格式，运行时才会发现。
 *
 * 接入方式（照抄 host.mjs 的走法）：
 *   - 前端：`src/utils/format.js` 转发（组件继续 `@/utils/format` import）；
 *   - 控制台 UI：`import ... from '/shared/format.mjs'`（服务器有 `/shared/` 静态路由）；
 *   - CLI：`import ... from '../../../shared/format.mjs'`。
 *
 * **刻意不在这里的**（同名或近名，但语义不同，别混）：
 *   - `shared/uptime.mjs` 的 `fmtDuration(ms)` —— 监控停机时长，英文缩写
 *     （`5m12s`）、**入参是毫秒**；本文件的时长是中文 `5 分 12 秒`、**入参是秒**，
 *     所以这里叫 `fmtDurationZh` 以示区分。
 *   - `src/utils/bgmScore.js` 的 `fmtClock(sec)` —— 音乐播放进度 `mm:ss`，
 *     是 bgmScore 的契约（`test-bgm` 直接测它）。
 */

const pad2 = (n) => String(n).padStart(2, '0')

/** 时间：本地化字符串（zh-CN）。非法输入回落**原值** —— 后台列表的主力用法。 */
export function fmtDateTime(ts) {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString('zh-CN')
}

/** 时间：本地化字符串 + 24 小时制；空值 / 非法回落 fallback（默认「—」）。 */
export function fmtDateTimeSec(ts, fallback = '—') {
  if (!ts) return fallback
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? fallback : d.toLocaleString('zh-CN', { hour12: false })
}

/** 时间：紧凑 `YYYY-MM-DD HH:mm`；空值 / 非法回落 fallback（默认「—」）。 */
export function fmtDateTimeShort(ts, fallback = '—') {
  if (!ts) return fallback
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return fallback
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/**
 * 时间：年内 `MM/DD HH:mm`，跨年补 `YYYY/` 前缀；空值 / 非法回落 fallback。
 * 详情页时间线、统计区间端点、控制台面板的日期列都用它。
 */
export function fmtDateTimeCompact(ts, fallback = '—') {
  if (!ts) return fallback
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return fallback
  const md = `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}/${md}`
}

/** 时间：仅时分秒 `HH:mm:ss`；空值 / 非法回落 fallback。（CLI 事件流用） */
export function fmtClockTime(ts, fallback = '—') {
  if (!ts) return fallback
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return fallback
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

/**
 * 时间：相对现在（刚刚 / N 分钟前 / N 小时前 / N 天前）。
 * 超过 30 天改走 `fallback`（默认本地化日期）—— 相对时间太久就失去意义。
 */
export function fmtRelative(ts, { fallback, now = Date.now() } = {}) {
  const diff = now - new Date(ts).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return fallback ? fallback(ts) : new Date(ts).toLocaleDateString('zh-CN')
}

/** 字节：`B` / `KB` / `MB`（各保留一位小数）。 */
export function fmtBytes(n) {
  const b = Number(n) || 0
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1048576).toFixed(1)} MB`
}

/**
 * 时长（**秒**）：`N 秒` / `N 分 N 秒` / `N 小时 N 分` / `N 天 N 小时`。
 * 中文界面用；CLI 的监控时长另有 `shared/uptime.mjs#fmtDuration(ms)`（英文、毫秒）。
 */
export function fmtDurationZh(sec) {
  const s = Number(sec) || 0
  if (s < 60) return `${s} 秒`
  if (s < 3600) return `${Math.floor(s / 60)} 分 ${s % 60} 秒`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时 ${Math.floor((s % 3600) / 60)} 分`
  return `${Math.floor(s / 86400)} 天 ${Math.floor((s % 86400) / 3600)} 小时`
}

/**
 * 耗时（毫秒）：`Nms` / `N.Ns`（性能指标 / 接口时延用，粒度到毫秒）。
 * 空值回落 fallback（默认「—」）—— 控制台面板此前各写一份，空值有的给「—」有的给空串。
 */
export function fmtMillis(ms, fallback = '—') {
  if (ms === null || ms === undefined) return fallback
  const v = Number(ms) || 0
  return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`
}
