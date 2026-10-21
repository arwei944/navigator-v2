/**
 * 三端同步的核心规则（纯函数，无 IO，可单测）。
 *
 * ## 「以最新数据为准」到底怎么判
 *
 * 三端各自写入时都会把 `updatedAt` 改成自己的写入时间，`version` 也各自 +1。
 * 因此不能简单比较 version（同步写入会让落后端的 version 追上甚至超过源端，
 * 但内容其实一样），也不能只看时间（同一份内容被写了三次，时间会一直变新）。
 *
 * 判定顺序：
 *   1. **先比内容指纹**（sites + categories，忽略 version/updatedAt）。
 *      指纹全相同 = 已一致，直接结束，一次写都不做。
 *   2. 内容不同时，才比 `updatedAt`；相同再比 `version`；
 *      还相同就用 id 稳定排序兜底（保证结果可复现，不会两端来回推）。
 *   3. 只把 winner 推给「内容不同且更旧 / 为空」的端。
 *      **绝不推给内容更新的端** —— 那会覆盖掉另一端刚做的修改。
 *
 * ## 冲突
 *
 * 两端的 `updatedAt` 完全相同但内容不同，属于「同一毫秒的并发写」。
 * 这时仍按稳定规则选一个 winner，但在计划里标 `conflict: true`，
 * 由面板显式提示 —— 静默选一个是最容易掩盖数据丢失的做法。
 */
import { createHash } from 'node:crypto'

/**
 * 参与三端一致性判定的字段。
 *
 * **刻意排除** `archived` / `pinned` / `visitCount` / `updatedAt`：
 *   - 前两个由各端健康巡检自动改写（`server/cron.mjs` 会把连续失效的站点归档），
 *     三个端巡检进度不同，把它们算进指纹会让「内容明明一样」永远判成不一致；
 *   - `visitCount` 是每台设备自己的浏览统计，同步覆盖它等于把别人的数据清零；
 *   - `updatedAt` 会在每次写入时被目标端改写成当前时间，无法用于跨端比较。
 *
 * 这四类属于「本地状态」，写入时由 `withLocalState` 从目标端原样保留。
 */
const SYNC_FIELDS = [
  'id', 'name', 'url', 'desc', 'categoryId', 'color', 'initial',
  'sortOrder', 'createdAt', 'icon', 'aliases', 'purposes', 'position',
]

/** 键排序的稳定序列化：对象键顺序不同不该产生不同指纹 */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}

/** 三端一致性指纹：只覆盖可同步的业务字段 + 分类表 */
export function syncFingerprint(data) {
  const sites = Array.isArray(data?.sites) ? data.sites : []
  const normalized = sites
    .map(site => {
      const picked = {}
      for (const key of SYNC_FIELDS) {
        if (site && site[key] !== undefined) picked[key] = site[key]
      }
      return picked
    })
    .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')))
  const categories = Array.isArray(data?.categories) ? data.categories : []
  return createHash('sha256').update(stableStringify({ sites: normalized, categories })).digest('hex')
}

/** 稳定比较：时间新 → version 大 → 站点多 → id 小 */
function compareNewer(a, b) {
  const ta = Date.parse(a?.data?.updatedAt || '') || 0
  const tb = Date.parse(b?.data?.updatedAt || '') || 0
  if (ta !== tb) return tb - ta
  const va = Number(a?.data?.version) || 0
  const vb = Number(b?.data?.version) || 0
  if (va !== vb) return vb - va
  const sa = Array.isArray(a?.data?.sites) ? a.data.sites.length : 0
  const sb = Array.isArray(b?.data?.sites) ? b.data.sites.length : 0
  if (sa !== sb) return sb - sa
  return String(a?.id || '').localeCompare(String(b?.id || ''))
}

function byId(a, b) {
  return String(a?.id || '').localeCompare(String(b?.id || ''))
}

/** 每端一行摘要（给面板直接用，不再让前端重复算） */
export function summarizeTarget(target) {
  const data = target && target.data
  return {
    id: String(target?.id || ''),
    label: String(target?.label || target?.id || ''),
    url: String(target?.url || ''),
    ok: Boolean(target?.ok),
    error: target?.error ? String(target.error) : null,
    version: data ? Number(data.version) || 0 : null,
    updatedAt: data?.updatedAt ? String(data.updatedAt) : null,
    sites: Array.isArray(data?.sites) ? data.sites.length : null,
    categories: Array.isArray(data?.categories) ? data.categories.length : null,
    fingerprint: data ? syncFingerprint(data) : null,
  }
}

/**
 * 选主。
 *
 * 已一致时**不按时间选**，而按 id 选：内容相同的情况下让「权威端」标签保持稳定，
 * 否则每次同步都会因为谁最后被写而漂移，面板看起来像在抽风。
 */
export function pickWinner(targets) {
  const usable = (Array.isArray(targets) ? targets : []).filter(
    t => t && t.ok && t.data && Array.isArray(t.data.sites) && t.data.sites.length > 0,
  )
  if (!usable.length) return null
  const fps = new Set(usable.map(t => syncFingerprint(t.data)))
  if (fps.size === 1) return [...usable].sort(byId)[0]
  return [...usable].sort(compareNewer)[0]
}

/**
 * 生成一次同步计划。
 *
 * @param {{id:string,label:string,url:string,ok:boolean,error?:string,data?:object}[]} targets
 * @param {{at?:string}} [opts]
 * @returns {{
 *   at: string,
 *   winner: object|null,
 *   targets: object[],
 *   actions: {id:string,label:string,reason:string}[],
 *   conflicts: {id:string,label:string}[],
 *   consistent: boolean,
 *   unreachable: string[],
 * }}
 */
export function planSync(targets, opts = {}) {
  const at = opts.at || new Date().toISOString()
  const list = Array.isArray(targets) ? targets : []
  /**
   * 固定权威端（`NAV_SYNC_AUTHORITY`，默认 botkeep）。
   *
   * 与「自动选最新」的区别：
   *   - 权威端**只读不写**。即使另一端的 `updatedAt` 更晚，也不会反向覆盖权威端；
   *   - 权威端不可达时不执行任何写入 —— 宁可这一轮不同步，也不能让「另一个端
   *     看起来更新」成为覆盖 BotKeep 的理由；
   *   - 其他端比权威端新时记 `diverged`，面板显式提示，由人决定要不要人工处理。
   */
  const authorityId = opts.authority ? String(opts.authority) : ''
  let winner = null
  let authorityUnavailable = false

  if (authorityId) {
    const auth = list.find(t => String(t.id) === authorityId)
    if (!auth || !auth.ok || !Array.isArray(auth.data?.sites) || auth.data.sites.length === 0) {
      authorityUnavailable = true
    } else {
      winner = auth
    }
  } else {
    winner = pickWinner(list)
  }

  const summaries = list.map(summarizeTarget)
  const winnerFp = winner ? syncFingerprint(winner.data) : null

  const actions = []
  const conflicts = []
  const diverged = []
  const unreachable = []

  for (const t of list) {
    const s = summaries.find(x => x.id === String(t.id))
    if (!t.ok) {
      unreachable.push(String(t.id))
      continue
    }
    if (!winner) continue
    if (String(t.id) === String(winner.id)) continue
    const fp = syncFingerprint(t.data || {})
    if (fp === winnerFp) continue

    const targetTime = Date.parse(t.data?.updatedAt || '') || 0
    const winnerTime = Date.parse(winner.data?.updatedAt || '') || 0

    if (authorityId) {
      // 权威模式下：另一端的更新时间更晚，只标记差异，仍然以权威端内容为准下发
      if (targetTime > winnerTime) {
        diverged.push({ id: String(t.id), label: s?.label || String(t.id), updatedAt: t.data?.updatedAt || null })
      }
      const reason = !t.data || !Array.isArray(t.data.sites) || t.data.sites.length === 0
        ? 'empty'
        : 'behind'
      actions.push({ id: String(t.id), label: s?.label || String(t.id), reason })
      continue
    }

    // 自动选主模式：目标比 winner 还新却内容不同，说明时间相同或时钟异常 —— 不覆盖
    if (targetTime >= winnerTime) {
      conflicts.push({ id: String(t.id), label: s?.label || String(t.id) })
      continue
    }
    const reason = !t.data || !Array.isArray(t.data.sites) || t.data.sites.length === 0
      ? 'empty'
      : 'behind'
    actions.push({ id: String(t.id), label: s?.label || String(t.id), reason })
  }

  return {
    at,
    authority: authorityId || null,
    authorityUnavailable,
    winner: winner ? summarizeTarget(winner) : null,
    targets: summaries,
    actions,
    conflicts,
    diverged,
    consistent: Boolean(winner) && summaries.every(s => !s.ok || s.fingerprint === winnerFp),
    unreachable,
  }
}