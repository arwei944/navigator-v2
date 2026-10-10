/**
 * 站点草稿 → 入库对象：站内搜索栏的「自动添加」管道与「添加站点」弹窗共用。
 *
 * 两边必须用同一把尺子判断「这个域名是否已收录」、用同一段代码组装站点对象，
 * 否则会出现搜索栏说没收录、弹窗却拦下来说重复的死路。
 *
 * 抓取失败与站名低置信在自动路径上不拦人，统一走域名兜底（fallbackDraftFromMeta）。
 * 只允许相对路径导入：tools/console 下的纯 node 测试要直接加载本模块。
 */

import { hostOf, looksLikeUrl } from './url.js'
import { normalizePurposes } from '../../shared/purposes.mjs'
// hashColor 单独从拆出来的小模块拿：从 site-infer 引会把整个 700 行推断引擎拖进首屏
// （它虽被 tree-shaking，但只要 site-infer 同时被别处动态 import，rollup 就会整模块提升）
import { hashColor } from '../../shared/hash-color.mjs'

/** 自动添加被拦下的原因码。抓取失败与站名低置信已改为域名兜底照常入库，故退役。 */
export const AUTO_ADD_REASON = {
  INVALID_URL: 'invalid-url',
  DUPLICATE: 'duplicate',
  WRITE_FAILED: 'write-failed',
}

/** 无品牌色时按域名派生稳定色：同一域名每次一致，不同域名不会撞成一片 */
export function colorFromHost(domain) {
  return hashColor(domain)
}

/** 存放用的主机名：去协议、去路径，保留用户输入的大小写与 www */
export function rawHostOf(raw) {
  return String(raw ?? '').replace(/^https?:\/\//i, '').split('/')[0]
}

/** 去重判据用的域名：小写、去 www */
export function domainOf(raw) {
  return rawHostOf(raw).toLowerCase().replace(/^www\./, '')
}

/** 别名入参归一：接受逗号 / 顿号 / 换行分隔；去重，并剔除与站名 / 域名同形的项 */
export function parseAliases(raw, name, host) {
  const nameLower = String(name || '').trim().toLowerCase()
  const out = []
  const seen = new Set()
  for (const part of String(raw || '').split(/[,，、\n]/)) {
    const a = part.trim()
    if (!a) continue
    const lower = a.toLowerCase()
    if (seen.has(lower) || lower === nameLower || lower === host) continue
    seen.add(lower)
    out.push(a)
  }
  return out
}

/** 列表里是否已收录同域站点；域名解析不出时一律视为不重复 */
export function findDuplicate(sites, url) {
  const domain = domainOf(url)
  if (!domain) return null
  return (sites || []).find(s => hostOf(s.url) === domain) || null
}

/**
 * 草稿 → 站点对象。三条规则与既有弹窗完全一致，不得改动：
 * 1) url 存去协议去路径的主机名（保留大小写与 www）；
 * 2) initial 取站名首字符大写；
 * 3) 图标只在「抓取来源域名 === 本站去重域名」时写入，宁可回落字母块也不挂错图。
 */
export function buildSiteFromDraft({ form, faviconUrl = '', faviconHost = '' }) {
  const rawDomain = rawHostOf(form.url)
  const domain = domainOf(form.url)

  const site = {
    name: form.name,
    url: rawDomain,
    desc: form.desc,
    categoryId: form.categoryId,
    color: form.color,
    initial: String(form.name || '').charAt(0).toUpperCase(),
  }
  if (/^https?:\/\//i.test(faviconUrl) && String(faviconHost).toLowerCase() === domain) {
    site.iconUrl = faviconUrl
  }
  const aliases = parseAliases(form.aliases, form.name, domain)
  if (aliases.length) site.aliases = aliases
  const purposes = normalizePurposes(form.purposes)
  if (purposes.length) site.purposes = purposes

  return { site, domain }
}

/**
 * 站点草稿：抓到了就用元数据，抓不到 / 站名不可靠就用域名兜底 —— 自动添加不再退回人工。
 * `categoryId` 由调用方（autoAdd）经分类决策解析后传入，本函数不猜分类。
 */
export function fallbackDraftFromMeta({ url, meta = null, categoryId = '' }) {
  const m = meta || {}
  const rawName = String(m.name || '').trim()
  // 站名不可靠 = 没抓到名字，或抓到的是「按域名拼的」低置信结果 → 一律退回域名兜底
  const nameReliable = Boolean(rawName) && m?.confidence?.name !== 'low'

  return {
    form: {
      name: nameReliable ? rawName : rawHostOf(url),
      url: String(m.domain || '').trim() || rawHostOf(url),
      desc: m.desc || '',
      categoryId,
      color: m.color || colorFromHost(domainOf(url)),
      aliases: '',
      purposes: normalizePurposes(m.purposes),
    },
    faviconUrl: m.faviconUrl || m.favicon || '',
    faviconHost: String(m.domain || '').toLowerCase(),
  }
}

/** 发请求前的把关：网址不成立就直接拦下，不必联网。重复判据见 autoAdd 里的 findDuplicate */
export function preflightOf({ url }) {
  if (!looksLikeUrl(url)) {
    return { reason: AUTO_ADD_REASON.INVALID_URL, message: '没能识别出有效网址，请检查后重试。' }
  }
  return null
}
