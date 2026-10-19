/**
 * 站点表体检：desc 垃圾形态识别 + 自动归类一致性分析。
 *
 * ## 为什么与推断引擎分开
 *
 * site-infer 的职责是「给一个页面，推出一条站点」；这里是「给一张已有站点表，回答它健不健康」。
 * 两者的输入不同、调用方不同（前者是添加站点，后者是后台数据面板与体检脚本），
 * 混在一个文件里时，改一条垃圾描述规则要翻过 600 行推断逻辑。
 *
 * ## 两条刻意的口径边界（归类一致性）
 *
 *   · **无信号不算进分母**：规则对该站判断不了时（score<=0）直接跳过 ——
 *     准确率衡量的是「规则出手时的正确率」，而不是「对沉默也算错」。
 *   · **排除自己再比**：inferCategory 有同域/同族信号，若把自己算进参照，
 *     每个站都会命中自己而恒等，准确率永远 100%，等于没测。
 */
import { inferCategory } from './site-infer.mjs'

export const DESC_JUNK_RULES = [
  [/<\/?[a-z][^>]{0,80}>/i, 'HTML 标签残留'],
  [/&[a-z]{2,8};|&#\d{1,5};/i, 'HTML 实体未解码'],
  [/�/, '替换字符（乱码）'],
  [/^\s*(undefined|null|nan)\s*$/i, '字面 undefined / null'],
  [/(.)\1{9,}/, '连续重复字符'],
]

/** 命中的垃圾形态原因；无则 ''（空描述不算垃圾，交给内核的 descIssue 报「缺失」） */
export function descJunkReason(desc) {
  const d = String(desc ?? '')
  if (!d.trim()) return ''
  for (const [re, label] of DESC_JUNK_RULES) if (re.test(d)) return label
  return ''
}

/**
 * 从站点表里挑出 desc 命中垃圾形态的条目（后台面板与 tools 脚本共用）。
 * @param {object[]} sites
 * @returns {{ id: string, name: string, url: string, desc: string, reason: string }[]}
 */
export function auditDescJunk(sites) {
  const list = Array.isArray(sites) ? sites.filter(s => s && typeof s === 'object') : []
  const out = []
  for (const s of list) {
    const reason = descJunkReason(s.desc)
    if (reason) out.push({ id: s.id, name: s.name, url: s.url, desc: s.desc, reason })
  }
  return out
}

/* ─────────────────────────────────────────────────────────────
 * 自动归类一致性体检（F5①）
 *
 * 「准确率」的可解释口径：把每条**已有分类**的站点重新喂给 `inferCategory`
 * （与「新增站点」时同一套推断），比对推荐分类与现值。一致的算命中；不一致的列出来，
 * 就是「现存归类里可能与规则不符」的清单 —— 高频出现的偏差模式才是调规则 / 提示词的依据。
 *
 * 两条刻意的边界：
 *   · **无信号不算进分母**：规则对该站（如纯品牌名、无关键词）判断不了时（score<=0），
 *     把它算成「不命中」会凭空拉低准确率。这里直接跳过 —— 准确率衡量的是「规则出手时的正确率」。
 *   · **排除自己再比**：inferCategory 有「同域 / 同族站点」信号，若把自己也算进参照，
 *     每个站都会命中自己而恒等，准确率永远 100%，等于没测。
 * ───────────────────────────────────────────────────────────── */
export function auditCategoryConsistency(sites, { categoryMeta = {} } = {}) {
  const list = Array.isArray(sites) ? sites.filter(s => s && typeof s === 'object') : []
  const meta = categoryMeta && typeof categoryMeta === 'object' ? categoryMeta : {}

  let scored = 0          // 规则能出手的站点数（分母）
  let consistent = 0      // 其中与现值一致的（分子）
  const mismatches = []

  for (const s of list) {
    const current = String(s.categoryId || '').trim()
    if (!current) continue
    const others = list.filter(x => x.id !== s.id)
    const u = String(s.url || '')
    let host = ''
    let path = ''
    try {
      const parsed = new URL(u.includes('://') ? u : 'https://' + u)
      host = parsed.hostname
      path = parsed.pathname
    } catch { /* 地址解析不了 → 用空域名，只靠名称/描述信号 */ }
    const rec = inferCategory({ name: s.name, desc: s.desc, domain: host, path }, others, meta, { fallback: '' })
    if (!(rec.score > 0)) continue   // 规则无信号，不计入分母
    scored++
    if (rec.categoryId === current) consistent++
    else mismatches.push({
      id: s.id, name: s.name, url: s.url,
      current, recommended: rec.categoryId,
      confidence: rec.confidence, reasons: rec.reasons,
    })
  }

  const rate = scored ? consistent / scored : 1
  // 高频偏差：按「现值 → 推荐值」聚合，供「先看哪类系统性判错」排序
  const pattern = new Map()
  for (const m of mismatches) {
    const k = `${m.current} → ${m.recommended}`
    pattern.set(k, (pattern.get(k) || 0) + 1)
  }
  const topPatterns = [...pattern.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([pair, count]) => ({ pair, count }))

  return { scored, consistent, rate, mismatches, topPatterns }
}