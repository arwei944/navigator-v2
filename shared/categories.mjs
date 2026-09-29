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

/** id -> { label, color, group }，分类白名单与配色都从这里取 */
export function categoryMeta() {
  const map = {}
  for (const g of CATEGORY_GROUPS) {
    for (const c of g.categories) map[c.id] = { label: c.label, color: c.dotColor, group: g.label }
  }
  return map
}