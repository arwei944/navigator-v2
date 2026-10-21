/**
 * 站点数据的「输出形态」—— CSV、Markdown 报告、切片。
 *
 * ## 为什么从 data-audit.mjs 拆出来
 *
 * 体检与修复是**判断**，导出是**呈现**。两者变更的原因不同：
 * 新增一条检查项不该让导出文件的表头变化，反之亦然。
 * 拆开后 `data-audit.mjs` 只保留规则运算，本文件只保留序列化。
 *
 * 拆分还有一个硬约束：仓库对 `shared/` 下的引擎文件有 700 行体量门禁，
 * 混在一起会先撞上这条线，而不是撞上「职责是否需要分开」这个真问题。
 *
 * 纯函数、无 IO，可被 Node 直接断言。
 */

/* ================================ CSV ================================ */

/** CSV 需要转义引号与换行；空值输出空串而不是 "undefined" */
function csvCell(v) {
  if (v == null) return ''
  let s
  if (Array.isArray(v)) s = v.join(';')
  else if (typeof v === 'object') s = JSON.stringify(v)
  else s = String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export const CSV_COLUMNS = [
  'id', 'name', 'url', 'desc', 'categoryId', 'purposes', 'color', 'initial',
  'sortOrder', 'icon', 'aliases',
  'position.domain', 'position.stage', 'position.source', 'position.confidence', 'position.reason',
  'visitCount', 'createdAt', 'updatedAt',
]

function pickPath(site, path) {
  return path.split('.').reduce((cur, k) => (cur == null ? cur : cur[k]), site)
}

/**
 * 把站点数组转成 CSV 文本（Excel 可直接打开）。
 *
 * `position` 摊平成四列：嵌套对象在表格里没法筛选。
 * 不写 BOM —— 需要 Excel 正确识别中文时由调用方在下载端加，纯函数保持干净。
 */
export function sitesToCsv(sites, columns = CSV_COLUMNS) {
  const cols = Array.isArray(columns) && columns.length ? columns : CSV_COLUMNS
  const lines = [cols.join(',')]
  for (const s of Array.isArray(sites) ? sites : []) {
    lines.push(cols.map(c => csvCell(pickPath(s, c))).join(','))
  }
  return lines.join('\r\n')
}

/* ================================ Markdown 报告 ================================ */

function mdTable(headers, rows) {
  const line = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  return [line, sep, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n')
}

/**
 * 体检报告 → Markdown。
 *
 * 为什么要它：面板上的数字适合「看一眼」，不适合「留档 / 发给人」。
 * 报告导出后可以进仓库、贴进工单，且数字与面板同源（都来自 auditSites）。
 *
 * @param {object} report     auditSites 的返回值
 * @param {object} [meta]     { version, updatedAt, storedAt }
 */
export function reportToMarkdown(report, meta = {}) {
  const r = report || {}
  const fields = Array.isArray(r.fields) ? r.fields : []
  const lines = []

  lines.push('# 站点库体检报告')
  lines.push('')
  lines.push(`- 生成时间：${r.generatedAt || new Date().toISOString()}`)
  lines.push(`- 数据版本：v${meta.version ?? 0}`)
  lines.push(`- 数据更新时间：${meta.updatedAt || '—'}`)
  lines.push(`- 数据来源：${meta.storedAt === 'seed' ? '构建期种子' : '云端已存数据'}`)
  lines.push('')

  lines.push('## 概览')
  lines.push('')
  lines.push(mdTable(['指标', '数值'], [
    ['站点总数', r.total ?? 0],
    ['分类数', r.categoriesDefined ?? 0],
    ['空分类', (r.emptyCategories || []).length],
    ['待处理问题', r.issueCount ?? 0],
    ['低置信度', (r.inference && r.inference.lowConfidence ? r.inference.lowConfidence.length : 0)],
    ['重复网址 / 名称 / ID', [
      (r.duplicates && r.duplicates.urls ? r.duplicates.urls.length : 0),
      (r.duplicates && r.duplicates.names ? r.duplicates.names.length : 0),
      (r.duplicates && r.duplicates.ids ? r.duplicates.ids.length : 0),
    ].join(' / ')],
    ['孤儿分类', (r.orphanCategories || []).length],
    ['图标引用失效', (r.resources && r.resources.iconMissing ? r.resources.iconMissing.length : 0)],
  ]))
  lines.push('')

  lines.push('## 字段覆盖')
  lines.push('')
  lines.push(mdTable(
    ['字段', '名称', '覆盖', '缺失', '必填'],
    fields.map(f => [f.key, f.label, `${f.covered}/${r.total ?? 0}`, f.missingCount, f.required ? '是' : '']),
  ))
  lines.push('')

  const low = (r.inference && r.inference.lowConfidence) || []
  lines.push('## 推断质量')
  lines.push('')
  const source = (r.inference && r.inference.source) || []
  lines.push(`- source 分布：${source.map(s => `${s.key} ${s.count}`).join('、') || '—'}`)
  lines.push(`- 低置信度条目：${low.length}`)
  if (low.length) {
    lines.push('')
    lines.push(mdTable(
      ['站点', '置信度', '方向/阶段', '归因'],
      low.slice(0, 50).map(s => [s.name, s.confidence, `${s.domain || '—'}/${s.stage || '—'}`, s.reason || '—']),
    ))
    if (low.length > 50) lines.push('', `> 仅列出前 50 条，共 ${low.length} 条。`)
  }
  lines.push('')

  const dist = r.categoryDistribution || []
  if (dist.length) {
    lines.push('## 分类分布')
    lines.push('')
    lines.push(mdTable(['分类', '名称', '分组', '站点数'], dist.slice(0, 30).map(c => [c.id, c.label, c.groupLabel, c.count])))
    if (dist.length > 30) lines.push('', `> 仅列出前 30 个分类，共 ${dist.length} 个。`)
    lines.push('')
  }

  const orphan = r.orphanCategories || []
  if (orphan.length) {
    lines.push('## 孤儿分类')
    lines.push('')
    lines.push(mdTable(['站点', '指向的分类'], orphan.map(o => [o.name, o.categoryId])))
    lines.push('')
  }

  const u = r.urlIssues || {}
  lines.push('## URL 形态')
  lines.push('')
  lines.push(mdTable(['项目', '数量'], [
    ['带协议', (u.hasProtocol || []).length],
    ['带 www', (u.hasWww || []).length],
    ['带尾斜杠', (u.hasTrailingSlash || []).length],
    ['带路径', (u.hasPath || []).length],
    ['非法域名', (u.invalid || []).length],
  ]))
  lines.push('')

  const t = r.timeline || {}
  lines.push('## 时间线')
  lines.push('')
  lines.push(`- 创建时间范围：${t.createdMin ? new Date(t.createdMin).toISOString() : '—'} ~ ${t.createdMax ? new Date(t.createdMax).toISOString() : '—'}`)
  lines.push(`- 更新时间范围：${t.updatedMin ? new Date(t.updatedMin).toISOString() : '—'} ~ ${t.updatedMax ? new Date(t.updatedMax).toISOString() : '—'}`)
  lines.push(`- 超过 ${t.staleDays ?? 90} 天未更新：${t.staleCount ?? 0}`)
  lines.push('')

  return lines.join('\n')
}

/* ================================ 切片 ================================ */

/**
 * 按条件切片：`{ categoryId }` 或 `{ domain }`。
 * 只给一个条件，避免「两个条件同时满足还是任一满足」的歧义。
 */
export function sliceSites(sites, { categoryId, domain } = {}) {
  const list = Array.isArray(sites) ? sites : []
  if (categoryId) return list.filter(s => String(s.categoryId) === String(categoryId))
  if (domain) return list.filter(s => s.position && String(s.position.domain) === String(domain))
  return list
}
