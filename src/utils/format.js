/**
 * 格式化函数的**前端入口** —— 实现住在 `shared/format.mjs`（全项目唯一一份）。
 *
 * 为什么转发而不是在这里写：控制台 UI 与 CLI 也共用同一套格式化规则（它们
 * 此前各写了 6 份 / 2 份，同一个时间在两个界面上显示不同格式），实现放
 * `shared/` 才能三边取同一份。这与 `utils/url.js` 转发 `shared/host.mjs`
 * 是同一个模式。
 *
 * 组件继续 `import { fmtXxx } from '@/utils/format'` 即可，不必知道实现在哪。
 * 注意时长叫 `fmtDurationZh`（中文、入参秒），与 `shared/uptime.mjs` 的
 * `fmtDuration`（英文、入参毫秒）区分，避免同名不同义。
 */
export {
  fmtDateTime,
  fmtDateTimeSec,
  fmtDateTimeShort,
  fmtDateTimeCompact,
  fmtClockTime,
  fmtRelative,
  fmtBytes,
  fmtDurationZh,
  fmtMillis,
} from '../../shared/format.mjs'
