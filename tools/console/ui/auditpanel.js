/** 审计面板：关键操作的持久化留痕（提交 / 推送 / 发布 / 放行 / 拒绝 / 回滚 / 站点增删改） */
import { $, api, appendLocal } from './core.js'

const MARK = { ok: '✓', fail: '✖', rejected: '⊘' }
const RESULT_LABEL = { ok: '成功', fail: '失败', rejected: '拒绝' }
const ALL = { value: '', label: '全部' }

const state = { items: [], total: 0, summary: null, actions: {}, loading: false, built: false }

function el(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

function fmtClock(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** 动作 / 结果下拉只在取值集合变化时重建，避免刷新打断用户当前筛选 */
function fillSelect(sel, options) {
  const want = options.map(o => o.value).join('\u0000')
  if (sel.dataset.sig === want) return
  const cur = sel.value
  sel.replaceChildren()
  for (const o of options) {
    const opt = el('option', '', o.label)
    opt.value = o.value
    sel.append(opt)
  }
  sel.dataset.sig = want
  sel.value = options.some(o => o.value === cur) ? cur : ''
}

function buildFilters() {
  const actions = Object.entries(state.actions).map(([value, label]) => ({ value, label: `${label}（${value}）` }))
  actions.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
  fillSelect($('#audit-action'), [ALL, ...actions])
  fillSelect($('#audit-result'), [
    ALL,
    { value: 'ok', label: '成功' },
    { value: 'fail', label: '失败' },
    { value: 'rejected', label: '拒绝' },
  ])
  state.built = true
}

/* ---------- 概览 ---------- */

function renderSummary() {
  const box = $('#audit-summary')
  box.innerHTML = ''
  const s = state.summary
  if (!s) { box.append(el('span', 'dim', '读取中…')); return }

  box.append(el('span', 'chip', `累计 ${s.total} 条`))
  box.append(el('span', `chip ${s.failures ? 'warn' : 'ok'}`, `非成功 ${s.failures}`))
  box.append(el('span', 'chip', `最近 ${s.lastAt ? fmtClock(s.lastAt) : '—'}`))
  if (s.lastApprove) {
    const a = s.lastApprove
    box.append(el('span', `chip ${a.action === 'gate.bypass' ? 'warn' : 'ok'}`,
      `最近放行 ${RESULT_LABEL[a.action === 'gate.bypass' ? 'rejected' : 'ok']} · ${fmtClock(a.ts)}`))
  } else {
    box.append(el('span', 'chip warn', '尚无放行记录'))
  }
}

function renderLastApprove() {
  const box = $('#audit-list')
  const a = state.summary?.lastApprove
  if (!a) return
  const note = el('div', `audit-approve ${a.action === 'gate.bypass' ? 'warn' : 'ok'}`)
  note.append(el('span', 'audit-approve-k', '最近一次放行'))
  note.append(el('span', 'audit-approve-v', `${a.action === 'gate.bypass' ? '绕过门禁' : '凭证核销'} · ${a.target || '(无目标)'} · ${fmtClock(a.ts)}`))
  if (a.detail) note.append(el('span', 'audit-approve-d', a.detail))
  box.prepend(note)
}

/* ---------- 列表 ---------- */

function renderList() {
  const box = $('#audit-list')
  box.replaceChildren()
  const count = $('#audit-count')
  count.textContent = state.total ? `匹配 ${state.total} 条 · 显示 ${state.items.length} 条` : ''

  if (!state.items.length) {
    box.append(el('div', 'audit-empty', state.summary?.total ? '没有匹配的记录，试试放宽筛选条件。' : '暂无审计记录。提交 / 发布 / 回滚等操作发生后，这里会留下痕迹。'))
    return
  }

  for (const it of state.items) {
    const row = el('div', `audit-row ${it.result}`)
    row.append(el('span', `audit-mark ${it.result}`, MARK[it.result] || '·'))

    const main = el('div', 'audit-main')
    const head = el('div', 'audit-head')
    head.append(el('span', 'audit-action', state.actions[it.action] || it.action))
    head.append(el('code', 'audit-key', it.action))
    if (it.actor) head.append(el('span', 'audit-actor', it.actor))
    if (it.target) head.append(el('span', 'audit-target', it.target))
    main.append(head)
    if (it.detail) main.append(el('div', 'audit-detail', it.detail))
    row.append(main)

    row.append(el('span', 'audit-ts', fmtClock(it.ts)))
    box.append(row)
  }

  renderLastApprove()
}

/* ---------- 交互 ---------- */

function query() {
  const params = new URLSearchParams({ limit: '200' })
  const q = $('#audit-search').value.trim()
  const action = $('#audit-action').value
  const result = $('#audit-result').value
  if (q) params.set('q', q)
  if (action) params.set('action', action)
  if (result) params.set('result', result)
  return params.toString()
}

export async function refresh() {
  if (state.loading) return
  state.loading = true
  try {
    const r = await api(`/api/audit?${query()}`)
    state.items = r.items || []
    state.total = r.total || 0
    state.summary = r.summary || null
    state.actions = r.actions || {}
    if (!state.built) buildFilters()
  } catch (e) {
    appendLocal(`读取审计日志失败：${e.message}`, 'stderr')
    state.items = []
    state.total = 0
  } finally {
    state.loading = false
  }
  renderSummary()
  renderList()
}

export function initAuditPanel() {
  let timer = null
  $('#audit-search').addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(refresh, 200)
  })
  $('#audit-action').addEventListener('change', () => refresh())
  $('#audit-result').addEventListener('change', () => refresh())
  $('#btn-audit-refresh').addEventListener('click', () => refresh())
  if ($('#panel-audit')?.classList.contains('active')) refresh()
}