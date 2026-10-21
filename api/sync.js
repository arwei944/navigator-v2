/**
 * 三端同步接口：本地库 ↔ BotKeep ↔ Vercel。
 *
 *   GET  /api/sync  → 当前状态、三端清单、最近一次结果（需鉴权）
 *   POST /api/sync  → 立即同步一次；body `{dryRun:true}` 只出计划不写
 *
 * ## 为什么同步不新开写通道
 *
 * 写入仍然走各端的 `POST /api/sites`：那里有 CAS（防并发丢更新）、
 * 写前快照、`sanitizeSites` 门禁。同步器只负责「选最新 + 推落后端」，
 * 存储安全语义一个字都不重复实现。
 *
 * ## 为什么状态要鉴权
 *
 * 状态里有三端地址与最近的失败原因（可能含目标端返回的错误文本）。
 * 三端地址本身不算机密，但失败原因可能带内部路径 —— 与审计日志同一口径，运维面一律要鉴权。
 */
import { checkAuthHeader } from '../shared/auth.mjs'
import { status, runSyncExclusive } from '../shared/tri-sync.mjs'

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
}

async function readBody(req) {
  if (typeof req.body === 'string') return JSON.parse(req.body)
  if (req.body && typeof req.body.getReader === 'function') return new Response(req.body).json()
  return req.body || {}
}

export default async function handler(req, res) {
  noStore(res)

  const auth = checkAuthHeader(req)
  if (!auth.ok) { res.status(auth.code).json({ ok: false, error: auth.error }); return }

  if (req.method === 'GET') {
    try {
      res.status(200).json({ ok: true, ...status(), via: auth.via || 'unknown' })
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) })
    }
    return
  }

  if (req.method === 'POST') {
    let body
    try { body = await readBody(req) } catch { res.status(400).json({ ok: false, error: 'Invalid JSON body' }); return }
    try {
      const result = await runSyncExclusive({
        dryRun: body?.dryRun === true,
        trigger: String(body?.trigger || 'manual'),
      })
      // 计划存在但写入失败 → 424，让前端能区分「接口坏了」与「某端写不进去」
      const code = result.ok ? 200 : (result.plan ? 424 : 500)
      res.status(code).json(result)
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) })
    }
    return
  }

  res.status(405).json({ ok: false, error: 'Method not allowed' })
}