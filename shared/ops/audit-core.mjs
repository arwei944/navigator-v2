/**
 * 操作审计内核：动作目录、条目规范化、筛选与统计。
 *
 * 本地控制台把审计落盘为 JSONL，线上后台落盘为 Blob；两端的「动作叫什么、
 * 一条记录长什么样、怎么筛」必须一致，否则同一件事在两个面板里显示成两种说法。
 * 这里只定义模型与纯函数，落盘与读取由各端实现。
 */

/**
 * 动作目录：既是展示标签，也是 UI 筛选的取值来源。
 * 命名规则 `域.动作`，域与 `sites / publish / gate / notify / schedule` 对齐。
 */
export const AUDIT_ACTIONS = {
  'gate.preflight': '发布预检',
  'gate.approve': '发布放行',
  'gate.bypass': '绕过门禁',
  'gate.reject': '门禁拒绝',
  'publish.start': '发布启动',
  'publish.done': '发布完成',
  'publish.fail': '发布失败',
  'publish.snapshot': '云端快照落盘',
  'publish.snapshotFail': '云端快照失败',
  'publish.rollback': '发布回滚',
  'hotupdate': '云端热更新',
  'rollback.preview': '回滚预演',
  'rollback.apply': '回滚执行',
  'commit': '提交',
  'push': '推送',
  'validate.fail': '校验失败',
  'sites.add': '新增站点',
  'sites.update': '更新站点',
  'sites.remove': '删除站点',
  'sites.batch': '批量站点操作',
  'sites.sync': '站点同步',
  'icon.fetch': '抓取图标',
  'health.probe': '可用性探活',
  'schedule.run': '定时巡检执行',
  'schedule.config': '定时巡检配置',
  'notify.push': '通知推送',
  'notify.webhook': '通知 Webhook 配置',
  'notify.read': '通知已读',
  'notify.clear': '通知清空',
}

export const AUDIT_RESULTS = { ok: '成功', fail: '失败', rejected: '已拒绝' }

export const actionLabel = key => AUDIT_ACTIONS[key] || key
export const resultLabel = key => AUDIT_RESULTS[key] || key

/** 动作列表（供下拉框渲染，按目录声明顺序） */
export function actionOptions() {
  return Object.entries(AUDIT_ACTIONS).map(([value, label]) => ({ value, label }))
}

/**
 * 规范化一条审计记录：补齐缺省值、裁剪超长 detail、统一时间格式。
 * 落盘前必须过这一关，避免两端写出结构不一致的行。
 */
export function normalizeEntry({ action, target = '', result = 'ok', detail = '', actor = 'console', ts } = {}) {
  return {
    ts: ts || new Date().toISOString(),
    actor: String(actor || 'console'),
    action: String(action || ''),
    target: String(target || ''),
    result: String(result || 'ok'),
    detail: String(detail || '').slice(0, 500),
  }
}

/** 关键词命中判定：动作 key / 动作中文名 / 目标 / 详情 任一命中 */
export function matchEntry(entry, keyword) {
  const kw = String(keyword || '').trim().toLowerCase()
  if (!kw) return true
  const hay = `${entry.action} ${actionLabel(entry.action)} ${entry.target} ${entry.detail}`.toLowerCase()
  return hay.includes(kw)
}

/** 审计筛选：按动作 / 结果 / 关键词过滤（入参已是「新 → 旧」顺序） */
export function filterEntries(items, { action = '', result = '', q = '' } = {}) {
  return (items || []).filter(it => {
    if (action && it.action !== action) return false
    if (result && it.result !== result) return false
    return matchEntry(it, q)
  })
}

/** 概览统计：总数 / 失败数 / 最近一次放行 */
export function summarizeEntries(items = []) {
  const list = items || []
  const fail = list.filter(it => it.result !== 'ok')
  const lastApprove = list.find(it => it.action === 'gate.approve' || it.action === 'gate.bypass') || null
  return {
    total: list.length,
    failures: fail.length,
    lastAt: list[0]?.ts || null,
    lastApprove: lastApprove
      ? { ts: lastApprove.ts, action: lastApprove.action, target: lastApprove.target, detail: lastApprove.detail }
      : null,
  }
}