/**
 * 控制台路由 · 可观测域：站点探活、通知、排程、数据报表、发布历史。
 *
 * 路由前缀：`/api/health/*`、`/api/notify/*`、`/api/schedule/*`、`/api/data/*`、`/api/history`
 */
import * as jobs from '../core/jobs.mjs'
import * as health from '../observe/health.mjs'
import * as notify from '../observe/notify.mjs'
import * as schedule from '../observe/schedule.mjs'
import * as data from '../content/data.mjs'
import * as history from '../observe/history.mjs'
import { record } from '../core/audit.mjs'
import { sendJson, readJsonBody } from './api-http.mjs'

export async function handleHealthGet(req, res, path, url) {
  if (path === '/api/health/latest') {
    sendJson(res, 200, {
      latest: health.latest(),
      runs: health.runs({ limit: 12 }),
      ...health.recentTrends({ limit: 12 }),
      labels: health.STATUS_LABEL,
    })
    return true
  }

  if (path === '/api/health/history') {
    const id = url.searchParams.get('id') || ''
    if (!id) { sendJson(res, 400, { error: '缺少 id' }); return true }
    sendJson(res, 200, { id, history: health.history(id, { limit: Number(url.searchParams.get('limit')) || 20 }) })
    return true
  }

  if (path === '/api/notify/list') {
    sendJson(res, 200, {
      ...notify.list({
        severity: url.searchParams.get('severity') || '',
        kind: url.searchParams.get('kind') || '',
        q: url.searchParams.get('q') || '',
        limit: Number(url.searchParams.get('limit')) || 100,
        unreadOnly: url.searchParams.get('unread') === '1',
      }),
      webhook: notify.webhookConfig(),
    })
    return true
  }

  if (path === '/api/notify/badge') {
    sendJson(res, 200, { unread: notify.unreadCount() })
    return true
  }

  if (path === '/api/schedule/status') {
    sendJson(res, 200, { ...schedule.status(), jobRunning: jobs.listJobs().some(j => j.title === schedule.JOB_TITLE && j.status === 'running') })
    return true
  }

  if (path === '/api/history') {
    sendJson(res, 200, await history.history({ limit: Number(url.searchParams.get('limit')) || 25 }))
    return true
  }

  if (path === '/api/data/report') {
    sendJson(res, 200, data.report())
    return true
  }

  return false
}

export async function handleHealthPost(req, res, path) {
  if (path === '/api/health/probe') {
    const body = await readJsonBody(req)
    if (jobs.listJobs().some(j => j.title.startsWith('可用性探活') && j.status === 'running')) {
      sendJson(res, 409, { error: '已有探活任务在运行中，请等待完成。' })
      return true
    }
    const job = health.startProbe({
      ids: Array.isArray(body.ids) ? body.ids : null,
      limit: Number(body.limit) || 0,
      timeout: Number(body.timeout) || 12,
      concurrency: Number(body.concurrency) || 12,
      attempts: Number(body.attempts) || 2,
    })
    sendJson(res, 200, { jobId: job.id })
    return true
  }

  if (path === '/api/health/publish') {
    // 把最近一轮本机判定推到云端（前端角标的来源）。不重新探测，只重发。
    const r = await health.publishLatest({ actor: 'console' })
    sendJson(res, r.ok ? 200 : 400, r)
    return true
  }

  if (path === '/api/notify/read') {
    const body = await readJsonBody(req)
    const r = notify.markRead({ ids: Array.isArray(body.ids) ? body.ids : null })
    sendJson(res, 200, r)
    return true
  }

  if (path === '/api/notify/clear') {
    sendJson(res, 200, notify.clear())
    return true
  }

  if (path === '/api/notify/webhook') {
    const body = await readJsonBody(req)
    const cfg = notify.saveWebhookConfig({ url: body.url, minSeverity: body.minSeverity })
    record({ action: 'notify.webhook', target: cfg.url || '(清空)', detail: `最低级别 ${cfg.minSeverity}` })
    sendJson(res, 200, { ok: true, webhook: cfg })
    return true
  }

  if (path === '/api/notify/test') {
    const r = await notify.testWebhook()
    sendJson(res, r.ok ? 200 : 400, r)
    return true
  }

  if (path === '/api/schedule/config') {
    const body = await readJsonBody(req)
    const st = schedule.saveConfig({
      enabled: body.enabled,
      intervalMs: Number(body.intervalMs) || undefined,
      timeout: Number(body.timeout) || undefined,
      concurrency: Number(body.concurrency) || undefined,
      attempts: Number(body.attempts) || undefined,
    })
    record({ action: 'schedule.config', target: st.enabled ? '启用' : '停用', detail: `间隔 ${st.intervalLabel}` })
    sendJson(res, 200, { ok: true, ...st })
    return true
  }

  if (path === '/api/schedule/run') {
    if (jobs.listJobs().some(j => j.title === schedule.JOB_TITLE && j.status === 'running')) {
      sendJson(res, 409, { error: '已有巡检任务在运行中，请等待完成。' })
      return true
    }
    const job = schedule.startInspection({ trigger: 'manual' })
    sendJson(res, 200, { jobId: job.id })
    return true
  }

  return false
}
