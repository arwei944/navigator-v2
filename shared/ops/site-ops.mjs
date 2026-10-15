/**
 * 站点数据内核：URL 归一、字段校验、结构化 diff、完整性体检、批量操作。
 *
 * 为什么单独抽出来：站点数据被四端同时读写 —— 本地控制台（tools/console）、
 * 智能体 CLI/MCP（tools/cli、tools/mcp）、线上接口（api/sites.js）、前端管理后台
 * （src/views/AdminView.vue）。任何一处自己写一套「什么叫重复域名 / 批量改分类该改哪些字段」，
 * 迟早会出现「控制台允许、线上拒绝」的口径漂移。因此把纯逻辑收到这里，
 * 各端只负责「取数据 → 调内核 → 落盘 / 上报」。
 *
 * 硬约束：本文件必须保持 **纯函数 + 零依赖**（不 import node:*，不碰 fs / 网络），
 * 否则前端 Vite 打包会失败 —— 它同时被浏览器侧（src/）与 Node 侧（api/、tools/）引用。
 */

import { normalizePurposes, purposeLabel, PURPOSE_IDS, MAX_PURPOSES } from '../purposes.mjs'

/* ---------------- 字段口径 ---------------- */

/** 参与语义比较的字段（忽略 visitCount / updatedAt / createdAt 这类本地噪音） */
export const SITE_FIELDS = ['name', 'url', 'desc', 'categoryId', 'icon', 'color', 'initial', 'sortOrder', 'aliases', 'purposes']

export const FIELD_LABEL = {
  name: '名称', url: '链接', desc: '描述', categoryId: '分类', icon: '图标',
  color: '配色', initial: '首字母', sortOrder: '排序', aliases: '别名', purposes: '用途',
  pinned: '置顶', archived: '归档',
}

/** 允许被编辑 / 批量写入的字段 */
export const EDITABLE_FIELDS = ['name', 'url', 'desc', 'categoryId', 'color', 'initial', 'icon', 'sortOrder', 'aliases', 'purposes']

/* ---------------- URL ---------------- */

// 唯一实现在 shared/host.mjs（本文件原来是四份之一）。
// 既要 re-export（保持既有 import 路径），也要 import（本模块内部有使用）。
export { hostOf, registrableDomain } from '../host.mjs'
import { hostOf, registrableDomain } from '../host.mjs'

/**
 * 落库口径：只保留域名，去协议 / 查询串 / 尾斜杠 —— 以及 `www.` 前缀。
 *
 * 去 `www.` 是与 `shared/host.mjs#hostOf` 对齐的**修正**，不是顺手加的行为：
 * hostOf 早就把 `www.github.com` 与 `github.com` 判为同一个站（它做「已收录」判定），
 * 而落库这一侧原来原样保留了 www —— 于是同一站在库里留下两条不同字符串的记录，
 * 卡片、去重、同域缓存全线对不上（`validateSite` 说「已收录」，用户却在列表里看到两条）。
 * 判重口径与落库口径必须同源。
 */
export function normalizeUrl(input) {
  let raw = String(input || '').trim()
  if (!raw) throw new Error('请填写站点地址')
  // 已显式带 scheme 时必须先校验，否则 ftp://a.com 会被拼成 https://ftp://a.com 蒙混过关
  const scheme = raw.match(/^([a-z][a-z0-9+.-]*):\/\//i)
  if (scheme) {
    if (!/^https?$/i.test(scheme[1])) throw new Error('仅支持 http/https 地址')
  } else {
    raw = 'https://' + raw
  }
  let u
  try { u = new URL(raw) } catch { throw new Error(`站点地址无法解析：${input}`) }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('仅支持 http/https 地址')
  return u.hostname.replace(/^www\./, '')
}

/**
 * 抓取口径：保留用户填写的路径与协议，与线上 api/metadata.js 一致。
 * 落库仍只存域名，但抓取要带路径 —— SPA 子页只有访问原地址才拿得到真实标题。
 */
export function toTarget(input) {
  const raw = String(input || '').trim()
  if (!raw) throw new Error('请填写站点地址')
  return /^https?:\/\//i.test(raw) ? raw : 'https://' + raw
}

/* ---------------- 去重 ---------------- */

/** 判重键：与落库口径同源的裸域名（去协议、路径、`www.`、大小写） */
export function dedupeKey(input) {
  return hostOf(input)
}

/**
 * 找出与候选同域的**已收录**站点。`excludeId` 用于编辑场景（与自己比不算重复）。
 *
 * 为什么用 hostOf 而不是 registrableDomain：`gist.github.com` 与 `github.com`
 * 是两个可独立收录的入口（用户在导航里想分别点到），判重只认完全同域；
 * 「同族但不同入口」属于**近重复**，由 `findNearDuplicates` 另作提示，不在这里拦。
 */
export function findDupe(candidate, sites = [], { excludeId = '' } = {}) {
  const key = dedupeKey(candidate && candidate.url != null ? candidate.url : candidate)
  if (!key) return null
  return (sites || []).find(s => s && s.id !== excludeId && dedupeKey(s.url) === key) || null
}

/* ---------------- 别名 ---------------- */

/**
 * 别名入参归一：接受数组，或「逗号 / 顿号 / 换行」分隔的字符串。
 * 去空白、去重（忽略大小写），并剔除与站名 / 域名同形的项 —— 那些检索已覆盖。
 */
export function normalizeAliases(input, { name = '', url = '' } = {}) {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(/[,，、\n]/)
  const nameLower = String(name || '').trim().toLowerCase()
  const host = String(url || '').toLowerCase().replace(/^www\./, '')
  const out = []
  const seen = new Set()
  for (const item of raw) {
    const a = String(item ?? '').trim()
    if (!a) continue
    const lower = a.toLowerCase()
    if (seen.has(lower) || lower === nameLower || lower === host) continue
    seen.add(lower)
    out.push(a)
  }
  return out
}

/* ---------------- 结构化 diff ---------------- */

/** 站点数组结构化对比：新增 / 移除 / 字段级修改 */
export function diffSites(before, after) {
  const prev = new Map((before || []).map(s => [s.id, s]))
  const next = new Map((after || []).map(s => [s.id, s]))
  const added = []
  const removed = []
  const modified = []
  for (const [id, s] of next) {
    if (!prev.has(id)) { added.push({ id, name: s.name }); continue }
    const p = prev.get(id)
    const fields = SITE_FIELDS.filter(k => JSON.stringify(p[k]) !== JSON.stringify(s[k]))
    if (fields.length) modified.push({ id, name: s.name, fields, labels: fields.map(k => FIELD_LABEL[k] || k) })
  }
  for (const [id, s] of prev) if (!next.has(id)) removed.push({ id, name: s.name })
  return { added, removed, modified, total: next.size }
}

/** 数据完整性：图标缺失 / sortOrder 重复 / 分类数 */
export function checkIntegrity(sites) {
  const list = Array.isArray(sites) ? sites : []
  const counter = new Map()
  for (const s of list) {
    const k = String(s.sortOrder)
    counter.set(k, (counter.get(k) || 0) + 1)
  }
  return {
    total: list.length,
    missingIcon: list.filter(s => !s.icon).map(s => s.id),
    dupSortOrder: [...counter.entries()].filter(([, n]) => n > 1).map(([k]) => Number(k)).sort((a, b) => a - b),
    categories: new Set(list.map(s => s.categoryId)).size,
  }
}

/* ---------------- 单站校验 ---------------- */

/**
 * 单站校验（新增 / 编辑共用）。返回错误信息数组，空数组表示通过。
 * @param {object} site 待校验站点（已归一化）
 * @param {{ sites?: object[], categoryMeta?: object, excludeId?: string }} ctx
 */
export function validateSite(site, { sites = [], categoryMeta = {}, excludeId = '' } = {}) {
  const errors = []
  if (!site.name) errors.push('请填写站点名称')
  if (!site.desc) errors.push('请填写站点描述')
  if (!categoryMeta[site.categoryId]) errors.push(`未登记的分类：${site.categoryId || '(空)'}`)
  const host = hostOf(site.url)
  if (!host) errors.push('站点地址无法解析')
  else {
    const dup = sites.find(s => s.id !== excludeId && hostOf(s.url) === host)
    if (dup) errors.push(`该域名已收录：${dup.id} ${dup.name}`)
  }
  if (site.purposes !== undefined) {
    if (!Array.isArray(site.purposes)) errors.push('用途必须是数组')
    else {
      const bad = site.purposes.filter(id => !PURPOSE_IDS.has(String(id)))
      if (bad.length) errors.push(`未登记的用途：${bad.join('、')}`)
      if (site.purposes.length > MAX_PURPOSES) errors.push(`用途最多 ${MAX_PURPOSES} 个`)
    }
  }
  return errors
}

/* ---------------- id / sortOrder ---------------- */

/** 沿用该分类既有站点的字母前缀；新分类则用分类名首字母，冲突时追加 x 直到唯一 */
export function letterPrefix(categoryId, sites = []) {
  const counts = new Map()
  for (const s of sites) {
    if (s.categoryId !== categoryId) continue
    const m = String(s.id || '').match(/^[a-z]+/)
    if (m) counts.set(m[0], (counts.get(m[0]) || 0) + 1)
  }
  if (counts.size) {
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
  }
  const taken = new Set()
  for (const s of sites) {
    if (s.categoryId === categoryId) continue
    const m = String(s.id || '').match(/^[a-z]+/)
    if (m) taken.add(m[0])
  }
  let p = String(categoryId).toLowerCase().replace(/[^a-z]/g, '').slice(0, 4) || 'x'
  while (taken.has(p)) p += 'x'
  return p
}

/** 分类内序号全局递增（s12 → s13） */
export function nextId(categoryId, sites = []) {
  const prefix = letterPrefix(categoryId, sites)
  const re = new RegExp('^' + prefix + '(\\d+)$')
  let max = 0
  for (const s of sites) {
    const m = String(s.id || '').match(re)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return prefix + (max + 1)
}

/** 跨分类全局递增序号 */
export function nextSortOrder(sites = []) {
  return sites.reduce((n, s) => Math.max(n, Number(s.sortOrder) || 0), 0) + 1
}

/* ---------------- 批量操作 ---------------- */

/**
 * 批量操作目录。`destructive` 的操作在 UI 上必须二次确认；
 * `patchKeys` 声明该操作会写哪些字段，供前端表单与影响面预览共用。
 */
export const BATCH_OPS = {
  fieldset: { id: 'fieldset', label: '多字段编辑', patchKeys: EDITABLE_FIELDS, hint: '同时修改多个字段：只写填了的那几项，留空的保持原样 —— 点「预演影响面」可先看会改哪些字段' },
  category: { id: 'category', label: '改分类', patchKeys: ['categoryId'], requires: ['categoryId'], hint: '把所选站点整体迁移到另一个分类' },
  color: { id: 'color', label: '改配色', patchKeys: ['color'], requires: ['color'], hint: '统一所选站点的主题色' },
  desc: { id: 'desc', label: '改描述', patchKeys: ['desc'], requires: ['desc'], hint: '用同一段文字覆盖所选站点的描述' },
  aliasAdd: { id: 'aliasAdd', label: '追加别名', patchKeys: ['aliases'], requires: ['aliases'], hint: '在既有别名基础上追加（不覆盖）' },
  aliasSet: { id: 'aliasSet', label: '替换别名', patchKeys: ['aliases'], requires: ['aliases'], hint: '整体替换所选站点的别名列表' },
  purposeAdd: { id: 'purposeAdd', label: '追加用途', patchKeys: ['purposes'], requires: ['purposes'], hint: '在既有用途基础上追加（不覆盖，最多 4 个）' },
  purposeSet: { id: 'purposeSet', label: '替换用途', patchKeys: ['purposes'], requires: ['purposes'], hint: '整体替换所选站点的用途标签' },
  pin: { id: 'pin', label: '置顶', patchKeys: ['pinned', 'archived'], hint: '把所选站点置顶（置顶与归档互斥，会一并取消归档）' },
  unpin: { id: 'unpin', label: '取消置顶', patchKeys: ['pinned'], hint: '取消所选站点的置顶' },
  archive: { id: 'archive', label: '归档', patchKeys: ['archived', 'pinned'], hint: '把所选站点移入归档（会一并取消置顶），随时可从归档取回' },
  unarchive: { id: 'unarchive', label: '取消归档', patchKeys: ['archived'], hint: '把所选站点从归档取回' },
  icon: { id: 'icon', label: '清空图标', patchKeys: ['icon'], hint: '清空图标引用，交给前端回落分类色块 + 首字母' },
  remove: { id: 'remove', label: '删除站点', patchKeys: [], destructive: true, hint: '从站点库中整体移除，不可撤销' },
}

export const BATCH_OP_LIST = Object.values(BATCH_OPS)

/**
 * 批量操作参与「有没有变化」比较的字段：比 SITE_FIELDS 多两个布尔开关。
 * `pinned` / `archived` 不参与站点数据的语义 diff（云端同步不该因为置顶就报「更新」），
 * 但批量置顶 / 归档时必须能被识别成「真的改了」，否则会被当成「无变化」而跳过。
 */
const BATCH_COMPARE_FIELDS = [...SITE_FIELDS, 'pinned', 'archived']

/**
 * 计算「批量操作会把数据变成什么样」—— 纯函数，不落盘，dry-run 与实写共用同一条路径，
 * 因此预演结果与实际写入必然一致（这是「影响面预览」可信的前提）。
 *
 * @param {object[]} sites 全量站点
 * @param {{ ids: string[], op: string, patch?: object, categoryMeta?: object }} input
 * @returns {{ ok: boolean, next: object[], affected: object[], changes: object[], removed: object[], skipped: object[], errors: string[] }}
 */
export function applyBatch(sites, { ids = [], op, patch = {}, categoryMeta = {} } = {}) {
  const list = Array.isArray(sites) ? sites : []
  const def = BATCH_OPS[op]
  if (!def) return { ok: false, next: list, affected: [], changes: [], removed: [], skipped: [], errors: [`未知的批量操作：${op}`] }

  const idSet = new Set(ids)
  const targets = list.filter(s => idSet.has(s.id))
  const errors = []
  if (!targets.length) errors.push('未选中任何站点')

  for (const key of def.requires || []) {
    if (patch[key] === undefined || patch[key] === '' || patch[key] === null) errors.push(`${def.label}缺少参数：${key}`)
  }
  if (op === 'category' && patch.categoryId && !categoryMeta[patch.categoryId]) {
    errors.push(`未登记的分类：${patch.categoryId}`)
  }
  if (errors.length) return { ok: false, next: list, affected: [], changes: [], removed: [], skipped: [], errors }

  const now = Date.now()
  const changes = []
  const removed = []
  const skipped = []
  const touched = new Map()

  for (const site of targets) {
    const next = { ...site }

    if (op === 'remove') {
      removed.push({ id: site.id, name: site.name })
      continue
    }

    if (op === 'category') {
      next.categoryId = String(patch.categoryId)
      // 显式给配色时以用户为准；否则跟随新分类主题色，避免「换了分类还是旧色」的割裂感
      if (patch.color !== undefined) next.color = String(patch.color)
      else if (categoryMeta[next.categoryId]?.color) next.color = categoryMeta[next.categoryId].color
    }

    if (op === 'color') next.color = String(patch.color)

    if (op === 'icon') delete next.icon

    if (op === 'aliasAdd' || op === 'aliasSet') {
      const base = op === 'aliasAdd' ? (Array.isArray(site.aliases) ? site.aliases : []) : []
      const aliases = normalizeAliases([...base, ...toList(patch.aliases)], { name: next.name, url: next.url })
      if (aliases.length) next.aliases = aliases
      else delete next.aliases
    }

    if (op === 'purposeAdd' || op === 'purposeSet') {
      const base = op === 'purposeAdd' ? (Array.isArray(site.purposes) ? site.purposes : []) : []
      const purposes = normalizePurposes([...base, ...toList(patch.purposes)])
      if (purposes.length) next.purposes = purposes
      else delete next.purposes
    }

    if (op === 'desc') next.desc = String(patch.desc)

    if (op === 'fieldset') applyFieldset(next, patch)

    // 置顶与归档互斥（与站点卡片上的 togglePin / toggleArchive 同一口径）：
    // 两者同时为真时，取消归档会让这条站突然弹到最前，看起来像凭空冒出来。
    //
    // 只在**确实需要变更**时才写那半个布尔：`archived: undefined` 与 `false` 语义相同，
    // 若一律写 false，一条原本没归档的站也会被 diff 成「有变化」，白白计入影响面。
    if (op === 'pin') { next.pinned = true; if (next.archived) next.archived = false }
    if (op === 'unpin' && next.pinned) next.pinned = false
    if (op === 'archive') { next.archived = true; if (next.pinned) next.pinned = false }
    if (op === 'unarchive' && next.archived) next.archived = false

    const fields = BATCH_COMPARE_FIELDS.filter(k => JSON.stringify(site[k]) !== JSON.stringify(next[k]))
    if (!fields.length) { skipped.push({ id: site.id, name: site.name, reason: '无变化' }); continue }

    next.updatedAt = now
    touched.set(site.id, next)
    changes.push({ id: site.id, name: site.name, fields, labels: fields.map(k => FIELD_LABEL[k] || k) })
  }

  const next = []
  for (const s of list) {
    if (removed.some(r => r.id === s.id)) continue
    next.push(touched.get(s.id) || s)
  }

  return {
    ok: true,
    next,
    affected: [...touched.keys()],
    changes,
    removed,
    skipped,
    errors: [],
  }
}

function toList(input) {
  return Array.isArray(input) ? input : String(input ?? '').split(/[,，、\n]/)
}

/**
 * 多字段编辑：只写 patch 里**明确给了值**的字段，其余保持原样。
 *
 * 空字符串代表「这一栏不动」，不是「清空」—— 前端表单上留空的输入框就是「不改这项」，
 * 若把空串当清空，用户想只改分类就会顺手把描述、别名一起清没。要清空请用专门的
 * `icon`（清图标）或把字段填一个空格这类显式动作，不做隐式清空。
 */
function applyFieldset(next, patch) {
  for (const key of EDITABLE_FIELDS) {
    const v = patch[key]
    if (v === undefined || v === null || v === '') continue
    if (key === 'aliases') {
      const aliases = normalizeAliases(v, { name: next.name, url: next.url })
      if (aliases.length) next.aliases = aliases
      else delete next.aliases
      continue
    }
    if (key === 'purposes') {
      const purposes = normalizePurposes(toList(v))
      if (purposes.length) next.purposes = purposes
      else delete next.purposes
      continue
    }
    next[key] = v
  }
}

/**
 * 扫描「疑似重复 / 近似」站点分组。
 *
 * 抓两类：
 *   - **同族**：同一注册域下的不同入口（`github.com` 与 `gist.github.com`）——
 *     完全同 host 的重复应该在一开始入库时就被 `findDupe` 拦住，这里要抓的是
 *     「拦不住、但看起来是同一家」的那一类，所以放宽到注册域。
 *   - **同名**：注册域不同但站名完全相同（忽略大小写与首尾空白）。
 *
 * @returns {{ key: string, kind: 'family'|'name', label: string, sites: object[] }[]} 只含 ≥2 条的组
 */
export function findNearDuplicates(sites, { minNameLen = 4 } = {}) {
  const list = Array.isArray(sites) ? sites : []
  const groups = []
  const seenRoots = new Set()

  const byRoot = new Map()
  for (const s of list) {
    const root = registrableDomain(s && s.url)
    if (!root) continue
    if (!byRoot.has(root)) byRoot.set(root, [])
    byRoot.get(root).push(s)
  }
  for (const [root, arr] of byRoot) {
    if (arr.length < 2) continue
    seenRoots.add(root)
    groups.push({ key: 'root:' + root, kind: 'family', label: root, sites: arr })
  }

  const byName = new Map()
  for (const s of list) {
    const name = String((s && s.name) || '').trim()
    if (name.length < minNameLen) continue
    const k = name.toLowerCase()
    if (!byName.has(k)) byName.set(k, [])
    byName.get(k).push(s)
  }
  for (const [, arr] of byName) {
    if (arr.length < 2) continue
    // 已作为「同族」报过的组不重复报（同名 + 同域是同一条线索）
    const roots = new Set(arr.map(s => registrableDomain(s.url)))
    if (roots.size === 1 && seenRoots.has([...roots][0])) continue
    groups.push({ key: 'name:' + arr[0].name, kind: 'name', label: arr[0].name, sites: arr })
  }

  return groups
}

/** 批量结果的一句话摘要（日志 / 提交消息 / 通知共用） */
export function batchSummary(result, { op } = {}) {
  if (!result?.ok) return `批量操作失败：${(result?.errors || []).join('；')}`
  const def = BATCH_OPS[op]
  const parts = []
  if (result.changes.length) parts.push(`更新 ${result.changes.length} 个`)
  if (result.removed.length) parts.push(`删除 ${result.removed.length} 个`)
  if (result.skipped.length) parts.push(`跳过 ${result.skipped.length} 个（无变化）`)
  return `${def?.label || op}：${parts.join('，') || '无实际改动'}`
}

/** 由站点数据 diff 生成规范提交消息 */
export function buildSitesCommitMessage(diff) {
  if (!diff) return 'chore(sites): 同步站点数据'
  if (diff.added.length && !diff.removed.length && !diff.modified.length) {
    return `feat(sites): 新增 ${diff.added.map(s => s.name).join('、')}`
  }
  const parts = []
  if (diff.added.length) parts.push(`新增 ${diff.added.length} 个`)
  if (diff.removed.length) parts.push(`移除 ${diff.removed.length} 个`)
  if (diff.modified.length) parts.push(`更新 ${diff.modified.length} 个`)
  const type = diff.added.length ? 'feat' : 'chore'
  return `${type}(sites): ${parts.join('，') || '同步站点数据'}`
}

/** 由站点数据 diff 生成人读摘要 */
export function describeDiff(diff) {
  if (!diff) return ''
  const parts = []
  if (diff.added.length) parts.push(`新增 ${diff.added.map(s => `${s.id} ${s.name}`).join('、')}`)
  if (diff.removed.length) parts.push(`移除 ${diff.removed.map(s => `${s.id} ${s.name}`).join('、')}`)
  if (diff.modified.length) parts.push(`更新 ${diff.modified.map(m => m.id).join('、')}`)
  return parts.join('；')
}

/** 站点关键字匹配（列表搜索 / 命令面板共用同一口径） */
export function matchSite(site, keyword) {
  const kw = String(keyword || '').trim().toLowerCase()
  if (!kw) return true
  return String(site.name).toLowerCase().includes(kw) ||
    String(site.url).toLowerCase().includes(kw) ||
    String(site.desc || '').toLowerCase().includes(kw) ||
    String(site.id).toLowerCase() === kw ||
    (Array.isArray(site.aliases) && site.aliases.some(a => String(a).toLowerCase().includes(kw))) ||
    // 用途既能按 id（英文）也能按中文标签命中，用户输入「查资料」或「reference」都能搜到
    (Array.isArray(site.purposes) && site.purposes.some(p => String(p).toLowerCase().includes(kw) || purposeLabel(p).includes(kw)))
}