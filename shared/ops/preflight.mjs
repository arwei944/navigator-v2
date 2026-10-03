/**
 * 发布预检内核：把「云端基底 → 本地当前」的差异与风险算清楚，供发布前把关。
 *
 * 为什么单独抽出来：预检必须在**两端同口径** —— 本地控制台的 dry-run 与线上后台的
 * 「发布预检」如果各算各的，就会出现「本地说没问题、线上拦下来」的割裂。
 * 纯函数、零依赖（与 site-ops / pipeline 同约束），浏览器侧与 Node 侧都可引用。
 *
 * 阻断 vs 警告的判据：**发布后前台会立刻坏掉**的才算阻断（空站点、分类表非法、
 * 站点引用了不存在的分类）；只是「不理想」的一律降级为警告（空分类、重复域名、
 * 排序号重复、无改动）—— 预检的职责是拦住事故，不是拦住一切不完美。
 */
import { diffSites, checkIntegrity, hostOf } from './site-ops.mjs'
import { diffGroups, sanitizeGroups } from '../categories.mjs'
import { CLOUD_PIPELINE, planPipeline } from './pipeline.mjs'

export const PREFLIGHT_CODES = {
  noKey: '缺少管理凭据',
  emptySites: '站点列表为空',
  invalidCategories: '分类表结构非法',
  orphanCategory: '站点引用了未登记的分类',
  emptyCategory: '存在空分类',
  dupHost: '存在重复域名',
  dupSortOrder: '排序号重复',
  noChanges: '没有任何改动',
}

/**
 * 发布预检。
 *
 * @param {{ cloudSites?: object[], sites?: object[], cloudGroups?: object[], groups?: object[], hasKey?: boolean }} input
 * @returns {{
 *   ok: boolean, blockers: object[], warnings: object[],
 *   sites: object, categories: object, integrity: object,
 *   changed: boolean, summary: string, plan: object[]
 * }}
 */
export function preflightPublish({ cloudSites, sites, cloudGroups, groups, hasKey = true } = {}) {
  const blockers = []
  const warnings = []
  const cur = Array.isArray(sites) ? sites : []
  const base = Array.isArray(cloudSites) ? cloudSites : []
  const catTable = Array.isArray(groups) ? groups : []

  if (!hasKey) blockers.push({ code: 'noKey', message: '请先登录（或填入管理凭据）再发布' })
  if (!cur.length) blockers.push({ code: 'emptySites', message: '站点列表为空，发布后前台将无内容可展示' })

  // 分类表：结构非法或站点引用了不存在的分类，都会让前台筛选条 / 下拉出现空档
  if (catTable.length && !sanitizeGroups(catTable)) {
    blockers.push({ code: 'invalidCategories', message: '分类表结构非法（域 / 分类 id 重复或为空、域与子分类重名）' })
  }

  const known = new Set()
  for (const g of catTable) for (const c of (g.categories || [])) known.add(c.id)
  const orphans = [...new Set(cur.map(s => s.categoryId).filter(id => id && !known.has(id)))]
  if (orphans.length) {
    blockers.push({
      code: 'orphanCategory',
      message: `有 ${orphans.length} 个站点引用了未登记的分类：${clip(orphans, 6)}`,
    })
  }

  const emptyCats = []
  for (const g of catTable) {
    for (const c of (g.categories || [])) {
      if (!cur.some(s => s.categoryId === c.id)) emptyCats.push(c.id)
    }
  }
  if (emptyCats.length) {
    warnings.push({ code: 'emptyCategory', message: `有 ${emptyCats.length} 个分类暂无站点：${clip(emptyCats, 8)}` })
  }

  // 重复域名：去重口径与站点内核一致（忽略 www）
  const hostSeen = new Map()
  const dupHosts = []
  for (const s of cur) {
    const h = hostOf(s.url)
    if (!h) continue
    if (hostSeen.has(h)) dupHosts.push(h)
    else hostSeen.set(h, s.id)
  }
  if (dupHosts.length) warnings.push({ code: 'dupHost', message: `有 ${dupHosts.length} 组重复域名：${clip(dupHosts, 5)}` })

  const integrity = checkIntegrity(cur)
  if (integrity.dupSortOrder.length) {
    warnings.push({ code: 'dupSortOrder', message: `排序号重复：${clip(integrity.dupSortOrder, 8)}` })
  }

  const siteDiff = diffSites(base, cur)
  const catDiff = diffGroups(cloudGroups || [], catTable)
  const changed = siteDiff.added.length + siteDiff.removed.length + siteDiff.modified.length + catDiff.total > 0
  if (!changed && hasKey) {
    warnings.push({ code: 'noChanges', message: '与云端相比没有任何改动，无需发布' })
  }

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    sites: siteDiff,
    categories: catDiff,
    integrity,
    changed,
    summary: summarizePreflight({ siteDiff, catDiff, blockers }),
    plan: planPipeline({ pipeline: CLOUD_PIPELINE, runner: 'cloud' }).steps,
  }
}

/** 预检一句话摘要（发布按钮旁 / 通知 / 审计共用） */
export function summarizePreflight({ siteDiff, catDiff, blockers = [] } = {}) {
  const parts = []
  if (siteDiff) {
    if (siteDiff.added.length) parts.push(`新增 ${siteDiff.added.length}`)
    if (siteDiff.removed.length) parts.push(`移除 ${siteDiff.removed.length}`)
    if (siteDiff.modified.length) parts.push(`更新 ${siteDiff.modified.length}`)
  }
  if (catDiff && catDiff.total) parts.push(`分类表 ${catDiff.total} 处调整`)
  const diffText = parts.length ? parts.join(' / ') : '无改动'
  return blockers.length ? `${diffText}；${blockers.length} 项阻断` : diffText
}

/** 超长清单截断，避免一行塞进几十个 id 把预检面板撑爆 */
function clip(list, max) {
  const arr = [...list]
  return arr.slice(0, max).join('、') + (arr.length > max ? '…' : '')
}