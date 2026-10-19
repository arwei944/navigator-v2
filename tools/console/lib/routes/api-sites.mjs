/**
 * 控制台路由 · 站点数据域：列表/元信息/增删改/图标抓取/批量操作/同步。
 *
 * 路由前缀：`/api/sites/*`
 *
 * 这里的写操作都会落审计，且失败也记 —— 「改站点失败」比成功更需要留痕，
 * 否则用户只看到一条错误提示，事后无法复现是哪次操作、哪个字段。
 */
import * as jobs from '../core/jobs.mjs'
import * as sites from '../content/sites.mjs'
import * as notify from '../observe/notify.mjs'
import { fmtBytes } from '../../../../shared/format.mjs'
import { record } from '../core/audit.mjs'
import { sendJson, readJsonBody, stripNext } from './api-http.mjs'

/** 抓取单个站点图标（多来源兜底，耗时不定，走任务 + SSE） */
export function startIconFetch(id, faviconUrl) {
  const job = jobs.createJob(`抓取图标 ${id}`)
  ;(async () => {
    jobs.log(job, `开始抓取 ${id} 的图标（页面声明 → /favicon.ico → favicon.im）`, 'info')
    try {
      const r = await sites.downloadIcon(id, { faviconUrl })
      jobs.emitEvent(job, 'icon', r)
      jobs.log(job, `✅ 已保存 ${r.icon}（${fmtBytes(r.bytes)}，来源 ${r.source}）`, 'success')
      jobs.finish(job, 0)
    } catch (e) {
      jobs.log(job, `❌ ${e.message}`, 'stderr')
      jobs.finish(job, -1)
    }
  })()
  return job
}

export async function handleSitesGet(req, res, path, url) {
  if (path === '/api/sites/list') {
    sendJson(res, 200, sites.list({
      q: url.searchParams.get('q') || '',
      category: url.searchParams.get('category') || '',
    }))
    return true
  }

  if (path === '/api/sites/meta') {
    try {
      sendJson(res, 200, await sites.fetchMeta(url.searchParams.get('url') || ''))
    } catch (e) {
      sendJson(res, 400, { error: e.message })
    }
    return true
  }

  return false
}

export async function handleSitesPost(req, res, path) {
  if (path === '/api/sites/add') {
    const body = await readJsonBody(req)
    try {
      const site = sites.addSite(body)
      record({ action: 'sites.add', target: `${site.id} ${site.name}`, detail: site.url || '' })
      sendJson(res, 200, { ok: true, site })
    } catch (e) {
      record({ action: 'sites.add', result: 'fail', target: body.url || '', detail: e.message })
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return true
  }

  if (path === '/api/sites/update') {
    const body = await readJsonBody(req)
    try {
      const site = sites.updateSite(body.id, body.patch || {})
      record({ action: 'sites.update', target: `${site.id} ${site.name}`, detail: `字段：${Object.keys(body.patch || {}).join('/')}` })
      sendJson(res, 200, { ok: true, site })
    } catch (e) {
      record({ action: 'sites.update', result: 'fail', target: String(body.id || ''), detail: e.message })
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return true
  }

  if (path === '/api/sites/remove') {
    const body = await readJsonBody(req)
    try {
      const site = sites.removeSite(body.id)
      record({ action: 'sites.remove', target: `${site.id} ${site.name}`, detail: site.url || '' })
      sendJson(res, 200, { ok: true, site })
    } catch (e) {
      record({ action: 'sites.remove', result: 'fail', target: String(body.id || ''), detail: e.message })
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return true
  }

  if (path === '/api/sites/batch/preview') {
    const body = await readJsonBody(req)
    try {
      sendJson(res, 200, { ok: true, ...stripNext(sites.previewBatch({ ids: body.ids, op: body.op, patch: body.patch })) })
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return true
  }

  if (path === '/api/sites/batch') {
    const body = await readJsonBody(req)
    try {
      const r = sites.batchOp({ ids: body.ids, op: body.op, patch: body.patch })
      if (!r.ok) {
        record({ action: 'sites.batch', result: 'rejected', target: `${body.op} · ${(body.ids || []).length} 个`, detail: r.errors.join('；') })
        sendJson(res, 400, { ok: false, error: r.errors.join('；'), ...stripNext(r) })
        return true
      }
      record({
        action: 'sites.batch',
        target: `${r.op} · ${(body.ids || []).length} 个`,
        detail: `${r.summary}；字段 ${[...new Set(r.changes.flatMap(c => c.labels))].join('/') || '无'}`,
      })
      notify.push({
        kind: 'sites.batch',
        title: `批量操作：${r.op}`,
        body: `${r.summary}；字段 ${[...new Set(r.changes.flatMap(c => c.labels))].join('/') || '无'}（本地已改，需同步到云端才生效）`,
        meta: { op: r.op, ids: body.ids || [], summary: r.summary },
      })
      sendJson(res, 200, { ok: true, ...stripNext(r) })
    } catch (e) {
      record({ action: 'sites.batch', result: 'fail', target: String(body.op || ''), detail: e.message })
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return true
  }

  if (path === '/api/sites/icon') {
    const body = await readJsonBody(req)
    if (!body.id) { sendJson(res, 400, { error: '缺少 id' }); return true }
    record({ action: 'icon.fetch', target: body.id, detail: body.faviconUrl ? `指定来源 ${body.faviconUrl}` : '自动来源' })
    const job = startIconFetch(body.id, body.faviconUrl || '')
    sendJson(res, 200, { jobId: job.id })
    return true
  }

  if (path === '/api/sites/sync') {
    const body = await readJsonBody(req)
    try {
      const job = sites.startDataSync({
        commit: body.commit !== false,
        push: body.push !== false,
        message: body.message,
      })
      record({ action: 'sites.sync', target: 'api/sites-data.json', detail: `提交=${body.commit !== false} 推送=${body.push !== false}` })
      sendJson(res, 200, { jobId: job.id, steps: job.steps.map(s => s.key) })
    } catch (e) {
      record({ action: 'sites.sync', result: 'fail', target: 'api/sites-data.json', detail: e.message })
      sendJson(res, 409, { error: e.message })
    }
    return true
  }

  return false
}
