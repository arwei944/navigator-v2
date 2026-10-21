/**
 * 阶段 1 的文本处理纯函数：语言检测、分词、TF-IDF、聚类、热度、规则简报。
 *
 * ## 为什么不用 BERTopic / 向量库
 *
 * 本地 30 天、每天几百条，最近 72 小时通常 100–500 条。这个规模下
 * TF-IDF + 余弦 + 并查集完全够用，而且：
 *   - 零模型下载、零 GPU；
 *   - 结果可解释（能说清为什么两条被合并）；
 *   - 不需要 Python sidecar。
 *
 * 阶段 2 若发现召回不足，再引入 embedding；接口保持不变。
 */

const EN_STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'to', 'of', 'in', 'on', 'for', 'with',
  'by', 'from', 'as', 'at', 'it', 'its', 'we', 'you', 'they', 'he', 'she', 'i', 'not', 'no',
  'has', 'have', 'had', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'about',
  'into', 'over', 'after', 'before', 'more', 'most', 'new', 'says', 'said', 'what', 'how',
])

const ZH_STOP = new Set([
  '的', '了', '在', '是', '和', '与', '对', '为', '等', '被', '把', '从', '到', '中', '上',
  '下', '个', '我', '你', '他', '她', '它', '们', '这', '那', '有', '也', '就', '都', '而',
  '及', '或', '一个', '我们', '他们', '可以', '已经', '进行', '通过', '对于', '以及',
])

/**
 * 聚类前清洗：去掉来源模板。
 *
 * HN 的摘要曾是「Hacker News · 214 分 · 112 条评论」、Product Hunt 是
 * 「Discussion | Link」——这些词在几十条里完全一样，会让 TF-IDF 把毫不相关
 * 的条目连成一个巨型事件（实测 14 条不同 HN 故事被合并）。
 */
export function cleanForCluster(text) {
  return String(text || '')
    .replace(/Hacker News\s*·\s*\d+\s*分\s*·\s*\d+\s*条评论/gi, ' ')
    .replace(/(Discussion|Link)\s*\|\s*(Discussion|Link)/gi, ' ')
    .replace(/\b(?:Discussion|Link)\b/gi, ' ')
}

/** CJK 字符占比 > 0.25 视为中文内容 */
export function isMostlyChinese(text) {
  const value = String(text || '')
  if (!value) return false
  const cjk = (value.match(/[㐀-鿿]/g) || []).length
  const letters = (value.match(/[\p{L}\p{N}]/gu) || []).length || 1
  return cjk / letters > 0.25
}

/**
 * 分词：英文按词（≥2 字符，去停用词），中文按 2-gram。
 * 返回 token 数组（保留重复，供 TF 统计）。
 */
export function tokenize(text) {
  const value = String(text || '').toLowerCase()
  const tokens = []
  for (const m of value.matchAll(/[a-z][a-z0-9+#.-]{1,30}/g)) {
    const word = m[0].replace(/[.-]+$/, '')
    if (word.length >= 2 && !EN_STOP.has(word)) tokens.push(word)
  }
  const cjk = value.match(/[㐀-鿿]+/g) || []
  for (const run of cjk) {
    if (run.length === 1) {
      if (!ZH_STOP.has(run)) tokens.push(run)
      continue
    }
    for (let i = 0; i < run.length - 1; i += 1) {
      const gram = run.slice(i, i + 2)
      if (!ZH_STOP.has(gram)) tokens.push(gram)
    }
  }
  return tokens
}

/** 文档向量：TF-IDF（返回稀疏 Map） */
export function buildTfidf(docs, { maxTerms = 4000 } = {}) {
  // 标题重复两次 = 加权：摘要只作为补充，避免通用模板词主导相似度
  const tokenized = docs.map(d => {
    const title = cleanForCluster(d.title)
    const summary = cleanForCluster(d.summary)
    return tokenize(`${title} ${title} ${summary}`)
  })
  const df = new Map()
  for (const tokens of tokenized) {
    for (const token of new Set(tokens)) df.set(token, (df.get(token) || 0) + 1)
  }
  const total = Math.max(1, docs.length)
  const terms = [...df.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTerms)
    .map(([token]) => token)
  const termSet = new Set(terms)
  const idf = new Map(terms.map(t => [t, Math.log((total + 1) / ((df.get(t) || 0) + 1)) + 1]))

  const vectors = tokenized.map(tokens => {
    const tf = new Map()
    for (const token of tokens) {
      if (!termSet.has(token)) continue
      tf.set(token, (tf.get(token) || 0) + 1)
    }
    const vec = new Map()
    let norm = 0
    for (const [token, count] of tf) {
      const w = (1 + Math.log(count)) * (idf.get(token) || 1)
      vec.set(token, w)
      norm += w * w
    }
    norm = Math.sqrt(norm) || 1
    for (const [token, w] of vec) vec.set(token, w / norm)
    return vec
  })
  return { vectors, idf }
}

export function cosine(a, b) {
  if (!a || !b) return 0
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let sum = 0
  for (const [token, w] of small) {
    const other = large.get(token)
    if (other) sum += w * other
  }
  return sum
}

function unionFind(n) {
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = x => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  const union = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }
  return { find, union }
}

/**
 * 聚类：TF-IDF + 余弦 + 并查集。
 *
 * 候选对用倒排索引（共享 token）剪枝，避免 n² 全量比较；
 * 出现频率过高的 token（> maxPostings）跳过，否则一个 "ai" 就能连起全站。
 *
 * @param {{id:string,title:string,summary:string,publishedAt:number}[]} docs
 * @param {{threshold?:number,minSize?:number,maxDocs?:number,maxPostings?:number}} [opts]
 * @returns {{members:object[], firstSeen:number, lastSeen:number}[]}
 */
export function clusterDocuments(docs, { threshold = 0.55, minSize = 2, maxDocs = 500, maxPostings = 60 } = {}) {
  const list = [...(Array.isArray(docs) ? docs : [])]
    .sort((a, b) => (Number(b.publishedAt) || 0) - (Number(a.publishedAt) || 0))
    .slice(0, maxDocs)
  if (list.length < 2) return []

  const { vectors } = buildTfidf(list)
  const postings = new Map()
  vectors.forEach((vec, index) => {
    for (const token of vec.keys()) {
      if (!postings.has(token)) postings.set(token, [])
      postings.get(token).push(index)
    }
  })

  const pairs = new Map() // `${i}:${j}` -> similarity
  for (const indexes of postings.values()) {
    if (indexes.length < 2 || indexes.length > maxPostings) continue
    for (let a = 0; a < indexes.length; a += 1) {
      for (let b = a + 1; b < indexes.length; b += 1) {
        const i = indexes[a]
        const j = indexes[b]
        const key = `${i}:${j}`
        if (pairs.has(key)) continue
        const sim = cosine(vectors[i], vectors[j])
        if (sim >= threshold) pairs.set(key, sim)
      }
    }
  }

  const uf = unionFind(list.length)
  for (const key of pairs.keys()) {
    const [i, j] = key.split(':').map(Number)
    uf.union(i, j)
  }

  const groups = new Map()
  for (let i = 0; i < list.length; i += 1) {
    const root = uf.find(i)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(i)
  }

  return [...groups.values()]
    .filter(indexes => indexes.length >= minSize)
    .map(indexes => {
      const members = indexes.map(i => list[i])
      const times = members.map(m => Number(m.publishedAt) || 0)
      return { members, firstSeen: Math.min(...times), lastSeen: Math.max(...times) }
    })
    .sort((a, b) => b.members.length - a.members.length)
}

/** 热度：规模、来源数、来源权重、时间衰减 */
export function heatScore({ size = 1, sources = 1, weight = 1, latestAt = Date.now(), now = Date.now() } = {}) {
  const ageHours = Math.max(0, (now - (Number(latestAt) || now)) / 3600000)
  return (size * 1.0 + sources * 1.5 + weight) / Math.pow(ageHours + 2, 0.8)
}

const DOMAIN_LABEL = {
  'ai-work': 'AI',
  research: '研究',
  onchain: '链上',
  infra: '工具 / 基础设施',
}

/** 事件代表标题：优先中文，取簇内最新一条 */
export function eventTitle(cluster) {
  const members = cluster?.members || []
  const sorted = [...members].sort((a, b) => (Number(b.publishedAt) || 0) - (Number(a.publishedAt) || 0))
  const top = sorted.find(m => m.summaryZh) || sorted[0] || {}
  return String(top.titleZh || top.title || '未命名事件').slice(0, 180)
}

export function eventSummary(cluster, { max = 500 } = {}) {
  const members = cluster?.members || []
  const parts = []
  for (const m of members) {
    const text = String(m.summaryZh || m.summary || '').trim()
    if (text && !parts.includes(text)) parts.push(text)
    if (parts.join(' ').length >= max) break
  }
  return parts.join(' ').slice(0, max)
}

/** 规则简报（LLM 不可用时的降级）：按领域列出 Top 事件与链接 */
export function ruleDigest({ events = [], entries = [], date = '', domainLabel = DOMAIN_LABEL } = {}) {
  const lines = [`# 领域动态简报 · ${date}`, '']
  if (events.length) {
    const byDomain = new Map()
    for (const e of events) {
      const key = e.domain || 'ai-work'
      if (!byDomain.has(key)) byDomain.set(key, [])
      byDomain.get(key).push(e)
    }
    for (const [domain, list] of byDomain) {
      lines.push(`## ${domainLabel[domain] || domain}`)
      for (const e of list.slice(0, 5)) {
        lines.push(`- **${e.title}**（${e.sourceCount} 个来源）`)
        if (e.summary) lines.push(`  ${e.summary.slice(0, 180)}`)
        const link = e.primaryUrl || (e.entries?.[0]?.url || '')
        if (link) lines.push(`  ${link}`)
      }
      lines.push('')
    }
  } else {
    lines.push('## 今日要闻')
    for (const item of entries.slice(0, 12)) {
      lines.push(`- **${item.titleZh || item.title}**${item.sourceId ? `（${item.sourceId}）` : ''}`)
      if (item.url) lines.push(`  ${item.url}`)
    }
    lines.push('')
  }
  lines.push('> 本简报由规则汇总生成（未配置 LLM 或调用失败）。')
  return lines.join('\n')
}

/** 从 LLM 输出中提取 JSON（容忍 ```json 代码块与前后说明） */
export function parseJsonLoose(text) {
  const raw = String(text || '').trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : raw
  try { return JSON.parse(candidate) } catch { /* 继续尝试截取 */ }
  const first = candidate.search(/[[{]/)
  const last = Math.max(candidate.lastIndexOf(']'), candidate.lastIndexOf('}'))
  if (first >= 0 && last > first) {
    try { return JSON.parse(candidate.slice(first, last + 1)) } catch { /* 放弃 */ }
  }
  return null
}