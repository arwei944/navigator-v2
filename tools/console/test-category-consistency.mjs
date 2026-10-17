/**
 * 归类一致性体检用例（F5①）：零依赖、不联网。
 *
 * 守的核心：
 *  1. **口径正确** —— 未分类的站点不进分母；规则无信号（score<=0）的站点也不进分母，
 *     否则「规则没意见」会稀释「规则判错了」，准确率看起来比实际低；
 *  2. **不自我循环** —— 比对时必须排除站点自己，否则「同域信号命中自己」会让
 *     每个站都恒等，准确率假性 100%；
 *  3. 偏差清单带出现值 → 推荐值与高频偏差聚合，供面板解释。
 *
 * 运行：node tools/console/test-category-consistency.mjs
 */
import { auditCategoryConsistency } from '../../shared/site-infer.mjs'

let pass = 0
const failures = []
function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

const meta = { cex: { id: 'cex' }, coding: { id: 'coding' }, ai: { id: 'ai' } }

const sites = [
  // 规则会推 cex，现值也是 cex → 一致
  { id: 'a', name: 'OKX 交易所', url: 'okx.com', desc: '数字货币交易平台，支持现货与合约', categoryId: 'cex' },
  // 规则会推 coding（品牌词 github），现值却是 cex → 不一致
  { id: 'b', name: 'GitHub', url: 'github.com', desc: '代码托管与协作开发平台', categoryId: 'cex' },
  // 未分类 → 不进分母
  { id: 'c', name: '某个站', url: 'some.com', desc: '一句正常的站点描述文本', categoryId: '' },
  // 规则对它没有任何信号 → 也不进分母
  { id: 'd', name: 'zzz', url: 'zzz.com', desc: 'zzz zzz zzz zzz zzz', categoryId: 'cex' },
]

const r = auditCategoryConsistency(sites, { categoryMeta: meta })
eq(r.scored, 2, '只有「有分类且规则能出手」的站点进分母')
eq(r.consistent, 1, '其中 1 条与现值一致')
eq(Math.round(r.rate * 100), 50, '准确率 = 一致 / 规则出手数')
eq(r.mismatches.length, 1, '偏差清单只含 1 条')
eq(r.mismatches[0].id, 'b', '偏差指向 GitHub')
eq(r.mismatches[0].current, 'cex', '偏差带出现值')
eq(r.mismatches[0].recommended, 'coding', '偏差带出推荐值')
eq(r.topPatterns[0].pair, 'cex → coding', '高频偏差按「现值 → 推荐」聚合')
eq(r.topPatterns[0].count, 1, '高频偏差计数正确')

/* ---------------- 不自我循环 ---------------- */

// 同域两条：若比对时不排除自己，startsWith(brand) 的「同域信号」会让每条都命中自己
const sameHost = [
  { id: 'x1', name: 'Foo', url: 'foo.com', desc: '一个编程与部署工具平台', categoryId: 'coding' },
  { id: 'x2', name: 'Foo Docs', url: 'foo.com/docs', desc: '一个编程与部署工具平台', categoryId: 'cex' },
]
const r2 = auditCategoryConsistency(sameHost, { categoryMeta: meta })
ok(r2.mismatches.some(m => m.id === 'x2'), '同域第二条被正确判为偏差（未被自己的同域信号掩盖）')

/* ---------------- 边界 ---------------- */

eq(auditCategoryConsistency([]).scored, 0, '空数组：分母为 0')
eq(auditCategoryConsistency([]).rate, 1, '空数组：rate 兜底为 1 而非 NaN')
eq(auditCategoryConsistency(null).scored, 0, 'null 不抛')
eq(auditCategoryConsistency([null, 1, 'x']).scored, 0, '过滤非对象条目')
eq(auditCategoryConsistency(sites).scored >= 0, true, '缺 categoryMeta 也不抛')

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.log(`✖ ${failures.length} 条失败：`)
  for (const f of failures) console.log('  - ' + f)
  console.log(`\n通过 ${pass}，失败 ${failures.length}`)
  process.exit(1)
}
console.log(`✓ 归类一致性体检：${pass} 条通过`)
