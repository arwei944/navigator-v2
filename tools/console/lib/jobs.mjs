/**
 * 长任务管理：注册任务、收集子进程输出、通过 SSE 广播事件。
 * 所有事件（日志 / 自定义步骤 / 结束）写入环形缓冲，新订阅者可完整回放。
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const MAX_EVENTS = 4000
const jobs = new Map()

export function createJob(title) {
  const job = {
    id: randomUUID().slice(0, 8),
    title,
    status: 'running',
    startedAt: Date.now(),
    endedAt: null,
    exitCode: null,
    events: [],
    subscribers: new Set(),
    proc: null,
    timer: null,
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

function buffer(job, event, data) {
  job.events.push({ event, data })
  if (job.events.length > MAX_EVENTS) job.events.splice(0, job.events.length - MAX_EVENTS)
}

function emit(job, event, data) {
  buffer(job, event, data)
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of job.subscribers) {
    try { res.write(payload) } catch { /* 连接已断开，交给 close 事件清理 */ }
  }
}

/** 推送自定义事件（如时间线步骤状态），前端按 event 名监听 */
export function emitEvent(job, event, data) {
  emit(job, event, data)
}

export function log(job, text, stream = 'stdout') {
  for (const line of String(text).split(/\r?\n/)) {
    if (line === '') continue
    emit(job, 'log', { t: Date.now(), stream, text: line })
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

/** 订阅任务事件：先回放缓冲，再持续推送；返回取消订阅函数 */
export function subscribe(job, res) {
  for (const { event, data } of job.events) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  if (job.status !== 'running') {
    res.end()
    return () => {}
  }
  job.subscribers.add(res)
  return () => job.subscribers.delete(res)
}

/**
 * 运行子进程并把输出接入任务事件流。
 * autoFinish=false 时不由本函数结束任务（供多步流水线复用同一任务）。
 */
export function run(job, command, cmdArgs, opts = {}) {
  const child = spawn(command, cmdArgs, {
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env || {}) },
    windowsHide: true,
  })
  job.proc = child
  job.timer = null
  if (opts.timeoutMs) {
    job.timer = setTimeout(() => {
      log(job, `[控制台] 任务超时（${Math.round(opts.timeoutMs / 1000)}s），已强制终止`, 'stderr')
      killJob(job.id)
    }, opts.timeoutMs)
  }

  const onLine = opts.onLine
  child.stdout.on('data', c => {
    const text = String(c)
    log(job, text, 'stdout')
    if (onLine) for (const l of text.split(/\r?\n/)) if (l.trim()) onLine(l.trim())
  })
  // git / vercel 把进度与结果都写在 stderr，正常输出不应标红；仅错误关键字保留红色
  const stderrMode = opts.stderrMode || 'error'
  child.stderr.on('data', c => {
    const text = String(c)
    const isError = /(^|\n)\s*(fatal|error|failed|denied|rejected|conflict)/i.test(text)
    log(job, text, stderrMode === 'info' && !isError ? 'info' : 'stderr')
    if (onLine) for (const l of text.split(/\r?\n/)) if (l.trim()) onLine(l.trim())
  })
  child.on('error', e => {
    log(job, `子进程启动失败: ${e.message}`, 'stderr')
    if (opts.autoFinish !== false) finish(job, -1)
  })
  child.on('close', code => {
    job.proc = null
    if (job.timer) { clearTimeout(job.timer); job.timer = null }
    if (opts.autoFinish === false) return
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