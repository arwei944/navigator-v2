/**
 * 站点「用途」内核：标签词表 + 规则推断 + 归一校验。
 *
 * 用途与分类是两个正交的轴，不能互相替代：
 *   - 分类回答「这是什么方向的站」（AI 学习 / 币圈 / 工具）—— 归属唯一，决定站点的位置；
 *   - 用途回答「我用它来干什么」（查资料 / 交易 / 写代码）—— 可多选，跨分类存在，
 *     同一个「查资料」既可能落在数据研究站，也可能落在媒体站。
 * 因此用途必须是独立字段，而不是从分类反推的展示文案。
 *
 * 与 shared/ops/site-ops.mjs 一样，本文件必须保持 **纯函数 + 零依赖**
 * （不 import node:*，不碰 fs / 网络）—— 它同时被浏览器侧（src/）、
 * Node 侧（api/、tools/）与 Vite 打包引用，一旦引入 Node API 前端构建就会失败。
 *
 * 推断口径放在这里而非各端自算：新增站点有两个入口（线上 api/metadata.js、
 * 本地控制台 tools/console），各写一套规则必然漂移 —— 同一网址在两个入口
 * 拿到不同用途，用户会以为功能坏了。
 */

/* ---------------- 标签词表 ---------------- */

/**
 * 受控词表。用途要参与筛选与聚合，必须是封闭集合：
 * 自由文本无法做筛选条，也无法统计「哪些用途最常用」。
 * id 用英文短横线（存进数据、做 URL 参数），label 是给人看的中文。
 */
export const PURPOSE_TAGS = [
  { id: 'reference', label: '查资料', color: '#3b82f6' },
  { id: 'tool', label: '在线工具', color: '#0d9488' },
  { id: 'data', label: '看数据', color: '#3861fb' },
  { id: 'ai-chat', label: 'AI 对话', color: '#a855f7' },
  { id: 'coding', label: '写代码', color: '#f97316' },
  { id: 'design', label: '设计素材', color: '#ec4899' },
  { id: 'learning', label: '学习', color: '#22c55e' },
  { id: 'news', label: '资讯', color: '#64748b' },
  { id: 'video', label: '看视频', color: '#ef4444' },
  { id: 'community', label: '社区交流', color: '#8b5cf6' },
  { id: 'trading', label: '交易', color: '#f0b90b' },
  { id: 'productivity', label: '办公协作', color: '#06b6d4' },
]

export const PURPOSE_IDS = new Set(PURPOSE_TAGS.map(t => t.id))

const TAG_BY_ID = new Map(PURPOSE_TAGS.map(t => [t.id, t]))

/** 单站点最多保留几个用途：够表达「主要怎么用」，又不至于把卡片塞满 */
export const MAX_PURPOSES = 4

export function purposeLabel(id) {
  return TAG_BY_ID.get(String(id))?.label || ''
}

export function purposeColor(id) {
  return TAG_BY_ID.get(String(id))?.color || '#64748b'
}

/* ---------------- 推断规则 ---------------- */

/**
 * 分类 → 用途的基线映射。分类是人工确认过的强信号（用户从下拉框里选的），
 * 因此它给出的用途排在最前，作为「兜底至少有一个用途」的保证 ——
 * 没有关键词命中时也不会出现空用途。
 */
const BY_CATEGORY = {
  // AI 学习
  starter: ['ai-chat', 'learning'],
  prompt: ['ai-chat', 'learning'],
  writing: ['ai-chat', 'productivity'],
  coding: ['coding'],
  design: ['design'],
  workflow: ['productivity'],
  learning: ['learning', 'news'],
  aideals: ['reference'],
  // 币圈
  cex: ['trading'],
  dex: ['trading'],
  defi: ['trading'],
  data: ['data', 'reference'],
  funding: ['news', 'reference'],
  wallet: ['tool'],
  chain: ['tool', 'data'],
  infra: ['tool'],
  nft: ['trading', 'design'],
  security: ['reference', 'tool'],
  media: ['news'],
  staking: ['trading'],
  stable: ['trading'],
  aicrypto: ['ai-chat', 'trading'],
  airdrop: ['news', 'trading'],
  // 工具
  sms: ['tool'],
  aiapi: ['tool', 'coding'],
  account: ['tool'],
  projects: ['reference', 'coding'],
  // 基础服务
  cloud: ['tool'],
  domain: ['tool'],
  proxy: ['tool'],
}

/**
 * 关键词 → 用途。规则之间**不得共享同一个词**，否则一个词会同时点亮两个用途
 * （曾把 `行情` 同时写进 data 与 trading、`docs` 同时写进 learning 与 reference）。
 * 每个词只归属语义最近的那个用途。
 */
const BY_KEYWORD = [
  { tag: 'video', re: /视频|直播|影片|影视|video|youtube|bilibili|vimeo|twitch|netflix/i },
  { tag: 'community', re: /社区|论坛|讨论|问答|圈子|forum|community|reddit|discord|贴吧|交流/i },
  { tag: 'news', re: /新闻|资讯|快讯|日报|晚报|头条|报道|媒体|news|feed|blog/i },
  { tag: 'learning', re: /教程|课程|学习|入门|指南|手册|tutorial|course|learn|guide|handbook/i },
  { tag: 'coding', re: /代码|编程|开发|开源|仓库|部署|调试|\bapi\b|\bsdk\b|github|gitlab|deploy/i },
  { tag: 'design', re: /设计|素材|图标|配色|字体|模板|插画|design|\bicon\b|\bfont\b|template|ui\s?kit/i },
  { tag: 'trading', re: /交易|买卖|合约|现货|交易所|撮合|exchange|\btrade\b|swap|perp|永续/i },
  { tag: 'data', re: /数据|统计|排行|榜单|看板|图表|分析|dashboard|analytics|chart|ranking|metric/i },
  { tag: 'ai-chat', re: /对话|聊天|助手|智能体|\bchat\b|assistant|agent|copilot|大模型/i },
  { tag: 'productivity', re: /办公|协作|笔记|日程|效率|协同|待办|productivity|workspace|notion|calendar/i },
  { tag: 'tool', re: /工具|在线|转换|生成器|解析|查询|检测|tool|online|converter|generator|parser/i },
  { tag: 'reference', re: /百科|资料|参考|导航|目录|文档|检索|wiki|reference|directory|catalog/i },
]

/**
 * 规则推断用途：分类基线打底，关键词命中补充，最后按上限截断。
 * 分类在前、关键词在后 —— 分类是用户确认过的归属，可信度高于词面命中。
 *
 * @param {{ categoryId?: string, name?: string, desc?: string, keywords?: string, url?: string }} input
 * @returns {string[]} 用途 id 数组（可能为空数组，表示无从判断）
 */
export function inferPurposes(input = {}, { max = MAX_PURPOSES } = {}) {
  const { categoryId = '', name = '', desc = '', keywords = '', url = '' } = input || {}
  const out = []
  const seen = new Set()
  const push = (id) => {
    if (!PURPOSE_IDS.has(id) || seen.has(id) || out.length >= max) return
    seen.add(id)
    out.push(id)
  }

  for (const id of BY_CATEGORY[String(categoryId || '').trim()] || []) push(id)

  const hay = `${name} ${desc} ${keywords} ${url}`.toLowerCase()
  for (const rule of BY_KEYWORD) {
    if (out.length >= max) break
    if (rule.re.test(hay)) push(rule.tag)
  }

  return out
}

/* ---------------- 归一校验 ---------------- */

/**
 * 归一化用途入参：接受数组，或「逗号 / 顿号 / 换行」分隔的字符串。
 * 剔除不在词表内的 id（旧数据 / 手改数据可能带脏值）、去重、按上限截断。
 * 与 normalizeAliases 同风格：非法项静默丢弃而不是抛错，
 * 因为这里同时服务于「读旧数据」与「写入前清洗」两个场景。
 */
export function normalizePurposes(input, { max = MAX_PURPOSES } = {}) {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(/[,，、\n]/)
  const out = []
  const seen = new Set()
  for (const item of raw) {
    const id = String(item ?? '').trim()
    if (!id || seen.has(id) || !PURPOSE_IDS.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= max) break
  }
  return out
}

/** 用途分布统计（后台洞察用）：返回 [{ id, label, count }]，按数量降序 */
export function tallyPurposes(sites) {
  const counter = new Map()
  for (const s of Array.isArray(sites) ? sites : []) {
    for (const id of normalizePurposes(s?.purposes)) {
      counter.set(id, (counter.get(id) || 0) + 1)
    }
  }
  return PURPOSE_TAGS
    .map(t => ({ id: t.id, label: t.label, color: t.color, count: counter.get(t.id) || 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}