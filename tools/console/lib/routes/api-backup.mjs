/**
 * 控制台路由 · 备份域：线上数据库的离线备份。
 *
 * 路由：
 *   GET  /api/backup          → 备份列表 + 新鲜度判定（部署闸门用）
 *   POST /api/backup/run      → 立即备份（下载 → 校验 → 落盘 → 清理超量）
 *
 * 为什么单独成域而不是塞进 ops：备份是**唯一能在平台故障后救回数据**的手段，
 * 它的可用性不该和别的运维动作耦合。将来加定时任务或异地同步也落在这里。
 */
import * as backup from '../ops/backup.mjs'
import * as audit from '../core/audit.mjs'
import { sendJson, readJsonBody } from './api-http.mjs'

export async function handleBackupGet(req, res, path, url) {
  if (path === '/api/backup') {
    const q = url?.searchParams
    const maxAgeHours = Number(q?.get('maxAgeHours')) || 24
    const st = backup.status({ maxAgeHours })
    // 定时调度器状态：面板要能回答「它到底会不会自己备份」，
    // 而不是只显示已有几份文件
    let schedule = null
    try {
      const mod = await import('../ops/backup-schedule.mjs')
      schedule = { ...mod.status }
    } catch { /* 调度器未加载时不影响主状态 */ }
    sendJson(res, 200, { ...st, schedule })
    return true
  }
  return false
}

export async function handleBackupPost(req, res, path) {
  if (path === '/api/backup/run') {
    const body = await readJsonBody(req).catch(() => ({}))
    const keep = Number(body.keep) || undefined
    try {
      const r = await backup.runBackup(keep ? { keep } : {})
      if (!r.ok) {
        audit.record({ action: 'backup.run', result: 'fail', target: 'store.db', detail: String(r.error).slice(0, 200) })
        sendJson(res, 500, r)
        return true
      }
      audit.record({
        action: 'backup.run',
        target: r.name,
        // 只记规模，不记内容
        detail: `${r.siteCount} 站点 · ${r.objects} 对象 · ${(r.bytes / 1024).toFixed(0)} KB${r.pruned?.length ? ` · 清理 ${r.pruned.length} 个旧文件` : ''}`,
      })
      sendJson(res, 200, r)
      return true
    } catch (e) {
      const msg = String(e?.message || e)
      audit.record({ action: 'backup.run', result: 'fail', target: 'store.db', detail: msg.slice(0, 200) })
      sendJson(res, 500, { ok: false, error: msg })
      return true
    }
  }
  return false
}
