/**
 * 重复站点分组与合并 —— 纯函数层。
 *
 * ## 为什么需要「合并」而不是「删除」
 *
 * 两个条目指向同一站点时，它们往往各带一半信息：一条有完整的描述，另一条有别名和访问计数。
 * 直接删掉其中一条，等于把另一半信息一起丢掉。合并要做的正是**把两边都留下**：
 * 别名取并集、用途取并集、访问数相加、描述取更完整的那条。
 *
 * ## 为什么由人决定保留哪条
 *
 * 自动规则（字段更全 → 更新更近 → 访问更多）能给出默认答案，但它看不到「id 是否被
 * 别处引用」「名称是否更好看」这类外部知识。所以本模块只**建议**保留项，
 * 最终由用户在预览里改。字段级也可以逐项指定取谁。
 *
 * 本文件不写库：`buildMergePlan` 返回 `nextSites`，由调用方走 `/api/sites`。
 */

import { normalizeUrl } from './data-audit.mjs'

/**
 * 合并时可逐项指定来源的字段。
 *
 * 这里不列 `visitCount` / `createdAt` / `aliases` / `purposes` ——
 * 它们的合并规则是固定的（相加 / 取最早 / 取并集），让用户选反而会丢数据。
 */
export const MERGE_FIELDS = [
  { key: 'name', label: '名称' },
  { key: 'desc', label: '描述' },
  { key: 'icon', label: '图标' },
  { key: 'color', label: '主题色' },
  { key: 'categoryId', label: '分类' },
  { key: 'position', label: '定位' },
]

/** 名称比较键：忽略大小写与空白差异 */
function nameKey(name) {
  return String(name ?? '').toLowerCase().replace(/\s+/g, '')
}

/** 非空字段数 —— 判断「哪条信息更全」的主指标 */
function richness(site) {
  let n = 0
  for (const k of ['desc', 'icon', 'color', 'initial']) {
    if (String((site && site[k]) ?? '').trim()) n += 1
  }
  for (const k of ['aliases', 'purposes']) {
    if (Array.isArray(site && site[k]) && site[k].length) n += 1
  }
  const p = site && site.position
  if (p && (p.domain || p.stage)) n += 1
  return n
}

/** 默认保留哪一条：信息更全 → 更新更近 → 访问更多 → id 字典序（保证结果稳定） */
export function pickDefaultKeep(sites) {
  return [...sites].sort((a, b) => {
    const ra = richness(b) - richness(a)
    if (ra) return ra
    const ua = Number(b && b.updatedAt || 0) - Number(a && a.updatedAt || 0)
    if (ua) return ua
    const va = Number(b && b.visitCount || 0) - Number(a && a.visitCount || 0)
    if (va) return va
    return String(a && a.id).localeCompare(String(b && b.id))
  })[0]
}

/**
 * 找出重复组。
 *
 * 用并查集而不是简单分组：A 与 B 同网址、B 与 C 同名时，三者其实是一组。
 * 简单按 url 分组会漏掉 C，而用户看到的是「同一条被分成了两组」。
 *
 * @returns {{key:string, ids:string[], sites:object[], matchReasons:string[]}[]}
 */
export function findDuplicateGroups(sites) {
  const list = Array.isArray(sites) ? sites.filter(s => s && s.id) : []
  const parent = new Map()
  for (const s of list) parent.set(String(s.id), String(s.id))

  const find = (x) => {
    let cur = x
    while (parent.get(cur) !== cur) {
      parent.set(cur, parent.get(parent.get(cur)))
      cur = parent.get(cur)
    }
    return cur
  }
  const union = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  const byUrl = new Map()
  const byName = new Map()
  const reasons = new Map() // id -> Set('同网址' | '同名')

  for (const s of list) {
    const id = String(s.id)
    const uk = s.url ? normalizeUrl(s.url).value.toLowerCase() : ''
    const nk = nameKey(s.name)

    if (uk) {
      if (byUrl.has(uk)) {
        union(id, byUrl.get(uk))
        if (!reasons.has(id)) reasons.set(id, new Set())
        reasons.get(id).add('同网址')
      } else {
        byUrl.set(uk, id)
      }
    }
    if (nk) {
      if (byName.has(nk)) {
        union(id, byName.get(nk))
        if (!reasons.has(id)) reasons.set(id, new Set())
        reasons.get(id).add('同名')
      } else {
        byName.set(nk, id)
      }
    }
  }

  const groups = new Map()
  for (const s of list) {
    const root = find(String(s.id))
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(s)
  }

  return [...groups.entries()]
    .filter(([, arr]) => arr.length > 1)
    .map(([key, arr]) => {
      const rs = new Set()
      for (const s of arr) for (const r of reasons.get(String(s.id)) || []) rs.add(r)
      return {
        key,
        ids: arr.map(s => String(s.id)),
        sites: arr,
        names: [...new Set(arr.map(s => s.name))],
        urls: [...new Set(arr.map(s => s.url))],
        matchReasons: [...rs],
        suggestedKeepId: String(pickDefaultKeep(arr).id),
      }
    })
    .sort((a, b) => b.sites.length - a.sites.length || a.key.localeCompare(b.key))
}

/** 合并时取并集并去重，保持首次出现的顺序 */
function unionList(lists) {
  const seen = new Set()
  const out = []
  for (const arr of lists) {
    if (!Array.isArray(arr)) continue
    for (const v of arr) {
      const key = String(v).trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(v)
    }
  }
  return out
}

/**
 * 合并一组站点。
 *
 * @param {object[]} groupSites
 * @param {object} [opts]
 * @param {string} [opts.keepId]            保留哪条（默认按 pickDefaultKeep）
 * @param {object} [opts.fieldChoices]      { desc: 'otherId', icon: 'otherId' } 逐字段指定取谁
 * @param {number} [opts.now]
 * @returns {{merged:object, keepId:string, removedIds:string[], fieldSources:object}}
 */
export function mergeGroup(groupSites, opts = {}) {
  const { keepId = '', fieldChoices = {}, now = Date.now() } = opts
  const list = Array.isArray(groupSites) ? groupSites.filter(Boolean) : []
  if (!list.length) throw new Error('合并组为空')

  const keep = list.find(s => String(s.id) === String(keepId)) || pickDefaultKeep(list)
  const others = list.filter(s => s !== keep)

  const merged = { ...keep }
  const fieldSources = {}

  /* 1) 逐字段指定优先 */
  for (const [field, sourceId] of Object.entries(fieldChoices || {})) {
    const src = list.find(s => String(s.id) === String(sourceId))
    if (!src) continue
    if (src[field] !== undefined && src[field] !== '' && !(Array.isArray(src[field]) && !src[field].length)) {
      merged[field] = Array.isArray(src[field]) ? [...src[field]] : src[field]
      fieldSources[field] = String(src.id)
    }
  }

  /* 2) 描述取最长的那条（信息量最大），除非被显式指定 */
  if (!fieldSources.desc) {
    const best = [keep, ...others].reduce((a, b) => (String(b.desc ?? '').length > String(a.desc ?? '').length ? b : a))
    if (String(best.desc ?? '') !== String(keep.desc ?? '')) {
      merged.desc = best.desc
      fieldSources.desc = String(best.id)
    }
  }

  /* 3) 别名 / 用途取并集 */
  if (!fieldSources.aliases) {
    merged.aliases = unionList([keep.aliases, ...others.map(s => s.aliases)])
    if (merged.aliases.length !== (keep.aliases || []).length) fieldSources.aliases = 'merged'
  }
  if (!fieldSources.purposes) {
    merged.purposes = unionList([keep.purposes, ...others.map(s => s.purposes)])
    if (merged.purposes.length !== (keep.purposes || []).length) fieldSources.purposes = 'merged'
  }

  /* 4) 空字段从其它条目借一个值 */
  for (const k of ['icon', 'color', 'initial']) {
    if (fieldSources[k]) continue
    if (String(merged[k] ?? '').trim()) continue
    const donor = others.find(s => String(s[k] ?? '').trim())
    if (donor) {
      merged[k] = donor[k]
      fieldSources[k] = String(donor.id)
    }
  }

  /* 5) position：取置信度最高的那份（用户看到的「方向/阶段」更可信） */
  if (!fieldSources.position) {
    const withPos = [keep, ...others].filter(s => s.position && (s.position.domain || s.position.stage))
    if (withPos.length > 1) {
      const best = withPos.reduce((a, b) =>
        (Number(b.position.confidence) || 0) > (Number(a.position.confidence) || 0) ? b : a)
      if (best !== keep) {
        merged.position = { ...best.position }
        fieldSources.position = String(best.id)
      }
    }
  }

  /* 6) 计数与时间：访问量相加，创建取最早，更新取本次 */
  merged.visitCount = list.reduce((n, s) => n + (Number(s.visitCount) || 0), 0)
  const created = list.map(s => Number(s.createdAt)).filter(n => Number.isFinite(n) && n > 0)
  if (created.length) merged.createdAt = Math.min(...created)
  merged.updatedAt = now

  /* 7) sortOrder 取最小值，保住原来的位置 */
  const orders = list.map(s => Number(s.sortOrder)).filter(n => Number.isFinite(n) && n > 0)
  if (orders.length) merged.sortOrder = Math.min(...orders)

  return {
    merged,
    keepId: String(keep.id),
    keptName: keep.name,
    removedIds: others.map(s => String(s.id)),
    removedNames: others.map(s => s.name),
    fieldSources,
  }
}

/**
 * 生成全量合并计划（不写库）。
 *
 * @param {object[]} sites
 * @param {object} [opts]
 * @param {object} [opts.choices]     { [groupKey]: { keepId, fields: { desc: id } } }
 * @param {number} [opts.now]
 * @returns {{merges:object[], nextSites:object[], stats:object, groups:object[]}}
 */
export function buildMergePlan(sites, opts = {}) {
  const { choices = {}, now = Date.now() } = opts
  const list = Array.isArray(sites) ? sites : []
  const groups = findDuplicateGroups(list)

  const merges = []
  const byRemoved = new Map()   // 被合并掉的 id → 合并结果（用于替换）
  const removedAll = new Set()

  for (const g of groups) {
    const choice = choices[g.key] || {}
    const r = mergeGroup(g.sites, {
      keepId: choice.keepId || g.suggestedKeepId,
      fieldChoices: choice.fields || {},
      now,
    })
    merges.push({
      key: g.key,
      keepId: r.keepId,
      keptName: r.keptName,
      removedIds: r.removedIds,
      removedNames: r.removedNames,
      fieldSources: r.fieldSources,
      matchReasons: g.matchReasons,
    })
    byRemoved.set(r.keepId, r.merged)
    for (const id of r.removedIds) removedAll.add(id)
  }

  const nextSites = []
  for (const s of list) {
    const id = String(s && s.id)
    if (removedAll.has(id)) continue
    nextSites.push(byRemoved.has(id) ? byRemoved.get(id) : s)
  }

  return {
    groups: groups.map(g => ({
      key: g.key,
      ids: g.ids,
      names: g.names,
      urls: g.urls,
      matchReasons: g.matchReasons,
      suggestedKeepId: g.suggestedKeepId,
      sites: g.sites.map(s => ({
        id: s.id,
        name: s.name,
        url: s.url,
        desc: s.desc,
        icon: s.icon || '',
        visitCount: s.visitCount || 0,
        updatedAt: s.updatedAt || 0,
        aliases: Array.isArray(s.aliases) ? s.aliases : [],
        purposes: Array.isArray(s.purposes) ? s.purposes : [],
        position: s.position || {},
      })),
    })),
    merges,
    nextSites,
    stats: {
      groups: groups.length,
      mergedGroups: merges.length,
      removedSites: removedAll.size,
      before: list.length,
      after: nextSites.length,
    },
  }
}
