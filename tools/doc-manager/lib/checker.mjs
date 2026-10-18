/**
 * 一致性巡检器。
 *
 * 回答的问题是：「这批文档自己跟自己、以及跟真实文件系统，是否对得上？」
 *
 * 规则分级：
 *   - error：硬错误，一定是坏的（死链）
 *   - warn ：多半是问题，需人判断（重复标题 / 缺失标题 / 过期引用 / 空文档）
 *   - info ：提示性（孤立文档 / 超大文档）
 *
 * `--strict` 模式下存在 error 即以非 0 退出，可直接当门禁用。
 */
import fs from 'node:fs'
import path from 'node:path'
import { KNOWLEDGE_KINDS } from './util.mjs'

/**
 * @param {{root:string, docs:object[]}} scanResult
 * @returns {{generatedAt:string,total:number,counts:{error:number,warn:number,info:number},issues:object[]}}
 */
export function runChecks(scanResult) {
  const { docs, root } = scanResult
  const issues = []
  const push = (level, rule, docPath, message, detail = '') =>
    issues.push({ level, rule, path: docPath, message, detail })

  const docByPath = new Map(docs.map(d => [d.path, d]))
  // 注意：必须是 docs.map(d => d.path)。`new Set(docs.keys())` 对**数组**返回的是下标集合 {0,1,…}，
  // 会让下面的 docSet.has(l) 恒为 false → incoming 恒空 → 所有知识型文档都被误报为孤立
  //（真实数据实测：41 条假阳性，且与 graph 的孤立数不一致）。参见 test-doc-manager.mjs 的回归用例。
  const docSet = new Set(docs.map(d => d.path))

  /* 1) 死链：链接目标相对工作区根存在性检查 */
  for (const d of docs) {
    for (const l of d.links) {
      if (l.includes('node_modules')) continue
      if (!fs.existsSync(path.join(root, l))) {
        push('error', 'dead-link', d.path, `链接目标不存在：${l}`)
      }
    }
  }

  /* 2) 重复标题（同一标题被多份文档使用 —— 检索时会撞车） */
  const byTitle = new Map()
  for (const d of docs) {
    const t = (d.title || '').trim()
    if (!t || t.length < 4) continue
    if (!byTitle.has(t)) byTitle.set(t, [])
    byTitle.get(t).push(d.path)
  }
  for (const [t, paths] of byTitle) {
    if (paths.length >= 2) {
      push('warn', 'duplicate-title', paths[0], `标题重复（${paths.length} 份）：「${t}」`, paths.join(' | '))
    }
  }

  /* 3) 缺失标题 */
  for (const d of docs) {
    if (!d.title && !d.parseError) push('warn', 'missing-title', d.path, '文档没有一级标题')
  }

  /* 4) 过期引用：active 文档引用了非 active（已归档/被取代）的文档 */
  for (const d of docs) {
    if (d.status !== 'active') continue
    for (const l of d.links) {
      const target = docByPath.get(l)
      if (target && target.status !== 'active') {
        push('warn', 'stale-reference', d.path, `引用了非 active 文档（${target.status}）：${l}`)
      }
    }
  }

  /* 5) 孤立文档：既无入链也无文档间出链（只对知识型文档报 —— 过程产物本就孤立） */
  const incoming = new Set()
  for (const d of docs) {
    for (const l of d.links) if (docSet.has(l)) incoming.add(l)
  }
  for (const d of docs) {
    if (!KNOWLEDGE_KINDS.has(d.kind)) continue
    const outDocLinks = d.links.filter(l => docSet.has(l))
    if (!incoming.has(d.path) && outDocLinks.length === 0) {
      push('info', 'orphan', d.path, '孤立文档（无入链、无文档间出链）')
    }
  }

  /* 6) 空文档 */
  for (const d of docs) {
    if (d.size < 40) push('warn', 'empty-doc', d.path, `内容过少（${d.size} B）`)
  }

  /* 7) 超大文档（提示拆分） */
  for (const d of docs) {
    if (d.size > 200 * 1024) push('info', 'oversize', d.path, `文档较大（${Math.round(d.size / 1024)} KB），可考虑拆分`)
  }

  const counts = { error: 0, warn: 0, info: 0 }
  for (const i of issues) counts[i.level]++

  return {
    generatedAt: new Date().toISOString(),
    total: docs.length,
    counts,
    issues,
  }
}

const ICON = { error: '❌', warn: '⚠️ ', info: 'ℹ️ ' }
const RANK = { error: 0, warn: 1, info: 2 }

/** 渲染成人可读报告（按规则分组，每组最多列 15 条） */
export function renderCheckReport(report) {
  const L = []
  L.push(`\n🔍 文档一致性巡检 — ${report.total} 份文档`)
  L.push(`   ❌ error ${report.counts.error}｜⚠️  warn ${report.counts.warn}｜ℹ️  info ${report.counts.info}`)

  if (!report.issues.length) {
    L.push('\n   ✅ 没有发现问题。')
    return L.join('\n')
  }

  const sorted = [...report.issues].sort(
    (a, b) => (RANK[a.level] - RANK[b.level]) || a.rule.localeCompare(b.rule),
  )
  const groups = new Map()
  for (const i of sorted) {
    if (!groups.has(i.rule)) groups.set(i.rule, [])
    groups.get(i.rule).push(i)
  }

  for (const [rule, items] of groups) {
    L.push(`\n  [${rule}] ${items.length} 条`)
    for (const i of items.slice(0, 15)) {
      L.push(`   ${ICON[i.level]} ${i.path} — ${i.message}`)
    }
    if (items.length > 15) L.push(`   … 其余 ${items.length - 15} 条见 --json`)
  }
  return L.join('\n')
}
