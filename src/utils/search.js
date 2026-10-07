import Fuse from 'fuse.js'
import { pinyin } from 'pinyin-pro'
import { purposeLabel } from '../../shared/purposes.mjs'

/**
 * 站点检索内核：页面搜索框与命令面板共用同一套评分与排序，
 * 避免「同一关键词两处结果不同」。纯函数，不依赖 Pinia。
 *
 * 评分分档（越高越靠前）：
 *   名称精确 > 别名精确 > 名称前缀 > 别名前缀 > 名称包含 > 别名包含
 *   > 域名包含 > 用途命中 > 描述包含 > 拼音首字母前缀 > 别名拼音首字母前缀
 *   > 拼音名包含 > 别名拼音包含 > 拼音描述包含
 * 别名是站点的「另一个叫法」（币安 / 小狐狸 / 抱抱脸），因此排在主名称
 * 同名档位之后、域名与描述之前——既让俗称找得到，又不喧宾夺主。
 * 全部未命中时退化为 Fuse 模糊匹配，容忍拼写错误。
 */

const keyCache = new WeakMap()

function keysOf(site) {
  let k = keyCache.get(site)
  if (k) return k
  const name = String(site?.name ?? '')
  const desc = String(site?.desc ?? '')
  const aliases = Array.isArray(site?.aliases) ? site.aliases.map(a => String(a ?? '')) : []
  // 用途既能按中文标签（查资料）也能按英文 id（reference）命中，两种写法拼成一段可搜文本
  const purposes = (Array.isArray(site?.purposes) ? site.purposes : []).map(p => String(p ?? ''))
  k = {
    name: name.toLowerCase(),
    desc: desc.toLowerCase(),
    url: String(site?.url ?? '').toLowerCase(),
    aliases: aliases.map(a => a.toLowerCase()),
    purposes: purposes.map(p => p.toLowerCase()),
    purposeText: purposes.map(p => purposeLabel(p)).filter(Boolean).join(' ').toLowerCase(),
    pyName: pinyin(name, { toneType: 'none', separator: '' }).toLowerCase(),
    pyInitial: pinyin(name, { pattern: 'first', toneType: 'none', separator: '' }).toLowerCase(),
    pyDesc: pinyin(desc, { toneType: 'none', separator: '' }).toLowerCase(),
    pyAliases: aliases.map(a => pinyin(a, { toneType: 'none', separator: '' }).toLowerCase()),
    pyAliasInitial: aliases.map(a => pinyin(a, { pattern: 'first', toneType: 'none', separator: '' }).toLowerCase())
  }
  keyCache.set(site, k)
  return k
}

export const SCORE = {
  NAME_EXACT: 1000,
  ALIAS_EXACT: 940,
  NAME_PREFIX: 820,
  ALIAS_PREFIX: 760,
  NAME_INCLUDES: 640,
  ALIAS_INCLUDES: 580,
  URL_INCLUDES: 520,
  PURPOSE_INCLUDES: 500,
  DESC_INCLUDES: 440,
  PY_INITIAL_PREFIX: 400,
  PY_ALIAS_INITIAL_PREFIX: 380,
  PY_NAME_INCLUDES: 340,
  PY_ALIAS_INCLUDES: 320,
  PY_DESC_INCLUDES: 200
}

const anyStarts = (arr, q) => arr.some(a => a.startsWith(q))
const anyIncludes = (arr, q) => arr.some(a => a.includes(q))

export function scoreSite(site, q) {
  if (!q) return 0
  const k = keysOf(site)
  if (k.name === q) return SCORE.NAME_EXACT
  if (k.aliases.includes(q)) return SCORE.ALIAS_EXACT
  if (k.name.startsWith(q)) return SCORE.NAME_PREFIX
  if (anyStarts(k.aliases, q)) return SCORE.ALIAS_PREFIX
  if (k.name.includes(q)) return SCORE.NAME_INCLUDES
  if (anyIncludes(k.aliases, q)) return SCORE.ALIAS_INCLUDES
  if (k.url.includes(q)) return SCORE.URL_INCLUDES
  // 用途是受控词表，命中即「这条站就是干这个的」，比描述里的顺带提及更可信，故排在描述之前
  if (anyIncludes(k.purposes, q) || k.purposeText.includes(q)) return SCORE.PURPOSE_INCLUDES
  if (k.desc.includes(q)) return SCORE.DESC_INCLUDES
  if (k.pyInitial.startsWith(q)) return SCORE.PY_INITIAL_PREFIX
  if (anyStarts(k.pyAliasInitial, q)) return SCORE.PY_ALIAS_INITIAL_PREFIX
  if (k.pyName.includes(q)) return SCORE.PY_NAME_INCLUDES
  if (anyIncludes(k.pyAliases, q)) return SCORE.PY_ALIAS_INCLUDES
  if (k.pyDesc.includes(q)) return SCORE.PY_DESC_INCLUDES
  return 0
}

function fuzzySites(sites, q) {
  try {
    const fuse = new Fuse(sites, {
      keys: [
        { name: 'name', weight: 2 },
        { name: 'aliases', weight: 1.6 },
        { name: 'desc', weight: 1 },
        { name: 'url', weight: 1 }
      ],
      threshold: 0.4,
      includeScore: true
    })
    return fuse.search(q).map(r => r.item)
  } catch {
    return []
  }
}

/**
 * 按相关性返回排序后的站点数组；query 为空时返回空数组。
 * tieBreak 仅用于同一评分档位内部的先后（稳定排序不会跨档乱序），
 * 因此「切换排序方式」不会推翻相关性。
 */
export function rankSites(sites, query, { limit, tieBreak } = {}) {
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return []
  const scored = []
  for (const s of sites) {
    const score = scoreSite(s, q)
    if (score > 0) scored.push({ site: s, score })
  }
  let out
  if (scored.length) {
    scored.sort((a, b) => (b.score - a.score) || (tieBreak ? tieBreak(a.site, b.site) : 0))
    out = scored.map(x => x.site)
  } else {
    // 模糊兜底已按 Fuse 自身评分排序，不再叠加 tieBreak 以免打乱
    out = fuzzySites(sites, q)
  }
  return typeof limit === 'number' ? out.slice(0, limit) : out
}

/**
 * 返回命中的别名（含拼音 / 拼音首字母命中），用于在结果里解释
 * 「这条为什么会出现」。命中优先级与评分一致：精确 > 前缀 > 包含 > 拼音。
 * 无命中返回 ''。
 */
export function matchedAlias(site, query) {
  const q = String(query ?? '').trim().toLowerCase()
  const aliases = Array.isArray(site?.aliases) ? site.aliases : []
  if (!q || !aliases.length) return ''
  const lower = aliases.map(a => String(a ?? '').toLowerCase())
  let i = lower.indexOf(q)
  if (i === -1) i = lower.findIndex(a => a && a.startsWith(q))
  if (i === -1) i = lower.findIndex(a => a && a.includes(q))
  if (i === -1) i = lower.findIndex(a => a && pinyin(a, { toneType: 'none', separator: '' }).toLowerCase().includes(q))
  if (i === -1) i = lower.findIndex(a => a && pinyin(a, { pattern: 'first', toneType: 'none', separator: '' }).toLowerCase().startsWith(q))
  return i === -1 ? '' : aliases[i]
}

/** 把 text 按 query 切成分段，供模板用 <mark> 渲染，替代 v-html。 */
export function splitHighlight(text, query) {
  const src = String(text ?? '')
  const q = String(query ?? '').trim()
  if (!q) return [{ text: src, hit: false }]
  const lower = src.toLowerCase()
  const needle = q.toLowerCase()
  const parts = []
  let i = 0
  for (;;) {
    const at = lower.indexOf(needle, i)
    if (at === -1) {
      if (i < src.length) parts.push({ text: src.slice(i), hit: false })
      break
    }
    if (at > i) parts.push({ text: src.slice(i, at), hit: false })
    parts.push({ text: src.slice(at, at + needle.length), hit: true })
    i = at + needle.length
  }
  return parts.length ? parts : [{ text: src, hit: false }]
}