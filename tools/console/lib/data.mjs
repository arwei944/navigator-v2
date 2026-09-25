/**
 * 站点数据体检：分类分布、图标/配色/描述缺失、sortOrder 重复与空洞、重复域名。
 * 只读本地 api/sites-data.json，不触碰云端。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.mjs'

const SITES_FILE = 'api/sites-data.json'
const CATEGORY_FILE = 'src/stores/categories.js'

export function readSites() {
  return JSON.parse(readFileSync(join(ROOT, SITES_FILE), 'utf-8'))
}

/**
 * 从分类 store 源码解析分组结构（该文件结构稳定，正则足够且不引入构建依赖）。
 * 先定位分组对象（含 collapsed 字段），再在分组区间内提取分类项，避免两类对象混淆。
 */
export function categoryGroups() {
  const file = join(ROOT, CATEGORY_FILE)
  if (!existsSync(file)) return []
  const text = readFileSync(file, 'utf-8')
  const heads = [...text.matchAll(/\{\s*id:\s*'([^']+)',\s*label:\s*'([^']+)',\s*collapsed:/g)]
  return heads.map((h, i) => {
    const body = text.slice(h.index, i + 1 < heads.length ? heads[i + 1].index : text.length)
    const categories = [...body.matchAll(/\{\s*id:\s*'([^']+)',\s*label:\s*'([^']+)',\s*dotColor:\s*'([^']+)'\s*\}/g)]
      .map(m => ({ id: m[1], label: m[2], color: m[3] }))
    return { id: h[1], label: h[2], categories }
  })
}

/** 扁平分类元信息：id -> { label, color, group } */
export function readCategoryMeta() {
  const map = {}
  for (const g of categoryGroups()) {
    for (const c of g.categories) map[c.id] = { label: c.label, color: c.color, group: g.label }
  }
  return map
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