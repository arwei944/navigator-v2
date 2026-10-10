/**
 * 场景感知排序：算出「此刻你最可能要打开的那几个站」。
 *
 * ## 信号从哪来（全是本地已有的，不新增采集）
 *
 *   1. 时段偏好：把一天切成 4 段，统计每段里你打开过哪些**分类**的站。
 *      「晚上常开 AI 对话、白天常看行情」这种规律，靠最近的访问记录就能看出来。
 *   2. 个人频次（带衰减）：`site.visitCount` 是你这台设备上的累计访问次数，
 *      再乘一个半衰期 7 天的衰减 —— 上个月天天开的站不该永远压在今天刚发现的站上面。
 *   3. 会话共现：5 分钟窗口内先后打开过的站点互为关联。你刚开了 A，那和 A 常一起
 *      打开的 B 就值得出现在眼前。
 *
 * ## 为什么每个结果都要带 reason
 *
 * 推荐最怕「莫名其妙」。用户看到一条不认识的站被推到面前，第一反应是这功能有毛病。
 * 所以每条都给一条人话理由（「你常在晚上打开」「与 X 一起用过」），并且**整条可以关掉**。
 *
 * 纯函数、零依赖，可单测（tools/console/test-intent.js 覆盖）。
 */

/** 一天的四个时段。切分点按作息常识，不做用户自适应 —— 样本太小，自适应只会有噪声 */
const SLOTS = [
  { id: 'morning', from: 5, to: 11, label: '早上' },
  { id: 'afternoon', from: 11, to: 14, label: '中午' },
  { id: 'evening', from: 14, to: 19, label: '下午' },
  { id: 'night', from: 19, to: 5, label: '晚上' }
]

export const SLOT_LABELS = Object.fromEntries(SLOTS.map(s => [s.id, s.label]))

/** 权重：时段是「此刻」的信号，频次是「长期」的信号，共现补临场关联 */
const W = { slot: 0.45, freq: 0.35, cooccur: 0.2 }

/** 半衰期 7 天：7 天前的一次访问只算半次，14 天前算四分之一 */
const HALF_LIFE_MS = 7 * 24 * 3600 * 1000

/** 共现窗口：同一次使用里先后打开的站才算「一起用过」 */
const CO_OCCUR_MS = 5 * 60 * 1000

export function slotOf(date = new Date()) {
  const h = date.getHours()
  for (const s of SLOTS) {
    if (s.from <= s.to) {
      if (h >= s.from && h < s.to) return s.id
    } else {
      // 跨零点（晚上 19:00 → 次日 05:00）
      if (h >= s.from || h < s.to) return s.id
    }
  }
  return 'evening'
}

/** 衰减系数：0..1，越久越小 */
export function decay(ts, now = Date.now()) {
  const t = typeof ts === 'number' ? ts : new Date(ts).getTime()
  if (!Number.isFinite(t)) return 0
  const age = Math.max(0, now - t)
  return Math.pow(0.5, age / HALF_LIFE_MS)
}

/**
 * 从访问记录里提炼三类信号。
 *
 * @param {Array} records history.records：[{siteId, timestamp}]，**最新在前**
 * @param {Array} sites 站点表（提供 categoryId）
 */
export function buildSignals(records = [], sites = []) {
  const byId = new Map(sites.map(s => [s.id, s]))
  const catOf = (id) => byId.get(id)?.categoryId || ''

  // 时段 → 分类 → 加权次数（近的记录权重更高）
  const slotCat = {}
  // 站点 → 最近一次访问时间（用于衰减）
  const lastVisit = {}
  // 站点对共现次数
  const pairs = new Map()

  const list = Array.isArray(records) ? records.slice() : []
  const sorted = list
    .map(r => ({ ...r, ts: Number(r.timestamp) || 0 }))
    .filter(r => r.ts > 0)
    .sort((a, b) => a.ts - b.ts)

  for (const r of sorted) {
    const cat = catOf(r.siteId)
    if (cat) {
      const slot = slotOf(new Date(r.ts))
      if (!slotCat[slot]) slotCat[slot] = {}
      slotCat[slot][cat] = (slotCat[slot][cat] || 0) + 1
    }
    lastVisit[r.siteId] = Math.max(lastVisit[r.siteId] || 0, r.ts)
  }

  for (let i = 0; i < sorted.length - 1; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const gap = sorted[j].ts - sorted[i].ts
      if (gap > CO_OCCUR_MS) break // 已排序，后面只会更远
      const key = pairKey(sorted[i].siteId, sorted[j].siteId)
      pairs.set(key, (pairs.get(key) || 0) + 1)
    }
  }

  return { slotCat, lastVisit, pairs, catOf }
}

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * 给一组站点打分。
 *
 * @param {Array} sites 候选站点（含 id / categoryId / visitCount）
 * @param {object} signals buildSignals 的结果
 * @param {object} [opts] now、clicks（全局热度，冷启动兜底）、recentId（刚打开的站）、
 *                       categoryLabels（分类 id → 中文名，用于理由文案）
 * @returns {Array<{site, score, reason}>} 已按分数降序
 */
export function rankSites(sites = [], signals, opts = {}) {
  const now = opts.now || Date.now()
  const clicks = opts.clicks || {}
  const slot = slotOf(new Date(now))
  const { slotCat = {}, lastVisit = {}, pairs = new Map(), catOf = () => '' } = signals || {}

  // 当前时段下各分类的归一化权重
  const catWeight = normalize(slotCat[slot] || {})
  // 个人频次的归一化基准：取最大值，避免「点了 100 次的站」把其余全压成 0
  let maxVisits = 1
  for (const s of sites) maxVisits = Math.max(maxVisits, Number(s.visitCount) || 0)

  // 共现：以「最近打开过的站」为锚，找出与它常一起出现的站
  const anchor = opts.recentId || mostRecent(lastVisit)
  const cooccur = new Map()
  if (anchor) {
    for (const [key, n] of pairs) {
      const [a, b] = key.split('|')
      if (a !== anchor && b !== anchor) continue
      const other = a === anchor ? b : a
      cooccur.set(other, (cooccur.get(other) || 0) + n)
    }
  }
  const maxCo = Math.max(1, ...cooccur.values())
  const anchorName = opts.anchorName || ''

  const out = []
  for (const s of sites) {
    const cat = s.categoryId || ''
    const slotScore = catWeight[cat] || 0

    const visits = Number(s.visitCount) || 0
    const freqRaw = (visits / maxVisits) * (0.4 + 0.6 * decay(lastVisit[s.id], now))
    // 没访问过但有全局热度时用热度补一点，避免冷启动一片空白
    const hotScore = visits === 0 ? Math.min(1, (Number(clicks[s.id]) || 0) / 500) * 0.3 : 0
    const freqScore = Math.min(1, freqRaw + hotScore)

    const coScore = cooccur.has(s.id) ? (cooccur.get(s.id) / maxCo) : 0

    const score = W.slot * slotScore + W.freq * freqScore + W.cooccur * coScore
    if (score <= 0.02) continue
    const catLabel = (opts.categoryLabels && opts.categoryLabels[cat]) || cat || '这个方向'
    out.push({
      site: s,
      score,
      reason: reasonOf({ slotScore, freqScore, coScore, visits, catLabel, slot, anchorName })
    })
  }

  out.sort((a, b) => b.score - a.score)
  return out
}

function normalize(map) {
  const vals = Object.values(map)
  const max = Math.max(1, ...vals)
  const out = {}
  for (const [k, v] of Object.entries(map)) out[k] = v / max
  return out
}

function mostRecent(lastVisit) {
  let best = null
  let bestTs = 0
  for (const [id, ts] of Object.entries(lastVisit)) {
    if (ts > bestTs) { bestTs = ts; best = id }
  }
  return best
}

/** 取占比最大的那个分项作为理由 —— 一条理由比三个分数更能让人信服 */
function reasonOf({ slotScore, freqScore, coScore, visits, catLabel, slot, anchorName }) {
  const top = Math.max(slotScore, freqScore, coScore)
  if (top === coScore && coScore > 0) {
    return anchorName ? `与「${anchorName}」一起用过` : '和最近打开的站常一起用'
  }
  if (top === freqScore && freqScore > 0) {
    if (visits > 0) return visits >= 5 ? `你打开过 ${visits} 次` : '最近打开过'
    return '大家都在用'
  }
  if (top === slotScore && slotScore > 0) {
    return `${SLOT_LABELS[slot] || '此刻'}常看「${catLabel}」这类站`
  }
  return '可能用得上'
}

/** 冷启动判据：没有访问记录时推荐无从谈起，交给调用方降级 */
export function hasSignal(signals) {
  if (!signals) return false
  return Object.keys(signals.lastVisit || {}).length > 0 || (signals.pairs?.size || 0) > 0
}
