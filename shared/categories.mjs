/**
 * 分类表：全站唯一数据源。
 *
 * 三处消费方都必须从这里取，不能再各自维护一份：
 *   - src/stores/categories.js        前端侧边栏 / 卡片分类色
 *   - tools/console/lib/data.mjs      本地控制台分类下拉与体检
 *   - api/metadata.js                 线上「添加站点」的分类白名单
 *
 * 没有这份文件时，控制台靠正则解析 categories.js 源码取分类（结构一变就静默失败），
 * 线上接口干脆不传分类表，推断出的 categoryId 可能是未登记分类 —— 前端下拉框里
 * 没有这一项，用户看到「已补全分类 X」但选中项没变。
 *
 * 字段用 dotColor 而非 color：前端模板与 AdminView 直接读 dotColor，
 * 控制台需要 color，由 data.mjs 映射，避免改两处模板。
 */
export const CATEGORY_GROUPS = [
  {
    id: 'ai',
    label: 'AI 学习',
    collapsed: false,
    categories: [
      { id: 'starter', label: '入门对话', dotColor: '#22c55e' },
      { id: 'prompt', label: '提示词工程', dotColor: '#3b82f6' },
      { id: 'writing', label: '写作与内容', dotColor: '#a855f7' },
      { id: 'coding', label: '编程与开发', dotColor: '#f97316' },
      { id: 'design', label: '设计与创意', dotColor: '#ec4899' },
      { id: 'workflow', label: '深度工作流', dotColor: '#06b6d4' },
      { id: 'learning', label: '学习与前沿', dotColor: '#ef4444' },
      { id: 'aideals', label: 'AI 优惠比价', dotColor: '#ff6a00' },
    ],
  },
  {
    id: 'crypto',
    label: '币圈',
    collapsed: false,
    categories: [
      { id: 'cex', label: '交易所 CEX', dotColor: '#f0b90b' },
      { id: 'dex', label: '去中心化交易所 DEX', dotColor: '#ff007a' },
      { id: 'defi', label: 'DeFi 借贷/收益', dotColor: '#00a3ff' },
      { id: 'data', label: '数据与研究', dotColor: '#3861fb' },
      { id: 'funding', label: '投融资', dotColor: '#ff4500' },
      { id: 'wallet', label: '钱包', dotColor: '#8b5cf6' },
      { id: 'chain', label: '链上工具', dotColor: '#3c3c3d' },
      { id: 'infra', label: '基础设施 L1/L2', dotColor: '#06b6d4' },
      { id: 'nft', label: 'NFT 市场', dotColor: '#ec4899' },
      { id: 'security', label: '安全审计', dotColor: '#ef4444' },
      { id: 'media', label: '媒体与研究', dotColor: '#1a1a2e' },
      { id: 'staking', label: '挖矿/节点', dotColor: '#f97316' },
      { id: 'stable', label: '稳定币/RWA', dotColor: '#22c55e' },
      { id: 'aicrypto', label: 'AI + Crypto', dotColor: '#a855f7' },
      { id: 'airdrop', label: '空投/Airdrop', dotColor: '#ff6a00' },
    ],
  },
  {
    id: 'tools',
    label: '工具',
    collapsed: false,
    categories: [
      { id: 'sms', label: '短信接码', dotColor: '#22c55e' },
      { id: 'aiapi', label: 'AI API 平台', dotColor: '#2563eb' },
      { id: 'account', label: '账号/卡密', dotColor: '#f59e0b' },
      { id: 'projects', label: '项目参考', dotColor: '#0d9488' },
    ],
  },
  {
    id: 'basics',
    label: '基础服务',
    collapsed: false,
    categories: [
      { id: 'cloud', label: '云服务器/VPS', dotColor: '#3b82f6' },
      { id: 'domain', label: '域名服务', dotColor: '#8b5cf6' },
      { id: 'proxy', label: '代理/VPN', dotColor: '#a855f7' },
    ],
  },
]

/** 扁平分类列表（保持分组顺序） */
export function categoryList() {
  return CATEGORY_GROUPS.flatMap(g => g.categories)
}

/**
 * 域（分组）列表。域是导航的一级方向，子分类是域内的二级筛选，
 * 两者共用同一个「当前范围」取值：'all' | 域 id | 子分类 id。
 * 域 id（ai/crypto/tools/basics）与子分类 id 无重名，同轴不会歧义。
 */
export function domainList() {
  return CATEGORY_GROUPS.map(g => ({ id: g.id, label: g.label }))
}

/** 该取值是否是「整域」（而非具体子分类） */
export function isDomainScope(value) {
  return CATEGORY_GROUPS.some(g => g.id === value)
}

/** 该取值归属于哪个域：域 id 返回自身，子分类 id 返回所属域，'all'/未知返回 'all' */
export function domainOfScope(value) {
  if (!value || value === 'all') return 'all'
  for (const g of CATEGORY_GROUPS) {
    if (g.id === value) return g.id
    if (g.categories.some(c => c.id === value)) return g.id
  }
  return 'all'
}

/** 某域下的子分类；'all' 返回全部子分类 */
export function categoriesOfDomain(domainId) {
  if (!domainId || domainId === 'all') return categoryList()
  const g = CATEGORY_GROUPS.find(g => g.id === domainId)
  return g ? g.categories : []
}

/** id -> { label, color, group }，分类白名单与配色都从这里取 */
export function categoryMeta() {
  const map = {}
  for (const g of CATEGORY_GROUPS) {
    for (const c of g.categories) map[c.id] = { label: c.label, color: c.dotColor, group: g.label }
  }
  return map
}

/** 深拷贝一份分组表（默认表是模块级常量，写入前必须拷贝，否则会污染所有消费方） */
export function cloneGroups(groups = CATEGORY_GROUPS) {
  return groups.map(g => ({
    id: g.id,
    label: g.label,
    collapsed: Boolean(g.collapsed),
    categories: g.categories.map(c => ({ id: c.id, label: c.label, dotColor: c.dotColor })),
  }))
}

/**
 * 校验并规范化「云端分类表」。
 *
 * 云端数据是运行时权威源，但它的结构可能被旧版本、手工编辑或半截写入破坏 ——
 * 一旦放行脏数据，全站分类下拉、筛选条、卡片配色会同时崩掉。
 * 因此这里做一次严格体检：任一硬约束不满足就整体返回 null，
 * 由调用方回退到内置默认表（宁可退回上一版结构，也不能渲染出半张表）。
 *
 * 硬约束：
 *  ① 至少一个分组，每个分组至少一个子分类；
 *  ② 分组 id / 子分类 id 各自唯一，且两组 id 集合互不相交（域与子分类同轴，重名会歧义）；
 *  ③ label 非空；dotColor 非空，缺失时补中性灰而非拒绝。
 */
export function sanitizeGroups(input) {
  if (!Array.isArray(input) || input.length === 0) return null

  const groupIds = new Set()
  const catIds = new Set()
  const groups = []

  for (const g of input) {
    if (!g || typeof g !== 'object') return null
    const gid = String(g.id || '').trim()
    const glabel = String(g.label || '').trim()
    if (!gid || !glabel || groupIds.has(gid)) return null
    if (!Array.isArray(g.categories) || g.categories.length === 0) return null

    const categories = []
    for (const c of g.categories) {
      if (!c || typeof c !== 'object') return null
      const cid = String(c.id || '').trim()
      const clabel = String(c.label || '').trim()
      if (!cid || !clabel || catIds.has(cid)) return null
      catIds.add(cid)
      const dotColor = String(c.dotColor || '').trim()
      categories.push({ id: cid, label: clabel, dotColor: dotColor || '#64748b' })
    }

    groupIds.add(gid)
    groups.push({ id: gid, label: glabel, collapsed: Boolean(g.collapsed), categories })
  }

  // 域 id 与子分类 id 不能重名：同轴取值 'all' | 域 id | 子分类 id，重名会让筛选语义歧义
  for (const gid of groupIds) if (catIds.has(gid)) return null

  return groups
}

/**
 * 分类表结构化对比（发布预检用）：域 / 分类的增删改与域内排序变化。
 *
 * 分类 id 是站点的归属键、创建后不可改，所以「改」只可能是 label / dotColor / 所属域。
 * 域内顺序变化单独记一条 `reordered`（顺序影响前台筛选条的呈现，值得提示但不阻断）。
 */
export function diffGroups(before, after) {
  const prevGroups = Array.isArray(before) ? before : []
  const nextGroups = Array.isArray(after) ? after : []
  const prevG = new Map(prevGroups.map(g => [g.id, g]))
  const nextG = new Map(nextGroups.map(g => [g.id, g]))

  const indexCats = (groups) => {
    const map = new Map()
    for (const g of groups) for (const c of (g.categories || [])) map.set(c.id, { cat: c, group: g.id })
    return map
  }
  const prevC = indexCats(prevGroups)
  const nextC = indexCats(nextGroups)

  const groupsAdded = []
  const groupsRemoved = []
  const groupsRenamed = []
  for (const [id, g] of nextG) {
    if (!prevG.has(id)) groupsAdded.push({ id, label: g.label })
    else if (prevG.get(id).label !== g.label) groupsRenamed.push({ id, from: prevG.get(id).label, to: g.label })
  }
  for (const [id, g] of prevG) if (!nextG.has(id)) groupsRemoved.push({ id, label: g.label })

  const catsAdded = []
  const catsRemoved = []
  const catsUpdated = []
  const catsMoved = []
  for (const [id, { cat, group }] of nextC) {
    if (!prevC.has(id)) {
      catsAdded.push({ id, label: cat.label, group })
      continue
    }
    const p = prevC.get(id)
    const fields = []
    if (p.cat.label !== cat.label) fields.push('label')
    if (p.cat.dotColor !== cat.dotColor) fields.push('dotColor')
    if (p.group !== group) fields.push('group')
    if (!fields.length) continue
    if (fields.includes('group')) catsMoved.push({ id, label: cat.label, fields, from: p.group, to: group })
    else catsUpdated.push({ id, label: cat.label, fields })
  }
  for (const [id, { cat, group }] of prevC) if (!nextC.has(id)) catsRemoved.push({ id, label: cat.label, group })

  const reordered = nextGroups.some(g => {
    const p = prevG.get(g.id)
    if (!p) return false
    return p.categories.map(c => c.id).join(',') !== g.categories.map(c => c.id).join(',')
  })

  const total = groupsAdded.length + groupsRemoved.length + groupsRenamed.length +
    catsAdded.length + catsRemoved.length + catsUpdated.length + catsMoved.length + (reordered ? 1 : 0)

  return {
    groupsAdded, groupsRemoved, groupsRenamed,
    catsAdded, catsRemoved, catsUpdated, catsMoved, reordered,
    total,
    changed: total > 0,
  }
}