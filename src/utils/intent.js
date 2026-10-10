/**
 * 意图检索：把用户的一句话解析成结构化的筛选条件。
 *
 * ## 为什么不用大模型
 *
 * 站内只有 300 条数据、29 个分类、12 个用途 —— 这是个**封闭集合**上的匹配问题，
 * 规则引擎的准确率足够，而且：① 零依赖、零延迟、离线可用；② 结果可解释（能告诉用户
 * 「我理解成了 AI · 图像 · 免费」）；③ 不会在用户没配 key 时变成一个死按钮。
 * 真要接模型，它的输出也应该落到同样的结构上（见方案 §7.4 的降级口径）。
 *
 * ## 匹配方式
 *
 * 中文不做分词，直接 `includes`：词表小（分类 29 + 用途 12 + 若干同义词），
 * 而「免费的 AI 画图工具」这类输入里的关键词是完整出现的，子串匹配既够用又不会误伤。
 *
 * 纯函数、零依赖：词典来自 shared/ 下的分类与用途词表（与全站共用同一份真值）。
 */
import { CATEGORY_GROUPS, domainOfScope } from '../../shared/categories.mjs'
import { PURPOSE_TAGS } from '../../shared/purposes.mjs'

/** 域（一级方向）的口语说法 */
const DOMAIN_SYNONYMS = {
  ai: ['ai', '人工智能', '大模型', 'gpt', 'llm', '智能体', 'agent'],
  crypto: ['币', '加密', '区块链', 'web3', '链上', 'defi', '空投', '挖矿'],
  tools: ['工具', '在线工具', '实用', '小工具'],
  basics: ['基础服务', '服务器', 'vps', '域名', '代理', 'vpn', '机场']
}

/** 子分类的口语说法。键是分类 id，值是「人们会怎么搜它」 */
const CATEGORY_SYNONYMS = {
  starter: ['入门', '新手', '对话'],
  prompt: ['提示词', 'prompt', '咒语'],
  writing: ['写作', '文案', '文章', '润色'],
  coding: ['代码', '编程', '开发', '写代码', '程序员', 'ide'],
  design: ['设计', '画图', '绘图', '生图', '图片', '素材', '海报', 'logo'],
  workflow: ['工作流', '自动化', '流程'],
  learning: ['学习', '教程', '课程', '前沿'],
  aideals: ['优惠', '比价', '折扣'],
  cex: ['交易所', '中心化', '现货', '合约'],
  dex: ['dex', '去中心化交易所', '链上交易', 'swap', '兑换'],
  defi: ['defi', '借贷', '收益', '理财', '挖矿'],
  data: ['数据', '行情', '看盘', '研究', '链上数据'],
  funding: ['投融资', '融资', 'vc'],
  wallet: ['钱包', '助记词'],
  chain: ['链上工具', '浏览器', '区块'],
  infra: ['公链', 'l1', 'l2', '基础设施', '扩容'],
  nft: ['nft', '数字藏品'],
  security: ['安全', '审计', '风控'],
  media: ['媒体', '资讯', '新闻'],
  staking: ['质押', '节点', 'staking'],
  stable: ['稳定币', 'rwa', 'usdt', 'usdc'],
  aicrypto: ['ai+crypto', 'ai币', '加密ai'],
  airdrop: ['空投', 'airdrop'],
  sms: ['接码', '短信', '验证码'],
  aiapi: ['api', '接口', '开放平台'],
  account: ['账号', '卡密', '共享账号'],
  projects: ['项目参考', '案例', '开源项目'],
  cloud: ['云服务', '服务器', 'vps', '主机'],
  domain: ['域名', 'dns'],
  proxy: ['代理', 'vpn', '机场', '梯子']
}

/** 用途的口语说法 */
const PURPOSE_SYNONYMS = {
  reference: ['查资料', '资料', '搜索', '检索', '文档', '百科'],
  tool: ['工具', '转换', '转换器', '在线处理', '生成器'],
  data: ['数据', '看数据', '统计', '指标'],
  'ai-chat': ['对话', '聊天', '问答', 'chat', '助理'],
  coding: ['代码', '写代码', '编程', '开发'],
  design: ['设计', '画图', '绘图', '生图', '素材'],
  learning: ['学习', '教程', '入门', '课程'],
  news: ['资讯', '新闻', '快讯', '日报'],
  video: ['视频', '影视', '看片'],
  community: ['社区', '论坛', '交流', '讨论'],
  trading: ['交易', '买卖', '炒币', '下单', '兑换'],
  productivity: ['办公', '协作', '效率', '文档协作']
}

/** 价格意图：命中后作为一条说明，不参与筛选（站点表里没有价格字段） */
const PRICE_WORDS = {
  free: ['免费', '不要钱', '白嫖', 'free', '免费用', '不花钱'],
  paid: ['付费', '会员', '订阅', '收费', '买']
}

const SORT_WORDS = {
  newest: ['最新', '新收录', '新上的', '刚加的'],
  clicks: ['热门', '最火', '大家都在用', '常用']
}

const CATEGORY_LABELS = Object.fromEntries(
  CATEGORY_GROUPS.flatMap(g => g.categories.map(c => [c.id, c.label]))
)
const DOMAIN_LABELS = Object.fromEntries(CATEGORY_GROUPS.map(g => [g.id, g.label]))
const PURPOSE_LABELS = Object.fromEntries(PURPOSE_TAGS.map(p => [p.id, p.label]))

function norm(q) {
  return String(q ?? '').toLowerCase().replace(/\s+/g, '')
}

/** 在输入里找出命中的词；返回命中的那个词（用于向用户解释） */
function hit(words, text) {
  for (const w of words) {
    if (w && text.includes(String(w).toLowerCase())) return w
  }
  return ''
}

/** 各维度命中后的置信度贡献。分类/用途是强信号，价格与排序只是附加说明 */
const WEIGHT = { category: 0.45, purpose: 0.4, price: 0.15, sort: 0.1 }

/**
 * 解析一句话。
 *
 * @param {string} q 用户输入
 * @param {object} [opts] minConfidence 低于它视为没命中（默认 0.5）
 * @returns {{categories: string[], purposes: string[], price: string|null, sort: string|null,
 *            confidence: number, matched: Array<{type, id, label, word}>, hit: boolean}}
 */
export function parseIntent(q, opts = {}) {
  const text = norm(q)
  const min = typeof opts.minConfidence === 'number' ? opts.minConfidence : 0.5
  const empty = { categories: [], purposes: [], price: null, sort: null, confidence: 0, matched: [], hit: false }
  if (!text) return empty

  const matched = []
  let score = 0

  // 分类：先看子分类（更具体），没命中再看域
  const categories = []
  for (const [id, words] of Object.entries(CATEGORY_SYNONYMS)) {
    const w = hit(words, text)
    if (!w) continue
    categories.push(id)
    matched.push({ type: 'category', id, label: CATEGORY_LABELS[id] || id, word: w })
  }
  if (!categories.length) {
    for (const [id, words] of Object.entries(DOMAIN_SYNONYMS)) {
      const w = hit(words, text)
      if (!w) continue
      categories.push(id)
      matched.push({ type: 'category', id, label: DOMAIN_LABELS[id] || id, word: w })
      break // 域只取一个：同时命中「AI」和「工具」多半是用户在描述一个跨界站点
    }
  }
  if (categories.length) score += WEIGHT.category

  const purposes = []
  for (const [id, words] of Object.entries(PURPOSE_SYNONYMS)) {
    const w = hit(words, text)
    if (!w) continue
    purposes.push(id)
    matched.push({ type: 'purpose', id, label: PURPOSE_LABELS[id] || id, word: w })
  }
  if (purposes.length) score += WEIGHT.purpose

  let price = null
  for (const [kind, words] of Object.entries(PRICE_WORDS)) {
    const w = hit(words, text)
    if (!w) continue
    price = kind
    matched.push({ type: 'price', id: kind, label: kind === 'free' ? '免费' : '付费', word: w })
    break
  }
  if (price) score += WEIGHT.price

  let sort = null
  for (const [kind, words] of Object.entries(SORT_WORDS)) {
    const w = hit(words, text)
    if (!w) continue
    sort = kind
    matched.push({ type: 'sort', id: kind, label: kind === 'newest' ? '最新' : '热门', word: w })
    break
  }
  if (sort) score += WEIGHT.sort

  const confidence = Math.min(1, score)
  return {
    categories,
    purposes: purposes.slice(0, 2),
    price,
    sort,
    confidence,
    matched,
    hit: confidence >= min && (categories.length > 0 || purposes.length > 0)
  }
}

/**
 * 把意图落成路由 query。
 * 只取第一个分类与第一个用途 —— 路由的 c / p 都是单值的，
 * 多选会让「筛选条上的计数」与实际列表对不上。
 */
export function intentToQuery(intent) {
  const q = {}
  if (intent?.categories?.length) q.c = intent.categories[0]
  if (intent?.purposes?.length) q.p = intent.purposes[0]
  if (intent?.sort) q.sort = intent.sort
  return q
}

/** 意图里命中的分类属于哪个域（用于显示「AI 学习 · 编程与开发」这种两级说明） */
export function domainLabelOf(categoryId) {
  const d = domainOfScope(categoryId)
  return d && d !== 'all' ? (DOMAIN_LABELS[d] || d) : ''
}

/** 给 chip 用的一句话描述 */
export function describeIntent(intent) {
  if (!intent || !intent.hit) return ''
  const parts = intent.matched
    .filter(m => m.type === 'category' || m.type === 'purpose' || m.type === 'price')
    .map(m => m.label)
  return parts.join(' · ')
}
