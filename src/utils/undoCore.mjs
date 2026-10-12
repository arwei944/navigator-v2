/**
 * 撤销栈内核：纯函数、零依赖。
 *
 * ## 为什么需要
 *
 * 批量删/改错了，以前的出路只有回收站 —— 而**改分类、加用途、置顶、归档连回收站都进不去**，
 * 改错了就改不回来。这是真实的数据安全缺口。
 *
 * ## 为什么反向补丁要按当前值快照
 *
 * 撤销要恢复**原值**，不是一律取反。批量置顶时有些站本来就已经是 pinned，
 * 一律取反会把它们改成未置顶 —— 撤销反而制造了新错误。
 * 所以入栈前必须按每个站的当前值各算一份补丁。
 *
 * ## 约束
 *
 * - 只留最近 `UNDO_MAX` 步（丢最旧的）：栈无限长等于没有撤销，用户找不到该撤哪一步
 * - `UNDO_TTL` 之后视为过期：撤销窗口太长时，「撤销」已经指不清是哪次操作了
 * - 纯函数：入栈/清过期/算反向补丁都不碰 store，可在 node 里穷举测试
 */

/** 只保留最近这么多步 */
export const UNDO_MAX = 10
/** 可撤销窗口（毫秒） */
export const UNDO_TTL = 5000

/**
 * 撤销的两种形态。
 *
 * - `patch`：把 `ops` 里的反向补丁写回字段（改分类 / 加用途 / 置顶 / 归档）。
 * - `restore`：`ops` 只有 id，撤销时从回收站取回（删除）。
 *
 * 删除**不**走补丁：站点已经不在列表里了，反向补丁没有「当前值」可快照；
 * 而回收站本就是删除的二次容器，撤销＝还原，是既有能力，不为它另造机制。
 */
export const UNDO_KINDS = ['patch', 'restore']

/** 建一步。ops 是「恢复用」的补丁列表：[{ id, patch }]（restore 形态只需 [{ id }]） */
export function makeStep({ label, ops, kind = 'patch', ttl = UNDO_TTL, now = Date.now() }) {
  return {
    id: `u${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    label: String(label || ''),
    kind: UNDO_KINDS.includes(kind) ? kind : 'patch',
    ops: Array.isArray(ops) ? ops.filter(o => o && o.id) : [],
    expiresAt: now + (Number(ttl) > 0 ? Number(ttl) : UNDO_TTL)
  }
}

/**
 * 入栈并裁剪到 UNDO_MAX。
 * **返回新数组**（不原地改）—— 调用方多是 computed / watch，原地改会让 Vue 漏检。
 */
export function pushUndo(steps, step) {
  const list = Array.isArray(steps) ? steps.slice() : []
  list.push(step)
  // 丢最旧的：最近的操作才最可能被撤销
  while (list.length > UNDO_MAX) list.shift()
  return list
}

/** 清掉超过 TTL 的步；未过期的一项不动 */
export function dropExpired(steps, now = Date.now()) {
  if (!Array.isArray(steps)) return []
  return steps.filter(s => s && Number(s.expiresAt) > now)
}

/** 最新一步（可能是 undefined） */
export function topStep(steps) {
  return Array.isArray(steps) && steps.length ? steps[steps.length - 1] : null
}

/**
 * 按站点当前值算 `patch` 的**反向补丁**。
 *
 * @param {Array<{id:string}>} sites 当前站点列表
 * @param {string[]} ids 要改动的 id
 * @param {object} patch 即将应用的补丁（如 `{ pinned: true, archived: false }`）
 * @returns {Array<{id:string, patch:object}>} 每个 id 一份「改回原样」的补丁
 *
 * 不存在的 id 静默跳过（与 batchUpdate 的口径一致：不存在的 id 忽略）。
 * 站点**没有**的字段，反向补丁记为 undefined —— 恢复时删掉该字段，
 * 而不是留一个 `undefined` 值（那会让 `site.pinned === undefined` 与 `false` 混淆）。
 */
export function undoPatches(sites, ids, patch) {
  const byId = new Map()
  for (const s of Array.isArray(sites) ? sites : []) {
    if (s && typeof s.id === 'string') byId.set(s.id, s)
  }
  const keys = patch && typeof patch === 'object' ? Object.keys(patch) : []
  const out = []
  const seen = new Set()
  for (const id of Array.isArray(ids) ? ids : []) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    const site = byId.get(id)
    if (!site) continue
    const back = {}
    for (const k of keys) back[k] = site[k]
    out.push({ id, patch: back })
  }
  return out
}

/**
 * 把一份反向补丁应用回站点列表，返回**新列表**。
 * 只补 `patch` 里出现的键 —— 撤销不该顺手动其它字段（那会覆盖期间的其它改动）。
 */
export function applyUndo(sites, ops) {
  const byId = new Map()
  for (const o of Array.isArray(ops) ? ops : []) {
    if (o && o.id && o.patch && typeof o.patch === 'object') byId.set(o.id, o.patch)
  }
  if (!byId.size) return Array.isArray(sites) ? sites.slice() : []
  return (Array.isArray(sites) ? sites : []).map(s => {
    const p = byId.get(s.id)
    return p ? { ...s, ...p } : s
  })
}
