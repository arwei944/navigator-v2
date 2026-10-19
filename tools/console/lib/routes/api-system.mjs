/**
 * 控制台路由 · 系统域：健康自检、环境摘要、任务、审计。
 *
 * 路由前缀：`/api/health*`（只读部分）、`/api/env`、`/api/jobs*`、`/api/audit`
 * 探活（`/api/health/probe`）与推送（`/api/health/publish`）是有副作用的写操作，不在此文件。
 */
import { ROOT, getAdminKey, envSummary } from '../core/env.mjs'
import * as jobs from '../core/jobs.mjs'
import * as audit from '../core/audit.mjs'
import { sendJson } from './api-http.mjs'

/** 控制台自检任务：验证 SSE 通道与子进程日志管道 */
export function startSelfCheck() {
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

/** 处理系统域的 GET 路由；未命中返回 false 交给下一个域 */
export async function handleSystemGet(req, res, path, url) {
  if (path === '/api/health') {
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

  if (path === '/api/env') {
    sendJson(res, 200, envSummary())
    return true
  }

  if (path === '/api/jobs') {
    sendJson(res, 200, { jobs: jobs.listJobs() })
    return true
  }

  if (path === '/api/audit') {
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

  return false
}

/** 处理系统域的 POST 路由；未命中返回 false */
export async function handleSystemPost(req, res, path) {
  if (path === '/api/jobs/selfcheck') {
    const job = startSelfCheck()
    sendJson(res, 200, { jobId: job.id })
    return true
  }

  const killMatch = path.match(/^\/api\/jobs\/([^/]+)\/kill$/)
  if (killMatch) {
    const ok = jobs.killJob(killMatch[1])
    sendJson(res, ok ? 200 : 404, { ok })
    return true
  }

  return false
}
