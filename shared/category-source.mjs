/**
 * 分类表 **来源注册表（热拔插）**。
 *
 * ## 先说清楚已经有什么（避免重复造）
 *
 * 云端下发链路**早就通了**：
 *   · `api/sites.js` 写入时把 `body.categories` 经 `sanitizeGroups` 落进 `sites.json`
 *     的 `categories` 字段，回滚时也从快照里带回；
 *   · `src/stores/sites.js` 拉取时 `if (data.categories) categoriesStore.applyCloudGroups(...)`。
 * 前端那侧**不缺任何东西**。
 *
 * 真正缺的是**服务端侧**：`api/metadata.js` 的 categoryId 白名单（`categoryMeta()`）
 * 与控制台的下拉表都还是**模块级内置常量**。后果很具体 —— 云端把分类改了、前端跟着变，
 * 但线上「添加站点」仍按旧表校验，推断出的新分类被判「未登记」，下拉框里也没有它。
 *
 * 本模块补的就是这一层：让服务端/控制台也能从「云端表 / 外部 JSON URL / 内置」取表。
 *
 * ## 三源与优先级
 *
 *   `cloud`   (order 100) —— 数据文件里的 `categories` 字段（读法由 `ctx.loadJson` 注入）
 *   `url`     (order 200) —— 外部 JSON URL（`NAV_CATEGORY_URL`），便于换主题域
 *   `builtin` (order 900) —— 内置表，**永远可用**，是最终回退
 *
 * 任何一源返回的结构过不了 `sanitizeGroups` 就换下一个源 —— 脏表宁可整体回退，
 * 也不渲染半张表（这条校验器是现成的，本模块只是把它接到链上）。
 */
import { CATEGORY_GROUPS, cloneGroups, sanitizeGroups } from './categories.mjs'

const registry = new Map()
let seq = 0

/**
 * 注册一个分类表来源。同 id 覆盖。
 *
 * @param {{
 *   id: string,
 *   label?: string,
 *   order?: number,
 *   available?: () => boolean,
 *   load: (ctx: object) => Promise<unknown> | unknown,   // 返回原始分组数组（未校验）；取不到返回 null
 * }} spec
 */
export function registerCategorySource(spec) {
  if (!spec || !spec.id) throw new Error('分类表来源必须提供 id')
  if (typeof spec.load !== 'function') throw new Error(`分类表来源 ${spec.id} 缺少 load`)
  const entry = {
    id: String(spec.id),
    label: spec.label ? String(spec.label) : String(spec.id),
    order: Number.isFinite(spec.order) ? Number(spec.order) : 100 + seq,
    available: typeof spec.available === 'function' ? spec.available : () => true,
    load: spec.load,
  }
  seq += 1
  registry.set(entry.id, entry)
  return entry
}

/** 来源清单（供控制台/接口展示，顺序即默认尝试顺序） */
export function listCategorySources({ check = true } = {}) {
  return [...registry.values()]
    .sort((a, b) => a.order - b.order)
    .map(s => ({ id: s.id, label: s.label, order: s.order, available: check ? Boolean(s.available()) : true }))
}

/**
 * 产出实际要试的来源链。
 * 优先级：显式传入 → `NAV_CATEGORY_SOURCES` → 注册顺序；然后过滤掉不可用项。
 * 容错与其余引擎一致：全不匹配回退全量；`none` 显式清空（只剩最终回落）。
 */
export function categorySourceChain(explicit) {
  const all = [...registry.values()].sort((a, b) => a.order - b.order)
  const raw = explicit !== undefined && explicit !== null
    ? String(explicit)
    : String(process.env.NAV_CATEGORY_SOURCES || '')
  const ids = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (ids.length === 1 && ['none', 'off', '0'].includes(ids[0])) return []
  const matched = ids.map(id => all.find(s => s.id === id)).filter(Boolean)
  const chosen = matched.length ? matched : all
  return chosen.filter(s => s.available())
}

/**
 * 按链取分类表。返回第一个**结构合法**的结果；全都不行则回落到内置表。
 *
 * @returns {Promise<{ groups: object[], source: string }>}
 *          `source` 为 `'builtin-fallback'` 时表示链上一个来源都没给出可用表
 */
export async function resolveCategoryGroups({ chain, ctx = {} } = {}) {
  for (const s of (Array.isArray(chain) ? chain : categorySourceChain())) {
    try {
      const raw = await s.load(ctx)
      if (!raw) continue
      const groups = sanitizeGroups(raw)
      if (groups && groups.length) return { groups, source: s.id }
    } catch { /* 换下一个来源 */ }
  }
  return { groups: cloneGroups(CATEGORY_GROUPS), source: 'builtin-fallback' }
}

/**
 * 造一个带进程内 TTL 缓存的解析器。
 *
 * 为什么需要：serverless 每个请求一个新进程，缓存等于「每请求读一次」；
 * 常驻进程（控制台）下则明显省 IO。同一个实现两边都合适，不需要分支。
 *
 * @param {{ ctx?: object, ttlMs?: number, sources?: object[] }} opts
 * @returns {() => Promise<{ groups: object[], source: string }>}
 */
export function createCategoryResolver({ ctx = {}, ttlMs = 60_000, sources } = {}) {
  let cache = null
  let at = 0
  return async function resolve() {
    const now = Date.now()
    if (cache && now - at < ttlMs) return cache
    const out = await resolveCategoryGroups({ chain: sources, ctx })
    cache = out
    at = now
    return out
  }
}

/** 扁平元信息：id -> { label, color, group }（与 categories.mjs 的 categoryMeta() 同形状） */
export function categoryMetaFromGroups(groups) {
  const map = {}
  for (const g of (groups || [])) {
    for (const c of ((g && g.categories) || [])) map[c.id] = { label: c.label, color: c.dotColor, group: g.label }
  }
  return map
}

/* ---------------- 内建三源 ---------------- */

registerCategorySource({
  id: 'cloud',
  label: '数据文件里的分类表',
  order: 100,
  /** 读法由调用方注入：线上是 #store，控制台是本地文件 —— shared 不绑定任何一侧 */
  available: () => true,
  load: async (ctx) => {
    if (typeof ctx.loadJson !== 'function') return null
    const path = String(process.env.NAV_CATEGORY_PATH || 'sites.json')
    const data = await ctx.loadJson(path)
    if (!data || Array.isArray(data)) return null
    return Array.isArray(data.categories) ? data.categories : null
  },
})

registerCategorySource({
  id: 'url',
  label: '外部 JSON URL',
  order: 200,
  available: () => Boolean(String(process.env.NAV_CATEGORY_URL || '').trim()),
  load: async (ctx) => {
    const url = String(process.env.NAV_CATEGORY_URL || '').trim()
    if (!url || typeof ctx.fetchJson !== 'function') return null
    const data = await ctx.fetchJson(url)
    if (!data) return null
    // 允许外部文件是裸数组，也允许与内部同形的 { categories: [...] } 包装
    return Array.isArray(data) ? data : (Array.isArray(data.categories) ? data.categories : null)
  },
})

registerCategorySource({
  id: 'builtin',
  label: '内置默认表',
  order: 900,
  available: () => true,
  load: () => CATEGORY_GROUPS,
})
