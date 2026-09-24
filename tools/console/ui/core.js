/** 控制台前端共享能力：API 调用、SSE 实时日志、状态徽标 */

export const $ = sel => document.querySelector(sel)
export const $$ = sel => [...document.querySelectorAll(sel)]

const HEADERS = { 'X-Nav-Console': '1' }

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? HEADERS : { ...HEADERS, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export function renderKv(el, rows) {
  el.innerHTML = ''
  for (const [k, v] of rows) {
    const dt = document.createElement('dt')
    dt.textContent = k
    const dd = document.createElement('dd')
    if (Array.isArray(v)) {
      const span = document.createElement('span')
      span.className = v[1]
      span.textContent = v[0]
      dd.append(span)
    } else {
      dd.textContent = String(v)
    }
    el.append(dt, dd)
  }
}

export function fmtTime(ts) {
  return new Date(ts).toTimeString().slice(0, 8)
}

/* ---------- 实时日志控制台 ---------- */

const EMPTY_HINT = '暂无日志。运行自检或提交 / 推送后，这里会实时输出。'
let es = null
let currentJob = null
let doneHook = null

function logView() { return $('#log-view') }

function dropEmpty() {
  const empty = logView().querySelector('.log-empty')
  if (empty) empty.remove()
}

export function clearLog(hint = EMPTY_HINT) {
  const view = logView()
  view.innerHTML = ''
  const div = document.createElement('div')
  div.className = 'log-empty'
  div.textContent = hint
  view.append(div)
}

function pushLine(ts, text, stream) {
  const view = logView()
  dropEmpty()
  const line = document.createElement('div')
  line.className = `log-line ${stream}`
  const t = document.createElement('span')
  t.className = 'ts'
  t.textContent = fmtTime(ts)
  const txt = document.createElement('span')
  txt.className = 'txt'
  txt.textContent = text
  line.append(t, txt)
  view.append(line)
  view.scrollTop = view.scrollHeight
}

export function appendLog(entry) {
  pushLine(entry.t, entry.text, entry.stream)
}

/** 本地信息行（不经服务端），用于提交结果、面板提示 */
export function appendLocal(text, stream = 'info') {
  pushLine(Date.now(), text, stream)
}

export function setStatus(status, text) {
  const badge = $('#job-status')
  badge.className = `badge ${status}`
  badge.textContent = text
}

export function isBusy() {
  return currentJob !== null
}

export function closeStream() {
  if (es) { es.close(); es = null }
}

export function openStream(jobId, title, onDone, handlers) {
  closeStream()
  currentJob = jobId
  doneHook = onDone || null
  $('#job-title').textContent = title ? `· ${title}` : ''
  setStatus('running', '运行中')
  $('#btn-kill').disabled = false

  es = new EventSource(`/api/events?job=${encodeURIComponent(jobId)}`)
  es.addEventListener('log', ev => appendLog(JSON.parse(ev.data)))
  // 自定义事件（如时间线步骤 steps/step/deployment/verdict）
  if (handlers) {
    for (const [name, fn] of Object.entries(handlers)) {
      es.addEventListener(name, ev => {
        try { fn(JSON.parse(ev.data)) } catch (e) { appendLocal(`事件处理失败（${name}）：${e.message}`, 'stderr') }
      })
    }
  }
  es.addEventListener('done', ev => {
    const d = JSON.parse(ev.data)
    setStatus(d.status, d.status === 'success' ? `完成 · ${(d.duration / 1000).toFixed(1)}s` : `失败 · 退出码 ${d.code}`)
    $('#btn-kill').disabled = true
    currentJob = null
    closeStream()
    const hook = doneHook
    doneHook = null
    if (hook) hook(d)
  })
  es.onerror = () => {
    // 任务结束后服务端主动关闭连接属正常情况，仅在仍在运行时提示
    if (currentJob) setStatus('failed', '连接中断')
  }
}

export async function killCurrent() {
  if (!currentJob) return
  await api(`/api/jobs/${currentJob}/kill`, { method: 'POST' })
}