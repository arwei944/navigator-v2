/**
 * 控制台 JSON API 路由。返回 true 表示已处理。
 * 来源校验统一在 server.mjs 入口执行（isTrusted），本模块只做路由。
 */
import { ROOT, getAdminKey, envSummary } from './env.mjs'
import * as jobs from './jobs.mjs'
import * as git from './git.mjs'
import * as changes from './changes.mjs'
import * as sync from './sync.mjs'
import * as history from './history.mjs'
import * as data from './data.mjs'
import * as sites from './sites.mjs'
import * as gate from './gate.mjs'
import * as snapshots from './snapshots.mjs'
import * as audit from './audit.mjs'
import * as publishlog from './publishlog.mjs'
import * as health from './health.mjs'
import * as notify from './notify.mjs'
import * as schedule from './schedule.mjs'
import { record } from './audit.mjs'

export function sendJson(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

/** 批量结果里 `next` 是整份站点数组（300+ 条），只对落盘有意义，不回传给前端 */
function stripNext({ next, ...rest }) {
  return rest
}

async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (chunks.length === 0) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf-8')) } catch { return {} }
}

/** 回环主机名白名单（IPv6 字面量带方括号，与 URL.hostname 的输出形式一致） */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/** 取 Host 头的主机名部分：剥离端口，兼容 [::1]:5175 这类 IPv6 字面量 */
function hostNameOf(req) {
  const raw = String(req.headers.host || '').trim().toLowerCase()
  if (!raw) return ''
  const v6 = raw.match(/^\[([^\]]+)\](?::\d+)?$/)
  return v6 ? v6[1] : raw.replace(/:\d+$/, '')
}

function isLoopbackOrigin(origin) {
  try { return LOOPBACK.has(new URL(origin).hostname) } catch { return false }
}

/**
 * 来源可信判定 —— 控制台所有请求（含静态资源与读接口）的统一入口校验。
 *
 * ① Host 必须是回环地址：DNS rebinding 攻击中浏览器发出的 Host 仍是攻击者域名，
 *    仅监听 127.0.0.1 挡不住，这一条才是核心防线。
 * ② Origin 存在时其主机名也必须是回环地址：阻断跨站页面直接调用。
 * ③ 非 GET 的写操作额外要求自定义头 X-Nav-Console：跨站携带该头会触发预检，
 *    而本服务不返回 CORS 许可。GET 通道（如 EventSource）无法携带请求头，由 ①② 兜底。
 *
 * 本机 curl / 脚本调试天然满足 ①②（Host=127.0.0.1、无 Origin）；
 * 调写接口需自行附加 -H "X-Nav-Console: 1"。
 */
export function isTrusted(req) {
  if (!LOOPBACK.has(hostNameOf(req))) return false
  const origin = req.headers.origin
  if (origin && !isLoopbackOrigin(origin)) return false
  if (req.method !== 'GET' && req.headers['x-nav-console'] !== '1') return false
  return true
}

/** 控制台自检任务：验证 SSE 通道与子进程日志管道 */
function startSelfCheck() {
  const steps = ['环境变量加载正常', 'SSE 通道已连通', '子进程日志管道正常', '日志回放缓冲可用']
  const job = jobs.createJob('控制台自检')
  const script = `
const steps = ${JSON.stringify(steps)}
let i = 0
const timer = setInterval(() => {
  if (i >= steps.length) {
    clearInterval(timer)
    console.log('✅ 自检完成，控制台骨架就绪')
    process.exit(0)
  }
  console.log('· 检查 ' + (i + 1) + '/' + steps.length + '：' + steps[i++])
}, 350)
`
  jobs.run(job, process.execPath, ['-e', script], { cwd: ROOT })
  return job
}

/** 抓取单个站点图标（多来源兜底，耗时不定，走任务 + SSE） */
function startIconFetch(id, faviconUrl) {
  const job = jobs.createJob(`抓取图标 ${id}`)
  ;(async () => {
    jobs.log(job, `开始抓取 ${id} 的图标（页面声明 → /favicon.ico → favicon.im）`, 'info')
    try {
      const r = await sites.downloadIcon(id, { faviconUrl })
      jobs.emitEvent(job, 'icon', r)
      jobs.log(job, `✅ 已保存 ${r.icon}（${(r.bytes / 1024).toFixed(1)} KB，来源 ${r.source}）`, 'success')
      jobs.finish(job, 0)
    } catch (e) {
      jobs.log(job, `❌ ${e.message}`, 'stderr')
      jobs.finish(job, -1)
    }
  })()
  return job
}

async function startPush({ dryRun = false } = {}) {
  const st = await git.getStatus()
  if (!st.branch) throw new Error('当前处于 detached HEAD，无法推送')
  if (st.ahead === 0 && st.upstream) throw new Error(`没有待推送的提交（origin/${st.branch} 已是最新）`)
  const job = jobs.createJob(dryRun ? `git push --dry-run → origin/${st.branch}` : `git push → origin/${st.branch}`)
  const args = st.upstream ? ['push', 'origin', st.branch] : ['push', '-u', 'origin', st.branch]
  if (dryRun) args.push('--dry-run')
  jobs.run(job, 'git', args, {
    cwd: ROOT,
    env: { GIT_TERMINAL_PROMPT: '0' },
    stderrMode: 'info',
    timeoutMs: 180000,
  })
  return { job, branch: st.branch }
}

export async function handleApi(req, res, path, url) {
  const method = req.method

  if (method === 'GET' && path === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      root: ROOT,
      pid: process.pid,
      adminKeyConfigured: Boolean(getAdminKey()),
      node: process.version,
      platform: process.platform,
    })
    return true
  }

  if (method === 'GET' && path === '/api/env') {
    sendJson(res, 200, envSummary())
    return true
  }

  if (method === 'GET' && path === '/api/jobs') {
    sendJson(res, 200, { jobs: jobs.listJobs() })
    return true
  }

  if (method === 'GET' && path === '/api/git/status') {
    sendJson(res, 200, await git.getStatus())
    return true
  }

  if (method === 'GET' && path === '/api/git/diff') {
    const file = url.searchParams.get('path') || ''
    const staged = url.searchParams.get('staged') === '1'
    sendJson(res, 200, await git.getDiff(file, staged))
    return true
  }

  if (method === 'GET' && path === '/api/changes/summary') {
    sendJson(res, 200, await changes.summary())
    return true
  }

  if (method === 'GET' && path === '/api/sync/status') {
    sendJson(res, 200, await sync.status())
    return true
  }

  if (method === 'GET' && path === '/api/sync/cloud') {
    sendJson(res, 200, await sync.fetchCloud())
    return true
  }

  if (method === 'GET' && path === '/api/sync/deployments') {
    sendJson(res, 200, await sync.deployments(Number(url.searchParams.get('limit')) || 8))
    return true
  }

  if (method === 'GET' && path === '/api/publish/preflight') {
    try {
      sendJson(res, 200, await gate.preflight({ kind: 'publish', message: url.searchParams.get('message') || '' }))
    } catch (e) {
      sendJson(res, 400, { error: e.message })
    }
    return true
  }

  if (method === 'GET' && path === '/api/publish/gates') {
    sendJson(res, 200, { gates: gate.listGates() })
    return true
  }

  if (method === 'GET' && path === '/api/publish/history') {
    sendJson(res, 200, publishlog.list({
      ok: url.searchParams.get('ok') || '',
      trigger: url.searchParams.get('trigger') || '',
      q: url.searchParams.get('q') || '',
      limit: Number(url.searchParams.get('limit')) || 30,
    }))
    return true
  }

  if (method === 'GET' && path === '/api/publish/snapshots') {
    try {
      sendJson(res, 200, await snapshots.listSnapshots())
    } catch (e) {
      sendJson(res, 400, { error: e.message })
    }
    return true
  }

  if (method === 'GET' && path === '/api/audit') {
    sendJson(res, 200, {
      ...audit.list({
        limit: Number(url.searchParams.get('limit')) || 200,
        action: url.searchParams.get('action') || '',
        result: url.searchParams.get('result') || '',
        q: url.searchParams.get('q') || '',
      }),
      summary: audit.summary(),
      actions: audit.ACTIONS,
    })
    return true
  }

  if (method === 'GET' && path === '/api/health/latest') {
    sendJson(res, 200, {
      latest: health.latest(),
      runs: health.runs({ limit: 12 }),
      ...health.recentTrends({ limit: 12 }),
      labels: health.STATUS_LABEL,
    })
    return true
  }

  if (method === 'GET' && path === '/api/health/history') {
    const id = url.searchParams.get('id') || ''
    if (!id) { sendJson(res, 400, { error: '缺少 id' }); return true }
    sendJson(res, 200, { id, history: health.history(id, { limit: Number(url.searchParams.get('limit')) || 20 }) })
    return true
  }

  if (method === 'GET' && path === '/api/notify/list') {
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

  if (method === 'GET' && path === '/api/notify/badge') {
    sendJson(res, 200, { unread: notify.unreadCount() })
    return true
  }

  if (method === 'GET' && path === '/api/schedule/status') {
    sendJson(res, 200, { ...schedule.status(), jobRunning: jobs.listJobs().some(j => j.title === schedule.JOB_TITLE && j.status === 'running') })
    return true
  }

  if (method === 'GET' && path === '/api/history') {
    sendJson(res, 200, await history.history({ limit: Number(url.searchParams.get('limit')) || 25 }))
    return true
  }

  if (method === 'GET' && path === '/api/data/report') {
    sendJson(res, 200, data.report())
    return true
  }

  if (method === 'GET' && path === '/api/sites/list') {
    sendJson(res, 200, sites.list({
      q: url.searchParams.get('q') || '',
      category: url.searchParams.get('category') || '',
    }))
    return true
  }

  if (method === 'GET' && path === '/api/sites/meta') {
    try {
      sendJson(res, 200, await sites.fetchMeta(url.searchParams.get('url') || ''))
    } catch (e) {
      sendJson(res, 400, { error: e.message })
    }
    return true
  }

  if (method === 'POST') {
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

    if (path === '/api/jobs/selfcheck') {
      const job = startSelfCheck()
      sendJson(res, 200, { jobId: job.id })
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

    const killMatch = path.match(/^\/api\/jobs\/([^/]+)\/kill$/)
    if (killMatch) {
      const ok = jobs.killJob(killMatch[1])
      sendJson(res, ok ? 200 : 404, { ok })
      return true
    }

    if (path === '/api/git/stage') {
      const body = await readJsonBody(req)
      const paths = body.paths || []
      const list = body.stage === false ? await git.unstagePaths(paths) : await git.stagePaths(paths)
      sendJson(res, 200, { ok: true, paths: list, staged: body.stage !== false })
      return true
    }

    if (path === '/api/git/hunks') {
      const body = await readJsonBody(req)
      try {
        const r = await git.applyHunks(String(body.path || ''), body.indexes, { staged: body.staged === true })
        sendJson(res, 200, { ok: true, ...r })
      } catch (e) {
        sendJson(res, 400, { ok: false, error: e.message })
      }
      return true
    }

    if (path === '/api/git/commit') {
      const body = await readJsonBody(req)
      try {
        const result = await git.commit(body.message, body.paths)
        record({ action: 'commit', target: result.sha || '', detail: `${(body.paths || []).length} 个文件 · ${body.message || ''}` })
        sendJson(res, 200, { ok: true, ...result })
      } catch (e) {
        record({ action: 'commit', result: 'fail', target: '提交失败', detail: e.message })
        sendJson(res, 400, { ok: false, error: e.message })
      }
      return true
    }

    if (path === '/api/git/push') {
      const body = await readJsonBody(req)
      try {
        const { job, branch } = await startPush({ dryRun: body.dryRun === true })
        record({ action: 'push', target: `origin/${branch}`, detail: body.dryRun ? '预演（--dry-run）' : '已发起推送' })
        sendJson(res, 200, { jobId: job.id, branch })
      } catch (e) {
        record({ action: 'push', result: 'fail', target: '推送失败', detail: e.message })
        sendJson(res, 400, { error: e.message })
      }
      return true
    }

    if (path === '/api/sync/publish') {
      const body = await readJsonBody(req)
      if (jobs.listJobs().some(j => j.title === sync.PUBLISH_JOB_TITLE && j.status === 'running')) {
        sendJson(res, 409, { error: '已有发布任务在运行中，请等待完成或终止后再试。' })
        return true
      }
      let g
      try {
        g = await sync.resolveGate({ gateId: body.gateId, allowUngated: body.noGate === true })
      } catch (e) {
        sendJson(res, 403, { error: e.message })
        return true
      }
      const job = sync.startPublish({
        message: body.message,
        push: body.push !== false,
        skipBuild: body.skipBuild === true,
        gateId: g.gateId,
      })
      sendJson(res, 200, { jobId: job.id, steps: job.steps.map(s => s.key), gate: g })
      return true
    }

    if (path === '/api/publish/rollback') {
      const body = await readJsonBody(req)
      const pathname = String(body.snapshot || '')
      if (!pathname) { sendJson(res, 400, { error: '缺少快照 pathname' }); return true }
      try {
        const preview = await snapshots.previewRollback(pathname)
        record({
          action: 'rollback.preview', target: pathname,
          detail: `v${preview.currentVersion}(${preview.currentCount}) → v${preview.snapshotVersion}(${preview.snapshotCount}) · 移除 ${preview.willRemove.length} / 恢复 ${preview.willRestore.length} / 改回 ${preview.willRevert.length}`,
        })
        if (body.dryRun === true) {
          sendJson(res, 200, { ok: true, dryRun: true, preview })
          return true
        }
        const r = await snapshots.rollbackTo(pathname)
        record({
          action: 'rollback.apply', target: pathname,
          detail: `云端 v${r.previousVersion} → v${r.version} · ${r.sites.length} 站点；回滚前数据已存快照 ${r.snapshot?.pathname || '(无)'}`,
        })
        notify.push({
          kind: 'rollback.done',
          title: `云端数据已回滚 · v${r.previousVersion} → v${r.version}`,
          body: `${r.sites.length} 站点；回滚前数据已存快照 ${r.snapshot?.pathname || '(无)'}`,
          meta: { from: r.previousVersion, to: r.version, count: r.sites.length, safetySnapshot: r.snapshot?.pathname || '' },
        })
        sendJson(res, 200, {
          ok: true,
          preview,
          restoredFrom: r.restoredFrom,
          previousVersion: r.previousVersion,
          version: r.version,
          count: r.sites.length,
          withIcons: r.sites.filter(s => s.icon).length,
          safetySnapshot: r.snapshot,
        })
      } catch (e) {
        record({ action: 'rollback.apply', result: 'fail', target: pathname, detail: e.message })
        sendJson(res, 400, { ok: false, error: e.message })
      }
      return true
    }

    if (path === '/api/sync/verify') {
      const body = await readJsonBody(req)
      const job = sync.startVerify({
        expectCount: Number.isFinite(body.expectCount) ? body.expectCount : null,
        tries: Number(body.tries) || 6,
      })
      sendJson(res, 200, { jobId: job.id })
      return true
    }

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
  }

  return false
}