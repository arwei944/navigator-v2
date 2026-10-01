/**
 * 通知内核：通知模型、严重级别、去重与 Webhook 载荷。
 *
 * 「通知中心」的价值不在于多一个列表，而在于把散落的异常收敛成「需要我做什么」。
 * 因此这里定义的不是「消息」，而是「事件」：每类事件有自己的级别、聚合键与处理建议。
 * 同一聚合键的重复事件在冷却期内只保留最新一条，避免巡检把同一个失效站点刷满整个列表。
 *
 * 纯函数、零依赖。
 */

/**
 * 通知类型目录。
 * - severity: info / warn / error
 * - cooldownMs: 同聚合键在此窗口内的重复事件被折叠（保留最新）
 * - action: 建议动作（UI 上的按钮文案来源）
 */
export const NOTIFY_KINDS = {
  'health.down': { id: 'health.down', label: '站点不可达', severity: 'error', cooldownMs: 6 * 3600e3, action: '查看可用性看板' },
  'health.recovered': { id: 'health.recovered', label: '站点恢复', severity: 'info', cooldownMs: 0, action: '查看可用性看板' },
  'publish.done': { id: 'publish.done', label: '发布完成', severity: 'info', cooldownMs: 0, action: '查看发布历史' },
  'publish.fail': { id: 'publish.fail', label: '发布失败', severity: 'error', cooldownMs: 0, action: '查看发布日志' },
  'rollback.done': { id: 'rollback.done', label: '数据已回滚', severity: 'warn', cooldownMs: 0, action: '查看发布历史' },
  'sites.batch': { id: 'sites.batch', label: '批量站点操作', severity: 'info', cooldownMs: 0, action: '查看站点列表' },
  'snapshot.fail': { id: 'snapshot.fail', label: '云端快照失败', severity: 'error', cooldownMs: 0, action: '检查 Blob 配置' },
  'schedule.summary': { id: 'schedule.summary', label: '定时巡检摘要', severity: 'info', cooldownMs: 0, action: '查看可用性看板' },
}

export const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 }
export const SEVERITY_LABEL = { error: '严重', warn: '注意', info: '提示' }

/**
 * 构造一条通知。
 * @param {{ kind: string, title?: string, body?: string, target?: string, link?: string, meta?: object, ts?: string }} input
 */
export function buildNotification({ kind, title = '', body = '', target = '', link = '', meta = {}, ts } = {}) {
  const def = NOTIFY_KINDS[kind] || { id: kind, label: kind, severity: 'info', cooldownMs: 0, action: '' }
  return {
    id: `${kind}:${target || ''}:${ts || new Date().toISOString()}`,
    ts: ts || new Date().toISOString(),
    kind,
    label: def.label,
    severity: def.severity,
    action: def.action,
    title: String(title || def.label),
    body: String(body || ''),
    target: String(target || ''),
    link: String(link || ''),
    meta: meta && typeof meta === 'object' ? meta : {},
  }
}

/**
 * 去重折叠：同一 kind + target 在 cooldownMs 内的重复事件只保留最新一条。
 * 输入需为「新 → 旧」顺序（调用方负责排序），输出同样保持新 → 旧。
 */
export function collapseNotifications(items = [], kinds = NOTIFY_KINDS) {
  const out = []
  const lastSeen = new Map()
  for (const n of items) {
    const def = kinds[n.kind] || {}
    const cooldown = Number(def.cooldownMs) || 0
    const key = `${n.kind}::${n.target || ''}`
    const prevTs = lastSeen.get(key)
    const t = Date.parse(n.ts)
    if (cooldown > 0 && prevTs && Number.isFinite(t) && prevTs - t < cooldown) continue
    lastSeen.set(key, Number.isFinite(t) ? t : Date.now())
    out.push(n)
  }
  return out
}

/** 排序：严重级别优先，其次时间（新 → 旧） */
export function sortNotifications(items = []) {
  return [...items].sort((a, b) => {
    const s = (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
    if (s !== 0) return s
    return a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0
  })
}

/** 筛选：按严重级别 / 类型 / 关键词 */
export function filterNotifications(items = [], { severity = '', kind = '', q = '' } = {}) {
  const kw = String(q || '').trim().toLowerCase()
  return items.filter(n => {
    if (severity && n.severity !== severity) return false
    if (kind && n.kind !== kind) return false
    if (kw && !`${n.label} ${n.title} ${n.body} ${n.target}`.toLowerCase().includes(kw)) return false
    return true
  })
}

/** 汇总：各级别计数 + 未读数（read 标记由调用方在存储层维护） */
export function summarizeNotifications(items = []) {
  const c = { error: 0, warn: 0, info: 0 }
  let unread = 0
  for (const n of items) {
    c[n.severity] = (c[n.severity] || 0) + 1
    if (!n.read) unread++
  }
  return { total: items.length, ...c, unread, latestAt: items[0]?.ts || null }
}

/**
 * Webhook 载荷：把通知转成 POST body。
 * 保持扁平且字段稳定 —— 接收方（如飞书/钉钉机器人或自建服务）依赖字段名解析。
 */
export function webhookPayload(notification) {
  const n = notification || {}
  return {
    event: n.kind || 'notify',
    severity: n.severity || 'info',
    title: n.title || '',
    body: n.body || '',
    target: n.target || '',
    time: n.ts || new Date().toISOString(),
  }
}

/** 飞书 / 通用 Markdown 文本（webhook 文本型机器人的兜底格式） */
export function notificationText(notification) {
  const n = notification || {}
  const icon = { error: '🔴', warn: '🟠', info: '🔵' }[n.severity] || '🔵'
  const head = `${icon} ${n.title || n.label || n.kind}`
  return n.body ? `${head}\n${n.body}` : head
}