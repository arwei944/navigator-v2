/**
 * 站点草稿 → 入库对象：站内搜索栏的「自动添加」管道与「添加站点」弹窗共用。
 *
 * 两边必须用同一把尺子判断「这个域名是否已收录」、用同一段代码组装站点对象，
 * 否则会出现搜索栏说没收录、弹窗却拦下来说重复的死路。
 *
 * 只允许相对路径导入：tools/console 下的纯 node 测试要直接加载本模块。
 */

import { hostOf, looksLikeUrl } from './url.js'
import { normalizePurposes } from '../../shared/purposes.mjs'

/** 自动添加被拦下的原因码 */
export const AUTO_ADD_REASON = {
  INVALID_URL: 'invalid-url',
  DUPLICATE: 'duplicate',
  FETCH_FAILED: 'fetch-failed',
  LOW_CONFIDENCE: 'low-confidence',
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

/** 元数据响应 → 表单草稿。自动添加无人工干预，故不做 touched 判断，直接取识别结果 */
export function draftFromMeta(meta) {
  const m = meta || {}
  return {
    form: {
      name: m.name || '',
      url: m.domain || '',
      desc: m.desc || '',
      categoryId: m.categoryId || '',
      color: m.color || '#3b82f6',
      aliases: '',
      purposes: normalizePurposes(m.purposes),
    },
    faviconUrl: m.faviconUrl || m.favicon || '',
    faviconHost: String(m.domain || '').toLowerCase(),
  }
}

/** 发请求前的把关：网址不成立 / 同域已收录 → 直接拦下，不必联网 */
export function preflightOf({ url, duplicate }) {
  if (!looksLikeUrl(url)) {
    return { reason: AUTO_ADD_REASON.INVALID_URL, message: '没能识别出有效网址，请检查后重试。' }
  }
  if (duplicate) {
    return {
      reason: AUTO_ADD_REASON.DUPLICATE,
      message: `该域名已收录：${duplicate.name}（${duplicate.url}）。如需变更请编辑该站点。`,
    }
  }
  return null
}

/** 抓取结果的把关：抓不到 / 站名不可信 → 不自动入库，交回人工确认 */
export function metaGuardrailOf({ meta }) {
  if (!meta) {
    return { reason: AUTO_ADD_REASON.FETCH_FAILED, message: '抓取站点信息失败，请手动确认后再添加。' }
  }
  const name = String(meta.name || '').trim()
  if (!name || meta?.confidence?.name === 'low') {
    return { reason: AUTO_ADD_REASON.LOW_CONFIDENCE, message: '没能可靠识别站点名称，请手动确认后再添加。' }
  }
  return null
}
