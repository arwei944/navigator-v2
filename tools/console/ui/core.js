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
const LOCAL_ID = 'local'
const MAX_LINES = 4000
const STREAMS = ['stdout', 'info', 'success', 'stderr']
const MARK = { running: '●', success: '✓', failed: '✕' }

/** 每个任务各留一份前端缓冲，切换视图时互不干扰 */
const JOBS = new Map() // id -> { id, title, status, startedAt, exitCode, lines: [] }

let es = null
let currentJob = null    // 正在运行的任务：决定「终止任务」的目标
let viewJobId = LOCAL_ID // 当前显示的任务，可为已结束任务或本地消息
let doneHook = null
let follow = true        // 是否自动滚到底部
let emptyHint = EMPTY_HINT
let renderedCount = 0    // 当前已渲染行数（用于「显示 N / M 行」）

const filter = { keyword: '', regex: null, levels: new Set(STREAMS) }

function logView() { return $('#log-view') }

function jobEntry(id, title) {
  let job = JOBS.get(id)
  if (!job) {
    job = { id, title: title || id, status: 'running', startedAt: Date.now(), exitCode: null, lines: [] }
    JOBS.set(id, job)
  } else if (title) {
    job.title = title
  }
  return job
}

function anyRunning() {
  for (const job of JOBS.values()) if (job.status === 'running') return job
  return null
}

/** 把关键字解析为字面量或 /正则/ 形式 */
function parseFilter(raw) {
  const kw = String(raw || '').trim()
  filter.keyword = kw
  filter.regex = null
  if (kw.length > 2 && kw.startsWith('/')) {
    const end = kw.lastIndexOf('/')
    if (end > 0) {
      try { filter.regex = new RegExp(kw.slice(1, end), kw.slice(end + 1)) } catch { filter.regex = null }
    }
  }
}

/** 命中区间；返回 false 表示该行被过滤掉，返回 [] 表示命中但无需高亮 */
function hitRanges(entry) {
  if (!filter.levels.has(entry.stream)) return false
  if (!filter.keyword) return []
  const ranges = []
  if (filter.regex) {
    const flags = filter.regex.flags.includes('g') ? filter.regex.flags : `${filter.regex.flags}g`
    for (const m of entry.text.matchAll(new RegExp(filter.regex.source, flags))) {
      if (m[0]) ranges.push([m.index, m.index + m[0].length])
    }
  } else {
    const lower = entry.text.toLowerCase()
    const kw = filter.keyword.toLowerCase()
    let i = lower.indexOf(kw)
    while (i !== -1) {
      ranges.push([i, i + kw.length])
      i = lower.indexOf(kw, i + kw.length)
    }
  }
  return ranges.length ? ranges : false
}

function buildLine(entry, ranges) {
  const line = document.createElement('div')
  line.className = `log-line ${entry.stream}`
  const t = document.createElement('span')
  t.className = 'ts'
  t.textContent = fmtTime(entry.t)
  const txt = document.createElement('span')
  txt.className = 'txt'
  if (ranges && ranges.length) {
    let pos = 0
    for (const [start, end] of ranges) {
      if (start > pos) txt.append(document.createTextNode(entry.text.slice(pos, start)))
      const mark = document.createElement('mark')
      mark.textContent = entry.text.slice(start, end)
      txt.append(mark)
      pos = end
    }
    if (pos < entry.text.length) txt.append(document.createTextNode(entry.text.slice(pos)))
  } else {
    txt.textContent = entry.text
  }
  line.append(t, txt)
  return line
}

function dropEmpty() {
  const empty = logView()?.querySelector('.log-empty')
  if (empty) empty.remove()
}

function updateCount(total) {
  const el = $('#log-count')
  if (!el) return
  if (!total) { el.textContent = ''; return }
  el.textContent = renderedCount === total ? `${total} 行` : `显示 ${renderedCount} / ${total} 行`
}

function scrollToEnd() {
  const view = logView()
  if (view && follow) view.scrollTop = view.scrollHeight
}

/** 全量重绘：切换任务或改动过滤条件时调用 */
function renderLog() {
  const view = logView()
  if (!view) return
  const job = JOBS.get(viewJobId)
  const lines = job ? job.lines : []
  view.replaceChildren()
  let shown = 0
  for (const entry of lines) {
    const ranges = hitRanges(entry)
    if (ranges === false) continue
    view.append(buildLine(entry, ranges))
    shown += 1
  }
  renderedCount = shown
  if (!shown) {
    const div = document.createElement('div')
    div.className = 'log-empty'
    div.textContent = lines.length ? '没有匹配的行，试试放宽过滤条件。' : emptyHint
    view.append(div)
  }
  updateCount(lines.length)
  scrollToEnd()
}

/** 追加一行到指定任务的缓冲，并同步视图 */
function pushEntry(id, entry) {
  const job = jobEntry(id)
  job.lines.push(entry)
  if (job.lines.length > MAX_LINES) job.lines.splice(0, job.lines.length - MAX_LINES)
  if (id !== viewJobId) return
  const ranges = hitRanges(entry)
  if (ranges !== false) {
    dropEmpty()
    logView().append(buildLine(entry, ranges))
    renderedCount += 1
    scrollToEnd()
  }
  updateCount(job.lines.length)
}

export function clearLog(hint = EMPTY_HINT) {
  emptyHint = hint
  const job = JOBS.get(viewJobId)
  if (job) job.lines.length = 0
  renderLog()
}

export function appendLog(entry) {
  pushEntry(viewJobId, entry)
}

/** 本地信息行（不经服务端），用于提交结果、面板提示 */
export function appendLocal(text, stream = 'info') {
  pushEntry(viewJobId, { t: Date.now(), text, stream, local: true })
}

export function setStatus(status, text) {
  const badge = $('#job-status')
  badge.className = `badge ${status}`
  badge.textContent = text
}

export function isBusy() {
  return anyRunning() !== null
}

export function closeStream() {
  if (es) { es.close(); es = null }
}

function syncKillButton() {
  const btn = $('#btn-kill')
  if (btn) btn.disabled = !anyRunning()
}

function renderJobSelect() {
  const sel = $('#job-select')
  if (!sel) return
  const items = [...JOBS.values()]
    .filter(job => job.id !== LOCAL_ID || job.lines.length)
    .sort((a, b) => b.startedAt - a.startedAt)
  sel.replaceChildren()
  if (!items.length) {
    const opt = document.createElement('option')
    opt.value = ''
    opt.textContent = '暂无任务'
    sel.append(opt)
    sel.disabled = true
    return
  }
  sel.disabled = false
  for (const job of items) {
    const opt = document.createElement('option')
    opt.value = job.id
    opt.textContent = `${MARK[job.status] || '·'} ${fmtTime(job.startedAt)} ${job.title}`
    sel.append(opt)
  }
  sel.value = JOBS.has(viewJobId) ? viewJobId : items[0].id
}

/** 从服务端同步任务列表（状态 / 标题），保证控制台之外的运行也能被看到 */
export async function refreshJobList() {
  const before = viewJobId
  try {
    const { jobs } = await api('/api/jobs')
    for (const j of jobs) {
      const job = jobEntry(j.id, j.title)
      job.status = j.status
      job.startedAt = j.startedAt
      job.exitCode = j.exitCode
    }
  } catch { /* 服务不可用时退回本地已知任务 */ }
  // 当前视图已失效（如被清空的任务）时，落到最近一个任务，避免下拉与视图不一致
  if (!JOBS.has(viewJobId)) {
    const newest = [...JOBS.values()].sort((a, b) => b.startedAt - a.startedAt)[0]
    if (newest) viewJobId = newest.id
  }
  renderJobSelect()
  if (viewJobId !== before) renderLog()
  syncKillButton()
}

/** 切换到某个任务视图：本地消息直接渲染，真实任务走 SSE 回放 */
function showJob(id) {
  if (id === LOCAL_ID) {
    closeStream()
    currentJob = null
    viewJobId = LOCAL_ID
    $('#job-title').textContent = ''
    setStatus('idle', '空闲')
    renderJobSelect()
    renderLog()
    return
  }
  openStream(id, JOBS.get(id)?.title)
}

export function openStream(jobId, title, onDone, handlers) {
  closeStream()
  const job = jobEntry(jobId, title)
  // 服务端会完整回放缓冲，清掉旧的服务端行避免重复；本地行（提交结果等）保留
  job.lines = job.lines.filter(line => line.local)
  viewJobId = jobId
  doneHook = onDone || null
  const known = job.status
  const running = known === 'running'
  currentJob = running ? jobId : null
  $('#job-title').textContent = title ? `· ${title}` : ''
  setStatus(running ? 'running' : known, running ? '运行中' : (known === 'success' ? '已完成' : '已失败'))
  renderJobSelect()
  syncKillButton()
  renderLog()

  es = new EventSource(`/api/events?job=${encodeURIComponent(jobId)}`)
  es.addEventListener('log', ev => pushEntry(jobId, JSON.parse(ev.data)))
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
    const target = jobEntry(jobId)
    target.status = d.status
    target.exitCode = d.code
    if (jobId === viewJobId) {
      setStatus(d.status, d.status === 'success' ? `完成 · ${(d.duration / 1000).toFixed(1)}s` : `失败 · 退出码 ${d.code}`)
    }
    if (currentJob === jobId) currentJob = null
    closeStream()
    renderJobSelect()
    syncKillButton()
    const hook = doneHook
    doneHook = null
    if (hook) hook(d)
  })
  es.onerror = () => {
    // 任务结束后服务端主动关闭连接属正常情况，仅在仍在运行时提示
    if (currentJob === jobId) setStatus('failed', '连接中断')
  }
}

export async function killCurrent() {
  const job = currentJob ? JOBS.get(currentJob) : anyRunning()
  if (!job) return
  await api(`/api/jobs/${job.id}/kill`, { method: 'POST' })
}

/** 复制当前视图里可见（已过滤）的日志 */
async function copyVisible() {
  const job = JOBS.get(viewJobId)
  const lines = (job?.lines || []).filter(entry => hitRanges(entry) !== false)
  const text = lines.map(entry => `${fmtTime(entry.t)} ${entry.text}`).join('\n')
  if (!text) { appendLocal('当前没有可复制的日志行。', 'warn'); return }
  try {
    await navigator.clipboard.writeText(text)
    appendLocal(`已复制 ${lines.length} 行日志到剪贴板。`, 'success')
  } catch (e) {
    appendLocal(`复制失败：${e.message}`, 'stderr')
  }
}

/** 绑定日志控制台交互：过滤 / 分级筛选 / 任务切换 / 跟随 / 复制 / 清空 / 终止 */
export function initLogConsole() {
  const view = logView()
  view.addEventListener('scroll', () => {
    const near = view.scrollHeight - view.scrollTop - view.clientHeight < 24
    if (near !== follow) {
      follow = near
      const box = $('#log-follow')
      if (box) box.checked = near
    }
  })

  let timer = null
  $('#log-filter')?.addEventListener('input', e => {
    clearTimeout(timer)
    const value = e.target.value
    timer = setTimeout(() => { parseFilter(value); renderLog() }, 150)
  })

  $('#log-levels')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-level]')
    if (!btn) return
    const level = btn.dataset.level
    if (filter.levels.has(level)) {
      if (filter.levels.size === 1) return // 至少保留一级，避免全空视图
      filter.levels.delete(level)
      btn.classList.remove('on')
    } else {
      filter.levels.add(level)
      btn.classList.add('on')
    }
    renderLog()
  })

  $('#job-select')?.addEventListener('change', e => showJob(e.target.value))
  $('#log-follow')?.addEventListener('change', e => {
    follow = e.target.checked
    if (follow) scrollToEnd()
  })
  $('#btn-copy-log')?.addEventListener('click', copyVisible)
  $('#btn-clear')?.addEventListener('click', () => clearLog())
  $('#btn-kill')?.addEventListener('click', () => killCurrent())

  renderJobSelect()
  renderLog()
  refreshJobList()
  setInterval(refreshJobList, 15000)
}