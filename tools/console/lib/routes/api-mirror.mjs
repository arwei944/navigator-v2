/**
 * 控制台路由 · 镜像同步域：把云端变化实时拉到本地。
 *
 * 路由：
 *   GET  /api/mirror           → 同步状态（游标、对象数、最近结果、调度器状态）
 *   POST /api/mirror/sync      → 立即同步一次（body: { force } 强制全量对齐）
 *   GET  /api/mirror/objects   → 本地镜像对象清单
 *
 * 为什么单独成域：它是**单向**的（云端 → 本地），与 publish/sync 那条
 * 「本地 → 云端」的发布链路方向相反。混在一起会让「谁写谁」变得含糊，
 * 而镜像一旦被误当成可回写的副本，就会变成第二个真相源。
 */
import * as mirror from '../ops/mirror.mjs'
import * as audit from '../core/audit.mjs'
import { sendJson, readJsonBody } from './api-http.mjs'

export async function handleMirrorGet(req, res, path, url) {
  if (path === '/api/mirror') {
    const st = mirror.status()
    let schedule = null
    try {
      const mod = await import('../ops/mirror-schedule.mjs')
      schedule = { ...mod.status }
    } catch { /* 调度器未加载时不影响主状态 */ }
    sendJson(res, 200, { ok: true, ...st, schedule })
    return true
  }

  if (path === '/api/mirror/objects') {
    const q = url?.searchParams
    const limit = Number(q?.get('limit')) || 200
    const items = mirror.listObjects(limit)
    sendJson(res, 200, { ok: true, count: items.length, items })
    return true
  }

  return false
}

export async function handleMirrorPost(req, res, path) {
  if (path === '/api/mirror/sync') {
    const body = await readJsonBody(req).catch(() => ({}))
    const force = body.force === true
    try {
      const r = await mirror.syncOnce({ force })
      if (!r.ok) {
        audit.record({
          action: 'mirror.sync',
          result: 'fail',
          target: 'mirror',
          detail: String(r.error).slice(0, 200),
        })
        sendJson(res, 500, r)
        return true
      }
      audit.record({
        action: 'mirror.sync',
        target: 'mirror',
        // 只记规模与游标，不记内容
        detail: `游标 ${r.from} → ${r.cursor} · 应用 ${r.applied} 个 · 删除 ${r.removed} 个${r.fullResync ? ' · 全量对齐' : ''}`,
      })
      sendJson(res, 200, r)
      return true
    } catch (e) {
      const msg = String(e?.message || e)
      audit.record({ action: 'mirror.sync', result: 'fail', target: 'mirror', detail: msg.slice(0, 200) })
      sendJson(res, 500, { ok: false, error: msg })
      return true
    }
  }
  return false
}
