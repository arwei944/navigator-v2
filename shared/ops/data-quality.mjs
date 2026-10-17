/**
 * 站点数据质量体检（F1）—— 脚本与后台面板**共用同一份判据**。
 *
 * ## 为什么单独一个模块
 *
 * 「重复 host / 缺 icon / 描述没质量」这几类问题，以前散在三处各查一半：
 *   · `site-ops.checkIntegrity` 只查 missingIcon 与 dupSortOrder；
 *   · `scripts/validate-data.mjs` 查 schema（字段在不在、分类认不认），但不查「描述有没有用」；
 *   · `validateSite` 只在**单站**新增 / 编辑时拦重复 host，查不了「库里已经存在的重复」。
 * 判据一旦分头实现就会漂移（这项目在 hostOf 上已经吃过一次亏）。
 * 这里收敛成唯一的内核：CLI 体检与后台「数据质量」面板都调 `auditSites`。
 *
 * ## 关键区分：真重复 vs 同站多入口（这是本模块最容易做错的地方）
 *
 * `hostOf` 只取 hostname、丢掉路径，所以 `github.com/copilot` 与 `github.com/trending`
 * 会被算成「同一个 host」—— 但它们**是两个不同产品页，都该收录**，盲目合并等于误删。
 * 因此这里分成两类，绝不混为一谈：
 *   · `duplicateUrls` —— 规范化 URL **完全相同**，是真重复，建议合并；
 *   · `sameHostGroups` —— host 相同但 URL 不同，是同站多入口，**只提示、不建议自动合并**，
 *     是否合并由人判断（面板逐组给「保留哪条」的选择）。
 *
 * ## 判据的克制
 *
 * 只报客观可判定的问题，不做主观审美。「描述写得不够好」交给 AI 能力（F5）去建议。
 */
import { hostOf } from '../host.mjs'
import { checkIntegrity } from './site-ops.mjs'

/** 占位型描述：看着有值，其实没信息 */
const PLACEHOLDER_DESC = /^(暂无|待补|无|不详|todo|n\/?a|-{1,})$/i

/** 描述默认最短长度：低于此视为「太短，不足以说明这是什么站」 */
export const MIN_DESC_LEN = 8

/**
 * 单条描述的质量问题。
 * @returns {'' | 'missing' | 'too-short' | 'same-as-name' | 'placeholder'}
 */
export function descIssue(site, minLen = MIN_DESC_LEN) {
  const desc = String(site?.desc ?? '').trim()
  const name = String(site?.name ?? '').trim()
  if (!desc) return 'missing'
  // 占位词先于「过短」判定：'暂无' 的问题是「没信息」而非「字数少」
  if (PLACEHOLDER_DESC.test(desc)) return 'placeholder'
  if (desc.length < minLen) return 'too-short'
  if (name && desc.toLowerCase() === name.toLowerCase()) return 'same-as-name'
  return ''
}

/** 把描述问题码翻成给面板看的中文说明 */
export const DESC_ISSUE_LABEL = {
  missing: '描述为空',
  'too-short': '描述过短',
  'same-as-name': '描述与站名雷同',
  placeholder: '描述是占位词',
}

/**
 * 完整 URL 规范化（**保留路径**）：去 `www.` / 统一小写 host / 去尾斜杠与查询锚点。
 *
 * 为什么不复用 `site-ops.normalizeUrl`：那个返回**裸域名**（它是「落库判重口径」），
 * 拿它判「真重复」会把 github.com/copilot 与 github.com/trending 算成同一条 —— 这是本模块
 * 最容易踩的坑（同站的**不同页面**会被误当重复而合并掉）。判「真重复」必须看完整路径。
 */
function normFullUrl(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  try {
    const u = new URL(s.includes('://') ? s : 'https://' + s)
    const host = u.hostname.replace(/^www\./, '').toLowerCase()
    const path = u.pathname.replace(/\/+$/, '')
    return host + path
  } catch {
    return ''
  }
}

/** 按某个键归组，取出现多条的分组（保序） */
function multiGroups(list, keyFn) {
  const m = new Map()
  for (const s of list) {
    const k = keyFn(s)
    if (!k) continue
    const arr = m.get(k)
    if (arr) arr.push(s)
    else m.set(k, [s])
  }
  return [...m.entries()].filter(([, arr]) => arr.length > 1)
}

/**
 * 全表体检。
 * @param {object[]} sites
 * @param {{ minDescLen?: number }} [opts]
 */
export function auditSites(sites, { minDescLen = MIN_DESC_LEN } = {}) {
  const list = Array.isArray(sites) ? sites : []

  // 真重复：完整 URL（保留路径）规范化后完全相同
  const duplicateUrls = multiGroups(list, s => normFullUrl(s.url)).map(([url, arr]) => ({
    url,
    ids: arr.map(s => s.id),
    names: arr.map(s => s.name),
    keep: arr[0].id, // 默认保留列表首条，其余为待合并项
  }))

  // 同 host 多入口：host 相同但 URL 不全相同 —— 只提示，不建议自动合并
  const sameHostGroups = multiGroups(list, s => hostOf(s.url))
    .filter(([, arr]) => new Set(arr.map(s => normFullUrl(s.url))).size > 1)
    .map(([host, arr]) => ({
      host,
      ids: arr.map(s => s.id),
      names: arr.map(s => s.name),
      paths: arr.map(s => { try { return new URL(s.url).pathname || '/' } catch { return '' } }),
    }))
    .sort((a, b) => b.ids.length - a.ids.length || a.host.localeCompare(b.host))

  const missingIcon = list.filter(s => !s.icon).map(s => s.id)
  const unknownUrl = list.filter(s => !hostOf(s.url)).map(s => s.id)

  const weakDesc = []
  for (const s of list) {
    const issue = descIssue(s, minDescLen)
    if (issue) weakDesc.push({ id: s.id, name: s.name, issue })
  }

  const integ = checkIntegrity(list)

  return {
    total: list.length,
    duplicateUrls,        // 真重复（建议合并）
    sameHostGroups,       // 同站多入口（人工甄别）
    missingIcon,
    weakDesc,
    unknownUrl,
    dupSortOrder: integ.dupSortOrder,
    categories: integ.categories,
    // 只有「客观该修」的才算问题；同站多入口不算 —— 它多半是合理收录
    clean: duplicateUrls.length === 0 && missingIcon.length === 0 &&
      weakDesc.length === 0 && unknownUrl.length === 0,
  }
}

/**
 * 由体检结果推导「合并真重复」的移除清单（只对 duplicateUrls，绝不碰同站多入口）。
 * @param {ReturnType<typeof auditSites>} audit
 * @returns {{ removeIds: string[], groups: number }}
 */
export function planHostMerge(audit) {
  const removeIds = []
  for (const g of audit?.duplicateUrls || []) {
    for (const id of g.ids) if (id !== g.keep) removeIds.push(id)
  }
  return { removeIds, groups: audit?.duplicateUrls?.length || 0 }
}

/** 体检报告的一行人类可读摘要（CLI 与面板提示共用） */
export function summarizeAudit(audit) {
  if (!audit) return '（无数据）'
  if (audit.clean && !audit.sameHostGroups.length) return `✅ ${audit.total} 个站点，未发现数据质量问题`
  const parts = []
  if (audit.duplicateUrls.length) parts.push(`完全重复 ${audit.duplicateUrls.length} 组`)
  if (audit.missingIcon.length) parts.push(`缺 icon ${audit.missingIcon.length} 条`)
  if (audit.weakDesc.length) parts.push(`描述待改进 ${audit.weakDesc.length} 条`)
  if (audit.unknownUrl.length) parts.push(`地址不可解析 ${audit.unknownUrl.length} 条`)
  if (audit.dupSortOrder.length) parts.push(`sortOrder 冲突 ${audit.dupSortOrder.length} 处`)
  const tip = audit.sameHostGroups.length ? `，另有 ${audit.sameHostGroups.length} 组同站多入口（需人工甄别）` : ''
  return audit.clean
    ? `✅ ${audit.total} 个站点${tip}`
    : `⚠️ ${audit.total} 个站点：${parts.join(' · ')}${tip}`
}
