/**
 * 定时发布判据守卫：纯函数，不起定时器、不落盘。
 *
 * 守的核心：
 *  1. 时间归一：'3:5' 这类手输要能收成 '03:05'，非法值退回默认而不是静默变成 00:00；
 *  2. **一天只触发一次**：'今天已触发' 之后不再触发，跨天自然重置 ——
 *     若忘了这个去重，控制台一开着就会每分钟发一次发布提醒（或每分钟跑一次发布）。
 *
 * 运行：node tools/console/test-schedule-publish.mjs
 */
import { normalizeHm, isPublishDue } from './lib/schedule.mjs'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

const at = (h, m) => new Date(2026, 9, 16, h, m, 0)   // 2026-10-16 HH:MM

/* ---- normalizeHm ---- */

eq(normalizeHm('3:5'), '03:05', '单位数补零')
eq(normalizeHm('03:05'), '03:05', '已是规范形式原样保留')
eq(normalizeHm('23:59'), '23:59', '边界内有效')
eq(normalizeHm('24:00'), '03:00', '24 点非法 → 退回默认')
eq(normalizeHm('12:60'), '03:00', '60 分非法 → 退回默认')
eq(normalizeHm('abc'), '03:00', '非时间串 → 默认')
eq(normalizeHm(''), '03:00', '空 → 默认')
eq(normalizeHm('07:30', '99:99'), '07:30', '可自定义 fallback')

/* ---- isPublishDue ---- */

const base = { publishEnabled: true, publishAt: '03:00', lastPublishDate: null }

eq(isPublishDue({ ...base, publishEnabled: false }, at(4, 0)), false, '未启用 → 不触发')
eq(isPublishDue(base, at(2, 59)), false, '未到点 → 不触发')
eq(isPublishDue(base, at(3, 0)), true, '正好到点 → 触发')
eq(isPublishDue(base, at(3, 1)), true, '过点（当天首开控制台迟到）→ 触发')
eq(isPublishDue(base, at(23, 59)), true, '当天任意更晚时刻仍可触发一次')
eq(isPublishDue({ ...base, lastPublishDate: '2026-10-16' }, at(4, 0)), false, '今天已触发 → 不再触发')
eq(isPublishDue({ ...base, lastPublishDate: '2026-10-15' }, at(4, 0)), true, '昨天触发过 → 今天可再触发')
eq(isPublishDue(null, at(4, 0)), false, '无配置安全')
eq(isPublishDue({ publishEnabled: true, publishAt: 'bad' }, at(4, 0)), false, '时间非法 → 不触发（不误跑）')

/* ---- 结果 ---- */

if (failures.length) {
  console.error(`\n❌ 定时发布判据 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 定时发布判据：${pass} 条断言`)
process.exit(0)
