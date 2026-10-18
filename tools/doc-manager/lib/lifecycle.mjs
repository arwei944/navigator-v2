/**
 * 文档生命周期分析。
 *
 * 回答：「哪些文档是活的、哪些已被取代、哪些该归档了？」
 *
 * 状态来源三层（优先级从高到低）：
 *   1. frontmatter 显式标注（status / superseded-by / supersedes，见 README 约定）
 *   2. 目录约定（archive/ → archived；scanner 的 inferStatus 已处理）
 *   3. 同名多版本的启发式（这里补充：同系列里保留最新、其余建议归档）
 */

/** 通用文件名：跨上下文反复出现，不构成「同系列版本」 */
const GENERIC_STEMS = new Set([
  'readme', 'index', 'progress', 'brief', 'report', 'notes', 'todo',
  'changelog', 'handover', 'project', 'summary', 'overview',
])

/**
 * 「系列键」= 所在目录 + 去掉版本号/日期/序号后的文件名主干。
 *
 * **必须带上目录**：不同任务目录下的 `progress.md`、不同目录下的 `README.md`
 * 是**不同的文档**，不是同一份的多个版本（实测曾因此误报 9 组）。
 * 通用文件名一律返回 null（不参与系列判定）。
 */
export function seriesKey(rel) {
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '.'
  const stem = rel.split('/').pop().replace(/\.md$/i, '')
  const norm = stem
    .replace(/v\d+/gi, '')
    .replace(/\d{4}-\d{2}-\d{2}/g, '')
    .replace(/^\d+-/, '')
    .replace(/[-_]+/g, '-')
    .replace(/^-|-$/g, '')
    .trim()
  if (!norm || GENERIC_STEMS.has(stem.toLowerCase())) return null
  return `${dir}|${norm}`
}

/** 从文档路径取版本号（`NAV-v3-…` → 3），没有则 null */
export function versionOf(rel) {
  const m = /v(\d+)/i.exec(rel.split('/').pop() || '')
  return m ? Number(m[1]) : null
}

/**
 * @param {{docs:object[]}} scanResult
 */
export function analyzeLifecycle(scanResult) {
  const { docs } = scanResult

  const byStatus = {}
  for (const d of docs) byStatus[d.status] = (byStatus[d.status] || 0) + 1

  /* 显式取代链（frontmatter 声明） */
  const chains = []
  for (const d of docs) {
    const sb = d.frontmatter['superseded-by'] || d.frontmatter.supersededBy
    const ss = d.frontmatter.supersedes
    if (sb) chains.push({ from: d.path, to: String(sb), relation: 'superseded-by' })
    if (ss) chains.push({ from: d.path, to: String(ss), relation: 'supersedes' })
  }

  /* 同名多版本：同系列里 >=2 份 active → 保留最新，其余建议归档 */
  const series = new Map()
  for (const d of docs) {
    const key = seriesKey(d.path)
    if (!key) continue
    if (!series.has(key)) series.set(key, [])
    series.get(key).push(d)
  }
  const suggestions = []
  for (const [key, items] of series) {
    const active = items.filter(i => i.status === 'active')
    if (active.length < 2) continue
    const sorted = [...active].sort((a, b) => {
      const va = versionOf(a.path)
      const vb = versionOf(b.path)
      if (va != null && vb != null && va !== vb) return vb - va /* 版本号大的在前 */
      return a.mtime < b.mtime ? 1 : -1 /* 否则新的在前 */
    })
    suggestions.push({
      series: key,
      keep: sorted[0].path,
      archive: sorted.slice(1).map(x => x.path),
    })
  }

  /* 长期未更新的 active 文档：早于全库中位数、且距今超过 30 天 */
  const times = docs.map(d => new Date(d.mtime).getTime()).sort((a, b) => a - b)
  const median = times[Math.floor(times.length / 2)] || Date.now()
  const now = Date.now()
  const DAY = 86400000
  const staleActive = docs
    .filter(d => d.status === 'active' && new Date(d.mtime).getTime() < median && (now - new Date(d.mtime).getTime()) > 30 * DAY)
    .map(d => d.path)

  return {
    generatedAt: new Date().toISOString(),
    total: docs.length,
    byStatus,
    chains,
    suggestions,
    staleActive,
  }
}

export function renderLifecycleReport(lc) {
  const L = []
  L.push(`\n♻️  文档生命周期 — ${lc.total} 份`)
  L.push(`   状态分布：${Object.entries(lc.byStatus).map(([k, v]) => `${k}×${v}`).join('  ')}`)

  L.push(`\n   显式取代链：${lc.chains.length} 条`)
  for (const c of lc.chains.slice(0, 10)) L.push(`     ${c.from} --${c.relation}--> ${c.to}`)

  L.push(`\n   同系列多版本（建议保留最新）：${lc.suggestions.length} 组`)
  for (const s of lc.suggestions.slice(0, 10)) {
    L.push(`     「${s.series}」保留 ${s.keep}`)
    for (const a of s.archive) L.push(`        可归档 → ${a}`)
  }

  L.push(`\n   长期未更新的 active 文档：${lc.staleActive.length} 份`)
  for (const p of lc.staleActive.slice(0, 10)) L.push(`     ${p}`)

  L.push('')
  L.push('   提示：状态可由文档 frontmatter 显式声明（status: archived / superseded-by: <路径>）。')
  return L.join('\n')
}
