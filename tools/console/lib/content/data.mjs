/**
 * 站点数据体检：分类分布、图标/配色/描述缺失、sortOrder 重复与空洞、重复域名。
 * 只读本地 api/sites-data.json，不触碰云端。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../core/env.mjs'
import { CATEGORY_GROUPS, sanitizeGroups } from '../../../../shared/categories.mjs'
import { categoryMetaFromGroups } from '../../../../shared/category-source.mjs'
import { hostOf } from '../../../../shared/ops/site-ops.mjs'

const SITES_FILE = 'api/sites-data.json'

export { hostOf }

export function readSites() {
  return JSON.parse(readFileSync(join(ROOT, SITES_FILE), 'utf-8'))
}

/**
 * 当前生效的分类分组：**优先数据文件里的 `categories` 字段**（与云端同源），
 * 结构非法或不存在则回落内置表 —— 换主题域只需换数据文件里的表，不必改代码。
 * 读文件失败（坏 JSON / 权限）同样回落：控制台下拉绝不该因为数据文件坏了而空掉。
 */
function currentGroups() {
  try {
    const data = readSites()
    const raw = Array.isArray(data) ? null : (Array.isArray(data.categories) ? data.categories : null)
    if (raw) {
      const groups = sanitizeGroups(raw)
      if (groups && groups.length) return groups
    }
  } catch { /* 回落内置 */ }
  return CATEGORY_GROUPS
}

/**
 * 分类分组，供控制台下拉框渲染。
 * 数据源与前端 store、线上接口同源（数据文件里的表 / shared/categories.mjs），
 * 不再正则解析源码。这里把 dotColor 映射成控制台用的 color，避免两处模板各写一套字段名。
 */
export function categoryGroups() {
  return currentGroups().map(g => ({
    id: g.id,
    label: g.label,
    categories: g.categories.map(c => ({ id: c.id, label: c.label, color: c.dotColor })),
  }))
}

/** 扁平分类元信息：id -> { label, color, group } */
export function readCategoryMeta() {
  return categoryMetaFromGroups(currentGroups())
}

export function report() {
  const sites = readSites()
  const meta = readCategoryMeta()

  const counts = new Map()
  for (const s of sites) counts.set(s.categoryId, (counts.get(s.categoryId) || 0) + 1)
  const distribution = [...counts.entries()]
    .map(([id, count]) => ({
      id, count,
      label: meta[id]?.label || id,
      color: meta[id]?.color || '#64748b',
      known: Boolean(meta[id]),
    }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))

  const orders = sites.map(s => s.sortOrder).filter(n => typeof n === 'number')
  const seen = new Map()
  for (const n of orders) seen.set(n, (seen.get(n) || 0) + 1)
  const dupSortOrder = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => Number(k)).sort((a, b) => a - b)
  const sortOrderMax = orders.length ? Math.max(...orders) : 0
  const present = new Set(orders)
  const holes = []
  for (let i = 1; i <= sortOrderMax; i++) if (!present.has(i)) holes.push(i)

  const domains = new Map()
  for (const s of sites) {
    const h = hostOf(s.url)
    if (!h) continue
    if (!domains.has(h)) domains.set(h, [])
    domains.get(h).push(s.id)
  }
  const dupDomains = [...domains.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([domain, ids]) => ({ domain, ids }))

  return {
    file: SITES_FILE,
    total: sites.length,
    categories: distribution.length,
    unknownCategories: distribution.filter(d => !d.known).map(d => d.id),
    distribution,
    missingIcon: sites.filter(s => !s.icon).map(s => s.id),
    missingColor: sites.filter(s => !s.color).map(s => s.id),
    missingDesc: sites.filter(s => !s.desc).map(s => s.id),
    dupSortOrder,
    holes,
    sortOrderMax,
    dupDomains,
  }
}