/**
 * 告警站外出口门禁（G3 / L1-3）。
 *
 * 守的是「判据 → 事件 → 载荷 → 渠道解析」这条纯计算链的不变量 ——
 * 发送要联网，门禁里不跑；但一旦这几条错了，线上就是「该报的不报 / 不该报的乱报」，
 * 比渠道连不上更隐蔽，所以必须钉住。
 *
 * 零依赖纯 node，退出码语义：0 全过 / 1 有失败。
 */
import {
  alertNotifications, webhookBody, parseWebhookUrls,
} from '../../shared/ops/alert-notify.mjs'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

/* ---------------- ① 判据：只对「达到阈值」的站点告警 ---------------- */
const sites = [
  { id: 'a', name: '甲站', url: 'https://a.com', categoryId: 'tools' },
  { id: 'b', name: '乙站', url: 'https://b.com/one', categoryId: 'tools' },
  { id: 'c', name: '丙站', url: 'https://b.com/two', categoryId: 'tools' }, // 与 b 同 host
  { id: 'd', name: '丁站', url: 'https://d.com', categoryId: 'tools' },
]
const config = { rules: [], fallback: { downThreshold: 3, cooldownMs: 3600e3 } }
const results = {
  a: { status: 'down', fails: 3 },   // 达阈值 → 告警
  b: { status: 'down', fails: 5 },   // 达阈值 → 告警（host b.com）
  c: { status: 'down', fails: 4 },   // 达阈值，但同 host → 合并键相同
  d: { status: 'down', fails: 2 },   // 未达阈值 → 不告警
  e: { status: 'ok', fails: 9 },     // 非 down → 不告警
}
const events = alertNotifications({ results, sites, config, ts: '2026-10-19T00:00:00.000Z' })
eq(events.length, 3, '达阈值的站点才产出事件（d 未达阈值、e 非 down 都排除）')
ok(events.every(e => e.kind === 'health.down'), '事件类型都是 health.down')
ok(events.every(e => e.severity === 'error'), '事件级别是 error')

// 同 host 的 b / c 聚合键相同 —— 这是「同站多入口只报一次」的依据
const bEvent = events.find(e => e.meta.id === 'b')
const cEvent = events.find(e => e.meta.id === 'c')
eq(bEvent.target, 'b.com', '聚合键取 host（不带路径）')
eq(cEvent.target, 'b.com', '同 host 的不同入口聚合键相同')
ok(bEvent.title.includes('乙站'), '标题带站名')

/* ---------------- ② 载荷：json 通用 / text 文本机器人 ---------------- */
const n = events[0]
const json = webhookBody(n, 'json')
const parsed = JSON.parse(json)
ok(parsed.event === 'health.down', 'json 载荷字段 event 稳定')
ok(typeof parsed.title === 'string' && parsed.title.length > 0, 'json 载荷有 title')
ok(typeof parsed.time === 'string', 'json 载荷有 time')
const text = webhookBody(n, 'text')
ok(typeof text === 'string' && text.includes(n.title), 'text 载荷含标题（飞书/钉钉文本机器人用）')
ok(text.includes('\n'), 'text 载荷标题与正文分行')
eq(webhookBody(n), json, '不传 format 默认 json')

/* ---------------- ③ 渠道解析：逗号分隔即多渠道 ---------------- */
eq(parseWebhookUrls('').length, 0, '空值 → 零渠道（完全不推送）')
eq(parseWebhookUrls('   ').length, 0, '纯空白 → 零渠道')
const urls = parseWebhookUrls(' https://hook.example/a , https://hook.example/b , https://hook.example/a ')
eq(urls.length, 2, '逗号分隔多渠道 + 去重')
eq(urls[0], 'https://hook.example/a', '顺序保持，去空白')
ok(parseWebhookUrls('ftp://x, notaurl, https://ok.example/g').length === 1, '丢弃非 http(s) 项，保留合法项')
eq(parseWebhookUrls('https://only.example/h').length, 1, '单个 URL 也正确解析')

/* ---------------- ④ 无告警时不产出（不误报） ---------------- */
eq(alertNotifications({ results: { a: { status: 'ok', fails: 0 } }, sites, config }).length, 0, '全正常时零事件')
eq(alertNotifications({}).length, 0, '空输入不抛错、零事件')

/* ---------------- 结果 ---------------- */
if (failures.length) {
  console.error(`\n❌ 告警出口门禁 ${failures.length} 条断言失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 告警出口门禁通过：${pass} 条断言`)
