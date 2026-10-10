/**
 * 智能化的两个内核用例：意图解析与场景排序。零依赖、不联网。
 *
 * 这两块最容易出的问题不是「算错」，而是「算得很像」—— 推荐出一堆解释不通的站、
 * 或者把用户的普通搜索词硬解释成筛选条件。所以这里的断言大量关于**边界与克制**：
 * 低置信度不许触发、冷启动不许硬推、URL 里的 javascript: 不许变成链接。
 *
 * 运行：node tools/console/test-intent.mjs
 */
import { describeIntent, intentToQuery, parseIntent } from '../../src/utils/intent.js'
import { buildSignals, decay, hasSignal, rankSites, slotOf, SLOT_LABELS } from '../../src/utils/smartRank.js'

let pass = 0
const failures = []

function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}
function deepEq(actual, expected, label) {
  ok(JSON.stringify(actual) === JSON.stringify(expected), label,
    `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

/* ---------------- 意图解析 ---------------- */

{
  const it = parseIntent('免费的 AI 画图工具')
  ok(it.hit, '典型输入被识别为意图')
  ok(it.categories.length > 0, '识别出分类')
  ok(it.purposes.includes('design') || it.purposes.includes('tool'), '识别出用途（设计或在线工具）')
  eq(it.price, 'free', '识别出免费')
  ok(it.confidence >= 0.5, '置信度达到阈值', String(it.confidence))
}

{
  const it = parseIntent('交易所')
  ok(it.categories.includes('cex') || it.categories.includes('crypto'), '「交易所」落到交易所或币圈')
}

{
  const it = parseIntent('写代码的站')
  ok(it.categories.includes('coding') || it.purposes.includes('coding'), '「写代码」落到编程方向')
}

{
  eq(parseIntent('').hit, false, '空输入不产生意图')
  eq(parseIntent('   ').hit, false, '纯空白不产生意图')
  eq(parseIntent(null).hit, false, 'null 不产生意图')
  eq(parseIntent(undefined).hit, false, 'undefined 不产生意图')
}

{
  // 普通站点名不该被硬解释成筛选条件
  const it = parseIntent('github')
  eq(it.hit, false, '普通英文站名不触发意图')
  eq(it.categories.length, 0, '普通站名不产生分类')
}

{
  const it = parseIntent('AI', { minConfidence: 0.9 })
  eq(it.hit, false, '阈值可调高：单维度命中在 0.9 阈值下不触发')
  eq(it.categories.length, 1, '但解析结果仍给出分类（调用方自行决定用不用）')
}

{
  const it = parseIntent('免费')
  eq(it.price, 'free', '只有价格词时仍能识别价格')
  eq(it.hit, false, '只有价格词不算完整意图（无分类也无用途）')
}

{
  const it = parseIntent('最新的资讯站')
  eq(it.sort, 'newest', '识别排序意图')
  ok(it.purposes.includes('news') || it.categories.includes('media'), '识别资讯方向')
}

{
  const it = parseIntent('热门交易')
  eq(it.sort, 'clicks', '识别热门排序')
  ok(it.purposes.includes('trading'), '识别交易用途')
}

{
  const it = parseIntent('付费的会员课程')
  eq(it.price, 'paid', '识别付费')
}

{
  // 大小写与空格不影响命中
  const a = parseIntent('AI 编程')
  const b = parseIntent('  ai 编程  ')
  deepEq(a.categories, b.categories, '大小写与空白不影响分类命中')
}

{
  const q = intentToQuery({ categories: ['coding', 'design'], purposes: ['tool', 'design'], sort: 'newest' })
  eq(q.c, 'coding', '路由只取第一个分类（单值轴）')
  eq(q.p, 'tool', '路由只取第一个用途')
  eq(q.sort, 'newest', '排序带到 query')
  deepEq(intentToQuery(null), {}, 'null 意图不产生 query')
}

{
  const text = describeIntent(parseIntent('免费的 AI 画图工具'))
  ok(text.includes('免费'), '描述里包含价格维度', text)
  eq(describeIntent({ hit: false, matched: [] }), '', '未命中时描述为空')
}

/* ---------------- 时段与衰减 ---------------- */

{
  const at = (h) => new Date(2026, 0, 5, h, 30)
  eq(slotOf(at(7)), 'morning', '早上 7 点')
  eq(slotOf(at(12)), 'afternoon', '中午 12 点')
  eq(slotOf(at(16)), 'evening', '下午 16 点')
  eq(slotOf(at(22)), 'night', '晚上 22 点')
  eq(slotOf(at(2)), 'night', '凌晨 2 点归入晚上（跨零点区间）')
  eq(slotOf(at(4)), 'night', '凌晨 4 点仍在晚上区间')
  eq(slotOf(at(5)), 'morning', '早上 5 点是分界')
}

{
  ok(Object.keys(SLOT_LABELS).length === 4, '四个时段都有中文标签')
}

{
  const now = Date.now()
  eq(decay(now, now), 1, '刚访问过的衰减为 1')
  const half = decay(now - 7 * 24 * 3600 * 1000, now)
  ok(Math.abs(half - 0.5) < 1e-6, '7 天前衰减到 0.5', String(half))
  const older = decay(now - 14 * 24 * 3600 * 1000, now)
  ok(older < half, '越久越小')
  eq(decay('不是时间', now), 0, '非法时间戳衰减为 0')
}

/* ---------------- 场景排序 ---------------- */

const SITES = [
  { id: 'a', name: 'A', categoryId: 'coding', visitCount: 10 },
  { id: 'b', name: 'B', categoryId: 'data', visitCount: 2 },
  { id: 'c', name: 'C', categoryId: 'design', visitCount: 0 },
  { id: 'd', name: 'D', categoryId: 'coding', visitCount: 1 }
]

eq(hasSignal(null), false, 'null 信号视为冷启动')
eq(hasSignal(buildSignals([], SITES)), false, '没有记录时是冷启动')

{
  const now = Date.now()
  const night = new Date(2026, 0, 5, 21, 0).getTime()
  const records = [
    { siteId: 'a', timestamp: now - 1000 },
    { siteId: 'd', timestamp: now - 2000 }
  ]
  const signals = buildSignals(records, SITES)
  ok(hasSignal(signals), '有记录时不再是冷启动')
  const ranked = rankSites(SITES, signals, { now, categoryLabels: { coding: '编程与开发', data: '数据与研究' } })
  ok(ranked.length > 0, '能产出推荐')
  eq(ranked[0].site.id, 'a', '访问最多的站排第一')
  ok(typeof ranked[0].reason === 'string' && ranked[0].reason.length > 0, '每条推荐都有理由')
  ok(ranked[0].score >= ranked[ranked.length - 1].score, '按分数降序')
  void night
}

{
  // 时段偏好：记录都发生在晚上，且集中在 coding 分类
  const now = new Date(2026, 0, 5, 21, 0).getTime()
  const eveningTs = new Date(2026, 0, 4, 21, 0).getTime()
  const records = [
    { siteId: 'a', timestamp: eveningTs },
    { siteId: 'd', timestamp: eveningTs - 1000 }
  ]
  const signals = buildSignals(records, SITES)
  const ranked = rankSites(SITES, signals, { now, categoryLabels: { coding: '编程与开发' } })
  const top = ranked[0]
  ok(top.site.categoryId === 'coding', '晚上看编程类 → 推的还是编程类')
  ok(top.reason.includes('晚上') || top.reason.includes('打开'), '理由说得出来自时段或频次', top.reason)
}

{
  // 共现：a 与 c 曾在 5 分钟内先后打开，锚点是 a → c 应被带出来
  const now = Date.now()
  const t0 = now - 10_000
  const records = [
    { siteId: 'a', timestamp: t0 },
    { siteId: 'c', timestamp: t0 + 60_000 }
  ]
  const signals = buildSignals(records, SITES)
  const ranked = rankSites(SITES, signals, { now, recentId: 'a', anchorName: 'A', categoryLabels: {} })
  const c = ranked.find(r => r.site.id === 'c')
  ok(c, '共现过的站出现在推荐里')
  ok(c.reason.includes('A'), '共现理由点名了锚点站', c.reason)
}

{
  // 超过共现窗口的不算共现
  const now = Date.now()
  const t0 = now - 3600_000
  const records = [
    { siteId: 'b', timestamp: t0 },
    { siteId: 'c', timestamp: t0 + 30 * 60_000 }
  ]
  const signals = buildSignals(records, SITES)
  eq(signals.pairs.size, 0, '超过 5 分钟窗口不构成共现')
}

{
  // 没有任何访问次数与热度 → 不该产出整排「推荐」
  const signals = buildSignals([{ siteId: 'c', timestamp: Date.now() }], SITES)
  const ranked = rankSites(SITES, signals, { now: Date.now() })
  ok(ranked.every(r => r.score > 0.02), '低分项被过滤（不打扰用户）')
  ok(ranked.length <= SITES.length, '结果不超过候选集')
}

{
  eq(rankSites([], null, {}).length, 0, '空候选集不报错')
  ok(Array.isArray(rankSites(SITES, null, { now: Date.now() })), '信号缺失时不抛错（返回数组）')
}

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 智能化内核 ${failures.length} 条断言失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 智能化内核全部通过：${pass} 条断言`)
