/**
 * 站点探活的**纯规则**：分级口径 + 限流码集合 + 汇总计数。
 *
 * 为什么与 `health-probe.mjs` 分开：探活引擎依赖 `node:child_process`（curl.exe），
 * 而 Vercel Serverless（`api/health.js`）写入判定时也要用同一套分级规则，
 * 不能把一个会拉起子进程的模块拖进函数运行时。
 * 规则放这里、引擎从这里引用 —— 「本机探活的判定」与「云端写入的归一」口径不分叉。
 *
 * 分级（前端角标 / 控制台看板 / CLI 共用同一语义）：
 *  - ok      : 2xx / 3xx 可访问
 *  - limited : 429/403/405/401 —— 限流 / 反爬 / 方法误用 / 鉴权，站点实际可用
 *  - down    : 连接失败 / ERR / 000 / 404 / 402 / 410 等真实失效
 *  - unknown : 未探测（无云端判定时的兜底）
 */

/** 限流 / 反爬 / 方法误用 / 鉴权：站点实际可用，不计入「需处理」 */
export const IGNORABLE = new Set([429, 403, 405, 401])

export const STATUS_LABEL = { ok: '正常', limited: '可忽略', down: '需处理', unknown: '未探测' }

/** 由 HTTP 码（或 'ERR' / '000'）判定分级 */
export function verdictOf(code) {
  if (code === 'ERR' || code === '000') return 'down'
  const n = Number(code)
  if (Number.isNaN(n)) return 'down'
  if (n >= 400) return IGNORABLE.has(n) ? 'limited' : 'down'
  return 'ok'
}

/** 汇总计数（看板 / CLI / 云端写入共用同一份口径） */
export function tally(results) {
  const out = { ok: 0, limited: 0, down: 0 }
  for (const r of results) out[r.status] = (out[r.status] || 0) + 1
  return out
}

/**
 * 把一批探活结果并进既有判定，产出要落库的那份数据 —— **合并逻辑的唯一实现**。
 *
 * 为什么抽出来：v10 加了服务端定时巡检，它与 `api/health.js` 的 POST 走的是同一份
 * 「合并而非覆盖 + 按当前站点集剔除 + version 递增 + 计数」口径。两处各写一遍，
 * 迟早会漂移（而漂移的后果是「死链悄悄从体检清单里消失」这种静默退化）。
 *
 * @param {{ prev?: object|null, incoming: Record<string, {code: string, status: string, ms: number|null}>,
 *           knownIds?: Set<string>|null, actor?: string, proxy?: string }} args
 *   `knownIds` 为 null（读不到站点表）时**跳过剔除**：判定宁可多留一条，
 *   也不能因为读不到站点表就把整份判定清空。
 */
export function buildHealthPayload({ prev = null, incoming = {}, knownIds = null, actor = 'unknown', proxy = '' } = {}) {
  const prevResults = prev && prev.results && typeof prev.results === 'object' ? prev.results : {}
  const merged = {}
  for (const [id, r] of Object.entries({ ...prevResults, ...incoming })) {
    if (!knownIds || knownIds.has(id)) merged[id] = r
  }
  return {
    version: ((prev && Number(prev.version)) || 0) + 1,
    updatedAt: new Date().toISOString(),
    actor: String(actor).slice(0, 40),
    proxy: String(proxy || '').slice(0, 120),
    counts: { total: Object.keys(merged).length, ...tally(Object.values(merged)) },
    results: merged,
  }
}

/** 探活结果数组 → incoming 映射（巡检与接口共用同一归一：code → verdict） */
export function toIncoming(rows) {
  const out = {}
  for (const r of rows || []) {
    const id = String((r && r.id) || '').trim()
    if (!id) continue
    const code = String(r.code == null || r.code === '' ? 'ERR' : r.code).trim() || 'ERR'
    const ms = Number(r.ms)
    out[id] = { code, status: verdictOf(code), ms: Number.isFinite(ms) ? Math.round(ms) : null }
  }
  return out
}