/**
 * 控制台 JSON API 路由。返回 true 表示已处理。
 * 所有写操作要求同源 + 自定义请求头（X-Nav-Console），阻断跨站伪造请求。
 */
import { ROOT, getAdminKey, envSummary } from './env.mjs'
import * as jobs from './jobs.mjs'
import * as git from './git.mjs'
import * as changes from './changes.mjs'

export function sendJson(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (chunks.length === 0) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf-8')) } catch { return {} }
}

/** 同源校验：跨站请求带自定义头会先触发预检，本服务不返回 CORS 许可即被浏览器拦截 */
function isTrusted(req) {
  const origin = req.headers.origin
  if (origin) {
    try {
      const host = new URL(origin).hostname
      if (!['127.0.0.1', 'localhost', '::1'].includes(host)) return false
    } catch { return false }
  }
  return req.headers['x-nav-console'] === '1'
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

  if (method === 'POST') {
    if (!isTrusted(req)) {
      sendJson(res, 403, { error: '请求来源不受信任（缺少 X-Nav-Console 头或跨站来源）' })
      return true
    }

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

    if (path === '/api/git/stage') {
      const body = await readJsonBody(req)
      const paths = body.paths || []
      const list = body.stage === false ? await git.unstagePaths(paths) : await git.stagePaths(paths)
      sendJson(res, 200, { ok: true, paths: list, staged: body.stage !== false })
      return true
    }

    if (path === '/api/git/commit') {
      const body = await readJsonBody(req)
      try {
        const result = await git.commit(body.message, body.paths)
        sendJson(res, 200, { ok: true, ...result })
      } catch (e) {
        sendJson(res, 400, { ok: false, error: e.message })
      }
      return true
    }

    if (path === '/api/git/push') {
      const body = await readJsonBody(req)
      try {
        const { job, branch } = await startPush({ dryRun: body.dryRun === true })
        sendJson(res, 200, { jobId: job.id, branch })
      } catch (e) {
        sendJson(res, 400, { error: e.message })
      }
      return true
    }
  }

  return false
}