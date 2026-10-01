/** 通知中心：把巡检 / 发布 / 批量操作 / 回滚的事件收敛成「现在需要我处理什么」，并管理定时巡检与 Webhook */
import { $, api, openStream, appendLocal, isBusy } from './core.js'

const SEV_MARK = { error: '●', warn: '◆', info: '·' }
const SEV_ORDER = { error: 0, warn: 1, info: 2 }
const INTERVALS = [
  { value: 30 * 60e3, label: '每 30 分钟' },
  { value: 2 * 3600e3, label: '每 2 小时' },
  { value: 6 * 3600e3, label: '每 6 小时' },
  { value: 12 * 3600e3, label: '每 12 小时' },
  { value: 24 * 3600e3, label: '每天' },
]

const state = {
  items: [], total: 0, summary: null, kinds: {}, severities: {},
  webhook: { url: '', minSeverity: 'warn' },
  schedule: null, loading: false, built: false, unreadOnly: false,
}

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

/* ---------- 概览 ---------- */

function renderSummary() {
  const box = $('#notify-summary')
  box.replaceChildren()
  const s = state.summary
  if (!s) { box.append(el('span', 'dim', '读取中…')); return }
  box.append(el('span', `chip ${s.unread ? 'warn' : 'ok'}`, `未读 ${s.unread}`))
  box.append(el('span', `chip ${s.error ? 'err' : ''}`, `严重 ${s.error}`))
  box.append(el('span', `chip ${s.warn ? 'warn' : ''}`, `注意 ${s.warn}`))
  box.append(el('span', 'chip', `提示 ${s.info}`))
  box.append(el('span', 'chip', `最近 ${s.latestAt ? fmtClock(s.latestAt) : '—'}`))
}

function renderSchedule() {
  const box = $('#notify-schedule-state')
  const st = state.schedule
  box.replaceChildren()
  if (!st) { box.append(el('span', 'dim', '读取中…')); return }
  box.append(el('span', `chip ${st.enabled ? 'ok' : ''}`, st.enabled ? '已启用' : '已停用'))
  box.append(el('span', 'chip', `间隔 ${st.intervalLabel}`))
  box.append(el('span', `chip ${st.running ? 'ok' : ''}`, st.running ? '调度中' : '未调度'))
  if (st.enabled && st.nextRunAt) box.append(el('span', 'chip', `下次 ${fmtClock(st.nextRunAt)}`))
  if (st.lastRun) {
    box.append(el('span', 'chip', `上轮 ${fmtClock(st.lastRunAt)}`))
    box.append(el('span', `chip ${st.lastRun.counts.down ? 'err' : 'ok'}`,
      `需处理 ${st.lastRun.counts.down} · 新增 ${st.lastRun.fresh} · 恢复 ${st.lastRun.recovered}`))
  } else {
    box.append(el('span', 'chip', '尚未巡检'))
  }
}

/* ---------- 列表 ---------- */

function renderList() {
  const box = $('#notify-list')
  box.replaceChildren()
  const count = $('#notify-count')
  count.textContent = state.total ? `去重后 ${state.total} 条 · 显示 ${state.items.length} 条` : ''

  if (!state.items.length) {
    box.append(el('div', 'notify-empty', state.total
      ? '没有匹配的通知，试试放宽筛选条件。'
      : '暂无通知。发布、批量操作、回滚与定时巡检的事件都会汇到这里。'))
    return
  }

  for (const n of state.items) {
    const row = el('div', `notify-row ${n.severity}${n.read ? ' read' : ''}`)
    row.append(el('span', `notify-mark ${n.severity}`, SEV_MARK[n.severity] || '·'))

    const main = el('div', 'notify-main')
    const head = el('div', 'notify-head')
    head.append(el('span', 'notify-title', n.title || n.label))
    head.append(el('code', 'notify-kind', n.kind))
    if (n.target) head.append(el('span', 'notify-target', n.target))
    if (!n.read) head.append(el('span', 'notify-unread', '未读'))
    main.append(head)
    if (n.body) main.append(el('div', 'notify-body', n.body))
    if (n.action) main.append(el('div', 'notify-action', `建议：${n.action}`))
    row.append(main)

    const side = el('div', 'notify-side')
    side.append(el('span', 'notify-ts', fmtClock(n.ts)))
    if (n.link) {
      const a = el('a', 'link small', '打开')
      a.href = n.link
      a.target = '_blank'
      a.rel = 'noreferrer'
      side.append(a)
    }
    row.append(side)
    box.append(row)
  }
}

/* ---------- 交互 ---------- */

function buildFilters() {
  const kinds = Object.entries(state.kinds).map(([value, def]) => ({ value, label: def.label }))
  kinds.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
  fillSelect($('#notify-kind'), [{ value: '', label: '全部类型' }, ...kinds])
  fillSelect($('#notify-severity'), [
    { value: '', label: '全部级别' },
    { value: 'error', label: '严重' },
    { value: 'warn', label: '注意' },
    { value: 'info', label: '提示' },
  ])
  state.built = true
}

function query() {
  const params = new URLSearchParams({ limit: '200' })
  const q = $('#notify-search').value.trim()
  const kind = $('#notify-kind').value
  const severity = $('#notify-severity').value
  if (q) params.set('q', q)
  if (kind) params.set('kind', kind)
  if (severity) params.set('severity', severity)
  if (state.unreadOnly) params.set('unread', '1')
  return params.toString()
}

export async function refresh() {
  if (state.loading) return
  state.loading = true
  try {
    const [r, s] = await Promise.all([
      api(`/api/notify/list?${query()}`),
      api('/api/schedule/status'),
    ])
    state.items = r.items || []
    state.total = r.total || 0
    state.summary = r.summary || null
    state.kinds = r.kinds || {}
    state.severities = r.severities || {}
    state.webhook = r.webhook || { url: '', minSeverity: 'warn' }
    state.schedule = s
    if (!state.built) { buildFilters(); hydrateControls() }
  } catch (e) {
    appendLocal(`读取通知中心失败：${e.message}`, 'stderr')
    state.items = []
    state.total = 0
  } finally {
    state.loading = false
  }
  renderSummary()
  renderSchedule()
  renderList()
}

/** 配置类控件只在首次加载时灌入，避免刷新覆盖用户正在编辑的内容 */
function hydrateControls() {
  $('#notify-webhook-url').value = state.webhook.url || ''
  $('#notify-webhook-sev').value = state.webhook.minSeverity || 'warn'
  fillSelect($('#notify-interval'), INTERVALS)
  const st = state.schedule
  if (st) {
    $('#notify-enabled').checked = Boolean(st.enabled)
    $('#notify-interval').value = String(st.intervalMs)
    $('#notify-timeout').value = String(st.timeout)
    $('#notify-concurrency').value = String(st.concurrency)
  }
}

async function runInspection() {
  if (isBusy()) { $('#notify-schedule-result').textContent = '已有任务在运行，请等待完成后再试。'; return }
  $('#btn-notify-run').disabled = true
  $('#notify-schedule-result').textContent = '巡检中…'
  try {
    const { jobId } = await api('/api/schedule/run', { method: 'POST' })
    openStream(jobId, '定时巡检', async d => {
      $('#notify-schedule-result').textContent = d.status === 'success' ? '巡检完成。' : `巡检失败，退出码 ${d.code}`
      $('#btn-notify-run').disabled = false
      await refresh()
    }, {
      verdict: v => { $('#notify-schedule-result').textContent = `完成：正常 ${v.ok} / 可忽略 ${v.limited} / 需处理 ${v.down}` },
    })
  } catch (e) {
    $('#notify-schedule-result').textContent = `无法启动巡检：${e.message}`
    $('#btn-notify-run').disabled = false
  }
}

export function initNotifyPanel() {
  let timer = null
  $('#notify-search').addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(refresh, 200)
  })
  $('#notify-kind').addEventListener('change', () => refresh())
  $('#notify-severity').addEventListener('change', () => refresh())
  $('#btn-notify-refresh').addEventListener('click', () => refresh())

  $('#btn-notify-unread').addEventListener('click', () => {
    state.unreadOnly = !state.unreadOnly
    $('#btn-notify-unread').classList.toggle('primary', state.unreadOnly)
    refresh()
  })

  $('#btn-notify-readall').addEventListener('click', async () => {
    const r = await api('/api/notify/read', { method: 'POST', body: {} })
    appendLocal(`已把 ${r.read} 条通知标记为已读。`, 'success')
    await refresh()
    refreshBadge()
  })

  $('#btn-notify-clear').addEventListener('click', async () => {
    if (!confirm('确认清空全部通知？此操作不可撤销（审计日志不受影响）。')) return
    const r = await api('/api/notify/clear', { method: 'POST' })
    appendLocal(`已清空 ${r.cleared} 条通知。`, 'success')
    await refresh()
    refreshBadge()
  })

  $('#btn-notify-run').addEventListener('click', runInspection)

  $('#btn-notify-save-schedule').addEventListener('click', async () => {
    try {
      const st = await api('/api/schedule/config', {
        method: 'POST',
        body: {
          enabled: $('#notify-enabled').checked,
          intervalMs: Number($('#notify-interval').value),
          timeout: Number($('#notify-timeout').value) || 12,
          concurrency: Number($('#notify-concurrency').value) || 12,
        },
      })
      $('#notify-schedule-result').textContent = st.enabled ? `已启用，间隔 ${st.intervalLabel}` : '已停用定时巡检'
      await refresh()
    } catch (e) {
      $('#notify-schedule-result').textContent = `保存失败：${e.message}`
    }
  })

  $('#btn-notify-save-webhook').addEventListener('click', async () => {
    try {
      const r = await api('/api/notify/webhook', {
        method: 'POST',
        body: { url: $('#notify-webhook-url').value.trim(), minSeverity: $('#notify-webhook-sev').value },
      })
      $('#notify-webhook-result').textContent = r.webhook.url ? '已保存' : '已清空 webhook 地址'
      state.webhook = r.webhook
    } catch (e) {
      $('#notify-webhook-result').textContent = `保存失败：${e.message}`
    }
  })

  $('#btn-notify-test-webhook').addEventListener('click', async () => {
    $('#notify-webhook-result').textContent = '测试中…'
    try {
      const r = await api('/api/notify/test', { method: 'POST' })
      $('#notify-webhook-result').textContent = `投递成功（HTTP ${r.code}）`
    } catch (e) {
      $('#notify-webhook-result').textContent = `投递失败：${e.message}`
    }
  })

  if ($('#panel-notify')?.classList.contains('active')) refresh()
}

/** 顶部标签上的未读角标（由 app.js 轮询驱动） */
export async function refreshBadge() {
  const badge = $('#notify-badge')
  if (!badge) return
  try {
    const { unread } = await api('/api/notify/badge')
    badge.textContent = unread > 99 ? '99+' : String(unread)
    badge.hidden = unread === 0
  } catch {
    badge.hidden = true
  }
}