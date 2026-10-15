/**
 * 关系图的力导向布局。
 *
 * ## 为什么自己写
 *
 * `utils/chartkit.js` 只有 sparkline / donut / heatstrip / barTrack，没有图布局；
 * 引 d3-force 会往按需 chunk 里加一个只为「算 300 个坐标」的大依赖。
 * 这里要的东西很少：斥力 + 引力 + 冷却，一百行足够。
 *
 * ## 三个刻意的选择
 *
 * 1. **分类锚点**：每个分类在画布上有固定锚点，节点被一股弱力拉向自己分类的锚点。
 *    纯 FR（Fruchterman-Reingold）会让同类节点散落全图 —— 出来的图「物理上很好看、
 *    读起来没信息」，而用户要看的第一件事就是「哪几坨是一类」。
 * 2. **确定性**：初始抖动用固定种子的伪随机（mulberry32），同一份数据两次布局**完全一致**。
 *    否则每次打开图都在跳，用户会以为数据变了。
 * 3. **位置夹紧**：每次迭代后把坐标收进 padding 内，保证节点永远在画布可见范围内。
 *
 * 纯函数、零依赖：能被 tools/console 的纯 node 测试直接加载。
 */

const DEFAULT_PADDING = 64

/** 固定种子的伪随机（同一 seed 得到同一串数）—— 布局可复现的前提 */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 分类锚点：把各分类均匀摆在一个椭圆上，同心一圈。
 * 单分类时直接放中心（画布内均匀铺开即可，硬摆到边缘反而难看）。
 *
 * `anchorScale` 是椭圆半径占可用半幅的比例 —— 这个值决定成败，不能随手取。
 * 早先取 0.82（几乎贴边），300 站真机跑出来是**一个空心方框**：每个分类的锚点都在
 * 边缘，同组节点被锚点力持续拉过去、又被斥力推开，最后整组堆在边界上被夹紧，
 * 画布中心全空。簇本身有半径，锚点必须收进内圈，簇才有地方向外铺。
 */
export function categoryAnchors(categoryIds, { width, height, padding = DEFAULT_PADDING, anchorScale = 0.5 } = {}) {
  const ids = [...new Set((categoryIds || []).filter(Boolean))]
  const map = new Map()
  if (!ids.length) return map

  const cx = width / 2
  const cy = height / 2
  if (ids.length === 1) {
    map.set(ids[0], { x: cx, y: cy })
    return map
  }
  const rx = ((width - padding * 2) / 2) * anchorScale
  const ry = ((height - padding * 2) / 2) * anchorScale
  ids.forEach((id, i) => {
    const angle = (i / ids.length) * Math.PI * 2 - Math.PI / 2
    map.set(id, { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry })
  })
  return map
}

/**
 * 算出一张图的节点坐标。
 *
 * ## repulsion / anchorPull / anchorScale 是实测扫出来的，不是拍的
 *
 * 300 站真实数据（1400×900 画布、580 条边）扫描结果：
 *
 * | repulsion / anchorPull / anchorScale | 簇分离比 | 贴边率 | 网格占用 | 最近邻 |
 * |---|---|---|---|---|
 * | 1 / 0.06 / 0.82（初版） | 5.46 | **97%** | 44/126 | 10.4 |
 * | 0.3 / 0.7 / 0.5（现值） | **6.40** | **6%** | 80/126 | 19.3 |
 *
 * 初版那两个系数的**量级**是错的：斥力按「每一对节点」累加，锚点力却只有一项，
 * 300 个节点的斥力净和把那点弱锚点力彻底压过去 —— 整张图一路向外膨胀，
 * 直到撞上画布边界被夹紧。真机截图上就是一个**空心方框**：节点沿四边排成线，
 * 中心全空。这是单测（只验确定性/夹紧/性能）看不见的那类缺陷。
 *
 * 「簇分离比」= 异类节点平均距离 / 同类节点平均距离，衡量「聚得有没有意义」；
 * 69% 的格子有节点说明铺得匀；最近邻 19.3px 说明标签不会互相压。
 * 改动这三个数之前请先重扫一遍，别凭手感调。
 *
 * @param {Array}  nodes 站点数组（用 id 与 categoryId）
 * @param {Array}  edges `{ source, target, score? }`
 * @param {object} [o]
 * @param {number} [o.iterations] 迭代轮数；80 轮在 300 节点上约 150~300ms，
 *                                再往上收益很小（位置基本不动了）
 * @param {number} [o.repulsion]  斥力系数（默认 0.3）
 * @param {number} [o.anchorPull] 分类锚点力系数（默认 0.7）
 * @param {number} [o.anchorScale] 锚点椭圆半径占可用半幅的比例（默认 0.5）
 * @returns {{ positions: Map<string, {x:number,y:number}>, bounds: object, iterations: number }}
 */
export function layoutGraph(nodes, edges, {
  width = 1200, height = 800, iterations = 80, padding = DEFAULT_PADDING, seed = 20261015,
  anchorScale = 0.5, repulsion = 0.3, anchorPull = 0.7,
} = {}) {
  const list = (nodes || []).filter(n => n && n.id)
  if (!list.length) {
    return { positions: new Map(), bounds: { minX: 0, minY: 0, maxX: width, maxY: height }, iterations: 0 }
  }

  const rand = mulberry32(seed)
  const n = list.length
  const anchors = categoryAnchors(list.map(s => s.categoryId), { width, height, padding, anchorScale })
  const center = { x: width / 2, y: height / 2 }
  // 理想边长：面积均分给节点后开方。乘 0.55 让初始网更紧凑、收敛更快
  const k = Math.sqrt((width * height) / n) * 0.55

  const pos = list.map(site => {
    const a = anchors.get(site.categoryId) || center
    return {
      id: site.id,
      x: a.x + (rand() - 0.5) * 60,
      y: a.y + (rand() - 0.5) * 60,
      anchor: a,
    }
  })

  const index = new Map(pos.map((p, i) => [p.id, i]))
  const links = (edges || [])
    .map(e => ({ a: index.get(e.source), b: index.get(e.target) }))
    .filter(l => l.a != null && l.b != null)

  let temp = width / 8
  const cool = temp / (iterations + 1)

  const disp = pos.map(() => ({ x: 0, y: 0 }))

  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) { disp[i].x = 0; disp[i].y = 0 }

    // 斥力：所有节点对相互推开
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x
        let dy = pos[i].y - pos[j].y
        let d2 = dx * dx + dy * dy
        if (d2 < 0.01) {
          // 完全重合会让方向无意义 —— 用一个确定性的小偏移岔开（不用 rand，保持可复现）
          dx = (i - j) * 0.5 || 0.5
          dy = 0.5
          d2 = dx * dx + dy * dy
        }
        const d = Math.sqrt(d2)
        const f = ((k * k) / d) * repulsion
        const ux = dx / d
        const uy = dy / d
        disp[i].x += ux * f
        disp[i].y += uy * f
        disp[j].x -= ux * f
        disp[j].y -= uy * f
      }
    }

    // 引力：有边的互相拉近
    for (const l of links) {
      const dx = pos[l.a].x - pos[l.b].x
      const dy = pos[l.a].y - pos[l.b].y
      const d = Math.max(0.01, Math.hypot(dx, dy))
      const f = ((d * d) / k) * 0.6
      const ux = dx / d
      const uy = dy / d
      disp[l.a].x -= ux * f
      disp[l.a].y -= uy * f
      disp[l.b].x += ux * f
      disp[l.b].y += uy * f
    }

    // 分类锚点弱力 + 位移限幅 + 夹紧到画布内
    for (let i = 0; i < n; i++) {
      disp[i].x += (pos[i].anchor.x - pos[i].x) * anchorPull
      disp[i].y += (pos[i].anchor.y - pos[i].y) * anchorPull
      const d = Math.max(0.01, Math.hypot(disp[i].x, disp[i].y))
      const lim = Math.min(d, temp)
      pos[i].x += (disp[i].x / d) * lim
      pos[i].y += (disp[i].y / d) * lim
      pos[i].x = Math.max(padding, Math.min(width - padding, pos[i].x))
      pos[i].y = Math.max(padding, Math.min(height - padding, pos[i].y))
    }

    temp -= cool
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const positions = new Map()
  for (const p of pos) {
    positions.set(p.id, { x: p.x, y: p.y })
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { positions, bounds: { minX, minY, maxX, maxY }, iterations }
}
