/**
 * 站点数据体检：分类分布、图标/配色/描述缺失、sortOrder 重复与空洞、重复域名。
 * 只读本地 api/sites-data.json，不触碰云端。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.mjs'
import { CATEGORY_GROUPS, categoryMeta } from '../../../shared/categories.mjs'

const SITES_FILE = 'api/sites-data.json'

export function readSites() {
  return JSON.parse(readFileSync(join(ROOT, SITES_FILE), 'utf-8'))
}

/**
 * 分类分组，供控制台下拉框渲染。
 * 数据源是 shared/categories.mjs（与前端 store、线上接口同源），不再正则解析源码。
 * 这里把 dotColor 映射成控制台用的 color，避免两处模板各写一套字段名。
 */
export function categoryGroups() {
  return CATEGORY_GROUPS.map(g => ({
    id: g.id,
    label: g.label,
    categories: g.categories.map(c => ({ id: c.id, label: c.label, color: c.dotColor })),
  }))
}

/** 扁平分类元信息：id -> { label, color, group } */
export function readCategoryMeta() {
  return categoryMeta()
}

/** 取主机名做去重比较：数据里存的是裸域名（无协议），需兼容补全后再解析 */
export function hostOf(url) {
  const raw = String(url || '').trim()
  if (!raw) return ''
  try {
    const u = new URL(raw.includes('://') ? raw : 'https://' + raw)
    return u.hostname.replace(/^www\./, '').toLowerCase()
  } catch { return '' }
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