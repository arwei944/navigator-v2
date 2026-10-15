/**
 * 网站关联度引擎：两站「为什么相关」，以及由它构成的整张关系图。
 *
 * ## 为什么是「可解释的加权规则」而不是向量/embedding
 *
 * 图上的每一条边都要能回答「它们凭什么连在一起」。黑箱相似度只能给一个数，
 * 用户看到两个八竿子打不着的站被连起来时无从判断是数据错了还是算法错了；
 * 而 `reasons` 里那句「都在讲『AI』『模型』，同属「AI 对话」」本身就能被核对。
 * 规则还能离线跑（300 个站的两两比对在毫秒级）、零成本、随时可复算。
 * 语义上算不出的可疑边，留给上层可选触发 AI 复核 —— 那是**补充**，不是底座。
 *
 * ## 权重从实际语料里来
 *
 * 本仓库 300 条站点描述实测：`AI` 出现 145 次、`API` 44、`DeFi` 27、`NFT` 16、
 * 分类与用途字段几乎条条都有值。所以主骨架是**分类 + 用途**（人工整理过的强信号），
 * 概念词负责把同一大类里真正谈同一件事的站连起来。
 *
 * 纯函数 + 零依赖（只引同目录的 purposes 词表）：浏览器侧、Node 侧、控制台都能直接用。
 */
import { PURPOSE_TAGS } from './purposes.mjs'

/**
 * 概念词表：命中即为「在讲这个概念」。
 *
 * 选取口径：**实际出现在本仓库站点描述里**的领域概念，而不是通用词典 ——
 * 词表价值来自区分度，收进「平台」「提供」这种到处都是的词只会让所有边等长。
 * 英文概念按词边界匹配（否则 `AI` 会命中 `said`、`L1` 会命中 `L10`）。
 */
export const CONCEPT_WORDS = [
  // 通用技术
  'AI', 'API', 'LLM', 'GPT', '模型', 'Agent', '提示词', '开源', '代码', '编程', '开发',
  '部署', '托管', '仓库', '协作', '文档', '笔记', '知识库', '表格', '数据', '分析',
  '监控', '日志', '测试', '安全', '加密', '隐私', '免费', '付费', '订阅', '中文', '翻译',
  '搜索', '浏览器', '插件', '扩展', '云', '存储', '备份', '域名', '服务器', '终端',
  '容器', 'Docker', 'GPU', '算力', '训练', '推理', '对话', '绘画', '图像', '设计',
  '原型', '视频', '音频', '音乐', '邮件', '日程', '任务', '待办', '会议',
  // 加密 / Web3
  'Web3', 'DeFi', 'NFT', 'DEX', 'CEX', '钱包', '交易所', '链', '合约', '质押', '空投',
  'Airdrop', '流动性', '聚合器', '行情', '交易', 'Token', 'EVM', 'Solana', 'L2', 'L1',
  '跨链', '挖矿',
  // 学习 / 内容
  '学习', '课程', '教程', '考试', '论文', '图书', '阅读', '新闻', '资讯', '社区',
  '论坛', '博客', '招聘', '简历', '面试', '远程',
]

/** 词表按「是否纯英文」分两路：英文走词边界，中文走子串 */
const ASCII_CONCEPTS = CONCEPT_WORDS.filter(w => /^[a-z0-9]+$/i.test(w))
const CJK_CONCEPTS = CONCEPT_WORDS.filter(w => !/^[a-z0-9]+$/i.test(w))
const ASCII_RE = ASCII_CONCEPTS.map(w => [w, new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')])

/** 打分权重 —— 改这里等于改图的形状，所以集中摆在一处并写明理由 */
export const WEIGHTS = {
  sameCategory: 40,   // 人工整理过的归属，最强信号
  perPurpose: 10,     // 用途是正交轴，跨分类拉开连接
  maxPurpose: 30,
  perConcept: 8,      // 真正谈同一件事
  maxConcept: 24,
  sameRegistrable: 25, // 同一注册域下的不同子域（如 xxx.google.com 与 google.com）
  nameOverlap: 15,     // 名称/别名互相包含（ChatGPT ↔ GPT）
  cap: 100,
}

/** 默认阈值：低于它的边不进图 —— 宁可少连，不要连出一堆噪音 */
export const DEFAULT_THRESHOLD = 35

/**
 * 取注册域（去协议、去路径、去 www，保留最后两段）。
 * 实现已收敛到 `shared/host.mjs`（与 `hostOf` 同处）—— 去重与近重复检测也要用它，
 * 不该为了一个域名函数把整张概念词表拖过去。这里 re-export，既有导入路径不变。
 */
export { registrableDomain } from './host.mjs'
import { registrableDomain } from './host.mjs'

/** 一个站点在哪些概念上「有话说」 */
export function conceptsOf(site) {
  const text = `${site?.name || ''} ${site?.desc || ''} ${(site?.aliases || []).join(' ')}`
  const out = []
  for (const t of CJK_CONCEPTS) if (text.includes(t)) out.push(t)
  for (const [w, re] of ASCII_RE) if (re.test(text)) out.push(w)
  return out
}

function purposeLabel(id, purposeLabels) {
  return purposeLabels?.[id] || PURPOSE_TAGS.find(p => p.id === id)?.label || id
}

/**
 * 一个站点的「特征包」。
 *
 * 建图要做 n²/2 次比对（300 站 = 4.5 万次），把分词、Set 构造、域名解析放进内层循环
 * 会让单次建图从 ~200ms 涨到 1.4s（实测），而这些都是**与对手方无关**的东西 ——
 * 每个站点算一次就够。这里算好，内层只做集合运算。
 */
export function featuresOf(site) {
  const concepts = conceptsOf(site)
  return {
    categoryId: site?.categoryId || '',
    purposes: new Set(site?.purposes || []),
    concepts: new Set(concepts),
    conceptList: concepts,
    domain: registrableDomain(site?.url),
    // 只留 ≥3 字的名称/别名：太短的（如 "X"）互含纯属偶然
    names: [site?.name, ...(site?.aliases || [])]
      .filter(Boolean).map(s => String(s).toLowerCase()).filter(s => s.length >= 3),
  }
}

/**
 * 两站的关联度。
 *
 * @param {object} a,b 站点对象（用 name/desc/aliases/categoryId/purposes/url）
 * @param {object} [o]
 * @param {Map} [o.featuresById]   预计算的特征包（批量建图时传入；单次调用不必）
 * @param {object} [o.categoryLabels] categoryId → 中文名
 * @param {object} [o.purposeLabels]  purposeId → 中文名
 * @returns {{ score: number, reasons: string[] }}
 */
export function affinityBetween(a, b, { featuresById, categoryLabels, purposeLabels } = {}) {
  if (!a || !b || a.id === b.id) return { score: 0, reasons: [] }
  const fa = featuresById?.get?.(a.id) || featuresOf(a)
  const fb = featuresById?.get?.(b.id) || featuresOf(b)
  const reasons = []
  let score = 0

  // ① 同分类
  if (fa.categoryId && fa.categoryId === fb.categoryId) {
    score += WEIGHTS.sameCategory
    reasons.push(`同属「${categoryLabels?.[fa.categoryId] || fa.categoryId}」`)
  }

  // ② 共同用途
  const sharedPurposes = [...fb.purposes].filter(p => fa.purposes.has(p))
  if (sharedPurposes.length) {
    score += Math.min(sharedPurposes.length * WEIGHTS.perPurpose, WEIGHTS.maxPurpose)
    reasons.push(`都用它来「${sharedPurposes.slice(0, 3).map(p => purposeLabel(p, purposeLabels)).join('、')}」`)
  }

  // ③ 共同概念
  const sharedConcepts = [...fb.concepts].filter(c => fa.concepts.has(c))
  if (sharedConcepts.length) {
    score += Math.min(sharedConcepts.length * WEIGHTS.perConcept, WEIGHTS.maxConcept)
    reasons.push(`都在讲「${sharedConcepts.slice(0, 4).join('」「')}」`)
  }

  // ④ 同一注册域（互链/子站关系）
  if (fa.domain && fa.domain === fb.domain) {
    score += WEIGHTS.sameRegistrable
    reasons.push(`同一个站点家族（${fa.domain}）`)
  }

  // ⑤ 名称 / 别名互相包含
  if (fa.names.some(x => fb.names.some(y => x.includes(y) || y.includes(x)))) {
    score += WEIGHTS.nameOverlap
    reasons.push('名称/别名互相包含')
  }

  return { score: Math.min(score, WEIGHTS.cap), reasons }
}

/**
 * 由站点列表构建关系图。
 *
 * @param {Array}  sites
 * @param {object} [o]
 * @param {number} [o.threshold] 低于此分不计入（默认 35）
 * @param {number} [o.topK]      每个站最多保留几条最强连接（默认 6）——
 *                               全量边在 300 站时是几万条，图会糊成一团；限制**每站**的度
 *                               比全局截断更公平：冷门方向也能连上自己的邻居
 * @returns {{ nodes: Array, edges: Array, byId: Map<string, Array<{id,score,reasons}>>,
 *             concepts: Map<string,string[]> }}
 */
export function buildAffinityGraph(sites, { threshold = DEFAULT_THRESHOLD, topK = 6, categoryLabels, purposeLabels } = {}) {
  const list = (sites || []).filter(s => s && s.id)
  const features = new Map()
  for (const s of list) features.set(s.id, featuresOf(s))
  const concepts = new Map([...features].map(([id, f]) => [id, f.conceptList]))

  const byId = new Map(list.map(s => [s.id, []]))
  const edges = []

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]
      const b = list[j]
      const { score, reasons } = affinityBetween(a, b, { featuresById: features, categoryLabels, purposeLabels })
      if (score < threshold) continue
      edges.push({ source: a.id, target: b.id, score, reasons })
      byId.get(a.id).push({ id: b.id, score, reasons })
      byId.get(b.id).push({ id: a.id, score, reasons })
    }
  }

  // 每站只留最强的 topK 条（按分数降序），再做一次对称修剪：
  // 一边留、另一边被剪掉的半条边会让图出现「单向往回连」的怪相
  const kept = new Set()
  for (const [id, arr] of byId) {
    arr.sort((x, y) => y.score - x.score)
    byId.set(id, arr.slice(0, topK))
  }
  for (const [id, arr] of byId) {
    for (const e of arr) {
      if (byId.get(e.id)?.some(x => x.id === id)) kept.add(id < e.id ? `${id}|${e.id}` : `${e.id}|${id}`)
    }
  }
  const finalEdges = edges.filter(e => kept.has(e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`))

  // 修剪后同步邻接表（避免节点还指着已被剪掉的边）
  const finalById = new Map(list.map(s => [s.id, []]))
  for (const e of finalEdges) {
    finalById.get(e.source).push({ id: e.target, score: e.score, reasons: e.reasons })
    finalById.get(e.target).push({ id: e.source, score: e.score, reasons: e.reasons })
  }
  for (const arr of finalById.values()) arr.sort((x, y) => y.score - x.score)

  return {
    nodes: list,
    edges: finalEdges,
    byId: finalById,
    concepts,
  }
}

/** 某个站点的相关站点（已按分数降序） */
export function neighborsOf(siteId, graph, n = 6) {
  return (graph?.byId?.get(siteId) || []).slice(0, n)
}

/**
 * 「与某一个站点相关的站点」—— 单点查询版。
 *
 * 与 buildAffinityGraph 的分工：那个要织整张网（300 站两两比 ≈ 4.5 万对），
 * 适合图谱页一次性建图；这里只关心「与**我**相关的有谁」，建一次特征包（O(n)）后
 * 每个站点只算一次比较，n=300 时是毫秒级。
 *
 * 注意这里**不做 topK 对称修剪**：那是「画图」的约束（防止图上糊成一团），
 * 而详情页只想知道「谁跟我最像」，被别处剪掉不该影响这里的答案。
 *
 * @returns {Array<{ site: object, id: string, score: number, reasons: string[] }>}
 */
export function relatedTo(me, sites, { threshold = DEFAULT_THRESHOLD, topN = 5, categoryLabels, purposeLabels } = {}) {
  const list = (sites || []).filter(s => s && s.id && s.id !== me?.id)
  if (!me?.id || !list.length) return []

  const featuresById = new Map([[me.id, featuresOf(me)]])
  for (const s of list) featuresById.set(s.id, featuresOf(s))

  return list
    .map(site => ({ site, id: site.id, ...affinityBetween(me, site, { featuresById, categoryLabels, purposeLabels }) }))
    .filter(r => r.score >= threshold)
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
    .slice(0, topN)
}
