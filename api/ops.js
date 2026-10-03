/**
 * 线上运维面：发布历史 + 通知中心的持久化与查询。
 *
 * 为什么单独一个函数：`api/sites.js` 是**数据面**（站点数据的读写与快照），
 * 它必须尽量简单、失败面尽量小 —— 热更新是用户可感知的关键路径。
 * 而发布历史、通知属于**运维面**，是旁路信息：写失败不该影响发布本身。
 * 把两者分到不同函数，数据面就永远不会因为运维面的 bug 而变慢或变脆。
 *
 * 记录结构来自 shared/ops/*（与本地控制台同源），因此两端能在同一套语义下对比。
 * 鉴权：全部要求 Bearer 凭据（登录会话 token 或 SITES_ADMIN_KEY）—— 运维面信息不对匿名访客开放。
 */
import { get, put } from '@vercel/blob'
import { checkAuthHeader } from '../shared/auth.mjs'
import {
  HISTORY_KEEP, TRIGGERS, normalizeRecord, sortRecords, filterRecords,
  summarizeRecords, prunableRecords,
} from '../shared/ops/publish-history.mjs'
import {
  NOTIFY_KINDS, SEVERITY_LABEL, buildNotification, collapseNotifications,
  sortNotifications, filterNotifications, summarizeNotifications,
} from '../shared/ops/notify-core.mjs'
import {
  AUDIT_ACTIONS, AUDIT_RESULTS, actionOptions,
  normalizeEntry, filterEntries, summarizeEntries,
} from '../shared/ops/audit-core.mjs'

const HISTORY_PATH = 'ops/publish-history.json'
const NOTIFY_PATH = 'ops/notifications.json'
const AUDIT_PATH = 'ops/audit.json'
const NOTIFY_KEEP = 200
const AUDIT_KEEP = 2000

/* ---------------- Blob 读写 ---------------- */

async function readJson(pathname, fallback) {
  try {
    const blob = await get(pathname, { access: 'private', useCache: false })
    if (!blob || !blob.stream) return fallback
    const text = await new Response(blob.stream).text()
    const data = JSON.parse(text)
    return Array.isArray(data) ? data : fallback
  } catch {
    return fallback
  }
}

async function writeJson(pathname, data) {
  await put(pathname, JSON.stringify(data), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  })
}

const readHistory = () => readJson(HISTORY_PATH, [])
const readNotifications = () => readJson(NOTIFY_PATH, [])
const readAudit = () => readJson(AUDIT_PATH, [])

/* ---------------- 写入 ---------------- */

/** 追加一条发布记录并按保留上限裁剪；返回落盘后的记录 */
async function appendHistory(input) {
  const record = normalizeRecord(input)
  const items = sortRecords([...await readHistory(), record])
  const drop = new Set(prunableRecords(items, HISTORY_KEEP))
  await writeJson(HISTORY_PATH, items.filter(r => !drop.has(r.id)))
  return record
}

/** 追加一条通知：先折叠冷却期内的同键重复事件，再按上限裁剪 */
async function pushNotification(input) {
  const n = { ...buildNotification(input), read: false }
  const merged = collapseNotifications([n, ...await readNotifications()])
  await writeJson(NOTIFY_PATH, merged.slice(0, NOTIFY_KEEP))
  return n
}

async function markRead(ids) {
  const list = await readNotifications()
  const set = new Set(Array.isArray(ids) ? ids : [])
  const next = list.map(n => (set.size === 0 || set.has(n.id) ? { ...n, read: true } : n))
  await writeJson(NOTIFY_PATH, next)
  return { updated: next.filter(n => n.read).length, total: next.length }
}

/**
 * 追加一条审计记录。审计是旁路：写失败不抛给调用方，只回 ok:false，
 * 让「记不上账」不至于反过来阻断发布/编辑这些主流程。
 */
async function appendAudit(input) {
  const entry = normalizeEntry(input || {})
  const items = [entry, ...await readAudit()].slice(0, AUDIT_KEEP)
  await writeJson(AUDIT_PATH, items)
  return entry
}

/* ---------------- HTTP 辅助 ---------------- */

/**
 * 鉴权：运维面全部要求 Bearer 凭据（会话 token 或共享密钥）。
 * 运维面信息不对匿名访客开放。
 */
function authorized(req) {
  return checkAuthHeader(req)
}

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
}

function readBody(req) {
  if (typeof req.body === 'string') return JSON.parse(req.body)
  if (req.body && typeof req.body.getReader === 'function') return new Response(req.body).json()
  return Promise.resolve(req.body || {})
}

/* ---------------- handler ---------------- */

export default async function handler(req, res) {
  noStore(res)
  const auth = authorized(req)
  if (!auth.ok) { res.status(auth.code).json({ ok: false, error: auth.error }); return }

  const query = (req.query && typeof req.query === 'object') ? req.query : {}

  if (req.method === 'GET') {
    try {
      if (query.audit !== undefined) {
        const all = await readAudit()
        const items = filterEntries(all, {
          action: query.action || '',
          result: query.result || '',
          q: query.q || '',
        })
        const limit = Math.max(1, Math.min(Number(query.limit) || 200, 2000))
        res.status(200).json({
          ok: true,
          total: all.length,
          matched: items.length,
          summary: summarizeEntries(all),
          actions: actionOptions(),
          actionLabels: AUDIT_ACTIONS,
          results: AUDIT_RESULTS,
          items: items.slice(0, limit),
        })
        return
      }

      if (query.notifications !== undefined) {
        const raw = await readNotifications()
        const collapsed = collapseNotifications(sortNotifications(raw))
        const items = filterNotifications(collapsed, {
          severity: query.severity || '',
          kind: query.kind || '',
          q: query.q || '',
        }).filter(n => query.unread !== '1' || !n.read)
        const limit = Math.max(1, Math.min(Number(query.limit) || 100, 500))
        res.status(200).json({
          ok: true,
          total: collapsed.length,
          matched: items.length,
          summary: summarizeNotifications(collapsed),
          kinds: NOTIFY_KINDS,
          severities: SEVERITY_LABEL,
          items: sortNotifications(items).slice(0, limit),
        })
        return
      }

      // 默认返回发布历史
      const items = sortRecords(await readHistory())
      const matched = filterRecords(items, {
        ok: query.ok || '',
        trigger: query.trigger || '',
        q: query.q || '',
      })
      const limit = Math.max(1, Math.min(Number(query.limit) || 30, 200))
      res.status(200).json({
        ok: true,
        total: items.length,
        matched: matched.length,
        summary: summarizeRecords(items),
        triggers: TRIGGERS,
        items: matched.slice(0, limit),
      })
      return
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) })
      return
    }
  }

  if (req.method === 'POST') {
    let body
    try {
      body = await readBody(req)
    } catch {
      res.status(400).json({ ok: false, error: 'Invalid JSON body' })
      return
    }

    try {
      switch (body.action) {
        case 'history.append': {
          const record = await appendHistory(body.record || {})
          res.status(200).json({ ok: true, record })
          return
        }
        case 'notify.push': {
          const n = await pushNotification(body.notification || body)
          res.status(200).json({ ok: true, notification: n })
          return
        }
        case 'notify.read': {
          res.status(200).json({ ok: true, ...(await markRead(body.ids)) })
          return
        }
        case 'notify.clear': {
          await writeJson(NOTIFY_PATH, [])
          res.status(200).json({ ok: true })
          return
        }
        case 'audit.append': {
          try {
            const entry = await appendAudit(body.entry || body)
            res.status(200).json({ ok: true, entry })
          } catch (e) {
            // 审计是旁路：落盘失败也不能让调用方以为主流程失败
            res.status(200).json({ ok: false, error: String(e?.message || e) })
          }
          return
        }
        default:
          res.status(400).json({ ok: false, error: `未知动作：${body.action}` })
          return
      }
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) })
      return
    }
  }

  res.status(405).json({ ok: false, error: 'Method not allowed' })
}