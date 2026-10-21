/**
 * 阶段 3 门禁：实体共现边、图谱裁剪、确定性布局。
 */
import assert from 'node:assert/strict'
import {
  buildEntityEdges, entityGraph, graphLayout, graphSummary,
} from '../../shared/content-graph.mjs'

let pass = 0
let fail = 0
function ok(name, fn) {
  try { fn(); pass += 1; console.log(`  ✓ ${name}`) }
  catch (e) { fail += 1; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0)
const HOUR = 3600000

function mention(entityId, entryId, sourceId, at = NOW) {
  return { entityId, entryId, sourceId, at }
}

console.log('领域动态 · 阶段 3 图谱')

ok('共现边：同一条目内两两组合，来源去重', () => {
  const entries = ['e1', 'e2', 'e3']
  const mentions = []
  for (const [i, id] of entries.entries()) {
    mentions.push(mention('openai', id, `s${i % 2}`))
    mentions.push(mention('microsoft', id, `s${i % 2}`))
  }
  const edges = buildEntityEdges({ mentions, minCo: 2 })
  assert.equal(edges.length, 1)
  assert.equal(edges[0].a, 'microsoft')
  assert.equal(edges[0].b, 'openai')
  assert.equal(edges[0].co, 3)
  assert.equal(edges[0].sources, 2)
  assert.ok(edges[0].weight > 3)
})

ok('共现边：minCo 过滤稀疏关系', () => {
  const mentions = [
    mention('a', 'e1', 's1'),
    mention('b', 'e1', 's1'),
    mention('a', 'e2', 's1'),
    mention('c', 'e2', 's1'),
  ]
  // 两条边各只共现 1 次：minCo=2 时都被过滤
  assert.equal(buildEntityEdges({ mentions, minCo: 2 }).length, 0)
  assert.equal(buildEntityEdges({ mentions, minCo: 1 }).length, 2)
})

ok('共现边：同条目重复实体只计一次', () => {
  const mentions = [
    mention('a', 'e1', 's1', NOW),
    mention('a', 'e1', 's1', NOW + HOUR),
    mention('b', 'e1', 's1', NOW),
  ]
  const edges = buildEntityEdges({ mentions, minCo: 1 })
  assert.equal(edges.length, 1)
  assert.equal(edges[0].co, 1)
})

ok('图谱：按提及量裁剪节点，边只在节点集内', () => {
  const mentions = []
  for (let i = 0; i < 30; i += 1) {
    mentions.push(mention(`n${i}`, `e${i}`, 's1'))
    mentions.push(mention('hub', `e${i}`, 's1'))
  }
  const graph = entityGraph({ mentions, maxNodes: 10, minCo: 1 })
  assert.equal(graph.nodes.length, 10)
  assert.equal(graph.nodes[0].id, 'hub')
  for (const edge of graph.edges) {
    assert.ok(graph.nodes.some(n => n.id === edge.a))
    assert.ok(graph.nodes.some(n => n.id === edge.b))
  }
})

ok('布局：确定性、在边界内、半径随提及量增大', () => {
  const graph = entityGraph({
    mentions: [
      mention('a', 'e1', 's1'), mention('b', 'e1', 's1'),
      mention('a', 'e2', 's1'), mention('b', 'e2', 's1'),
      mention('a', 'e3', 's1'), mention('c', 'e3', 's1'),
    ],
    maxNodes: 10,
    minCo: 1,
  })
  const one = graphLayout(graph.nodes, graph.edges, { width: 400, height: 300, iterations: 40 })
  const two = graphLayout(graph.nodes, graph.edges, { width: 400, height: 300, iterations: 40 })
  assert.deepEqual(one.map(n => [n.id, n.x, n.y]), two.map(n => [n.id, n.x, n.y]))
  for (const node of one) {
    assert.ok(node.x >= 34 && node.x <= 366)
    assert.ok(node.y >= 34 && node.y <= 266)
  }
  const a = one.find(n => n.id === 'a')
  const c = one.find(n => n.id === 'c')
  assert.ok(a.r > c.r, 'a 提及更多，半径应更大')
})

ok('图谱摘要：孤立节点计数', () => {
  const summary = graphSummary({
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    edges: [{ a: 'a', b: 'b', co: 2, weight: 3 }],
  })
  assert.equal(summary.nodes, 3)
  assert.equal(summary.edges, 1)
  assert.equal(summary.isolated, 1)
})

console.log(`\n${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)