/**
 * 文档台账生成器。
 *
 * 台账 = 「有哪些文档」的权威答案。它把扫描结果收敛成两级产物：
 *   - `doc-index.json` —— 机器可读（AI / 脚本消费）
 *   - `DOC-INDEX.md`   —— 人可读（按类型分组、带状态与时间）
 */

/**
 * @param {{root:string, scannedAt:string, docs:object[]}} scanResult
 */
export function buildIndex(scanResult) {
  const { docs, root, scannedAt } = scanResult
  const byKind = {}
  const byStatus = {}
  const missingTitle = []

  const items = docs.map(d => {
    byKind[d.kind] = (byKind[d.kind] || 0) + 1
    byStatus[d.status] = (byStatus[d.status] || 0) + 1
    if (!d.title) missingTitle.push(d.path)
    return {
      path: d.path,
      title: d.title || '(无标题)',
      kind: d.kind,
      status: d.status,
      size: d.size,
      mtime: d.mtime,
      headings: d.headings.length,
      links: d.links.length,
    }
  })

  return {
    root,
    scannedAt,
    generatedAt: new Date().toISOString(),
    total: items.length,
    byKind,
    byStatus,
    missingTitle,
    items,
  }
}

/** 类型的中文标签（输出更友好；未知类型回落到原值） */
const KIND_LABEL = {
  plan: '规划',
  design: '设计',
  spec: '规格',
  audit: '审计',
  report: '产出报告',
  memory: '记忆',
  project: '项目主文档',
  readme: '说明',
  reference: '参考',
  sdd: '任务简报',
  archive: '归档',
  handover: '交接',
  other: '其它',
}

/** 把台账渲染成 Markdown（分组表格） */
export function renderIndexMarkdown(index) {
  const L = []
  L.push(`# 文档台账（DOC-INDEX）`)
  L.push('')
  L.push(`> 由 \`tools/doc-manager\` 生成于 ${index.generatedAt}｜工作区 \`${index.root}\``)
  L.push(`> 共 **${index.total}** 份文档`)
  L.push('')
  L.push('## 总览')
  L.push('')
  L.push('| 类型 | 数量 | 状态 | 数量 |')
  L.push('|---|---|---:|---|---:|')
  const kinds = Object.entries(index.byKind).sort((a, b) => b[1] - a[1])
  const statuses = Object.entries(index.byStatus).sort((a, b) => b[1] - a[1])
  const rows = Math.max(kinds.length, statuses.length)
  for (let i = 0; i < rows; i++) {
    const k = kinds[i] || ['', '']
    const s = statuses[i] || ['', '']
    L.push(`| ${k[0] ? (KIND_LABEL[k[0]] || k[0]) + ` (${k[0]})` : ''} | ${k[1]} | ${s[0]} | ${s[1]} |`)
  }
  L.push('')

  // 按类型分组明细
  const grouped = new Map()
  for (const it of index.items) {
    if (!grouped.has(it.kind)) grouped.set(it.kind, [])
    grouped.get(it.kind).push(it)
  }
  for (const [kind, items] of [...grouped.entries()].sort((a, b) => b[1].length - a[1].length)) {
    L.push(`## ${KIND_LABEL[kind] || kind}（${items.length}）`)
    L.push('')
    L.push('| 标题 | 路径 | 状态 | 更新 |')
    L.push('|---|---|---|---|')
    for (const it of items) {
      const date = it.mtime.slice(0, 10)
      L.push(`| ${it.title} | \`${it.path}\` | ${it.status} | ${date} |`)
    }
    L.push('')
  }

  if (index.missingTitle.length) {
    L.push('## ⚠️ 缺失标题')
    L.push('')
    for (const p of index.missingTitle) L.push(`- \`${p}\``)
    L.push('')
  }
  return L.join('\n')
}
