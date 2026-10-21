/**
 * 阶段 3：实体共现图谱。
 *
 * ## 为什么不引入图数据库
 *
 * 30 天、万级条目、几百个实体，完全放得进 SQLite 的一张 `entity_edges` 表。
 * 引入 Neo4j 之类只会让本地部署多一个服务。这里把「建边」做成纯函数：
 * 输入提及，输出边；存储与展示各自负责。
 *
 * ## 边的含义
 *
 * 同一条报道里同时出现两个实体 → 记一次共现。共现次数越多、
 * 来源越分散，说明两者关系越稳定（而不是同一家媒体的口径重复）。
 * `weight = co × (1 + log2(1 + 来源数))`。
 */

function round(n, digits = 2) {
  const p = 10 ** digits
  return Math.round(n * p) / p
}

/**
 * 按条目聚合提及，生成实体共现边。
 *
 * @param {Array<{entityId:string, entryId:string, at:number, sourceId?:string}>} mentions
 * @param {{minCo?:number, limit?:number}} options
 * @returns {Array<{a:string,b:string,co:number,sources:number,weight:number,lastAt:number}>}
 */
export function buildEntityEdges({ mentions = [], minCo = 2, limit = 400 } = {}) {
  const byEntry = new Map()
  for (const m of Array.isArray(mentions) ? mentions : []) {
    if (!m?.entityId || !m?.entryId) continue
    if (!byEntry.has(m.entryId)) byEntry.set(m.entryId, [])
    byEntry.get(m.entryId).push(m)
  }

  const pairs = new Map()
  for (const list of byEntry.values()) {
    // 同一条目里同一实体只算一次
    const ids = [...new Set(list.map(m => m.entityId))].sort()
    if (ids.length < 2) continue
    const sources = new Set(list.map(m => m.sourceId).filter(Boolean))
    const at = list.reduce((n, m) => Math.max(n, Number(m.at) || 0), 0)
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const key = `${ids[i]}|${ids[j]}`
        let row = pairs.get(key)
        if (!row) {
          row = { a: ids[i], b: ids[j], co: 0, sourceSet: new Set(), lastAt: 0 }
          pairs.set(key, row)
        }
        row.co += 1
        for (const s of sources) row.sourceSet.add(s)
        row.lastAt = Math.max(row.lastAt, at)
      }
    }
  }

  const edges = []
  for (const row of pairs.values()) {
    if (row.co < Math.max(1, Number(minCo) || 1)) continue
    const sources = row.sourceSet.size
    edges.push({
      a: row.a,
      b: row.b,
      co: row.co,
      sources,
      weight: round(row.co * (1 + Math.log2(1 + sources))),
      lastAt: row.lastAt,
    })
  }
  return edges.sort((x, y) => y.weight - x.weight || y.co - x.co).slice(0, Math.max(1, Number(limit) || 400))
}

/**
 * 图谱视图数据：取提及最多的实体作为节点，再取它们之间的边。
 *
 * @param {{mentions?:Array, names?:Map<string,{name:string,kind:string}>, maxNodes?:number, minCo?:number}} input
 */
export function entityGraph({ mentions = [], names = new Map(), maxNodes = 40, minCo = 2 } = {}) {
  const counts = new Map()
  for (const m of mentions) {
    if (!m?.entityId) continue
    counts.set(m.entityId, (counts.get(m.entityId) || 0) + 1)
  }
  const nodes = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, Number(maxNodes) || 40))
    .map(([id, count]) => {
      const meta = names.get(id) || {}
      return { id, name: meta.name || id, kind: meta.kind || 'unknown', count }
    })
  const keep = new Set(nodes.map(n => n.id))
  const edges = buildEntityEdges({
    mentions: mentions.filter(m => keep.has(m.entityId)),
    minCo,
    limit: Math.max(20, nodes.length * 3),
  }).filter(e => keep.has(e.a) && keep.has(e.b))
  return { nodes, edges }
}

function hash01(text) {
  let h = 2166136261
  const s = String(text)
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

/**
 * 确定性力导向布局。
 *
 * 不能依赖 `Math.random()`：同一份数据每次刷新都换位置，用户会以为
 * 图谱在「乱跳」，测试也无法断言。这里用 id 的 FNV-1a 哈希做初始扰动。
 *
 * @returns {Array<{id:string,name:string,kind:string,count:number,x:number,y:number,r:number}>}
 */
export function graphLayout(nodes = [], edges = [], {
  width = 760, height = 420, iterations = 140, padding = 34,
} = {}) {
  const list = Array.isArray(nodes) ? nodes : []
  const n = list.length
  if (!n) return []

  const index = new Map(list.map((node, i) => [node.id, i]))
  const pos = list.map((node, i) => {
    const angle = (i / n) * Math.PI * 2
    const radius = Math.min(width, height) * 0.32 * (0.55 + 0.7 * hash01(node.id))
    return {
      x: width / 2 + Math.cos(angle) * radius,
      y: height / 2 + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    }
  })

  const links = (Array.isArray(edges) ? edges : [])
    .map(e => ({
      s: index.get(e.a ?? e.source),
      t: index.get(e.b ?? e.target),
      w: Number(e.weight) || 1,
    }))
    .filter(l => l.s !== undefined && l.t !== undefined && l.s !== l.t)

  const k = Math.sqrt((width * height) / n) * 0.72
  for (let it = 0; it < iterations; it += 1) {
    const cool = 1 - it / iterations

    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        let dx = pos[i].x - pos[j].x
        let dy = pos[i].y - pos[j].y
        let d2 = dx * dx + dy * dy
        if (d2 < 0.01) {
          dx = hash01(`${list[i].id}|${list[j].id}`) - 0.5
          dy = hash01(`${list[j].id}|${list[i].id}`) - 0.5
          d2 = dx * dx + dy * dy + 0.01
        }
        const d = Math.sqrt(d2)
        const force = ((k * k) / d) * 0.05 * cool
        const fx = (dx / d) * force
        const fy = (dy / d) * force
        pos[i].vx += fx
        pos[i].vy += fy
        pos[j].vx -= fx
        pos[j].vy -= fy
      }
    }

    for (const link of links) {
      const dx = pos[link.t].x - pos[link.s].x
      const dy = pos[link.t].y - pos[link.s].y
      const d = Math.max(1, Math.hypot(dx, dy))
      // 边越强，期望长度越短
      const target = k * (0.95 - 0.18 * Math.min(3, link.w) / 3)
      const force = (d - target) * 0.02 * cool
      const fx = (dx / d) * force
      const fy = (dy / d) * force
      pos[link.s].vx += fx
      pos[link.s].vy += fy
      pos[link.t].vx -= fx
      pos[link.t].vy -= fy
    }

    for (const p of pos) {
      p.vx += (width / 2 - p.x) * 0.002 * cool
      p.vy += (height / 2 - p.y) * 0.002 * cool
      p.x += Math.max(-14, Math.min(14, p.vx))
      p.y += Math.max(-14, Math.min(14, p.vy))
      p.vx *= 0.85
      p.vy *= 0.85
      p.x = Math.max(padding, Math.min(width - padding, p.x))
      p.y = Math.max(padding, Math.min(height - padding, p.y))
    }
  }

  const maxCount = Math.max(1, ...list.map(x => Number(x.count) || 1))
  return list.map((node, i) => ({
    ...node,
    x: Math.round(pos[i].x * 10) / 10,
    y: Math.round(pos[i].y * 10) / 10,
    r: Math.round((6 + 11 * Math.sqrt((Number(node.count) || 1) / maxCount)) * 10) / 10,
  }))
}

/** 图谱摘要，用于面板标题与测试断言 */
export function graphSummary(graph = {}) {
  const nodes = graph.nodes || []
  const edges = graph.edges || []
  return {
    nodes: nodes.length,
    edges: edges.length,
    topEdge: edges[0] ? { ...edges[0] } : null,
    isolated: Math.max(0, nodes.length - new Set(edges.flatMap(e => [e.a, e.b])).size),
  }
}
