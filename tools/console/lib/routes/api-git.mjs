/**
 * 控制台路由 · 版本控制与发布域：git 暂存/提交/推送、变更摘要、云端同步、发布预检与快照。
 *
 * 路由前缀：`/api/git/*`、`/api/changes/*`、`/api/sync/*`、`/api/publish/*`
 *
 * 这里所有写操作都会落审计（`record`），这是控制台能被安全使用的关键：
 * 出了问题要能回答「谁在什么时候推了什么」。
 */
import { ROOT } from '../core/env.mjs'
import * as jobs from '../core/jobs.mjs'
import * as git from '../vcs/git.mjs'
import * as changes from '../vcs/changes.mjs'
import * as sync from '../publish/sync.mjs'
import * as gate from '../core/gate.mjs'
import * as snapshots from '../publish/snapshots.mjs'
import * as publishlog from '../publish/publishlog.mjs'
import { record } from '../core/audit.mjs'
import { sendJson, readJsonBody } from './api-http.mjs'

async function startPush({ dryRun = false } = {}) {
  const st = await git.getStatus()
  if (!st.branch) throw new Error('当前处于 detached HEAD，无法推送')
  if (st.ahead === 0 && st.upstream) throw new Error(`没有待推送的提交（origin/${st.branch} 已是最新）`)
  const job = jobs.createJob(dryRun ? '推送预演' : '推送到远端')
  const args = ['push', 'origin', st.branch]
  if (dryRun) args.push('--dry-run')
  jobs.run(job, 'git', args, {
    cwd: ROOT,
    env: { GIT_TERMINAL_PROMPT: '0' },
    stderrMode: 'info',
    timeoutMs: 180000,
  })
  return { job, branch: st.branch }
}

export async function handleGitGet(req, res, path, url) {
  if (path === '/api/git/status') {
    sendJson(res, 200, await git.getStatus())
    return true
  }

  if (path === '/api/git/diff') {
    const file = url.searchParams.get('path') || ''
    const staged = url.searchParams.get('staged') === '1'
    sendJson(res, 200, await git.getDiff(file, staged))
    return true
  }

  if (path === '/api/changes/summary') {
    sendJson(res, 200, await changes.summary())
    return true
  }

  if (path === '/api/sync/status') {
    sendJson(res, 200, await sync.status())
    return true
  }

  if (path === '/api/sync/cloud') {
    sendJson(res, 200, await sync.fetchCloud())
    return true
  }

  if (path === '/api/sync/deployments') {
    sendJson(res, 200, await sync.deployments(Number(url.searchParams.get('limit')) || 8))
    return true
  }

  if (path === '/api/publish/preflight') {
    try {
      sendJson(res, 200, await gate.preflight({ kind: 'publish', message: url.searchParams.get('message') || '' }))
    } catch (e) {
      sendJson(res, 400, { error: e.message })
    }
    return true
  }

  if (path === '/api/publish/gates') {
    sendJson(res, 200, { gates: gate.listGates() })
    return true
  }

  if (path === '/api/publish/history') {
    sendJson(res, 200, publishlog.list({
      ok: url.searchParams.get('ok') || '',
      trigger: url.searchParams.get('trigger') || '',
      q: url.searchParams.get('q') || '',
      limit: Number(url.searchParams.get('limit')) || 30,
    }))
    return true
  }

  if (path === '/api/publish/snapshots') {
    try {
      sendJson(res, 200, await snapshots.listSnapshots())
    } catch (e) {
      sendJson(res, 400, { error: e.message })
    }
    return true
  }

  return false
}

export async function handleGitPost(req, res, path) {
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

  if (path === '/api/sync/verify') {
    const body = await readJsonBody(req)
    const job = sync.startVerify({
      expectCount: Number.isFinite(body.expectCount) ? body.expectCount : null,
      tries: Number(body.tries) || 6,
    })
    sendJson(res, 200, { jobId: job.id })
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

  return false
}
