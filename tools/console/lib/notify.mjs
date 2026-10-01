/**
 * 通知中心落盘：把巡检 / 发布 / 批量操作 / 回滚产生的事件收敛成「现在需要我处理什么」。
 *
 * 与审计的分工：审计回答「谁在何时做了什么」，通知回答「哪些事还没人管」。
 * 审计是流水账，不能删；通知是待办，可以已读、可以清空 —— 两者混在一起会既丢线索又刷屏。
 *
 * 记录模型、严重级别与去重规则来自 shared/ops/notify-core.mjs，与线上后台同源，
 * 保证两端能在同一套 UI 里看同一批事件。
 *
 * 硬约束：写入失败绝不阻断主流程；webhook 投递失败只记日志，不影响通知落盘。
 */
import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.mjs'
import {
  NOTIFY_KINDS, SEVERITY_ORDER, buildNotification, collapseNotifications,
  sortNotifications, filterNotifications, summarizeNotifications,
  webhookPayload, notificationText,
} from '../../../shared/ops/notify-core.mjs'

const DATA_DIR = join(ROOT, 'tools', 'console', '.data')
const FILE = join(DATA_DIR, 'notify.jsonl')
const CONFIG_FILE = join(DATA_DIR, 'notify-config.json')
const KEEP = 500

export { NOTIFY_KINDS }

/* ---------------- 存储 ---------------- */

function readAll() {
  let text = ''
  try { text = readFileSync(FILE, 'utf-8') } catch { return [] }
  const out = []
  for (const line of text.split('\n')) {
    const raw = line.trim()
    if (!raw) continue
    try { out.push(JSON.parse(raw)) } catch { /* 跳过写坏的行 */ }
  }
  return out
}

function writeAll(items) {
  mkdirSync(DATA_DIR, { recursive: true })
  const tmp = `${FILE}.tmp`
  writeFileSync(tmp, items.map(n => JSON.stringify(n)).join('\n') + (items.length ? '\n' : ''), 'utf-8')
  renameSync(tmp, FILE)
}

/* ---------------- 写入 ---------------- */

/**
 * 追加一条通知。返回落盘后的记录；失败返回 null（旁路，不抛）。
 * @param {{kind:string,title?:string,body?:string,target?:string,link?:string,meta?:object,ts?:string,actor?:string}} input
 */
export function push(input = {}) {
  try {
    const n = { ...buildNotification(input), read: false, actor: String(input.actor || 'console') }
    const items = [...readAll(), n]
    writeAll(items.slice(Math.max(0, items.length - KEEP)))
    dispatchWebhook(n)
    return n
  } catch {
    return null
  }
}

/* ---------------- 读取 ---------------- */

/** 纯时间序（新 → 旧），供去重折叠使用 */
function byTimeDesc(items) {
  return [...items].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
}

/**
 * 通知查询：新 → 旧，先去重折叠再按严重级别排序。
 * @param {{severity?:string,kind?:string,q?:string,limit?:number,unreadOnly?:boolean}} opts
 */
export function list({ severity = '', kind = '', q = '', limit = 100, unreadOnly = false } = {}) {
  const raw = readAll()
  const collapsed = collapseNotifications(byTimeDesc(raw))
  const filtered = filterNotifications(collapsed, { severity, kind, q })
    .filter(n => !unreadOnly || !n.read)
  const sorted = sortNotifications(filtered)
  return {
    total: collapsed.length,
    matched: sorted.length,
    summary: summarizeNotifications(collapsed),
    kinds: NOTIFY_KINDS,
    severities: { error: '严重', warn: '注意', info: '提示' },
    items: sorted.slice(0, Math.max(1, Math.min(Number(limit) || 100, 500))),
  }
}

/** 未读数（顶部角标用） */
export function unreadCount() {
  return summarizeNotifications(collapseNotifications(byTimeDesc(readAll()))).unread
}

/** 全部已读 / 按 id 标记已读。整文件重写，记录量小可接受。 */
export function markRead({ ids = null } = {}) {
  const set = Array.isArray(ids) && ids.length ? new Set(ids) : null
  const items = readAll()
  let n = 0
  for (const it of items) {
    if (it.read) continue
    if (set && !set.has(it.id)) continue
    it.read = true
    n += 1
  }
  if (n) writeAll(items)
  return { ok: true, read: n }
}

export function clear() {
  const n = readAll().length
  writeAll([])
  return { ok: true, cleared: n }
}

/* ---------------- Webhook ---------------- */

const DEFAULT_WEBHOOK = { url: '', minSeverity: 'warn' }

export function webhookConfig() {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
    return { ...DEFAULT_WEBHOOK, ...raw }
  } catch {
    return { ...DEFAULT_WEBHOOK }
  }
}

export function saveWebhookConfig(patch = {}) {
  const next = { ...webhookConfig(), ...patch }
  next.minSeverity = SEVERITY_ORDER[next.minSeverity] === undefined ? DEFAULT_WEBHOOK.minSeverity : next.minSeverity
  next.url = String(next.url || '').trim()
  mkdirSync(DATA_DIR, { recursive: true })
  const tmp = `${CONFIG_FILE}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8')
  renameSync(tmp, CONFIG_FILE)
  return next
}

/**
 * 投递 webhook。低于阈值不发；失败静默（通知中心本身不因外部服务不可用而失败）。
 * 走 curl.exe：本机 Node fetch 不走系统代理。
 */
function dispatchWebhook(n) {
  const cfg = webhookConfig()
  if (!cfg.url) return
  const threshold = SEVERITY_ORDER[cfg.minSeverity] ?? SEVERITY_ORDER.warn
  if ((SEVERITY_ORDER[n.severity] ?? 9) > threshold) return
  const payload = JSON.stringify({ ...webhookPayload(n), text: notificationText(n) })
  try {
    execFile('curl.exe', [
      '-s', '-X', 'POST', cfg.url,
      '-H', 'Content-Type: application/json',
      '--data-binary', payload,
      '--max-time', '10',
    ], { windowsHide: true, timeout: 15000 }, () => { /* 结果不关心 */ }).unref?.()
  } catch { /* curl 不存在或参数异常都不影响落盘 */ }
}

/** 手动测试 webhook：同步返回结果，便于 UI 立即反馈 */
export function testWebhook() {
  const cfg = webhookConfig()
  if (!cfg.url) return Promise.resolve({ ok: false, error: '未配置 webhook 地址' })
  const n = buildNotification({ kind: 'schedule.summary', title: '通知中心连通性测试', body: '这是一条来自 nav-console 的测试通知。' })
  const payload = JSON.stringify({ ...webhookPayload(n), text: notificationText(n) })
  return new Promise(resolve => {
    execFile('curl.exe', [
      '-s', '-o', 'NUL', '-w', '%{http_code}', '-X', 'POST', cfg.url,
      '-H', 'Content-Type: application/json',
      '--data-binary', payload,
      '--max-time', '10',
    ], { windowsHide: true, timeout: 15000 }, (err, stdout) => {
      if (err) { resolve({ ok: false, error: err.message }); return }
      const code = String(stdout || '').trim()
      resolve({ ok: code.startsWith('2'), code })
    })
  })
}

export const NOTIFY_FILE = FILE