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
export const EMPTY_CLICKS = { version: 0, updatedAt: null, sites: 0, total: 0, clicks: {}, series: {} }

/* ------------------------------------------------------------------ *
 * 时间分桶（v11）
 *
 * 为什么是**平行于 clicks 的第二份结构**而不是把 clicks 的值改成
 * `{ total, buckets }`：clicks 是三个读写方共用了很久的口径（前端角标、排行、
 * 后台看板都直接读它），改值等于让既有 29 套件的断言与所有读点一起重写。
 * series 只服务于「趋势图」这一个新增用途，缺了它页面降级成「暂无趋势」，
 * 不会让任何既有能力坏掉 —— 这是纯增量，不是破坏性迁移。
 * ------------------------------------------------------------------ */

/** 时间分桶保留天数（超出即裁剪，防止云端对象随站点数无限膨胀） */
export const SERIES_DAYS = 90
/** 趋势图默认取最近多少天 */
export const SERIES_WINDOW = 30

function toDate(input) {
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : new Date(input.getTime())
  if (typeof input === 'number' || typeof input === 'string') {
    const d = new Date(input)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

/**
 * 归一成桶键 `'YYYY-MM-DD'`。
 * 按**本地时区**而非 UTC：用户在 GMT+8，UTC 分桶会把晚上的点击记到前一天，
 * 趋势图横轴对不上直觉。跨端时区差异会让桶键不完全一致，但这是统计量，
 * 误差远小于「横轴错一天」的观感代价。非法输入返回空串（调用方据此跳过写入）。
 */
export function dayKey(input) {
  const d = toDate(input)
  if (!d) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 在给定日期上加减天数（用 setDate 而非毫秒，避开夏令时与月末进位） */
function shiftDays(input, delta) {
  const d = toDate(input)
  if (!d) return null
  d.setDate(d.getDate() + delta)
  return d
}

/**
 * 裁剪 series：丢掉早于「今天往前 keepDays-1 天」的桶。
 * 桶键是定长 `YYYY-MM-DD`，字典序等于时间序，直接字符串比较即可，不必解析日期。
 */
export function pruneSeries(series, today = new Date(), keepDays = SERIES_DAYS) {
  const base = shiftDays(today, -(Math.max(1, keepDays) - 1))
  const cutoff = base ? dayKey(base) : ''
  const out = {}
  for (const [id, buckets] of Object.entries(series || {})) {
    if (!buckets || typeof buckets !== 'object') continue
    const kept = {}
    for (const [key, n] of Object.entries(buckets)) {
      const v = Math.floor(Number(n) || 0)
      if (v <= 0 || typeof key !== 'string' || key.length !== 10) continue
      if (cutoff && key < cutoff) continue
      kept[key] = v
    }
    if (Object.keys(kept).length) out[id] = kept
  }
  return out
}

/**
 * 把一次上报的增量 `{id: n}` 叠加进 series，并顺带裁剪。
 * 纯函数：不修改入参。非法桶键 / 非正值在裁剪环节被一并清掉，脏数据不会落库。
 */
export function applySeries(prev, increments, { today = new Date(), keepDays = SERIES_DAYS } = {}) {
  const out = {}
  for (const [id, buckets] of Object.entries(prev || {})) {
    if (!buckets || typeof buckets !== 'object') continue
    const kept = {}
    for (const [key, n] of Object.entries(buckets)) {
      const v = Math.floor(Number(n) || 0)
      if (v > 0 && typeof key === 'string' && key.length === 10) kept[key] = v
    }
    if (Object.keys(kept).length) out[id] = kept
  }
  const key = dayKey(today)
  if (key) {
    for (const [id, n] of Object.entries(increments || {})) {
      const step = Math.floor(Number(n) || 0)
      if (step <= 0) continue
      const cur = out[id] || (out[id] = {})
      cur[key] = Math.floor(Number(cur[key]) || 0) + step
    }
  }
  return pruneSeries(out, today, keepDays)
}

/**
 * 取某站点最近 days 天的定长数组（**从旧到新**，缺失补 0）—— sparkline 直接吃这个。
 * 定长是刻意的：图表不该自己算日期，否则每个组件都要复制一遍「补零 / 排序」逻辑。
 */
export function seriesOf(series, id, { days = SERIES_WINDOW, today = new Date() } = {}) {
  const span = Math.max(1, Math.floor(Number(days) || SERIES_WINDOW))
  const buckets = (series || {})[id]
  const map = buckets && typeof buckets === 'object' ? buckets : {}
  const out = new Array(span).fill(0)
  const base = toDate(today) || new Date()
  base.setHours(12, 0, 0, 0)
  for (let back = span - 1; back >= 0; back -= 1) {
    const d = new Date(base.getTime())
    d.setDate(d.getDate() - back)
    out[span - 1 - back] = Math.max(0, Math.floor(Number(map[dayKey(d)]) || 0))
  }
  return out
}

/**
 * 按当前站点集剔除 series 里的孤儿桶：站点删了，它的趋势也必须一起消失，
 * 否则既污染趋势图，也可能被未来同 id 的新站点继承。`known` 为空时整份保留。
 */
export function filterSeries(series, known) {
  if (!known || typeof known.has !== 'function') return series || {}
  const out = {}
  for (const [id, buckets] of Object.entries(series || {})) {
    if (known.has(id)) out[id] = buckets
  }
  return out
}

/** series 里某站点的窗口内总量（与 countOf 的区别：只数窗口内的，用于「近 30 天」口径） */
export function windowedCount(series, id, opts = {}) {
  return seriesOf(series, id, opts).reduce((a, b) => a + b, 0)
}