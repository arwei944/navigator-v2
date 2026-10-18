/**
 * 关联图谱：文档 ↔ 项目 ↔ 文档。
 *
 * 回答：「这份文档属于哪个项目？它引用了谁、又被谁引用？哪些文档是悬空的？」
 *
 * 节点 = 文档；边 = 文档间的相对链接（只保留**指向库内文档**的边）。
 */

import { KNOWLEDGE_KINDS } from './util.mjs'

/**
 * @param {{docs:object[]}} scanResult
 */
export function buildGraph(scanResult) {
  const { docs } = scanResult
  const docSet = new Set(docs.map(d => d.path))

  const edges = []
  const incoming = new Map()
  const outgoing = new Map()
  for (const d of docs) {
    const outDoc = d.links.filter(l => docSet.has(l) && l !== d.path)
    outgoing.set(d.path, outDoc)
    for (const l of outDoc) {
      edges.push({ from: d.path, to: l })
      incoming.set(l, (incoming.get(l) || 0) + 1)
    }
  }

  const nodes = docs.map(d => ({
    id: d.path,
    title: d.title || '(无标题)',
    kind: d.kind,
    status: d.status,
    inDegree: incoming.get(d.path) || 0,
    outDegree: (outgoing.get(d.path) || []).length,
  }))

  const orphans = docs
    .filter(d => KNOWLEDGE_KINDS.has(d.kind))
    .filter(d => !incoming.has(d.path) && (outgoing.get(d.path) || []).length === 0)
    .map(d => d.path)

  /* 按项目归属：projects/<id>/ 下的文档 */
  const projMap = new Map()
  for (const d of docs) {
    const m = /^projects\/([^/]+)\//.exec(d.path)
    if (!m) continue
    const id = m[1]
    if (!projMap.has(id)) projMap.set(id, [])
    projMap.get(id).push(d.path)
  }
  const byProject = [...projMap.entries()]
    .map(([project, list]) => ({ project, docs: list.sort() }))
    .sort((a, b) => b.docs.length - a.docs.length)

  return {
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
    orphans,
    byProject,
  }
}

/** 渲染 Mermaid。节点太多会糊成一团，所以只取度数最高的一段边。 */
export function renderGraphMermaid(g, { maxEdges = 80, maxNodes = 60 } = {}) {
  const degree = new Map()
  for (const e of g.edges) {
    degree.set(e.from, (degree.get(e.from) || 0) + 1)
    degree.set(e.to, (degree.get(e.to) || 0) + 1)
  }
  const ranked = [...g.edges].sort((a, b) => {
    const da = (degree.get(a.from) || 0) + (degree.get(a.to) || 0)
    const db = (degree.get(b.from) || 0) + (degree.get(b.to) || 0)
    return db - da
  })

  const picked = []
  const used = new Set()
  for (const e of ranked) {
    if (picked.length >= maxEdges || used.size >= maxNodes) break
    if (!used.has(e.from) && used.size >= maxNodes) continue
    picked.push(e)
    used.add(e.from)
    used.add(e.to)
  }

  const idOf = p => 'n' + Buffer.from(p).toString('base64url').slice(0, 10)
  const L = ['```mermaid', 'graph LR']
  for (const p of used) L.push(`  ${idOf(p)}["${p.split('/').pop()}"]`)
  for (const e of picked) L.push(`  ${idOf(e.from)} --> ${idOf(e.to)}`)
  L.push('```')
  return L.join('\n')
}
