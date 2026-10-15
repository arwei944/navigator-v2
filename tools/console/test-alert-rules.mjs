/**
 * 告警规则引擎守卫：纯函数，不联网。
 *
 * 守的核心：
 *  1. 匹配优先级 host > categoryId > fallback（越具体越优先，写反了会让特例形同虚设）；
 *  2. 非法规则被**丢弃**而不是保留成「匹配所有站点」的空 match；
 *  3. 阈值与 fails 的比较边界（达到即告警）。
 *
 * 运行：node tools/console/test-alert-rules.mjs
 */
import { normalizeRule, normalizeRules, ruleFor, evaluateAlerts, DEFAULT_FALLBACK } from '../../shared/alert-rules.mjs'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

/* ---- normalizeRule ---- */

eq(normalizeRule(null), null, 'null 规则丢弃')
eq(normalizeRule({ downThreshold: 3 }), null, '没有 match 条件的规则丢弃（否则会匹配所有站点）')
eq(normalizeRule({ match: {} }), null, '空 match 丢弃')
eq(normalizeRule({ match: { host: 'https://www.Ex.com/x' } }).match.host, 'ex.com', 'host 归一（去 www/协议/路径/大小写）')
eq(normalizeRule({ match: { categoryId: 'cex' }, downThreshold: 0 }).downThreshold, DEFAULT_FALLBACK.downThreshold, '阈值 0 非法 → 兜底')
eq(normalizeRule({ match: { categoryId: 'cex' }, downThreshold: '2' }).downThreshold, 2, '字符串数字可接受')
eq(normalizeRule({ match: { categoryId: 'cex' }, enabled: false }).enabled, false, 'enabled=false 保留')

/* ---- normalizeRules ---- */

const cfg = normalizeRules({
  rules: [
    { id: 'a', match: { host: 'binance.com' }, downThreshold: 1 },
    { id: 'b', match: { categoryId: 'cex' }, downThreshold: 2 },
    { id: 'bad' },
  ],
  fallback: { downThreshold: 5 },
})
eq(cfg.rules.length, 2, '非法规则被丢弃')
eq(cfg.fallback.downThreshold, 5, 'fallback 归一')
eq(normalizeRules(null).fallback.downThreshold, DEFAULT_FALLBACK.downThreshold, '空配置用默认兜底')
eq(normalizeRules([{ match: { categoryId: 'x' } }]).rules.length, 1, '裸数组也可接受')

/* ---- ruleFor：优先级 ---- */

const site = { id: 's1', url: 'binance.com', categoryId: 'cex' }
eq(ruleFor(site, cfg).id, 'a', 'host 精确优先于分类')
eq(ruleFor({ id: 's2', url: 'okx.com', categoryId: 'cex' }, cfg).id, 'b', '无 host 规则时用分类规则')
eq(ruleFor({ id: 's3', url: 'other.com', categoryId: 'misc' }, cfg).id, 'fallback', '都不匹配用兜底')
eq(ruleFor({ id: 's4', url: 'binance.com', categoryId: 'misc' }, cfg).downThreshold, 1, 'host 规则带来它自己的阈值')

// 停用的规则不参与匹配
const cfg2 = normalizeRules({ rules: [{ id: 'x', enabled: false, match: { host: 'a.com' }, downThreshold: 1 }], fallback: { downThreshold: 9 } })
eq(ruleFor({ url: 'a.com' }, cfg2).id, 'fallback', '停用的规则跳过')

/* ---- evaluateAlerts ---- */

const sites = [
  { id: 's1', name: 'Binance', url: 'binance.com', categoryId: 'cex' },
  { id: 's2', name: 'OKX', url: 'okx.com', categoryId: 'cex' },
  { id: 's3', name: 'Other', url: 'other.com', categoryId: 'misc' },
]
const results = {
  s1: { status: 'down', fails: 1 },   // binance 阈值 1 → 告警
  s2: { status: 'down', fails: 1 },   // cex 阈值 2 → 不告警
  s3: { status: 'down', fails: 5 },   // 兜底阈值 5 → 告警
  s4: { status: 'ok', fails: 0 },     // 非 down → 忽略
}
const alerts = evaluateAlerts({ results, sites, config: cfg })
eq(alerts.length, 2, '恰好两条达阈值')
eq(alerts.map(a => a.id).sort().join(','), 's1,s3', '命中的是与各自阈值比较后的结果')
eq(alerts.find(a => a.id === 's1').threshold, 1, 'Binance 用了 host 规则的阈值')
eq(alerts.find(a => a.id === 's3').threshold, 5, 'Other 用了兜底阈值')

// 边界：正好等于阈值 → 告警
eq(evaluateAlerts({ results: { s2: { status: 'down', fails: 2 } }, sites, config: cfg }).length, 1, 'fails 正好等于阈值 → 告警')
eq(evaluateAlerts({ results: {}, sites, config: cfg }).length, 0, '空判定 → 无告警')
eq(evaluateAlerts({ results, sites: [], config: cfg }).length, 1, '站点表缺失时退化为只用兜底阈值（只剩 s3 达标）')

/* ---- 结果 ---- */

if (failures.length) {
  console.error(`\n❌ 告警规则引擎 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 告警规则引擎：${pass} 条断言`)
process.exit(0)
