/**
 * 发布历史内核：一次发布的记录模型、检索与保留策略。
 *
 * 为什么需要它：`jobs` 只在内存、审计只记「动作」不记「整条流水线」。
 * 要回答「上次发布是哪一版、耗时多久、哪一步失败、能否回退到它」，
 * 需要一个把流水线结果整体落盘的记录。本地控制台存 JSONL，线上后台存 Blob，
 * 两端共用同一份记录结构，才能在同一套 UI 里对比。
 *
 * 纯函数、零依赖。
 */

export const HISTORY_KEEP = 50

/** 触发来源 */
export const TRIGGERS = { manual: '手动', schedule: '定时', cli: '命令行', admin: '线上后台' }

/**
 * 规范化一条发布记录。缺字段一律补默认值，保证两端结构一致。
 */
export function normalizeRecord({
  id, ts, runner = 'console', trigger = 'manual', ok = false, reason = '',
  duration = null, steps = [], commit = null, deployment = null,
  cloud = null, snapshot = null, counts = null, note = '',
} = {}) {
  const at = ts || new Date().toISOString()
  return {
    id: String(id || `pub-${at.replace(/[:.]/g, '-')}`),
    ts: at,
    runner: String(runner),
    trigger: String(trigger),
    ok: Boolean(ok),
    reason: String(reason || ''),
    duration: Number.isFinite(duration) ? duration : null,
    steps: (steps || []).map(s => ({
      key: s.key, label: s.label, status: s.status,
      duration: Number.isFinite(s.duration) ? s.duration : null,
      detail: String(s.detail || ''),
    })),
    commit: commit ? { sha: String(commit.sha || ''), message: String(commit.message || '') } : null,
    deployment: deployment ? { url: String(deployment.url || ''), state: String(deployment.state || '') } : null,
    cloud: cloud ? { version: Number(cloud.version) || 0, count: Number(cloud.count) || 0, previousVersion: Number(cloud.previousVersion) || 0 } : null,
    snapshot: snapshot ? { pathname: String(snapshot.pathname || ''), ok: snapshot.ok !== false } : null,
    counts: counts || null,
    note: String(note || ''),
  }
}

/** 新 → 旧 */
export function sortRecords(items = []) {
  return [...items].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
}

/** 保留最近 keep 条，返回应删除的记录 id（按时间从旧到新，即删除顺序） */
export function prunableRecords(items = [], keep = HISTORY_KEEP) {
  return sortRecords(items).slice(Math.max(0, keep)).map(r => r.id).reverse()
}

/** 检索：按结果 / 触发来源 / 关键词（提交信息、失败原因、部署 URL） */
export function filterRecords(items = [], { ok = '', trigger = '', q = '' } = {}) {
  const kw = String(q || '').trim().toLowerCase()
  return (items || []).filter(r => {
    if (ok === 'ok' && !r.ok) return false
    if (ok === 'fail' && r.ok) return false
    if (trigger && r.trigger !== trigger) return false
    if (kw) {
      const hay = `${r.commit?.message || ''} ${r.reason} ${r.deployment?.url || ''} ${r.note}`.toLowerCase()
      if (!hay.includes(kw)) return false
    }
    return true
  })
}

/** 概览：总次数 / 成功率 / 最近一次 / 平均耗时 */
export function summarizeRecords(items = []) {
  const list = sortRecords(items)
  if (!list.length) return { total: 0, ok: 0, failed: 0, successRate: null, lastAt: null, avgDuration: null, last: null }
  const ok = list.filter(r => r.ok).length
  const durations = list.map(r => r.duration).filter(d => Number.isFinite(d) && d > 0)
  return {
    total: list.length,
    ok,
    failed: list.length - ok,
    successRate: Math.round((ok / list.length) * 100),
    lastAt: list[0].ts,
    avgDuration: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    last: list[0],
  }
}

/**
 * 从一条记录推导「可回退目标」。
 * 数据回退依赖快照（记录里带的 snapshot 是「本次发布前的数据」），
 * 代码回退依赖部署（本地控制台可走 vercel rollback）。
 */
export function rollbackTarget(record, { runner = 'console' } = {}) {
  if (!record) return { data: null, code: null, available: false, reason: '无发布记录' }
  const data = record.snapshot?.ok && record.snapshot?.pathname ? record.snapshot.pathname : null
  const code = record.deployment?.url || null
  const caps = runner === 'console'
  const available = Boolean(data) || (caps && Boolean(code))
  return {
    data,
    code: caps ? code : null,
    available,
    reason: available ? '' : '该记录没有可用快照，且当前执行端不支持代码回退',
  }
}

/** 一条记录的一行摘要（列表 / 通知 / 日志共用） */
export function formatRecordLine(record) {
  const icon = record.ok ? '✓' : '✗'
  const v = record.cloud?.version ? ` · v${record.cloud.version}` : ''
  const n = record.cloud?.count ? ` · ${record.cloud.count} 站点` : ''
  const ms = record.duration ? ` · ${(record.duration / 1000).toFixed(1)}s` : ''
  const why = record.ok ? '' : ` · ${record.reason || '未说明'}`
  return `${icon} ${record.ts}${v}${n}${ms}${why}`
}