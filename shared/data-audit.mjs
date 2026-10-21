/**
 * 站点数据体检与修复计划 —— 纯函数层。
 *
 * ## 为什么单独成文件
 *
 * 「体检」和「修复」都是对 300 条站点数据的规则运算，与 HTTP、存储、Vue 无关。
 * 抽成纯函数后，Node 侧可以直接拿真实种子数据断言（见 `tools/console/test-data-manager.mjs`），
 * 而不必先把服务跑起来。这也让「预览 diff 的条数必须等于实际写入的变化条数」这条
 * 不变量成为可测事实，而不是口头承诺。
 *
 * ## 两条硬约束
 *
 * 1. **不造新对象，除非要改**。`buildFixPlan` 对没有命中的条目原样返回同一个对象引用，
 *    前端 300 张卡的渲染复用依赖对象身份（与 `shared/sanitize.mjs` 同一条口径）。
 * 2. **空库不是合法结果**。`auditSites` 对空数组返回 `total: 0` 的报告，但修复计划
 *    永远返回 `nextSites` 长度不减少（本模块不删除站点），避免一次误点把库清空。
 */

/* ================================ 字段清单 ================================ */

/**
 * 站点表的字段口径。顺序即面板展示顺序。
 *
 * `required` 表达的是「缺了会影响到什么」，不是「保存会不会被拒」——
 * 保存门禁只有 id/name/url 三条（见 shared/sanitize.mjs），这里更细是为了让人知道
 * 该补什么，而不是再造一套校验去卡发布。
 */
export const AUDIT_FIELDS = [
  { key: 'id', label: 'ID', required: true },
  { key: 'name', label: '名称', required: true },
  { key: 'url', label: '网址', required: true },
  { key: 'desc', label: '描述', required: true },
  { key: 'categoryId', label: '分类', required: true },
  { key: 'purposes', label: '用途', required: true, kind: 'array' },
  { key: 'position', label: '定位', required: true, kind: 'object' },
  { key: 'color', label: '主题色', required: false },
  { key: 'initial', label: '首字母', required: false },
  { key: 'sortOrder', label: '排序', required: true, kind: 'number' },
  { key: 'visitCount', label: '访问数', required: false, kind: 'number' },
  { key: 'createdAt', label: '创建时间', required: false, kind: 'number' },
  { key: 'updatedAt', label: '更新时间', required: false, kind: 'number' },
  { key: 'icon', label: '图标', required: false },
  { key: 'aliases', label: '别名', required: false, kind: 'array' },
]

/**
 * 低置信度阈值：**小于等于**它就算「推断得不够有把握」。
 *
 * 取 0.6 而不是 0.9 的理由：实测置信度只有 0.9 / 0.6 / 0.5 三档，
 * 0.9 是「描述命中强关键词」，0.6 是「弱命中或用途兜底」，0.5 是「纯兜底」。
 * 后两档都属于「需要人看一眼」，因此用 `<=` 把 0.6 一并纳入 —— 用 `<` 会漏掉 52 条。
 */
export const LOW_CONFIDENCE = 0.6

const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i

/* ================================ URL 归一化 ================================ */

/**
 * 把一条站点 URL 归一化成「不含协议、不含 www、不含尾斜杠」的形态。
 *
 * 为什么不做更激进的清洗（去查询串 / 去路径 / 小写化）：
 *   - 路径可能是有意为之的深链（实测 22 条带路径）；
 *   - 查询串可能是站点入口的一部分。
 * 这两类只**标记**不修改，把「要不要动」留给人工。
 *
 * @returns {{value:string, changed:boolean, valid:boolean, flags:object, host:string, path:string}}
 */
export function normalizeUrl(raw) {
  const original = String(raw ?? '').trim()
  let rest = original

  const hasProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(rest)
  if (hasProtocol) rest = rest.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')

  const hasWww = /^www\./i.test(rest)
  if (hasWww) rest = rest.replace(/^www\./i, '')

  // 查询串与锚点不参与归一化判断，但原样保留
  const hashAt = rest.indexOf('#')
  const hash = hashAt >= 0 ? rest.slice(hashAt) : ''
  if (hashAt >= 0) rest = rest.slice(0, hashAt)
  const qAt = rest.indexOf('?')
  const query = qAt >= 0 ? rest.slice(qAt) : ''
  if (qAt >= 0) rest = rest.slice(0, qAt)

  const hasTrailingSlash = rest.length > 1 && rest.endsWith('/')
  if (hasTrailingSlash) rest = rest.replace(/\/+$/, '')

  const slashAt = rest.indexOf('/')
  const hostPart = slashAt >= 0 ? rest.slice(0, slashAt) : rest
  const pathPart = slashAt >= 0 ? rest.slice(slashAt) : ''

  // host 允许带端口，但比较与校验只看主机名
  const hostNoPort = hostPart.replace(/:\d+$/, '')
  const hasPath = pathPart.length > 0
  const valid = HOST_RE.test(hostNoPort)

  const value = original === rest + query + hash ? original : rest + query + hash

  return {
    value,
    changed: value !== original,
    valid,
    host: hostNoPort,
    path: pathPart + query + hash,
    flags: { hasProtocol, hasWww, hasTrailingSlash, hasPath },
  }
}

/** 归一化后用于「重复检测」的键：协议/www/尾斜杠/大小写差异都不算不同站点 */
export function urlKey(raw) {
  return normalizeUrl(raw).value.toLowerCase()
}

/* ================================ 辅助 ================================ */

function hasValue(v) {
  if (v == null) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v).length > 0
  if (typeof v === 'number') return Number.isFinite(v)
  return true
}

/** 把分类表（分组形态）摊平成 id → { label, group, groupLabel } */
export function categoryIndex(categories = []) {
  const map = new Map()
  for (const g of Array.isArray(categories) ? categories : []) {
    if (!g || !Array.isArray(g.categories)) continue
    for (const c of g.categories) {
      if (!c || !c.id) continue
      map.set(String(c.id), { label: c.label || String(c.id), group: g.id, groupLabel: g.label || g.id })
    }
  }
  return map
}

function countBy(list, pick) {
  const out = {}
  for (const item of list) {
    const k = pick(item)
    const key = k === undefined || k === null || k === '' ? '(空)' : String(k)
    out[key] = (out[key] || 0) + 1
  }
  return out
}

function sortedEntries(obj) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/* ================================ 体检 ================================ */

/**
 * 跑一次完整体检。
 *
 * @param {object[]} sites
 * @param {object} [opts]
 * @param {object[]} [opts.categories]  分类表（分组形态）
 * @param {number}   [opts.now]         当前时间戳，测试注入以保证确定性
 * @param {number}   [opts.staleDays]   「长期未更新」阈值，默认 90 天
 * @param {(icon:string)=>boolean} [opts.iconExists] 图标存在性判定；不给就跳过资源检查
 * @returns {object} 报告（结构稳定，可直接 JSON 序列化）
 */
export function auditSites(sites, opts = {}) {
  const {
    categories = [],
    now = Date.now(),
    staleDays = 90,
    iconExists = null,
  } = opts

  const list = Array.isArray(sites) ? sites.filter(s => s && typeof s === 'object') : []
  const total = list.length
  const catIndex = categoryIndex(categories)
  const categoryIds = new Set(catIndex.keys())

  /* ---- 字段覆盖率 ---- */
  const fields = AUDIT_FIELDS.map((f) => {
    const missing = []
    for (const s of list) if (!hasValue(s[f.key])) missing.push({ id: s.id, name: s.name })
    return {
      key: f.key,
      label: f.label,
      required: Boolean(f.required),
      covered: total - missing.length,
      missingCount: missing.length,
      missing,
    }
  })

  /* ---- 唯一性 ---- */
  const byUrl = new Map()
  const byName = new Map()
  const byId = new Map()
  for (const s of list) {
    const uk = urlKey(s.url)
    if (uk) {
      if (!byUrl.has(uk)) byUrl.set(uk, [])
      byUrl.get(uk).push({ id: s.id, name: s.name })
    }
    const nk = String(s.name ?? '').trim().toLowerCase()
    if (nk) {
      if (!byName.has(nk)) byName.set(nk, [])
      byName.get(nk).push({ id: s.id, name: s.name })
    }
    const ik = String(s.id ?? '')
    if (ik) byId.set(ik, (byId.get(ik) || 0) + 1)
  }
  const duplicates = {
    urls: [...byUrl.entries()].filter(([, v]) => v.length > 1).map(([key, items]) => ({ key, items })),
    names: [...byName.entries()].filter(([, v]) => v.length > 1).map(([key, items]) => ({ key, items })),
    ids: [...byId.entries()].filter(([, n]) => n > 1).map(([key, count]) => ({ key, count })),
  }

  /* ---- 引用完整性 ---- */
  const orphanCategories = list
    .filter(s => s.categoryId && !categoryIds.has(String(s.categoryId)))
    .map(s => ({ id: s.id, name: s.name, categoryId: s.categoryId }))

  const categoryDistribution = [...categoryIds.entries()]
    .map(([id, meta]) => ({
      id,
      label: meta.label,
      group: meta.group,
      groupLabel: meta.groupLabel,
      count: list.filter(s => String(s.categoryId) === id).length,
    }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))

  const emptyCategories = categoryDistribution.filter(c => c.count === 0).map(c => ({ id: c.id, label: c.label }))
  const overloaded = categoryDistribution.filter(c => c.count > 0).slice(0, 5)

  /* ---- URL 规范性 ---- */
  const urlIssues = {
    hasProtocol: [],
    hasWww: [],
    hasTrailingSlash: [],
    hasPath: [],
    invalid: [],
    missing: [],
  }
  for (const s of list) {
    if (!hasValue(s.url)) { urlIssues.missing.push({ id: s.id, name: s.name }); continue }
    const n = normalizeUrl(s.url)
    if (n.flags.hasProtocol) urlIssues.hasProtocol.push({ id: s.id, name: s.name, url: s.url })
    if (n.flags.hasWww) urlIssues.hasWww.push({ id: s.id, name: s.name, url: s.url })
    if (n.flags.hasTrailingSlash) urlIssues.hasTrailingSlash.push({ id: s.id, name: s.name, url: s.url })
    if (n.flags.hasPath) urlIssues.hasPath.push({ id: s.id, name: s.name, url: s.url })
    if (!n.valid) urlIssues.invalid.push({ id: s.id, name: s.name, url: s.url })
  }

  /* ---- 推断质量 ---- */
  const sourceCount = countBy(list, s => (s.position && s.position.source) || '')
  const confidenceCount = countBy(list, s => {
    const c = s.position && s.position.confidence
    return typeof c === 'number' ? String(c) : '(无)'
  })
  const lowConfidence = list
    .filter((s) => {
      const c = s.position && s.position.confidence
      return typeof c === 'number' && c <= LOW_CONFIDENCE
    })
    .map(s => ({
      id: s.id,
      name: s.name,
      confidence: s.position.confidence,
      reason: s.position.reason || '',
      domain: s.position.domain || '',
      stage: s.position.stage || '',
    }))
    .sort((a, b) => a.confidence - b.confidence || String(a.id).localeCompare(String(b.id)))

  const reasonCount = countBy(
    list.filter(s => s.position && s.position.reason),
    s => s.position.reason,
  )

  /* ---- 资源引用 ---- */
  const resources = { checked: false, iconMissing: [], iconExternal: [], orphanFiles: [] }
  if (typeof iconExists === 'function') {
    resources.checked = true
    const referenced = new Set()
    for (const s of list) {
      if (!hasValue(s.icon)) continue
      const p = String(s.icon)
      // 远程图标不走本地文件检查，但单独列出来（离线时会降级）
      if (/^https?:\/\//i.test(p)) { resources.iconExternal.push({ id: s.id, name: s.name, icon: p }); continue }
      referenced.add(p)
      let exists = false
      try { exists = Boolean(iconExists(p)) } catch { exists = false }
      if (!exists) resources.iconMissing.push({ id: s.id, name: s.name, icon: p })
    }
    if (Array.isArray(opts.iconFiles)) {
      resources.orphanFiles = opts.iconFiles
        .map(f => String(f))
        .filter(f => !referenced.has(f))
    }
  }

  /* ---- 时间线 ---- */
  const stamps = list
    .map(s => Number(s.updatedAt))
    .filter(n => Number.isFinite(n) && n > 0)
  const staleBefore = now - staleDays * 24 * 60 * 60 * 1000
  const stale = list
    .filter(s => Number.isFinite(Number(s.updatedAt)) && Number(s.updatedAt) < staleBefore)
    .map(s => ({ id: s.id, name: s.name, updatedAt: Number(s.updatedAt) }))
  const timeline = {
    createdMin: null,
    createdMax: null,
    updatedMin: stamps.length ? Math.min(...stamps) : null,
    updatedMax: stamps.length ? Math.max(...stamps) : null,
    staleDays,
    staleCount: stale.length,
    stale: stale.slice(0, 20),
    missingUpdatedAt: list.filter(s => !Number.isFinite(Number(s.updatedAt)) || Number(s.updatedAt) <= 0)
      .map(s => ({ id: s.id, name: s.name })),
  }
  const created = list
    .map(s => Number(s.createdAt))
    .filter(n => Number.isFinite(n) && n > 0)
  if (created.length) {
    timeline.createdMin = Math.min(...created)
    timeline.createdMax = Math.max(...created)
  }

  /* ---- 汇总 ---- */
  const issueCount =
    fields.reduce((n, f) => n + f.missingCount, 0) +
    duplicates.urls.length + duplicates.names.length + duplicates.ids.length +
    orphanCategories.length +
    urlIssues.invalid.length + urlIssues.hasProtocol.length + urlIssues.hasWww.length + urlIssues.hasTrailingSlash.length +
    lowConfidence.length +
    resources.iconMissing.length

  return {
    generatedAt: new Date(now).toISOString(),
    total,
    fields,
    duplicates,
    orphanCategories,
    categoryDistribution,
    emptyCategories,
    overloaded,
    urlIssues: {
      hasProtocol: urlIssues.hasProtocol,
      hasWww: urlIssues.hasWww,
      hasTrailingSlash: urlIssues.hasTrailingSlash,
      hasPath: urlIssues.hasPath,
      invalid: urlIssues.invalid,
      missing: urlIssues.missing,
    },
    inference: {
      source: sortedEntries(sourceCount).map(([k, v]) => ({ key: k, count: v })),
      confidence: sortedEntries(confidenceCount).map(([k, v]) => ({ key: k, count: v })),
      lowConfidence,
      reasons: sortedEntries(reasonCount).map(([k, v]) => ({ key: k, count: v })).slice(0, 10),
    },
    resources,
    timeline,
    issueCount,
    categoriesDefined: categoryIds.size,
  }
}

/* ================================ 修复计划 ================================ */

/** 修复动作清单（面板按这个顺序渲染，key 与 buildFixPlan 的 actions 一一对应） */
export const FIX_ACTIONS = [
  {
    key: 'normalizeUrl',
    label: 'URL 归一化',
    level: 'low',
    desc: '去掉协议、www、尾斜杠。带路径的条目只标记不修改。',
  },
  {
    key: 'fillAliases',
    label: '补充别名',
    level: 'low',
    desc: '为 aliases 为空的站点，用名称生成一条别名，改善搜索召回。',
  },
  {
    key: 'dropMissingIcons',
    label: '清理失效图标引用',
    level: 'low',
    desc: '图标文件不存在的条目，把 icon 置空，回退到首字母显示。',
  },
  {
    key: 'renumberSortOrder',
    label: '重排排序值',
    level: 'medium',
    desc: '仅在检测到重复或非正整数时触发，按现有顺序重排为 1..n。',
  },
  {
    key: 'markManual',
    label: '标记为人工校正',
    level: 'low',
    desc: '把指定条目的 position.source 改为 manual，保留原 confidence。',
  },
]

/**
 * 生成修复计划（不写库）。
 *
 * 返回的 `nextSites` 是**完整的下一版站点数组**，调用方拿它去走 `POST /api/sites`
 * —— 写入仍然只有那一条通道（CAS + 写前快照 + sanitizeSites 门禁）。
 *
 * @param {object[]} sites
 * @param {object} [opts]
 * @param {object}   [opts.actions]     { normalizeUrl:true, fillAliases:true, ... }
 * @param {object}   [opts.reassign]    { siteId: categoryId } 孤儿分类重指派映射
 * @param {string[]} [opts.markManual]  要标记为人工校正的站点 id
 * @param {(icon:string)=>boolean} [opts.iconExists]
 * @param {number}   [opts.now]
 * @returns {{changes:object[], nextSites:object[], stats:object, skipped:object[]}}
 */
export function buildFixPlan(sites, opts = {}) {
  const {
    actions = {},
    reassign = {},
    markManual = [],
    iconExists = null,
    now = Date.now(),
    scope = null,
  } = opts

  /**
   * 作用范围只约束**字段级修复**（URL 归一化 / 补别名 / 清理图标）。
   *
   * `renumberSortOrder` 刻意不受它影响：只对一部分站点重排，会让排序值在范围边界处
   * 出现重复或空洞，比不重排更糟。`reassign` / `markManual` 本来就是按 id 指定的，
   * 再加一层范围过滤只会让「我明明选了它却没生效」变成谜。
   */
  const inScope = (site) => {
    if (!scope) return true
    if (scope.categoryId && String(site.categoryId) !== String(scope.categoryId)) return false
    if (scope.domain && String((site.position && site.position.domain) || '') !== String(scope.domain)) return false
    return true
  }
  const scoped = Boolean(scope && (scope.categoryId || scope.domain))

  const list = Array.isArray(sites) ? sites : []
  const changes = []
  const skipped = []
  const manualSet = new Set((Array.isArray(markManual) ? markManual : []).map(String))
  const reassignMap = reassign && typeof reassign === 'object' ? reassign : {}

  /* 重排排序值：先判断要不要做，避免「本来就对」也产生 300 条 diff */
  let orderMap = null
  if (actions.renumberSortOrder) {
    const orders = list.map(s => Number(s.sortOrder))
    const badType = orders.some(n => !Number.isFinite(n) || n <= 0 || !Number.isInteger(n))
    const dup = new Set(orders).size !== orders.length
    if (badType || dup) {
      const sorted = [...list].sort((a, b) => {
        const oa = Number(a.sortOrder)
        const ob = Number(b.sortOrder)
        const va = Number.isFinite(oa) && oa > 0 ? oa : Number.MAX_SAFE_INTEGER
        const vb = Number.isFinite(ob) && ob > 0 ? ob : Number.MAX_SAFE_INTEGER
        return va - vb || String(a.id).localeCompare(String(b.id))
      })
      orderMap = new Map(sorted.map((s, i) => [String(s.id), i + 1]))
    } else {
      skipped.push({ action: 'renumberSortOrder', reason: '排序值已连续且无重复，无需重排' })
    }
  }

  const nextSites = list.map((site) => {
    let next = site
    /** 只在真的要改时才复制，保住未命中条目的对象身份 */
    const mutate = () => {
      if (next === site) next = { ...site }
      return next
    }

    /* ---- B1 URL 归一化 ---- */
    if (inScope(site) && actions.normalizeUrl && hasValue(site.url)) {
      const n = normalizeUrl(site.url)
      if (n.changed && n.valid) {
        mutate()
        changes.push({
          id: site.id,
          name: site.name,
          field: 'url',
          from: site.url,
          to: n.value,
          action: 'normalizeUrl',
          reason: '去掉协议 / www / 尾斜杠',
        })
        next.url = n.value
      } else if (n.changed && !n.valid) {
        skipped.push({ action: 'normalizeUrl', id: site.id, reason: `归一化后不是合法域名：${n.value}` })
      }
    }

    /* ---- B2 补充别名 ----
     * 两种形态都要覆盖：字段整个缺失（实测 92 条）与空数组（1 条）。
     * 只判 `Array.isArray && length===0` 会漏掉绝大多数 —— 体检里它们都算「缺失」，
     * 修复却只命中 1 条，面板上就会出现「报告说 93、修复只改 1」的自相矛盾。
     */
    if (inScope(site) && actions.fillAliases && (!Array.isArray(site.aliases) || site.aliases.length === 0)) {
      const alias = String(site.name ?? '').trim()
      if (alias) {
        mutate()
        changes.push({
          id: site.id,
          name: site.name,
          field: 'aliases',
          from: [],
          to: [alias],
          action: 'fillAliases',
          reason: '用名称补一条别名',
        })
        next.aliases = [alias]
      }
    }

    /* ---- B3 孤儿分类重指派 ---- */
    if (reassignMap[site.id] !== undefined) {
      const target = String(reassignMap[site.id])
      if (target && target !== String(site.categoryId)) {
        mutate()
        changes.push({
          id: site.id,
          name: site.name,
          field: 'categoryId',
          from: site.categoryId,
          to: target,
          action: 'reassignCategory',
          reason: '孤儿分类重指派',
        })
        next.categoryId = target
      }
    }

    /* ---- B4 清理失效图标引用 ---- */
    if (inScope(site) && actions.dropMissingIcons && hasValue(site.icon) && typeof iconExists === 'function') {
      const icon = String(site.icon)
      if (!/^https?:\/\//i.test(icon)) {
        let exists = false
        try { exists = Boolean(iconExists(icon)) } catch { exists = false }
        if (!exists) {
          mutate()
          changes.push({
            id: site.id,
            name: site.name,
            field: 'icon',
            from: icon,
            to: '',
            action: 'dropMissingIcons',
            reason: '图标文件不存在',
          })
          next.icon = ''
        }
      }
    }

    /* ---- B5 重排排序值 ---- */
    if (orderMap) {
      const want = orderMap.get(String(site.id))
      if (Number.isFinite(want) && want !== Number(site.sortOrder)) {
        mutate()
        changes.push({
          id: site.id,
          name: site.name,
          field: 'sortOrder',
          from: site.sortOrder,
          to: want,
          action: 'renumberSortOrder',
          reason: '按现有顺序重排为连续整数',
        })
        next.sortOrder = want
      }
    }

    /* ---- B6 标记人工校正 ---- */
    if (manualSet.has(String(site.id))) {
      const pos = site.position && typeof site.position === 'object' ? site.position : null
      if (pos && pos.source !== 'manual') {
        mutate()
        changes.push({
          id: site.id,
          name: site.name,
          field: 'position.source',
          from: pos.source || '',
          to: 'manual',
          action: 'markManual',
          reason: '人工确认后标记',
        })
        next.position = { ...pos, source: 'manual' }
      }
    }

    /* 变更过的条目统一刷新 updatedAt —— 值是「这次写库的时间」，不是伪造的历史 */
    if (next !== site) next.updatedAt = now

    return next
  })

  /* 汇总：按动作统计，面板要能显示「每项修了几条」 */
  const byAction = {}
  for (const c of changes) byAction[c.action] = (byAction[c.action] || 0) + 1

  return {
    changes,
    nextSites,
    skipped,
    stats: {
      total: list.length,
      /** 作用范围内的站点数；未设范围时等于总数 */
      scopedSites: scoped ? list.filter(inScope).length : list.length,
      scope: scoped ? { categoryId: scope.categoryId || '', domain: scope.domain || '' } : null,
      changedSites: new Set(changes.map(c => c.id)).size,
      changes: changes.length,
      byAction,
    },
  }
}

/* 导出与报告（CSV / Markdown / 切片）已拆分到 shared/data-report.mjs —— 拆分理由见该文件头部。 */
