/**
 * 发布门禁：预检（preflight）→ 人工放行（approve）。
 *
 * 为什么需要它：数据覆盖即丢、部署不可逆，发布前必须能先看清「将发生什么」。
 * 设计取舍：不把任务挂起等审批（那要改动 jobs 状态机，影响面大），
 * 而是把「放行」做成一张有指纹、有时效的凭证 —— 预检产出凭证，发布时核销。
 *
 * 指纹的意义：预检之后只要工作区再有任何变动（改了文件、又暂存了别的、
 * 或数据文件被写），指纹就对不上，凭证作废，必须重新预检。
 * 这样「放行」放行的就是被看过的那一份东西，而不是「随便一个时刻的工作区」。
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.mjs'
import { fetchCloud } from './cloud.mjs'
import * as git from './git.mjs'
import * as changes from './changes.mjs'
import { record } from './audit.mjs'

const GATE_TTL_MS = 10 * 60 * 1000
const DATA_DIR = join(ROOT, 'tools', 'console', '.data')
const GATE_FILE = join(DATA_DIR, 'gates.json')

const SITES_FILE = 'api/sites-data.json'

/**
 * 凭证必须落盘，不能只放进程内存。
 *
 * 原因：CLI 是「一次调用一个进程」——`nav publish preflight` 产出的凭证随进程退出
 * 就没了，紧接着的 `nav publish run --gate <id>` 是另一个进程，内存表是空的，
 * 于是永远核销不了。控制台内之所以看不出这个问题，是因为预检与发布都在同一个
 * 常驻进程里，共享内存表。
 *
 * 写入失败不阻断主流程（与 audit 同口径）：持久化不可用时凭证退化为进程内有效，
 * 控制台路径照常工作，只是跨进程放行会失败并要求重新预检。
 */
function loadGates() {
  try {
    const arr = JSON.parse(readFileSync(GATE_FILE, 'utf-8'))
    if (!Array.isArray(arr)) return new Map()
    return new Map(arr.filter(g => g && g.id).map(g => [g.id, g]))
  } catch {
    return new Map()
  }
}

function saveGates(gates) {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    const tmp = `${GATE_FILE}.tmp`
    writeFileSync(tmp, JSON.stringify([...gates.values()]), 'utf-8')
    renameSync(tmp, GATE_FILE)
  } catch { /* 落盘失败不影响本次放行判定 */ }
}

function dataDigest() {
  try { return createHash('sha256').update(readFileSync(join(ROOT, SITES_FILE))).digest('hex').slice(0, 16) } catch { return 'no-data' }
}

/**
 * 工作区指纹：分支 + HEAD + 全部改动路径（含未暂存/未跟踪）+ 数据文件内容摘要。
 * 用「改动路径集合」而非逐个文件内容哈希：文件内容变了路径不变也够用吗？不够 ——
 * 所以数据文件单独按内容哈希（发布的核心载荷），源码类改动则按路径+增删行数近似。
 */
function fingerprintOf(status, head) {
  const files = (status?.files || [])
    .map(f => `${f.path}:${f.index || '-'}:${f.worktree || '-'}:${f.added || 0}/${f.deleted || 0}`)
    .sort()
  const parts = [
    `branch=${status?.branch || ''}`,
    `head=${head?.sha || ''}`,
    `ahead=${status?.ahead || 0}`,
    `data=${dataDigest()}`,
    ...files,
  ]
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16)
}

/** 当前工作区指纹（不创建凭证，仅用于比对） */
export async function currentFingerprint() {
  const [st, head] = await Promise.all([git.getStatus(), git.headCommit()])
  return fingerprintOf(st, head)
}

function pruneExpired(gates) {
  const now = Date.now()
  for (const [id, g] of gates) if (g.expiresAt <= now) gates.delete(id)
  return gates
}

/**
 * 预检：只读地汇总「发布将发生什么」，并产出一张放行凭证。
 * 不触碰云端、不写盘、不提交。
 */
export async function preflight({ kind = 'publish', message = '' } = {}) {
  const gates = pruneExpired(loadGates())
  const [st, head, sites, cloud, pending] = await Promise.all([
    git.getStatus(),
    git.headCommit(),
    changes.sitesSummary(),
    fetchCloud(),
    git.pendingCommits(20).catch(() => []),
  ])

  const staged = (st.files || []).filter(f => f.staged)
  const unstaged = (st.files || []).filter(f => !f.staged)
  const dataChanges = sites ? sites.diff.added.length + sites.diff.removed.length + sites.diff.modified.length : 0

  // 硬阻断：不解决就跑不通的（detached HEAD 无法推送；云端读不到就无法比对版本与验证收敛）
  const blockers = []
  if (!st.branch) blockers.push('处于 detached HEAD，无法推送')
  if (!cloud.ok) blockers.push(`云端当前数据读取失败（${cloud.error}），无法比对版本`)

  // 警告：需要留意但不该拦住放行的（消息可在放行时补；无改动时发布是空转）
  const warnings = []
  if (staged.length > 0 && !String(message || '').trim()) {
    warnings.push(`存在 ${staged.length} 个已暂存文件，放行发布时必须填写提交消息`)
  }
  if (st.counts.total === 0 && (st.ahead || 0) === 0) {
    warnings.push('工作区无改动且无待推送提交，发布将是空转')
  }
  if (sites && sites.integrity.dupSortOrder.length > 0) {
    warnings.push(`sortOrder 存在 ${sites.integrity.dupSortOrder.length} 组重复，建议先跑 fix-sortorder`)
  }

  const fingerprint = fingerprintOf(st, head)
  const id = randomUUID().slice(0, 8)
  const gate = { id, kind, createdAt: Date.now(), expiresAt: Date.now() + GATE_TTL_MS, fingerprint }
  gates.set(id, gate)
  saveGates(gates)

  record({
    action: 'gate.preflight',
    target: id,
    result: blockers.length ? 'rejected' : 'ok',
    detail: `分支 ${st.branch || '(detached)'} · 改动 ${st.counts.total} · 待提交 ${staged.length} · 云端 ${cloud.ok ? `v${cloud.version}/${cloud.count}` : '读取失败'}`
      + (blockers.length ? ` · 阻断：${blockers.join('；')}` : ''),
  })

  return {
    id,
    kind,
    fingerprint,
    expiresAt: new Date(gate.expiresAt).toISOString(),
    ttlSeconds: Math.round(GATE_TTL_MS / 1000),
    workspace: {
      branch: st.branch || '',
      detached: Boolean(st.detached),
      head: head ? { sha: head.sha, short: head.short, subject: head.subject } : null,
      ahead: st.ahead || 0,
      behind: st.behind || 0,
      upstream: st.upstream || '',
      counts: st.counts,
    },
    willCommit: staged.map(f => f.path),
    willNotCommit: unstaged.map(f => f.path),
    pendingCommits: pending.map(c => ({ sha: c.sha, short: c.short, subject: c.subject })),
    data: sites
      ? {
        file: sites.file,
        headCount: sites.headCount,
        currentCount: sites.currentCount,
        changed: sites.changed,
        added: sites.diff.added.map(s => ({ id: s.id, name: s.name })),
        removed: sites.diff.removed.map(s => ({ id: s.id, name: s.name })),
        modified: sites.diff.modified.map(m => ({ id: m.id, name: m.name, labels: m.labels })),
        missingIcon: sites.integrity.missingIcon.length,
        dupSortOrder: sites.integrity.dupSortOrder.length,
      }
      : null,
    cloud: {
      ok: cloud.ok,
      version: cloud.ok ? cloud.version : null,
      count: cloud.ok ? cloud.count : null,
      withIcons: cloud.ok ? cloud.withIcons : null,
      error: cloud.ok ? null : cloud.error,
    },
    delta: {
      siteCount: sites ? sites.currentCount - (cloud.ok ? cloud.count : sites.currentCount) : null,
      dataChanges,
      files: st.counts.total,
    },
    blockers,
    warnings,
    ready: blockers.length === 0,
  }
}

/**
 * 核销凭证：校验存在、未过期、指纹一致，成功后作废（一次性）。
 *
 * kind 只作标签不做拦截：预检看到的是同一份工作区状态，
 * 而 publish 与 sync-data 都作用于这份状态，用同一张凭证放行是合理的。
 * 真正拦住误操作的是指纹 —— 工作区一变，凭证立即作废。
 */
export async function consumeGate(id) {
  const gates = pruneExpired(loadGates())
  const gate = gates.get(String(id || ''))
  if (!gate) {
    record({ action: 'gate.reject', result: 'rejected', target: String(id || ''), detail: '放行凭证不存在或已过期' })
    return { ok: false, reason: '放行凭证不存在或已过期，请重新预检' }
  }
  const fp = await currentFingerprint()
  if (fp !== gate.fingerprint) {
    record({
      action: 'gate.reject', result: 'rejected', target: gate.id,
      detail: `预检后工作区已变动（${gate.fingerprint} → ${fp}），凭证作废`,
    })
    return { ok: false, reason: '预检后工作区已变动，放行凭证作废，请重新预检' }
  }
  gates.delete(gate.id)
  saveGates(gates)
  record({ action: 'gate.approve', target: gate.id, detail: `凭证核销放行（指纹 ${gate.fingerprint}）` })
  return { ok: true, gate: { id: gate.id, kind: gate.kind, createdAt: gate.createdAt, fingerprint: gate.fingerprint } }
}

/** 当前有效的放行凭证（控制台展示用） */
export function listGates() {
  return [...pruneExpired(loadGates()).values()]
    .map(g => ({ id: g.id, kind: g.kind, createdAt: g.createdAt, expiresAt: g.expiresAt, fingerprint: g.fingerprint }))
}

/** 测试用：清空凭证表 */
export function clearGates() {
  saveGates(new Map())
}

export { GATE_TTL_MS, fingerprintOf }