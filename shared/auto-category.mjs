/**
 * 自动分类决策：搜索栏一键添加时判断「这个站点该放进哪个分类」。
 *
 * 纯函数 + 零副作用（只 import 同目录的 .mjs 词表与 pinyin-pro），
 * 与 shared/purposes.mjs 同规矩 —— 一旦引入 node:* 或碰 I/O，
 * 前端 Vite 打包会直接失败。
 *
 * 判断依据的优先级是用户指定的口径：**先看页面简介**（主题表），
 * 再退到用途，最后才落「其他」。元数据自带的分类只有在可信且存在于本地表时才算数 ——
 * 否则低置信的关键词命中会盖过简介，新分类就永远建不出来。
 */
import { purposeLabel } from './purposes.mjs'
import { pinyin } from 'pinyin-pro'

/* ---------------- 标签归一 ---------------- */

/**
 * label 归一：只留小写字母 / 数字 / 汉字，其余（空格、斜杠、加号、标点）全部丢掉。
 * 「AI 绘画」「ai绘画」「AI绘画」归一后必须相等，否则同义分类会被重复新建。
 */
export function normalizeLabel(s) {
  return String(s ?? '').toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, '')
}

/* ---------------- 主题表 ---------------- */

/**
 * 内置表覆盖不到的主题。label 分两种：
 *   - 与内置分类**同文案**（设计与创意 / 编程与开发 / 写作与内容 / 云服务器/VPS / 代理/VPN）
 *     → 归一后必然相等，走「复用」，不会重复建；
 *   - 内置表没有的（AI 音乐 / AI 视频 …）→ 走「新建」，这是本功能的核心能力。
 * 顺序即优先级：更具体的主题写在前面，泛词写在后面。
 */
export const THEMES = [
  { label: '设计与创意', domain: 'ai', keywords: /绘画|画图|作图|文生图|插画|midjourney|stable[\s-]?diffusion|text-to-image|\bflux\b/i },
  { label: '编程与开发', domain: 'ai', keywords: /代码补全|编程助手|开发工具|代码生成|copilot|cursor|replit|\bide\b/i },
  { label: '写作与内容', domain: 'ai', keywords: /写作|文案|润色|copywriting|writing/i },
  { label: 'AI 视频', domain: 'ai', keywords: /文生视频|视频生成|视频创作|text-to-video|\bsora\b|\brunway\b|可灵|\bkling\b/i },
  { label: 'AI 音乐', domain: 'ai', keywords: /音乐生成|作曲|歌曲生成|text-to-music|\bsuno\b|\budio\b/i },
  { label: 'AI 语音', domain: 'ai', keywords: /语音合成|语音克隆|配音|text-to-speech|\btts\b|elevenlabs/i },
  { label: 'AI 搜索', domain: 'ai', keywords: /ai搜索|智能搜索|答案引擎|联网问答|perplexity|搜索摘要/i },
  { label: 'AI 智能体', domain: 'ai', keywords: /智能体|多智能体|\bn8n\b|\bdify\b|\bagent\b/i },
  { label: '云服务器/VPS', domain: 'basics', keywords: /云服务器|云主机|\bvps\b|虚拟主机|dedicated\s+server/i },
  { label: '代理/VPN', domain: 'basics', keywords: /\bvpn\b|代理|机场|科学上网|节点订阅|clash|v2ray|shadowrocket/i },
]

/** 用途没有「域」的天然归属，这里给一张固定映射，保证新建时域一定合法 */
const PURPOSE_DOMAIN = {
  'ai-chat': 'ai', coding: 'ai', design: 'ai', learning: 'ai',
  trading: 'crypto', data: 'crypto',
  reference: 'tools', tool: 'tools', news: 'tools', video: 'tools',
  community: 'tools', productivity: 'tools',
}

/** 新建分类的配色：按「域内已有分类数 % 调色板长度」取，避免与相邻分类撞色 */
export const DOT_PALETTE = [
  '#3b82f6', '#a855f7', '#ec4899', '#06b6d4', '#22c55e',
  '#f97316', '#ef4444', '#8b5cf6', '#f59e0b', '#0d9488',
]

/* ---------------- id 派生 ---------------- */

/**
 * 分类 id 派生：label 拼音首字母 → 只留 a-z0-9 → 冲突则 base + n++。
 * 口径与 AdminCategoryManager#onDraftLabel 完全一致，两处必须同时改。
 * `taken` 要同时装下「已有分类 id」与「域 id」——域与分类同轴，重名会让筛选歧义。
 */
export function categoryIdFor(label, taken) {
  const base = pinyin(String(label || ''), { pattern: 'first', toneType: 'none', separator: '' })
    .toLowerCase().replace(/[^a-z0-9]/g, '') || 'cat'
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(base + n)) n++
  return base + n
}

/* ---------------- 决策表 ---------------- */

/**
 * 6 条优先级分支，命中即止。
 *
 * @param {{categoryId?: string, categoryConfidence?: string, name?: string, desc?: string,
 *          domain?: string, purposes?: string[], existing?: object[], domainIds?: string[]}} input
 *   `existing` 是本地分类表快照 [{ id, label, groupId }]，`domainIds` 是域 id 列表 ——
 *   两者由调用方（Pinia store）提供，保证本函数可脱离框架单测。
 * @returns {{kind: 'use', categoryId: string, label: string}
 *         | {kind: 'create', id: string, label: string, groupId: string, dotColor: string}}
 */
export function suggestCategory({
  categoryId = '', categoryConfidence = '', name = '', desc = '', domain = '',
  purposes = [], existing = [], domainIds = [],
} = {}) {
  const list = Array.isArray(existing) ? existing : []
  const byNorm = (label) => list.find(c => normalizeLabel(c.label) === normalizeLabel(label)) || null
  const taken = new Set([...list.map(c => c.id), ...domainIds])
  const countIn = (groupId) => list.filter(c => c.groupId === groupId).length

  const create = (label, groupId) => ({
    kind: 'create',
    id: categoryIdFor(label, taken),
    label,
    groupId,
    dotColor: DOT_PALETTE[countIn(groupId) % DOT_PALETTE.length],
  })
  const use = (c) => ({ kind: 'use', categoryId: c.id, label: c.label })

  // ① 元数据给出的分类：可信且本地表里有 → 直接用
  if (categoryId && categoryConfidence !== 'low') {
    const hit = list.find(c => c.id === categoryId)
    if (hit) return use(hit)
  }

  // ② 主题表（页面简介 + 域名）：同名复用，没有就新建 —— 这条是「没有合适分类就自动建」的落点
  const hay = `${name} ${desc} ${domain}`.toLowerCase()
  const theme = THEMES.find(t => t.keywords.test(hay))
  if (theme) {
    const same = byNorm(theme.label)
    if (same) return use(same)
    return create(theme.label, theme.domain)
  }

  // ③ 用途兜底：用途是「拿来干嘛」，拿它的文案当分类名
  const firstPurpose = Array.isArray(purposes) ? purposes[0] : ''
  const purposeName = firstPurpose ? purposeLabel(firstPurpose) : ''
  if (purposeName) {
    const same = byNorm(purposeName)
    if (same) return use(same)
    return create(purposeName, PURPOSE_DOMAIN[firstPurpose] || 'tools')
  }

  // ④ 无任何信号：统一落「其他」，且全站只建这一次
  const other = byNorm('其他')
  if (other) return use(other)
  return create('其他', 'tools')
}
