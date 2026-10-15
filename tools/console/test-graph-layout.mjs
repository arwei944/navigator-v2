/**
 * 关系图布局用例：零依赖、不跑浏览器。
 *
 * 守三件事：
 *  1. **确定性** —— 同一份数据两次布局必须完全一致（否则每次打开图都在跳，
 *     用户会以为数据变了）；
 *  2. **边界** —— 所有节点必须落在画布内，且同类节点聚在一起（分类锚点起了作用）；
 *  3. **健壮** —— 空输入、重复边、指向不存在节点的边，都不能把布局算炸。
 *
 * 运行：node tools/console/test-graph-layout.mjs
 */
import { layoutGraph, categoryAnchors, mulberry32 } from '../../src/utils/graphLayout.js'

let pass = 0
const failures = []
function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

/* ---------------- mulberry32 ---------------- */

{
  const a = mulberry32(42)
  const b = mulberry32(42)
  const seqA = [a(), a(), a(), a()]
  const seqB = [b(), b(), b(), b()]
  eq(JSON.stringify(seqA), JSON.stringify(seqB), '同种子产生同一串随机数')
  ok(seqA.every(v => v >= 0 && v < 1), '随机数落在 [0,1)')
  const c = mulberry32(43)
  ok(c() !== seqA[0], '不同种子结果不同')
}

/* ---------------- categoryAnchors ---------------- */

{
  const m = categoryAnchors(['a', 'b', 'c', 'd'], { width: 1000, height: 600 })
  eq(m.size, 4, '四个分类四个锚点')
  const pts = [...m.values()]
  ok(pts.every(p => p.x >= 0 && p.x <= 1000 && p.y >= 0 && p.y <= 600), '锚点都在画布内')
  ok(new Set(pts.map(p => `${Math.round(p.x)},${Math.round(p.y)}`)).size === 4, '锚点互不重合')

  const single = categoryAnchors(['only'], { width: 1000, height: 600 })
  eq(single.size, 1, '单分类只有一个锚点')
  eq(single.get('only').x, 500, '单分类锚点在水平中心')
  eq(single.get('only').y, 300, '单分类锚点在垂直中心')

  eq(categoryAnchors([], { width: 800, height: 600 }).size, 0, '空分类返回空表')
  eq(categoryAnchors(['a', 'a', 'b'], { width: 800, height: 600 }).size, 2, '重复分类只算一次')
}

/* ---------------- layoutGraph ---------------- */

const W = 1000
const H = 700
const nodes = [
  { id: 'a1', categoryId: 'ai', name: 'AI 甲' },
  { id: 'a2', categoryId: 'ai', name: 'AI 乙' },
  { id: 'a3', categoryId: 'ai', name: 'AI 丙' },
  { id: 'c1', categoryId: 'coin', name: '币 甲' },
  { id: 'c2', categoryId: 'coin', name: '币 乙' },
  { id: 'x1', categoryId: 'other', name: '孤 一' },
]
const edges = [
  { source: 'a1', target: 'a2', score: 80 },
  { source: 'a2', target: 'a3', score: 70 },
  { source: 'c1', target: 'c2', score: 90 },
]

{
  const g1 = layoutGraph(nodes, edges, { width: W, height: H })
  const g2 = layoutGraph(nodes, edges, { width: W, height: H })

  eq(g1.positions.size, 6, '六个节点都有坐标')
  ok([...g1.positions.values()].every(p => p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H),
    '所有节点落在画布内')

  // 确定性：这是最重要的一条
  let same = true
  for (const [id, p] of g1.positions) {
    const q = g2.positions.get(id)
    if (!q || q.x !== p.x || q.y !== p.y) { same = false; break }
  }
  ok(same, '同输入两次布局结果完全一致（图不会每次打开都跳）')

  // 分类锚点生效：同类节点应比异类更近
  const d = (p, q) => Math.hypot(p.x - q.x, p.y - q.y)
  const sameCat = d(g1.positions.get('a1'), g1.positions.get('a2'))
  const crossCat = d(g1.positions.get('a1'), g1.positions.get('c1'))
  ok(sameCat < crossCat, '同类节点比异类节点更近', `${sameCat.toFixed(0)} < ${crossCat.toFixed(0)}`)
}

/* ---------------- 健壮性 ---------------- */

{
  const empty = layoutGraph([], [], { width: W, height: H })
  eq(empty.positions.size, 0, '空节点返回空表')
  eq(empty.iterations, 0, '空节点不迭代')
  ok(empty.bounds.maxX === W, '空节点也给出画布边界')

  const nulls = layoutGraph([null, { id: 'ok', categoryId: '' }, undefined], [], { width: W, height: H })
  eq(nulls.positions.size, 1, 'null/undefined 节点被跳过')

  // 指向不存在节点的边：忽略而不是崩
  const ghost = layoutGraph(nodes, [{ source: 'a1', target: '不存在' }, { source: 'a2', target: 'a3' }],
    { width: W, height: H })
  eq(ghost.positions.size, 6, '悬空边被忽略，节点照常布局')

  // 两个节点坐标完全重合时的退化情形：初始抖动相同也不会算出 NaN
  const dup = layoutGraph(
    [{ id: 'p', categoryId: 'same' }, { id: 'q', categoryId: 'same' }],
    [{ source: 'p', target: 'q' }], { width: 400, height: 400 })
  const pts = [...dup.positions.values()]
  ok(pts.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)), '重合节点不产生 NaN',
    JSON.stringify(pts))

  // 无边的图也要能布局（全是孤立点）
  const solo = layoutGraph(nodes, [], { width: W, height: H })
  eq(solo.positions.size, 6, '没有边也能布局')
}

/* ---------------- 性能 ---------------- */

{
  const big = Array.from({ length: 300 }, (_, i) => ({
    id: 'n' + i,
    categoryId: 'c' + (i % 12),
  }))
  const bigEdges = Array.from({ length: 580 }, (_, i) => ({
    source: 'n' + (i % 300),
    target: 'n' + ((i * 7 + 13) % 300),
  }))
  const t0 = Date.now()
  const g = layoutGraph(big, bigEdges, { width: 1200, height: 800 })
  const ms = Date.now() - t0
  eq(g.positions.size, 300, '300 个节点全部有坐标')
  ok(ms < 900, '300 节点布局在 900ms 内', `${ms}ms`)
}

/* ---------------- 铺开度（防「空心方框」回归） ----------------
 *
 * 真机上出过一次很难看的事故：整张图变成**空心方框** —— 节点沿画布四边排成线、
 * 中心全空（斥力系数与锚点力系数差了两个量级，图一路膨胀到撞墙被夹紧）。
 * 上面那些断言一条都没拦住它：确定性没问题、夹紧也「正确」、性能还挺快。
 *
 * 所以这里按**铺开度**立三条线。用合成的 12 分类 × 300 站（类内成链），
 * 数值取自实测：贴边 14% / 网格 67% / 中心区 73%，阈值都留了余量，
 * 但足以把「空心方框」（贴边 97% / 网格 35% / 中心区 2%）拦下来。
 */
{
  const W = 1400, H = 900, PAD = 64, CATS = 12
  const nodes = Array.from({ length: 300 }, (_, i) => ({ id: `s${i}`, categoryId: `c${i % CATS}` }))
  const links = []
  for (let c = 0; c < CATS; c++) {
    const list = nodes.filter(n => n.categoryId === `c${c}`)
    for (let i = 0; i + 1 < list.length; i++) links.push({ source: list[i].id, target: list[i + 1].id, score: 50 })
  }
  const { positions } = layoutGraph(nodes, links, { width: W, height: H })
  const pts = [...positions.values()]
  const n = pts.length

  let pinned = 0
  for (const p of pts) {
    if (p.x <= PAD + 0.5 || p.x >= W - PAD - 0.5 || p.y <= PAD + 0.5 || p.y >= H - PAD - 0.5) pinned++
  }
  const pinnedRate = (pinned / n) * 100
  ok(pinnedRate <= 30, '贴边率 ≤ 30%（不是沿墙排线的方框）', `${pinnedRate.toFixed(1)}%`)

  const GX = 14, GY = 9
  const cell = new Set()
  for (const p of pts) {
    cell.add(`${Math.min(GX - 1, Math.max(0, Math.floor((p.x / W) * GX)))},${Math.min(GY - 1, Math.max(0, Math.floor((p.y / H) * GY)))}`)
  }
  const gridRate = (cell.size / (GX * GY)) * 100
  ok(gridRate >= 55, '网格占用 ≥ 55%（铺得开）', `${cell.size}/${GX * GY} = ${gridRate.toFixed(0)}%`)

  let inner = 0, innerTotal = 0
  for (let x = 2; x < GX - 2; x++) {
    for (let y = 1; y < GY - 1; y++) {
      innerTotal++
      if (cell.has(`${x},${y}`)) inner++
    }
  }
  const innerRate = (inner / innerTotal) * 100
  ok(innerRate >= 45, '中心区占用 ≥ 45%（中心不是空的）', `${innerRate.toFixed(0)}%`)
}

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 图布局 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 图布局全部通过：${pass} 条断言`)
