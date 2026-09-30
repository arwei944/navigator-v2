/** 可用性看板：站点状态徽标 + 响应时间趋势 + 探活轮次（口径与 nav sites check 同源） */
import { $, api, openStream, appendLocal, isBusy } from './core.js'

const SEVERITY = { down: 0, limited: 1, unknown: 2, ok: 3 }
const SCOPE_LABEL = { problems: '需处理 + 可忽略', all: '全部站点' }

const state = {
  latest: null, runs: [], trends: {}, labels: {}, sites: [], total: 0,
  scope: 'problems', loading: false, progress: null,
}

function el(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

function fmtMs(ms) {
  if (ms === null || ms === undefined) return '—'
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function fmtClock(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function statusOf(id) {
  return state.latest?.results?.[id]?.status || 'unknown'
}

/* ---------- 概览 ---------- */

function renderSummary() {
  const box = $('#health-summary')
  box.replaceChildren()
  const l = state.latest
  if (!l) {
    box.append(el('span', 'chip', '尚无探活记录'))
    box.append(el('span', 'chip', '点「开始探活」建立首份快照'))
    return
  }
  const c = l.counts
  box.append(el('span', 'chip', `最近一轮 ${fmtClock(l.ts)}`))
  box.append(el('span', `chip ${c.ok === c.total ? 'ok' : ''}`, `正常 ${c.ok}`))
  box.append(el('span', `chip ${c.limited ? 'warn' : ''}`, `可忽略 ${c.limited}`))
  box.append(el('span', `chip ${c.down ? 'err' : 'ok'}`, `需处理 ${c.down}`))
  if (state.total && state.total !== c.total) box.append(el('span', 'chip warn', `未覆盖 ${state.total - c.total}`))
}

/** 概览面板的「站点可用性」摘要（与看板同源，只是压缩成一行） */
function renderOverview() {
  const box = $('#overview-health')
  if (!box) return
  box.replaceChildren()
  const l = state.latest
  if (!l) {
    box.append(el('div', 'dim', '尚无探活记录，去「可用性」面板跑一次探活。'))
    return
  }
  const c = l.counts
  const chips = el('div', 'chips')
  chips.append(el('span', 'chip', `最近一轮 ${fmtClock(l.ts)}`))
  chips.append(el('span', `chip ${c.ok === c.total ? 'ok' : ''}`, `正常 ${c.ok}`))
  chips.append(el('span', `chip ${c.limited ? 'warn' : ''}`, `可忽略 ${c.limited}`))
  chips.append(el('span', `chip ${c.down ? 'err' : 'ok'}`, `需处理 ${c.down}`))
  box.append(chips)
  box.append(el('p', 'hint', `run ${l.run} · 口径与 nav sites check 同源；明细与响应时间趋势见「可用性」面板。`))
}

function renderRuns() {
  const box = $('#health-runs')
  box.replaceChildren()
  if (!state.runs.length) { box.append(el('div', 'dim', '暂无轮次记录。')); return }
  for (const r of state.runs) {
    const row = el('div', 'run-row')
    row.append(el('span', 'run-id', r.run))
    row.append(el('span', 'run-ts', fmtClock(r.ts)))
    const chips = el('div', 'chips')
    chips.append(el('span', 'chip', `共 ${r.total}`))
    chips.append(el('span', `chip ${r.ok === r.total ? 'ok' : ''}`, `正常 ${r.ok}`))
    chips.append(el('span', `chip ${r.limited ? 'warn' : ''}`, `可忽略 ${r.limited}`))
    chips.append(el('span', `chip ${r.down ? 'err' : 'ok'}`, `需处理 ${r.down}`))
    row.append(chips)
    if (r.actor) row.append(el('span', 'run-actor', r.actor))
    box.append(row)
  }
}

/* ---------- 趋势 ---------- */

function trendNode(id) {
  const series = state.trends?.[id]
  const box = el('div', 'health-trend')
  if (!series || series.length < 2) {
    box.append(el('span', 'dim', '—'))
    return box
  }
  // 接口按新 → 旧返回，这里反转成「左旧右新」，符合时间轴直觉
  for (const p of [...series].reverse()) {
    const bar = el('span', `trend-bar ${p.status}`)
    bar.title = `${fmtClock(p.ts)} · HTTP ${p.code} · ${fmtMs(p.ms)}`
    box.append(bar)
  }
  return box
}

/* ---------- 列表 ---------- */

function visibleSites() {
  const rows = state.sites.map(s => ({ ...s, status: statusOf(s.id) }))
  const filtered = state.scope === 'all' ? rows : rows.filter(r => r.status !== 'ok')
  return filtered.sort((a, b) => (SEVERITY[a.status] - SEVERITY[b.status]) || a.id.localeCompare(b.id))
}

function renderList() {
  const box = $('#health-list')
  box.replaceChildren()
  if (!state.sites.length) { box.append(el('div', 'dim', '读取站点列表…')); return }

  const rows = visibleSites()
  if (!rows.length) {
    box.append(el('div', 'health-empty ok', `最近一轮探活没有「${SCOPE_LABEL[state.scope]}」的站点。`))
    return
  }
  const cap = 120
  for (const r of rows.slice(0, cap)) {
    const row = el('div', `health-row ${r.status}`)
    row.append(el('span', `health-badge ${r.status}`, state.labels[r.status] || r.status))

    const main = el('div', 'health-main')
    const head = el('div', 'health-head')
    head.append(el('span', 'health-name', r.name))
    head.append(el('code', 'health-id', r.id))
    const h = state.latest?.results?.[r.id]
    if (h) head.append(el('span', 'health-code', `HTTP ${h.code}`))
    main.append(head)
    main.append(el('div', 'health-sub', r.url))
    row.append(main)

    row.append(trendNode(r.id))
    row.append(el('span', 'health-ms', h ? fmtMs(h.ms) : '—'))
    box.append(row)
  }
  if (rows.length > cap) box.append(el('div', 'dim', `另有 ${rows.length - cap} 个站点未展示，可切换筛选或缩小范围。`))
}

/* ---------- 探活 ---------- */

function setProgress(text) {
  const box = $('#health-progress')
  box.textContent = text || ''
}

async function doProbe({ onlyProblems = false } = {}) {
  if (isBusy()) { setProgress('已有任务在运行，请等待完成或终止后再试。'); return }
  const body = {}
  if (onlyProblems) {
    const ids = state.sites.map(s => s.id).filter(id => statusOf(id) !== 'ok')
    if (!ids.length) { setProgress('当前没有需处理 / 可忽略的站点。'); return }
    body.ids = ids
  }
  $('#btn-health-probe').disabled = true
  $('#btn-health-probe-bad').disabled = true
  setProgress(onlyProblems ? '探活中（仅异常站点）…' : '探活中（全量）…')
  try {
    const { jobId } = await api('/api/health/probe', { method: 'POST', body })
    openStream(jobId, '可用性探活', async d => {
      setProgress(d.status === 'success' ? '' : `探活失败，退出码 ${d.code}`)
      $('#btn-health-probe').disabled = false
      $('#btn-health-probe-bad').disabled = false
      await refresh()
    }, {
      progress: p => setProgress(`进度 ${p.done}/${p.total} · 正常 ${p.ok} · 可忽略 ${p.limited} · 需处理 ${p.down}`),
      result: r => setProgress(`完成：正常 ${r.counts.ok} / 可忽略 ${r.counts.limited} / 需处理 ${r.counts.down}（run ${r.run}）`),
    })
  } catch (e) {
    setProgress(`无法启动探活：${e.message}`)
    $('#btn-health-probe').disabled = false
    $('#btn-health-probe-bad').disabled = false
  }
}

/* ---------- 交互 ---------- */

export async function refresh() {
  if (state.loading) return
  state.loading = true
  try {
    const [h, list] = await Promise.all([
      api('/api/health/latest'),
      api('/api/sites/list'),
    ])
    state.latest = h.latest
    state.runs = h.runs || []
    state.trends = h.trends || {}
    state.labels = h.labels || {}
    state.sites = list.sites || []
    state.total = list.total || state.sites.length
  } catch (e) {
    appendLocal(`读取可用性看板失败：${e.message}`, 'stderr')
  } finally {
    state.loading = false
  }
  renderSummary()
  renderRuns()
  renderList()
  renderOverview()
}

export function initHealthPanel() {
  $('#btn-health-refresh').addEventListener('click', () => refresh())
  $('#btn-health-probe').addEventListener('click', () => doProbe())
  $('#btn-health-probe-bad').addEventListener('click', () => doProbe({ onlyProblems: true }))
  $('#health-scope').addEventListener('change', e => {
    state.scope = e.target.value
    renderList()
  })
  if ($('#panel-health')?.classList.contains('active')) refresh()
}