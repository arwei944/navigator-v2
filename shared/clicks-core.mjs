/**
 * 点击统计的**纯规则**：增量校验 / 合并 / 汇总 / 排行。
 *
 * 为什么单独抽出来：点击数据有三个读写方 —— 访客前端（`src/stores/clicks.js` 攒本地待发队列）、
 * 线上接口（`api/clicks.js` 匿名写入 + 公开读取）、管理后台（排行与角标）。
 * 任何一处自己写一套「多大算一条有效点击 / 合并时怎么加 / 删除站点后怎么剔除」，
 * 迟早出现「前端记了、云端不认」的口径漂移。因此把纯逻辑收到这里，各端只负责搬运。
 *
 * 硬约束：本文件必须保持 **纯函数 + 零依赖**（不 import node:*，不碰 fs / 网络），
 * 否则前端 Vite 打包会失败 —— 它同时被浏览器侧（src/）与 Node 侧（api/）引用。
 */

/** 单次上报最多覆盖的站点数（防止匿名接口被一次性灌入海量 id） */
export const MAX_BATCH = 300
/** 单站点单次上报的最大增量（正常一次点击 = 1，钳制是为了抵御刷量脚本） */
export const MAX_STEP = 50
/** 单次上报的总增量上限 */
export const MAX_TOTAL_STEP = 2000
/** 站点 id 的最大长度（超长 id 一律丢弃，避免脏键落库） */
export const MAX_ID_LEN = 64

/**
 * 校验并归一匿名上报的增量。
 * 接受 `[{ id, n }]` 或 `[{ id, count }]`；同一 id 重复出现时累加（仍受 MAX_STEP 约束）。
 * 非法项（无 id / 非正数 / 超长 id）静默丢弃 —— 匿名接口宁可少记，不可因一条脏数据整批失败。
 */
export function normalizeIncrements(input, { maxBatch = MAX_BATCH, maxStep = MAX_STEP, maxTotal = MAX_TOTAL_STEP } = {}) {
  const list = Array.isArray(input) ? input : []
  const agg = {}
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const id = String(item.id ?? '').trim()
    if (!id || id.length > MAX_ID_LEN) continue
    const n = Math.floor(Number(item.n ?? item.count ?? 0))
    if (!Number.isFinite(n) || n <= 0) continue
    agg[id] = Math.min((agg[id] || 0) + Math.min(n, maxStep), maxStep)
  }
  const entries = Object.entries(agg).slice(0, maxBatch)
  const out = {}
  let total = 0
  for (const [id, n] of entries) {
    if (total + n > maxTotal) break
    out[id] = n
    total += n
  }
  return { entries: out, sites: Object.keys(out).length, total }
}

/**
 * 合并点击：prev（云端已存） + incoming（本次增量）逐站点相加。
 * `known` 传入当前站点 id 集合时**顺带剔除已删除站点** —— 站点下架后其点击必须一起消失，
 * 否则既污染 total，也可能被未来同 id 的新站点继承。
 * known 为 null / undefined 时跳过剔除（读不到站点表时宁可多留，也不清空整份统计）。
 */
export function mergeClicks(prev, incoming, { known } = {}) {
  const out = {}
  const add = (id, n) => {
    const v = Math.floor(Number(n) || 0)
    if (v <= 0) return
    if (known && !known.has(id)) return
    out[id] = (out[id] || 0) + v
  }
  for (const [id, n] of Object.entries(prev || {})) add(id, n)
  for (const [id, n] of Object.entries(incoming || {})) add(id, n)
  return out
}

/** 汇总：有点击的站点数 + 总点击量 */
export function tallyClicks(clicks) {
  let total = 0
  let sites = 0
  for (const n of Object.values(clicks || {})) {
    const v = Math.floor(Number(n) || 0)
    if (v > 0) { sites += 1; total += v }
  }
  return { sites, total }
}

/** 读某站点点击量（缺失 / 非法一律按 0，前端角标不必各写一遍兜底） */
export function countOf(clicks, id) {
  return Math.max(0, Math.floor(Number(clicks?.[id]) || 0))
}

/**
 * 按点击量降序排行；同分时按名称升序，保证顺序稳定（否则同分站点会随数据刷新抖动）。
 * 纯函数：不修改入参数组。
 */
export function rankByClicks(sites, clicks, { limit } = {}) {
  const out = [...(sites || [])].sort((a, b) =>
    (countOf(clicks, b.id) - countOf(clicks, a.id)) ||
    String(a.name || '').localeCompare(String(b.name || '')))
  return typeof limit === 'number' ? out.slice(0, limit) : out
}

/** 云端未存储时的空统计（前端据此显示「暂无点击数据」而不是报错） */
export const EMPTY_CLICKS = { version: 0, updatedAt: null, sites: 0, total: 0, clicks: {} }