/**
 * 站点数据导入 —— 解析、字段映射、冲突计划的纯函数层。
 *
 * ## 为什么要自己写 CSV 解析
 *
 * 站点描述里真实存在逗号、引号与换行（实测 300 条里有大量中文逗号与英文引号）。
 * 用 `split(',')` 解析会把它们切碎，而且错误是静默的 —— 行还是那么多，只是内容错位。
 * 这里是一个最小状态机：支持 BOM、`""` 转义、引号内换行、`\r\n` 与 `\n`。
 *
 * ## 为什么导入也走「计划 → 确认」
 *
 * 导入是覆盖写的一种。先给出「新增多少、覆盖哪些、跳过哪些、哪些行不合法」，
 * 再让调用方确认，和修复计划同一条纪律。`planImport` 只返回 `nextSites`，
 * 不碰存储 —— 落库仍由 `/api/sites` 完成。
 */

import { normalizeUrl } from './data-audit.mjs'

/** 单次导入的行数上限。超过就拒绝，而不是让一次请求把内存和渲染撑爆 */
export const MAX_IMPORT_ROWS = 5000

/** 文件体积上限（字节）。与 transport 层 2MB 的粗保险分开，给出可读的原因 */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024

/**
 * CSV 表头别名 → 站点字段。
 *
 * 为什么需要别名：从 Excel 里整理出来的表，列名通常是「名称 / 网址 / 描述」，
 * 而我们的导出用 `name / url / desc`。两者都要能读，否则用户得先改表头。
 */
const COLUMN_ALIASES = {
  id: 'id',
  编号: 'id',
  name: 'name',
  名称: 'name',
  名字: 'name',
  title: 'name',
  url: 'url',
  link: 'url',
  href: 'url',
  网址: 'url',
  链接: 'url',
  地址: 'url',
  desc: 'desc',
  description: 'desc',
  描述: 'desc',
  简介: 'desc',
  categoryid: 'categoryId',
  category: 'categoryId',
  分类: 'categoryId',
  分类id: 'categoryId',
  purposes: 'purposes',
  用途: 'purposes',
  color: 'color',
  主题色: 'color',
  initial: 'initial',
  首字母: 'initial',
  sortorder: 'sortOrder',
  排序: 'sortOrder',
  icon: 'icon',
  图标: 'icon',
  aliases: 'aliases',
  别名: 'aliases',
  visitcount: 'visitCount',
  'position.domain': 'position.domain',
  方向: 'position.domain',
  'position.stage': 'position.stage',
  阶段: 'position.stage',
  'position.source': 'position.source',
  'position.confidence': 'position.confidence',
  'position.reason': 'position.reason',
}

function canonicalColumn(raw) {
  const key = String(raw ?? '').replace(/^﻿/, '').trim()
  if (!key) return ''
  return COLUMN_ALIASES[key.toLowerCase()] || COLUMN_ALIASES[key] || key
}

/**
 * 解析 CSV 文本为「行数组的数组」。空行会被丢弃（Excel 常在末尾留空行）。
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const src = String(text ?? '').replace(/^﻿/, '')
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1 } // "" → 字面量引号
        else inQuotes = false
      } else {
        cell += ch
      }
      continue
    }

    if (ch === '"') { inQuotes = true; continue }
    if (ch === ',') { row.push(cell); cell = ''; continue }
    if (ch === '\r') {
      // \r\n 与孤立的 \r 都当行尾
      if (src[i + 1] === '\n') i += 1
      row.push(cell); cell = ''
      if (row.some(c => c !== '')) rows.push(row)
      row = []
      continue
    }
    if (ch === '\n') {
      row.push(cell); cell = ''
      if (row.some(c => c !== '')) rows.push(row)
      row = []
      continue
    }
    cell += ch
  }

  // 末行没有换行符时补上
  if (cell !== '' || row.length) {
    row.push(cell)
    if (row.some(c => c !== '')) rows.push(row)
  }

  return rows
}

/** CSV → 对象数组（表头按别名归一化；重复列名保留第一个） */
export function csvToObjects(text) {
  const rows = parseCsv(text)
  if (!rows.length) return { objects: [], headers: [], error: '文件为空或没有可解析的行' }

  const headers = rows[0].map(canonicalColumn)
  const seen = new Set()
  const objects = []

  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r]
    const obj = { __line: r + 1 }
    for (let c = 0; c < headers.length; c += 1) {
      const key = headers[c]
      if (!key || seen.has(`${r}:${key}`)) continue
      obj[key] = cells[c] ?? ''
      seen.add(`${r}:${key}`)
    }
    objects.push(obj)
  }

  return { objects, headers, error: '' }
}

/** 判断一段文本像不像 JSON（导入时用户可能选错格式） */
export function looksLikeJson(text) {
  const t = String(text ?? '').trim()
  return t.startsWith('{') || t.startsWith('[')
}

/**
 * 把导入文件解析成「原始站点对象数组」。
 *
 * 支持三种 JSON 形态：
 *   1. 本插件导出的 `{ kind: 'navigator-sites-export', sites: [...] }`
 *   2. `/api/sites` 的 `{ sites: [...] }`
 *   3. 纯数组 `[...]`（`api/sites-data.json` 的形态）
 *
 * @returns {{ rows: object[], format: string, diagnostics: object[] }}
 */
export function parseImportText(text, { format = 'auto' } = {}) {
  const diagnostics = []
  const raw = String(text ?? '')

  if (Buffer.byteLength(raw, 'utf8') > MAX_IMPORT_BYTES) {
    return { rows: [], format: 'none', diagnostics: [{ level: 'error', message: `文件超过 ${MAX_IMPORT_BYTES / 1024 / 1024} MB 上限` }] }
  }

  const useJson = format === 'json' || (format === 'auto' && looksLikeJson(raw))

  if (useJson) {
    let parsed
    try { parsed = JSON.parse(raw) } catch (e) {
      return { rows: [], format: 'json', diagnostics: [{ level: 'error', message: `JSON 解析失败：${e.message}` }] }
    }
    let sites = null
    if (Array.isArray(parsed)) sites = parsed
    else if (parsed && Array.isArray(parsed.sites)) sites = parsed.sites
    else if (parsed && parsed.kind && Array.isArray(parsed.sites)) sites = parsed.sites

    if (!sites) {
      return { rows: [], format: 'json', diagnostics: [{ level: 'error', message: 'JSON 里没有找到站点数组（需要 sites 字段或顶层数组）' }] }
    }
    return { rows: sites, format: 'json', diagnostics }
  }

  const { objects, headers, error } = csvToObjects(raw)
  if (error) return { rows: [], format: 'csv', diagnostics: [{ level: 'error', message: error }] }
  if (!headers.includes('name') || !headers.includes('url')) {
    return {
      rows: [],
      format: 'csv',
      diagnostics: [{
        level: 'error',
        message: `CSV 表头缺少必需列：${['name', 'url'].filter(k => !headers.includes(k)).join(' / ')}（可用中文「名称 / 网址」）`,
      }],
    }
  }
  return { rows: objects, format: 'csv', diagnostics }
}

/* ================================ 规范化 ================================ */

/** 稳定短哈希：用于从 url 派生可复现的 id */
function shortHash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

const PALETTE = ['#22c55e', '#3b82f6', '#a855f7', '#f97316', '#ec4899', '#06b6d4', '#ef4444', '#6366f1']

function splitList(v) {
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean)
  const s = String(v ?? '').trim()
  if (!s) return []
  return s.split(/[;；|]/).map(x => x.trim()).filter(Boolean)
}

function toNumber(v, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/**
 * 单条原始记录 → 合法站点对象。
 *
 * `index` 只用于生成 id 与报错行号；`now` 由调用方注入以保证可测。
 *
 * @returns {{ site: object|null, issues: object[], warnings: object[] }}
 */
export function normalizeIncomingSite(raw, opts = {}) {
  const {
    index = 0,
    now = Date.now(),
    allowedCategories = null,
    line = null,
  } = opts

  const issues = []
  const warnings = []
  const where = line ? { line } : { index: index + 1 }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { site: null, issues: [{ level: 'error', ...where, message: '不是对象' }], warnings }
  }

  const name = String(raw.name ?? raw.title ?? '').trim()
  const rawUrl = String(raw.url ?? raw.link ?? '').trim()
  const desc = String(raw.desc ?? raw.description ?? '').trim()

  if (!name) issues.push({ level: 'error', ...where, message: '缺少名称' })
  if (!rawUrl) issues.push({ level: 'error', ...where, message: '缺少网址' })

  const n = rawUrl ? normalizeUrl(rawUrl) : null
  if (n && !n.valid) issues.push({ level: 'error', ...where, message: `网址不是合法域名：${rawUrl}` })

  if (issues.length) return { site: null, issues, warnings }

  const categoryId = String(raw.categoryId ?? raw.category ?? '').trim()
  let finalCategory = categoryId
  if (!finalCategory) {
    issues.push({ level: 'error', ...where, message: '缺少分类' })
    return { site: null, issues, warnings }
  }
  if (allowedCategories && !allowedCategories.has(finalCategory)) {
    issues.push({ level: 'error', ...where, message: `分类未登记：${finalCategory}` })
    return { site: null, issues, warnings }
  }

  /* id：优先用文件里的；没有就从网址派生（稳定，重复导入不会产生新 id） */
  let id = String(raw.id ?? '').trim()
  if (!id) id = `imp-${shortHash(n.value.toLowerCase())}`
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    issues.push({ level: 'error', ...where, message: `id 含非法字符：${id}` })
    return { site: null, issues, warnings }
  }

  /* position：JSON 导入带嵌套对象；CSV 是摊平列 */
  let position = null
  if (raw.position && typeof raw.position === 'object' && !Array.isArray(raw.position)) {
    position = { ...raw.position }
  } else if (raw['position.domain'] !== undefined || raw['position.stage'] !== undefined) {
    position = {
      domain: String(raw['position.domain'] ?? '').trim(),
      stage: String(raw['position.stage'] ?? '').trim(),
      source: String(raw['position.source'] ?? 'manual').trim() || 'manual',
      confidence: toNumber(raw['position.confidence'], 0),
      reason: String(raw['position.reason'] ?? '').trim(),
    }
  }
  if (!position) {
    position = { domain: '', stage: '', source: 'manual', confidence: 1, reason: '导入' }
    warnings.push({ level: 'warn', ...where, message: '没有定位信息，已按「人工导入」补齐' })
  }
  if (!position.source) position.source = 'manual'

  const color = String(raw.color ?? '').trim() || PALETTE[index % PALETTE.length]
  const initial = String(raw.initial ?? '').trim() || name.slice(0, 1).toUpperCase()

  const site = {
    id,
    name,
    url: n.value,
    desc,
    categoryId: finalCategory,
    color,
    initial,
    sortOrder: toNumber(raw.sortOrder, 0),
    visitCount: toNumber(raw.visitCount, 0),
    createdAt: toNumber(raw.createdAt, now),
    updatedAt: toNumber(raw.updatedAt, now),
    purposes: splitList(raw.purposes),
    position,
    icon: String(raw.icon ?? '').trim(),
    aliases: splitList(raw.aliases),
  }

  return { site, issues, warnings }
}

/* ================================ 字段级差异 ================================ */

/** 参与差异比较的标量字段 */
const DIFF_SCALARS = ['name', 'url', 'desc', 'categoryId', 'color', 'initial', 'icon']
/** 参与差异比较的数组字段（用 `;` 连接后比较，避免顺序相同但引用不同造成假 diff） */
const DIFF_LISTS = ['purposes', 'aliases']
/** position 子字段 */
const DIFF_POSITION = ['domain', 'stage', 'source', 'confidence', 'reason']

/**
 * 两个站点对象之间的字段级差异。
 *
 * 只比较「覆盖会改到的字段」。`id` / `createdAt` 刻意不参与 ——
 * 覆盖时 id 被强制保留，把「id 没变」也列成一条会让 diff 全是噪音。
 *
 * @returns {{field:string, from:any, to:any}[]}
 */
export function diffSiteFields(before, after) {
  const out = []
  const b = before && typeof before === 'object' ? before : {}
  const a = after && typeof after === 'object' ? after : {}

  for (const k of DIFF_SCALARS) {
    const from = String(b[k] ?? '')
    const to = String(a[k] ?? '')
    if (from !== to) out.push({ field: k, from, to })
  }

  if (Number(b.sortOrder ?? 0) !== Number(a.sortOrder ?? 0)) {
    out.push({ field: 'sortOrder', from: b.sortOrder, to: a.sortOrder })
  }

  for (const k of DIFF_LISTS) {
    const from = Array.isArray(b[k]) ? b[k].join(';') : ''
    const to = Array.isArray(a[k]) ? a[k].join(';') : ''
    if (from !== to) out.push({ field: k, from, to })
  }

  const bp = b.position && typeof b.position === 'object' ? b.position : {}
  const ap = a.position && typeof a.position === 'object' ? a.position : {}
  for (const k of DIFF_POSITION) {
    const from = String(bp[k] ?? '')
    const to = String(ap[k] ?? '')
    if (from !== to) out.push({ field: `position.${k}`, from: bp[k], to: ap[k] })
  }

  return out
}

/* ================================ 冲突计划 ================================ */

export const IMPORT_STRATEGIES = [
  {
    key: 'skip',
    label: '跳过已存在',
    desc: '按 id 或归一化网址匹配到已有站点就跳过，只导入新的。最安全。',
  },
  {
    key: 'overwrite',
    label: '覆盖同 id / 同网址',
    desc: '匹配到已有站点时用导入内容替换，保留原 id。适合「修好表再导回来」。',
  },
  {
    key: 'new-id',
    label: '全部作为新站点',
    desc: '忽略匹配，为每条导入生成新 id。适合把一份清单并入现有库。',
  },
]

/**
 * 生成导入计划（不写库）。
 *
 * @param {object[]} existingSites 当前站点（权威数据）
 * @param {object[]} incomingRows 解析出来的原始行
 * @param {object} opts
 * @param {string}   [opts.strategy]           skip / overwrite / new-id
 * @param {Map}      [opts.categoryIndex]      分类白名单
 * @param {number}   [opts.now]
 * @returns {{adds, updates, skips, invalid, nextSites, stats, diagnostics}}
 */
export function planImport(existingSites, incomingRows, opts = {}) {
  const {
    strategy = 'skip',
    categoryIndex = null,
    now = Date.now(),
  } = opts

  const existing = Array.isArray(existingSites) ? existingSites : []
  const rows = Array.isArray(incomingRows) ? incomingRows : []

  const allowed = categoryIndex ? new Set(categoryIndex.keys()) : null

  if (rows.length > MAX_IMPORT_ROWS) {
    return {
      adds: [], updates: [], skips: [], invalid: [],
      nextSites: existing,
      stats: { incoming: rows.length, adds: 0, updates: 0, skips: 0, invalid: 0 },
      diagnostics: [{ level: 'error', message: `导入 ${rows.length} 行超过上限 ${MAX_IMPORT_ROWS}，请拆分成多份` }],
      blocked: true,
    }
  }

  const byId = new Map()
  const byUrl = new Map()
  for (const s of existing) {
    if (s && s.id) byId.set(String(s.id), s)
    if (s && s.url) byUrl.set(normalizeUrl(s.url).value.toLowerCase(), s)
  }

  const adds = []
  const updates = []
  const skips = []
  const invalid = []
  const diagnostics = []
  const usedIds = new Set(existing.map(s => String(s && s.id)))
  /** 本批次内用于「新 id」策略的去重，避免同一文件里两行生成同一个 id */
  const batchIds = new Set()

  rows.forEach((raw, i) => {
    const line = raw && raw.__line ? raw.__line : null
    const { site, issues, warnings } = normalizeIncomingSite(raw, {
      index: i,
      now,
      allowedCategories: allowed,
      line,
    })

    for (const w of warnings) diagnostics.push(w)
    if (!site) {
      invalid.push({ line, index: i + 1, issues })
      for (const it of issues) diagnostics.push(it)
      return
    }

    const matchById = byId.get(site.id) || null
    const matchByUrl = byUrl.get(normalizeUrl(site.url).value.toLowerCase()) || null
    const matched = matchById || matchByUrl

    if (strategy === 'new-id') {
      let candidate = site.id
      let n = 2
      while (usedIds.has(candidate) || batchIds.has(candidate)) {
        candidate = `${site.id}-${n}`
        n += 1
      }
      const finalSite = { ...site, id: candidate, updatedAt: now }
      batchIds.add(candidate)
      adds.push(finalSite)
      return
    }

    if (matched) {
      if (strategy === 'skip') {
        skips.push({ id: matched.id, name: matched.name, incomingName: site.name, reason: matchById ? '同 id' : '同网址' })
        return
      }
      // overwrite：保留原 id，其余以导入内容为准
      const merged = { ...site, id: matched.id, updatedAt: now }
      updates.push({
        id: matched.id,
        name: matched.name,
        incomingName: site.name,
        next: merged,
        fields: diffSiteFields(matched, merged),
        reason: matchById ? '同 id' : '同网址',
      })
      return
    }

    // 新增：id 可能与批内其它行冲突（导入文件自身重复）
    let candidate = site.id
    let n = 2
    while (usedIds.has(candidate) || batchIds.has(candidate)) {
      candidate = `${site.id}-${n}`
      n += 1
    }
    const finalSite = { ...site, id: candidate, updatedAt: now }
    batchIds.add(candidate)
    adds.push(finalSite)
  })

  /* 组装下一版数组：覆盖按 id 原地替换，新增追加到末尾并顺延 sortOrder */
  const updateMap = new Map(updates.map(u => [u.id, u.next]))
  let maxOrder = existing.reduce((m, s) => Math.max(m, toNumber(s && s.sortOrder, 0)), 0)

  const nextSites = existing.map(s => (s && updateMap.has(String(s.id)) ? updateMap.get(String(s.id)) : s))

  for (const a of adds) {
    maxOrder += 1
    nextSites.push({ ...a, sortOrder: a.sortOrder > 0 ? a.sortOrder : maxOrder })
  }

  return {
    adds,
    updates,
    skips,
    invalid,
    nextSites,
    stats: {
      incoming: rows.length,
      adds: adds.length,
      updates: updates.length,
      /**
       * 覆盖但在字段层面没有任何变化的条数。
       * 实测「导出再导回」时这个值等于 updates —— 没有它，用户会以为真改了 300 条。
       */
      noopUpdates: updates.filter(u => !u.fields || u.fields.length === 0).length,
      changedFields: updates.reduce((n, u) => n + (u.fields ? u.fields.length : 0), 0),
      skips: skips.length,
      invalid: invalid.length,
    },
    diagnostics,
    blocked: false,
  }
}
