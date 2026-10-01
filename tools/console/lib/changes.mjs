/**
 * 规则式变更理解：把 git 改动翻译成「改了什么、影响什么」，并生成规范提交消息。
 * 站点数据变动时做结构化 diff（新增/删除/字段变更），其余按路径分组归类。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.mjs'
import { getStatus, showFileAtHead } from './git.mjs'
import { diffSites, checkIntegrity } from '../../../shared/ops/site-ops.mjs'

const SITES_FILE = 'api/sites-data.json'

export { diffSites, checkIntegrity }

const RULES = [
  { scope: 'sites', type: 'feat', match: p => p === SITES_FILE },
  { scope: 'api', type: 'feat', match: p => p.startsWith('api/') },
  { scope: 'ui', type: 'feat', match: p => p.startsWith('src/') },
  { scope: 'scripts', type: 'chore', match: p => p.startsWith('scripts/') },
  { scope: 'console', type: 'chore', match: p => p.startsWith('tools/console/') },
  { scope: 'ci', type: 'chore', match: p => p.startsWith('.github/') || /^package(-lock)?\.json$/.test(p) },
  { scope: 'docs', type: 'docs', match: p => /\.(md|mdx|txt)$/i.test(p) },
]

function classify(path) {
  return RULES.find(r => r.match(path)) || { scope: '', type: 'chore' }
}





function nameList(items) {
  const names = items.slice(0, 3).map(i => i.name || i.id)
  return items.length > 3 ? `${names.join('/')} 等 ${items.length} 个` : names.join('/')
}

function sitesSubject(diff) {
  const parts = []
  if (diff.added.length) parts.push(`新增 ${nameList(diff.added)}`)
  if (diff.removed.length) parts.push(`移除 ${nameList(diff.removed)}`)
  if (diff.modified.length) parts.push(`更新 ${nameList(diff.modified)}`)
  return parts.join('，') || '调整站点数据'
}

function sitesDetails(diff, integrity) {
  const rows = []
  if (diff.added.length) rows.push(`新增：${diff.added.map(s => `${s.id} ${s.name}`).join('、')}`)
  if (diff.removed.length) rows.push(`移除：${diff.removed.map(s => `${s.id} ${s.name}`).join('、')}`)
  if (diff.modified.length) {
    rows.push(`修改：${diff.modified.map(m => `${m.id}（${m.labels.join('/')}）`).join('、')}`)
  }
  rows.push(`完整性：图标缺失 ${integrity.missingIcon.length}、sortOrder 重复 ${integrity.dupSortOrder.length}、分类 ${integrity.categories}、站点总数 ${integrity.total}`)
  return rows
}

/** 站点数据（工作区 vs HEAD）摘要 */
export async function sitesSummary() {
  let current
  try {
    current = JSON.parse(readFileSync(join(ROOT, SITES_FILE), 'utf-8'))
  } catch {
    return null
  }
  const headText = await showFileAtHead(SITES_FILE)
  let head = []
  try { head = headText ? JSON.parse(headText) : [] } catch { head = [] }

  const diff = diffSites(head, current)
  const integrity = checkIntegrity(current)
  return {
    file: SITES_FILE,
    headCount: head.length,
    currentCount: current.length,
    diff,
    integrity,
    changed: diff.added.length + diff.removed.length + diff.modified.length > 0,
  }
}

/** 由改动列表生成规范提交消息（Conventional Commits） */
export function suggestMessage(status, sites) {
  const files = (status && status.files) || []
  if (files.length === 0) return null

  const groups = new Map()
  for (const f of files) {
    const r = classify(f.path)
    const key = r.scope || '(repo)'
    const g = groups.get(key) || { scope: r.scope, type: r.type, files: [] }
    g.files.push(f)
    groups.set(key, g)
  }
  const dominant = [...groups.values()].sort((a, b) => b.files.length - a.files.length)[0]

  const sitesChanged = sites && sites.changed
  let type = dominant.type
  let scope = dominant.scope
  let subject
  let details = []

  if (sitesChanged) {
    type = sites.diff.added.length > 0 ? 'feat' : 'chore'
    scope = 'sites'
    subject = sitesSubject(sites.diff)
    details = sitesDetails(sites.diff, sites.integrity)
    const others = files.filter(f => f.path !== SITES_FILE)
    if (others.length) details.push(`其他文件：${others.length} 个`)
  } else {
    const byStatus = { added: [], deleted: [], modified: [] }
    for (const f of dominant.files) {
      if (f.untracked) byStatus.added.push(f)
      else if (f.index === 'deleted' || f.worktree === 'deleted') byStatus.deleted.push(f)
      else byStatus.modified.push(f)
    }
    const parts = []
    if (byStatus.added.length) parts.push(`新增 ${byStatus.added.length} 个文件`)
    if (byStatus.modified.length) parts.push(`更新 ${byStatus.modified.length} 个文件`)
    if (byStatus.deleted.length) parts.push(`删除 ${byStatus.deleted.length} 个文件`)
    subject = parts.join('，') || '更新代码'
    details = dominant.files.slice(0, 8).map(f => f.path)
    if (dominant.files.length > 8) details.push(`… 其余 ${dominant.files.length - 8} 个文件`)
  }

  const message = scope ? `${type}(${scope}): ${subject}` : `${type}: ${subject}`
  return { type, scope, subject, message, details, dominantScope: dominant.scope, groups: [...groups.keys()] }
}

/** 综合摘要：供「改动」面板与「提交」面板共用 */
export async function summary(status) {
  const st = status || (await getStatus())
  const sites = await sitesSummary()
  const suggestion = suggestMessage(st, sites)
  return { status: st, sites, suggestion }
}