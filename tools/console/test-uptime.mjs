/**
 * 本站可用性内核：判定一次探测、折叠掉线区间、汇总可用率。
 *
 * 盯的是两类事故：
 *   ① 把「平台挂了」认成「我们挂了」（处置完全相反：一个只能等，一个要动手）；
 *   ② 用错误的窗口算出漂亮的可用率（比如一段样本都没有却报 100%）。
 */
import {
  classifyProbe, foldOutages, summarize, fmtDuration, KIND, EDGE_SIGNATURE,
} from '../../shared/uptime.mjs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs'

let pass = 0
const failures = []
function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

const T = 1_700_000_000_000
const ev = (at, kind) => ({ at, kind })
const okEv = at => ev(at, KIND.OK)

/* ---- 判定：平台边缘 vs 应用 vs 网络 ---- */
eq(classifyProbe({ status: 200, body: '{"ok":true}' }), KIND.OK, '200 → 正常')
eq(classifyProbe({ status: 302, body: '' }), KIND.OK, '3xx 也算可达（重定向不影响可用性）')
eq(classifyProbe({ status: 503, body: EDGE_SIGNATURE }), KIND.EDGE, '平台文案 → 平台边缘故障')
eq(classifyProbe({ status: 503, body: `<html>${EDGE_SIGNATURE}</html>` }), KIND.EDGE, '文案嵌在 HTML 里也认得出')
eq(classifyProbe({ status: 503, body: '{"ok":false,"error":"store unreadable"}' }), KIND.APP, '我们自己的 503 → 应用故障')
eq(classifyProbe({ status: 500, body: '' }), KIND.APP, '5xx 无文案 → 应用故障')
eq(classifyProbe({ status: 404, body: 'Not Found' }), KIND.APP, '4xx（应用在响应但不认路）→ 应用故障')
eq(classifyProbe({ status: 0, error: 'timeout' }), KIND.NET, '没拿到状态码 → 连不上')
eq(classifyProbe({ status: 0, body: EDGE_SIGNATURE }), KIND.NET, '连状态码都没有时，先判「连不上」而不是猜平台')
eq(classifyProbe({}), KIND.NET, '空结果 → 连不上')
eq(classifyProbe({ status: 200, body: EDGE_SIGNATURE }), KIND.OK, '状态码是 2xx 时以状态码为准（文案出现在页面正文里不算故障）')

/* ---- 折叠：掉线区间 ---- */
eq(foldOutages([]).length, 0, '没有事件 → 没有掉线')
eq(foldOutages([okEv(T), okEv(T + 1000)]).length, 0, '全是正常 → 没有掉线')

const one = foldOutages([okEv(T), ev(T + 60000, KIND.EDGE), ev(T + 120000, KIND.EDGE), okEv(T + 300000)])
eq(one.length, 1, '一跳一恢复 → 一段掉线')
eq(one[0].durationMs, 240000, '掉线时长 = 首次异常到恢复之间')
eq(one[0].samples, 2, '段内异常样本数')
eq(one[0].kind, KIND.EDGE, '段的主要判定')
eq(one[0].ongoing, false, '已恢复的段不算进行中')

const ongoing = foldOutages([okEv(T), ev(T + 30000, KIND.APP)], T + 90000)
eq(ongoing[0].ongoing, true, '结尾仍是异常 → 进行中')
eq(ongoing[0].durationMs, 60000, '进行中的段用 now 算时长')

const two = foldOutages([
  okEv(T), ev(T + 1000, KIND.NET), okEv(T + 5000),
  okEv(T + 9000), ev(T + 10000, KIND.APP), ev(T + 11000, KIND.APP), okEv(T + 20000),
])
eq(two.length, 2, '两跳两恢复 → 两段掉线')
eq(two[1].samples, 2, '第二段样本数')
eq(two[0].durationMs, 4000, '第一段时长')

// 段内混合故障类型 → 取出现最多的那种（这决定了要不要重启容器）
const mixed = foldOutages([ev(T, KIND.NET), ev(T + 1000, KIND.EDGE), ev(T + 2000, KIND.EDGE), okEv(T + 3000)])
eq(mixed[0].kind, KIND.EDGE, '段内判定取出现次数最多的类型')

/* ---- 汇总 ---- */
const events = [okEv(T), okEv(T + 10000), ev(T + 20000, KIND.EDGE), okEv(T + 60000), okEv(T + 90000)]
const s = summarize(events, { now: T + 100000, since: T })
eq(s.samples, 5, '样本数')
eq(s.okCount, 4, '正常样本数')
eq(s.failCount, 1, '异常样本数')
eq(s.outages.length, 1, '掉线段数')
eq(s.downMs, 40000, '掉线总时长')
eq(s.upMs, 60000, '在线总时长')
ok(Math.abs(s.availability - 0.6) < 1e-9, '可用率 = 在线时长 / 窗口时长', String(s.availability))

// 窗口外的事件不参与
const win = summarize(events, { now: T + 100000, since: T + 50000 })
eq(win.samples, 2, 'since 之前的事件被排除')
eq(win.availability, 1, '窗口内没有异常 → 可用率 100%')

// 没有样本时不许报「100% 可用」——那是假结论
const empty = summarize([], { now: T, since: T - 86400000 })
eq(empty.availability, null, '没有样本时可用率为 null（不假装 100%）')
eq(empty.samples, 0, '没有样本时计数为 0')

// 乱序输入也要算对
const shuffled = summarize([okEv(T + 90000), ev(T + 20000, KIND.EDGE), okEv(T), okEv(T + 60000), okEv(T + 10000)], { now: T + 100000, since: T })
eq(shuffled.samples, 5, '乱序输入样本数不变')
eq(shuffled.downMs, 40000, '乱序输入掉线时长仍正确')

// 掉线时长不能超过窗口
const clamp = summarize([okEv(T), ev(T + 1000, KIND.APP)], { now: T + 3000, since: T })
ok(clamp.downMs <= clamp.spanMs, '掉线时长被夹在窗口内', `${clamp.downMs} ≤ ${clamp.spanMs}`)
ok(clamp.availability >= 0, '可用率不会为负')

/* ---- 时长格式 ---- */
eq(fmtDuration(6000), '6s', '秒级')
eq(fmtDuration(65000), '1m05s', '分级')
eq(fmtDuration(7500000), '2h 5m', '小时级')
eq(fmtDuration(0), '0s', '零')
eq(fmtDuration(null), '0s', '空值容错')

/* ---- 落盘：坏行不吞、窗口过滤、超限裁剪（走临时文件，不碰真实日志）---- */
process.env.NAV_UPTIME_LOG = join(tmpdir(), `nav-uptime-test-${process.pid}.jsonl`)
const lib = await import('../../tools/console/lib/uptime.mjs')
const TMP = lib.logPath()

rmSync(TMP, { force: true })
eq(TMP, process.env.NAV_UPTIME_LOG, '日志路径可用 NAV_UPTIME_LOG 覆盖（测试不写真实日志）')

lib.append({ at: T + 1, kind: KIND.OK })
lib.append({ at: T + 2, kind: KIND.EDGE })
let r = lib.read()
eq(r.total, 2, '落盘后读回两条')
eq(r.skipped, 0, '没有坏行时不报跳过')

// 手动塞一行坏数据：模拟写日志时断电
writeFileSync(TMP, readFileSync(TMP, 'utf8') + '{ 这不是 JSON\n')
r = lib.read()
eq(r.total, 2, '一行坏了不影响其余记录')
eq(r.skipped, 1, '坏行被如实计数（不假装没发生）')

lib.append({ at: T + 3000, kind: KIND.OK })
eq(lib.read({ since: T + 2 }).total, 2, 'since 过滤含边界（等于 since 的留下）')
eq(lib.read({ since: T + 3 }).total, 1, 'since 之前的记录被排除')
eq(lib.read({ limit: 1 }).events.length, 1, 'limit 取最近的若干条')
eq(lib.read({ limit: 1 }).events[0].at, T + 3000, 'limit 取的是最近那条')
eq(lib.lastEvent().at, T + 3000, 'lastEvent 返回日志里最后一条（计划任务靠它判断状态变化）')

// 裁剪：日志会随计划任务无界增长，必须封顶
for (let i = 0; i < 200; i++) lib.append({ at: T + 10000 + i, kind: KIND.OK })
const sizeBefore = statSync(TMP).size
ok(lib.trimIfNeeded({ maxBytes: 400, keepLines: 50 }), '超过上限时执行裁剪')
ok(statSync(TMP).size < sizeBefore, '裁剪后文件确实变小', `${sizeBefore} → ${statSync(TMP).size}`)
const kept = lib.read()
eq(kept.total, 50, '裁剪后只保留最后 50 行')
eq(kept.events[kept.events.length - 1].at, T + 10000 + 199, '保留的是最近的那批')
ok(!lib.trimIfNeeded({ maxBytes: 10 * 1024 * 1024 }), '没超上限时不动文件')

rmSync(TMP, { force: true })
ok(!existsSync(TMP), '测试用的临时日志已清理')

console.log(`\n本站可用性内核：${pass} 通过 / ${failures.length} 失败`)
if (failures.length) {
  for (const f of failures) console.log('  ✖ ' + f)
  process.exit(1)
}
