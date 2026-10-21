/**
 * 体检趋势 —— 摘要的记录、清洗与追加（纯函数层）。
 *
 * ## 为什么只记摘要
 *
 * 完整报告有逐条缺失清单（300 条时约 30 KB）。每天存一份，一年就是 10 MB，
 * 而曲线需要的只是六七个数字。所以历史里只保留「能画图的最小集合」，
 * 想看明细时仍然回到当次报告。
 *
 * ## 为什么不由 GET 自动记录
 *
 * GET 应当无副作用。如果每次打开面板都写一条历史，刷新十次就会留下十个点，
 * 曲线会被噪声压平。记录动作必须是显式的（用户点按钮，或修复/导入成功后的一次回调）。
 */

/** 最多保留的点数。100 个点足够看出趋势，也不会让面板变重 */
export const HISTORY_KEEP = 100

/** 去抖窗口：同一版本、同一问题数在 5 分钟内重复记录视为同一次 */
export const HISTORY_DEDUPE_MS = 5 * 60 * 1000

/**
 * 从体检报告提取摘要。
 *
 * @param {object} report auditSites 的返回值
 * @param {object} [meta] { version, now }
 */
export function summaryFromReport(report, meta = {}) {
  const r = report || {}
  const low = (r.inference && r.inference.lowConfidence) || []
  const dup = r.duplicates || {}
  const resources = r.resources || {}
  const aliasesField = Array.isArray(r.fields) ? r.fields.find(f => f.key === 'aliases') : null

  return {
    at: new Date(Number(meta.now) || Date.now()).toISOString(),
    version: Number(meta.version) || 0,
    total: Number(r.total) || 0,
    issueCount: Number(r.issueCount) || 0,
    lowConfidence: low.length,
    orphanCategories: (r.orphanCategories || []).length,
    duplicateUrls: (dup.urls || []).length,
    duplicateNames: (dup.names || []).length,
    missingIcons: (resources.iconMissing || []).length,
    emptyCategories: (r.emptyCategories || []).length,
    missingAliases: aliasesField ? Number(aliasesField.missingCount) || 0 : 0,
  }
}

/**
 * 清洗历史条目：丢掉结构不对的，把数字收敛成 Number，按时间排序。
 *
 * 历史是「读回来就要能画」的数据。一条 `issueCount: "abc"` 会让整张图崩掉，
 * 所以读路径必须逐条净化，而不是信任磁盘上的内容。
 */
export function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(e => e && typeof e === 'object' && typeof e.at === 'string' && e.at)
    .map(e => ({
      at: e.at,
      version: Number(e.version) || 0,
      total: Number(e.total) || 0,
      issueCount: Number(e.issueCount) || 0,
      lowConfidence: Number(e.lowConfidence) || 0,
      orphanCategories: Number(e.orphanCategories) || 0,
      duplicateUrls: Number(e.duplicateUrls) || 0,
      duplicateNames: Number(e.duplicateNames) || 0,
      missingIcons: Number(e.missingIcons) || 0,
      emptyCategories: Number(e.emptyCategories) || 0,
      missingAliases: Number(e.missingAliases) || 0,
    }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
}

/**
 * 追加一条摘要。
 *
 * @returns {{items:object[], added:boolean, reason:string}}
 */
export function appendHistory(items, entry, opts = {}) {
  const { keep = HISTORY_KEEP, dedupeMs = HISTORY_DEDUPE_MS } = opts
  const list = sanitizeHistory(items)
  const clean = sanitizeHistory([entry])
  if (!clean.length) return { items: list, added: false, reason: 'invalid' }

  const e = clean[0]
  const last = list[list.length - 1]
  if (last) {
    const dt = new Date(e.at).getTime() - new Date(last.at).getTime()
    /*
     * 窗口内**只看问题总数**，不看 version。
     *
     * 发布一次会让 version 递增，但数据可能一个字都没改 —— 若把 version 纳入去抖条件，
     * 每发布一次就多一个等高的点，曲线会被发布节奏而不是数据质量驱动。
     */
    if (dt >= 0 && dt < dedupeMs && last.issueCount === e.issueCount) {
      return { items: list, added: false, reason: 'duplicate' }
    }
  }

  const next = [...list, e]
  return {
    items: next.slice(Math.max(0, next.length - Math.max(1, Number(keep) || HISTORY_KEEP))),
    added: true,
    reason: '',
  }
}

/**
 * 给面板用的最小序列：只挑一条指标。
 * 不做插值、不补零点 —— 缺失就是缺失，画成 0 会误导。
 */
export function seriesOf(items, key = 'issueCount') {
  return sanitizeHistory(items).map(e => ({ at: e.at, value: Number(e[key]) || 0 }))
}
