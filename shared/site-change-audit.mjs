/**
 * 站点变更审计：对比写入前后的站点表，生成可读的操作记录（纯函数，无 IO）。
 *
 * ## 为什么需要
 *
 * 站点表是整站唯一的数据面，但它的写入一直没有审计：
 * 「某个站点是什么时候加的、谁删的、改了什么」只能靠 `createdAt` 猜。
 * 升级保护只能证明「数据没少」，不能回答「哪一条被谁动了」。
 *
 * ## 哪些字段算「变更」
 *
 * 只比较**人可感知的内容字段**（名称、网址、描述、分类、图标、别名、用途、
 * 排序、置顶、归档、位置）。刻意排除：
 *   - `updatedAt`：每次写入都会被改写，比它等于「每次都是更新」；
 *   - `visitCount`：访问计数变化不该产生审计，否则一天能刷满整份日志；
 *   - `createdAt`：创建时间不会在更新时变化。
 *
 * ## 记录粒度
 *
 * 少量变更（≤ threshold）逐条记录，便于直接读懂「加了哪个站」；
 * 超过阈值（导入 / 同步 / 回滚）合并成一条 `sites.batch` / `sites.sync`，
 * 完整明细另存 `ops/site-changes/*.json`，审计里只留摘要与路径。
 * 这样一次 300 条的导入不会把 2000 条的审计上限一次吃掉。
 */

/** 参与「变更」判定的字段 */
export const AUDITED_FIELDS = [
  'name', 'url', 'desc', 'categoryId', 'color', 'initial', 'sortOrder',
  'icon', 'aliases', 'purposes', 'position', 'archived', 'pinned',
]

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}

function brief(site) {
  return {
    id: String(site?.id || ''),
    name: String(site?.name || ''),
    url: String(site?.url || ''),
  }
}

function changed(before, after) {
  for (const field of AUDITED_FIELDS) {
    if (stableStringify(before?.[field]) !== stableStringify(after?.[field])) return true
  }
  return false
}

/**
 * @param {object[]} before 写入前站点表
 * @param {object[]} after 写入后站点表
 * @returns {{added:object[], removed:object[], updated:object[], total:number}}
 */
export function diffSites(before, after) {
  const beforeMap = new Map(
    (Array.isArray(before) ? before : []).filter(s => s && s.id).map(s => [String(s.id), s]),
  )
  const afterMap = new Map(
    (Array.isArray(after) ? after : []).filter(s => s && s.id).map(s => [String(s.id), s]),
  )

  const added = []
  const removed = []
  const updated = []

  for (const [id, site] of afterMap) {
    if (!beforeMap.has(id)) added.push(brief(site))
    else if (changed(beforeMap.get(id), site)) updated.push(brief(site))
  }
  for (const [id, site] of beforeMap) {
    if (!afterMap.has(id)) removed.push(brief(site))
  }

  return {
    added,
    removed,
    updated,
    total: added.length + removed.length + updated.length,
  }
}

function detailOf(site) {
  return `${site.name || '(未命名)'} · ${site.url || '(无网址)'}`
}

/**
 * 生成审计条目（交给 `server/audit-log.mjs#appendAudit` 规范化后落盘）。
 *
 * @param {ReturnType<typeof diffSites>} diff
 * @param {{actor?:string, source?:'manual'|'sync'|'rollback', detailPath?:string|null, threshold?:number}} opts
 * @returns {{action:string,target:string,result:string,detail:string,actor:string}[]}
 */
export function buildSiteAuditEntries(diff, opts = {}) {
  if (!diff || !diff.total) return []
  const actor = String(opts.actor || 'admin')
  const source = String(opts.source || 'manual')
  const threshold = Math.max(1, Number(opts.threshold) || 30)
  const summary = `新增 ${diff.added.length} · 删除 ${diff.removed.length} · 修改 ${diff.updated.length}`

  // 同步 / 批量：一条摘要，明细在独立对象里
  if (source === 'sync' || diff.total > threshold) {
    const action = source === 'sync' ? 'sites.sync' : 'sites.batch'
    const where = opts.detailPath ? ` · 明细 ${opts.detailPath}` : ''
    return [{
      action,
      target: 'sites',
      result: 'ok',
      detail: `${summary}${where}`,
      actor,
    }]
  }

  const entries = []
  for (const site of diff.added) {
    entries.push({ action: 'sites.add', target: site.id, result: 'ok', detail: detailOf(site), actor })
  }
  for (const site of diff.updated) {
    entries.push({ action: 'sites.update', target: site.id, result: 'ok', detail: detailOf(site), actor })
  }
  for (const site of diff.removed) {
    entries.push({ action: 'sites.remove', target: site.id, result: 'ok', detail: detailOf(site), actor })
  }
  return entries
}