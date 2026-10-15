/**
 * 网站关联度用例：零依赖、不联网。
 *
 * 守的核心不是某个分数，而是三件事：
 *  1. 每一条边都要**说得出理由**（reasons 非空、可读）—— 这是选规则而不是选黑箱的前提；
 *  2. 评分因子各自独立生效（同分类 / 同用途 / 同概念 / 同域族 / 名称互含）；
 *  3. 建图之后**边是对称的**：A 的邻居里有 B，B 的邻居里就必须有 A，
 *     否则图上会出现「单向往回连」的怪相。
 *
 * 运行：node tools/console/test-affinity.mjs
 */
import {
  registrableDomain, conceptsOf, affinityBetween, buildAffinityGraph,
  neighborsOf, relatedTo, WEIGHTS, DEFAULT_THRESHOLD,
} from '../../shared/affinity.mjs'

let pass = 0
const failures = []
function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

const S = (over) => ({
  id: 'x', name: 'X', url: 'x.com', desc: '', categoryId: '', purposes: [], aliases: [], ...over,
})

/* ---------------- registrableDomain ---------------- */

eq(registrableDomain('https://www.github.com/a/b'), 'github.com', '去协议去路径去 www')
eq(registrableDomain('docs.google.com'), 'google.com', '子域归到注册域')
eq(registrableDomain('foo.co.uk'), 'foo.co.uk', '两段式后缀多留一段')
eq(registrableDomain('example.com'), 'example.com', '裸域名原样')
eq(registrableDomain(''), '', '空值返回空串')

/* ---------------- conceptsOf ---------------- */

const c1 = conceptsOf(S({ desc: 'OpenAI 对话助手，AI 入门首选，支持编程与翻译。' }))
ok(c1.includes('AI'), '中文描述命中 AI', c1.join('/'))
ok(c1.includes('对话'), '中文描述命中「对话」')
ok(c1.includes('编程'), '中文描述命中「编程」')

const c2 = conceptsOf(S({ desc: 'A decentralized exchange for DeFi, swap tokens on-chain.' }))
ok(c2.includes('DeFi'), '英文描述命中 DeFi')
ok(c2.includes('交易所') === false, '没写中文就不该凭空命中中文概念', c2.join('/'))

// 词边界：AI 不能命中 said
const c3 = conceptsOf(S({ desc: 'He said the painting is detailed.' }))
ok(!c3.includes('AI'), 'AI 不命中 said（英文按词边界匹配）', c3.join('/'))

const c4 = conceptsOf(S({ name: 'ChatGPT', aliases: ['GPT 助手'], desc: '对话模型' }))
ok(c4.includes('GPT'), '别名/名称也参与概念提取', c4.join('/'))

/* ---------------- affinityBetween ---------------- */

const A = S({ id: 'a', name: 'Alpha', url: 'alpha.com', desc: 'AI 对话助手', categoryId: 'aichat', purposes: ['ai-chat', 'tool'] })
const B = S({ id: 'b', name: 'Beta', url: 'beta.com', desc: 'AI 对话与编程', categoryId: 'aichat', purposes: ['ai-chat', 'coding'] })

const ab = affinityBetween(A, B, { categoryLabels: { aichat: 'AI 对话' } })
ok(ab.score >= WEIGHTS.sameCategory, '同分类至少拿到同分类分', String(ab.score))
ok(ab.reasons.some(r => r.includes('AI 对话')), '理由里写明了分类', ab.reasons.join(' | '))
ok(ab.reasons.some(r => r.includes('AI')), '理由里写明了共同概念', ab.reasons.join(' | '))
eq(ab.score, Math.min(ab.score, WEIGHTS.cap), '分数不超过上限')

eq(affinityBetween(A, A).score, 0, '和自己不算关联')
eq(affinityBetween(null, B).score, 0, '空对象不炸')
ok(affinityBetween(A, B).reasons.length > 0, '有分就有理由（规则必须可解释）')

// 完全无关的两站：不该连边
const X = S({ id: 'x', name: 'X', url: 'x.com', desc: '天气预报', categoryId: 'weather', purposes: ['data'] })
const Y = S({ id: 'y', name: 'Y', url: 'y.com', desc: '在线钢琴', categoryId: 'music', purposes: ['video'] })
ok(affinityBetween(X, Y).score < DEFAULT_THRESHOLD, '毫无交集的两站低于阈值', String(affinityBetween(X, Y).score))
eq(affinityBetween(X, Y).reasons.length, 0, '毫无交集时不给理由')

// 同域族
const D1 = S({ id: 'd1', name: 'Docs', url: 'docs.google.com', desc: '' })
const D2 = S({ id: 'd2', name: 'Drive', url: 'drive.google.com', desc: '' })
ok(affinityBetween(D1, D2).reasons.some(r => r.includes('站点家族')), '同一注册域会被认出来')

// 名称互含
const N1 = S({ id: 'n1', name: 'ChatGPT', url: 'n1.com', desc: '' })
const N2 = S({ id: 'n2', name: 'GPT', url: 'n2.com', desc: '', aliases: ['ChatGPT'] })
ok(affinityBetween(N1, N2).reasons.some(r => r.includes('名称')), '名称/别名互相包含会被认出来')

/* ---------------- buildAffinityGraph ---------------- */

const sites = [
  S({ id: 's1', name: 'AI 甲', url: 'a1.com', desc: 'AI 对话助手', categoryId: 'aichat', purposes: ['ai-chat'] }),
  S({ id: 's2', name: 'AI 乙', url: 'a2.com', desc: 'AI 对话模型', categoryId: 'aichat', purposes: ['ai-chat'] }),
  S({ id: 's3', name: 'AI 丙', url: 'a3.com', desc: 'AI 绘画工具', categoryId: 'aichat', purposes: ['design'] }),
  S({ id: 's4', name: '天气', url: 'w.com', desc: '天气预报', categoryId: 'weather', purposes: ['data'] }),
]
const g = buildAffinityGraph(sites, { categoryLabels: { aichat: 'AI 对话' } })

ok(g.edges.length > 0, '同类站点之间连上了边', `${g.edges.length} 条`)
ok(!g.edges.some(e => e.source === 's4' || e.target === 's4'), '孤立的站不产生边')
ok(g.edges.every(e => e.reasons.length > 0), '每条边都带理由')

// 对称性：图的基本不变式
for (const e of g.edges) {
  const fwd = g.byId.get(e.source)?.some(x => x.id === e.target)
  const back = g.byId.get(e.target)?.some(x => x.id === e.source)
  ok(fwd && back, `边 ${e.source}↔${e.target} 双向都在邻接表里`, `fwd=${fwd} back=${back}`)
}
// 邻接表里不能出现已经被剪掉的边
for (const [id, arr] of g.byId) {
  for (const n of arr) {
    ok(g.edges.some(e => (e.source === id && e.target === n.id) || (e.target === id && e.source === n.id)),
      `邻接表里的 ${id}→${n.id} 确实是一条保留的边`)
  }
}

// topK 限制每个站的度
const many = Array.from({ length: 12 }, (_, i) =>
  S({ id: 'm' + i, name: 'AI' + i, url: `m${i}.com`, desc: 'AI 对话助手模型', categoryId: 'aichat', purposes: ['ai-chat'] }))
const g2 = buildAffinityGraph(many, { topK: 3 })
ok([...g2.byId.values()].every(arr => arr.length <= 3), '每站最多保留 topK 条连接',
  [...g2.byId.values()].map(a => a.length).join(','))

// 阈值：调高则该连的边也不连
const gHigh = buildAffinityGraph(sites, { threshold: 999 })
eq(gHigh.edges.length, 0, '阈值高到 999 时没有边')

/* ---------------- neighborsOf ---------------- */

const nb = neighborsOf('s1', g)
ok(nb.length > 0, 's1 有邻居')
ok(nb.every(n => n.score > 0 && Array.isArray(n.reasons)), '邻居带分数与理由')
eq(neighborsOf('s4', g).length, 0, '孤立站没有邻居')
eq(neighborsOf('不存在', g).length, 0, '不存在的 id 返回空数组')

/* ---------------- 性能：建图必须够快（打开图谱页不能等） ---------------- */

{
  const many = Array.from({ length: 300 }, (_, i) => S({
    id: 'p' + i,
    name: 'Site' + i,
    url: `s${i}.com`,
    desc: i % 3 === 0 ? 'AI 对话与编程助手，支持模型调用' : i % 3 === 1 ? 'DeFi 交易与行情，链上数据' : '设计素材与图像工具',
    categoryId: i % 3 === 0 ? 'aichat' : i % 3 === 1 ? 'defi' : 'design',
    purposes: i % 3 === 0 ? ['ai-chat'] : i % 3 === 1 ? ['trading'] : ['design'],
  }))
  const t0 = Date.now()
  const big = buildAffinityGraph(many)
  const ms = Date.now() - t0
  // 特征包若退回内层循环重复构造，这里会立刻涨到 1.4s 量级（实测过）
  ok(ms < 600, '300 站建图在 600ms 内', `${ms}ms`)
  ok(big.edges.length > 0, '大图确实连出了边', `${big.edges.length} 条`)
}

/* ---------------- relatedTo（站点详情里的「相关站点」） ---------------- */

{
  const me = S({ id: 'me', name: 'Binance', url: 'binance.com', categoryId: 'cex', purposes: ['trading', 'data'], desc: '交易所 交易 行情' })
  const sib = S({ id: 'sib', name: 'OKX', categoryId: 'cex', purposes: ['trading'], desc: '交易所 交易 行情' })
  const far = S({ id: 'far', name: 'Figma', categoryId: 'design', purposes: ['design'], desc: '设计 原型' })
  const sameFam = S({ id: 'fam', name: 'Binance Academy', url: 'academy.binance.com', categoryId: 'edu', purposes: [], desc: '学习' })

  const r = relatedTo(me, [me, sib, far, sameFam])
  ok(r.length >= 2, 'relatedTo 返回相关站点', `${r.length} 个`)
  eq(r[0].id, 'sib', '最相关的是同类同用途的那一个')
  ok(r.every(x => x.id !== 'me'), '不把自己算进相关站点')
  ok(r.every(x => Array.isArray(x.reasons) && x.reasons.length > 0), '每个相关站点都说得出理由')
  ok(r.every(x => x.score >= DEFAULT_THRESHOLD), '低于阈值的被滤掉')
  ok(r.some(x => x.id === 'fam'), '同一注册域家族也算相关（Binance ↔ Binance Academy）')

  // 阈值可调：把线拉到最高，只剩最强的那些
  const strict = relatedTo(me, [me, sib, far, sameFam], { threshold: WEIGHTS.cap })
  ok(strict.every(x => x.score >= WEIGHTS.cap), '提高阈值后只留高分', `${strict.length} 个`)

  // topN 截断
  const many = Array.from({ length: 12 }, (_, i) => S({ id: 'n' + i, name: 'N' + i, categoryId: 'cex', purposes: ['trading'], desc: '交易所 交易 行情' }))
  eq(relatedTo(me, [me, ...many], { topN: 5 }).length, 5, 'topN 生效（最多 5 个）')

  // 边界：空输入、无 id
  eq(relatedTo(null, [sib]).length, 0, 'me 为空返回空数组')
  eq(relatedTo(me, []).length, 0, '站点列表为空返回空数组')
  eq(relatedTo(me, [me]).length, 0, '只有自己时返回空数组')

  // 确定性：同样输入两次结果一致（详情页每次重算不该跳来跳去）
  const a1 = relatedTo(me, [me, sib, far, sameFam]).map(x => x.id).join(',')
  const a2 = relatedTo(me, [me, sib, far, sameFam]).map(x => x.id).join(',')
  eq(a2, a1, 'relatedTo 结果稳定可复现')

  // 性能：300 站点查一次应当远快于整图构建
  const big = Array.from({ length: 300 }, (_, i) => S({
    id: 'b' + i, name: 'B' + i, categoryId: 'c' + (i % 12), purposes: ['trading'], desc: '交易所 交易 行情 数据',
  }))
  const t0 = Date.now()
  relatedTo(big[0], big, { topN: 5 })
  const ms = Date.now() - t0
  ok(ms < 120, '300 站单点查询在 120ms 内', `${ms}ms`)
}

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 关联度 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.slice(0, 12).forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 关联度全部通过：${pass} 条断言`)
