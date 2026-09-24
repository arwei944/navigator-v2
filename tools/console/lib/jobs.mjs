/**
 * 长任务管理：注册任务、收集子进程输出、通过 SSE 广播日志。
 * 日志保留环形缓冲，新订阅者可回放历史。
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const MAX_LOG_LINES = 3000
const jobs = new Map()

export function createJob(title) {
  const job = {
    id: randomUUID().slice(0, 8),
    title,
    status: 'running',
    startedAt: Date.now(),
    endedAt: null,
    exitCode: null,
    logs: [],
    subscribers: new Set(),
    proc: null,
  }
  jobs.set(job.id, job)
  return job
}

export function getJob(id) {
  return jobs.get(id) || null
}

export function listJobs() {
  return [...jobs.values()]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 20)
    .map(({ id, title, status, startedAt, endedAt, exitCode }) => ({
      id, title, status, startedAt, endedAt, exitCode,
    }))
}

function emit(job, event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of job.subscribers) {
    try { res.write(payload) } catch { /* 连接已断开，交给 close 事件清理 */ }
  }
}

export function log(job, text, stream = 'stdout') {
  for (const line of String(text).split(/\r?\n/)) {
    if (line === '') continue
    const entry = { t: Date.now(), stream, text: line }
    job.logs.push(entry)
    if (job.logs.length > MAX_LOG_LINES) job.logs.splice(0, job.logs.length - MAX_LOG_LINES)
    emit(job, 'log', entry)
  }
}

export function finish(job, code) {
  if (job.status !== 'running') return
  if (job.timer) { clearTimeout(job.timer); job.timer = null }
  job.status = code === 0 ? 'success' : 'failed'
  job.exitCode = code
  job.endedAt = Date.now()
  emit(job, 'done', { code, status: job.status, duration: job.endedAt - job.startedAt })
  // 任务已结束，主动关闭所有订阅连接，避免连接悬挂
  for (const res of job.subscribers) {
    try { res.end() } catch { /* 已断开 */ }
  }
  job.subscribers.clear()
}

/** 订阅任务日志：先回放已有日志，再持续推送；返回取消订阅函数 */
export function subscribe(job, res) {
  for (const entry of job.logs) {
    res.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`)
  }
  if (job.status !== 'running') {
    res.write(`event: done\ndata: ${JSON.stringify({
      code: job.exitCode,
      status: job.status,
      duration: (job.endedAt || Date.now()) - job.startedAt,
    })}\n\n`)
    res.end()
    return () => {}
  }
  job.subscribers.add(res)
  return () => job.subscribers.delete(res)
}

/** 运行子进程并把输出接入任务日志流 */
export function run(job, command, cmdArgs, opts = {}) {
  const child = spawn(command, cmdArgs, {
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env || {}) },
  })
  job.proc = child
  job.timer = null
  if (opts.timeoutMs) {
    job.timer = setTimeout(() => {
      log(job, `[控制台] 任务超时（${Math.round(opts.timeoutMs / 1000)}s），已强制终止`, 'stderr')
      killJob(job.id)
    }, opts.timeoutMs)
  }
  child.stdout.on('data', c => log(job, String(c), 'stdout'))
  // git 把进度与结果都写在 stderr，正常输出不应标红；仅错误关键字保留红色
  const stderrMode = opts.stderrMode || 'error'
  child.stderr.on('data', c => {
    const text = String(c)
    const isError = /(^|\n)\s*(fatal|error|failed|denied|rejected|conflict)/i.test(text)
    log(job, text, stderrMode === 'info' && !isError ? 'info' : 'stderr')
  })
  child.on('error', e => {
    log(job, `子进程启动失败: ${e.message}`, 'stderr')
    finish(job, -1)
  })
  child.on('close', code => {
    job.proc = null
    finish(job, code ?? -1)
  })
  return child
}

export function killJob(id) {
  const job = jobs.get(id)
  if (!job) return false
  if (!job.proc) return false
  const pid = job.proc.pid
  job.proc.kill()
  // Windows 下子进程常带孙进程（npm/npx 包装），需整棵树结束
  if (process.platform === 'win32' && pid) {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
  }
  log(job, '[控制台] 已请求终止任务', 'stderr')
  return true
}