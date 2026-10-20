/**
 * 控制台的「镜像同步」面板：云端变化 → 本地副本。
 *
 * 解决什么：本机关机/休眠期间云端照样在变。靠本机轮询比对的话，
 * 那段窗口里的变化要么永久丢失、要么只能靠事后全量重拉补救。
 * 这里的前提是**云端自己记账**（每次写入同事务记一条 seq），
 * 本机回来时按游标追赶 —— 离线多久都不影响。
 *
 * 展示口径：
 *   · 游标是核心指标：它等于「本地已应用到第几条变化」，比"最近同步时间"更能说明状态
 *   · 落后很多时不该只说"落后"，要说清楚**为什么**（日志被裁剪 → 已自动全量对齐）
 *   · 失败时不显示"上次同步 xx 前"就完事，必须说「游标未推进，会重试」
 */
import { $, api } from './core.js'
import { fmtDateTimeSec, fmtBytes, fmtRelativeSec } from '../../../shared/format.mjs'

const state = { data: null, running: false }

function el(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

function notice(text, kind = '') {
  const box = $('#mirror-notice')
  if (!box) return
  box.textContent = text
  box.className = `notice ${kind}`
  box.hidden = !text
}

function renderStatus(d) {
  const box = $('#mirror-status')
  if (!box) return
  box.innerHTML = ''

  const failed = Boolean(d.lastError)
  const row = el('div', `backup-fresh backup-${failed ? 'bad' : 'ok'}`)
  row.append(el('div', 'backup-fresh-title', failed ? '同步异常' : '同步正常'))
  row.append(el('div', 'backup-fresh-reason',
    failed ? d.lastError : `已追到第 ${d.cursor} 条变化`))
  row.append(el('div', 'backup-fresh-meta',
    `本地 ${d.objects} 个对象 · ${fmtBytes(d.bytes)} · 最近成功 ${fmtRelativeSec(d.lastSuccessAt)}`))

  // 失败时最要紧的一句话：游标没动，数据没丢，下次会重试
  if (failed) {
    row.append(el('div', 'backup-verdict', '✓ 游标未推进，下次同步会从同一位置重试，不会漏数据'))
  } else {
    row.append(el('div', 'backup-verdict', '✓ 本地副本与云端一致（按游标追平）'))
  }

  // 全量对齐：说明日志被裁剪过，用户需要知道这件事发生过
  if (d.lastFullResyncAt) {
    row.append(el('div', 'backup-fresh-meta',
      `最近全量对齐：${fmtDateTimeSec(d.lastFullResyncAt)}（累计 ${d.truncatedEvents} 次，说明本地曾落后超过日志保留区间）`))
  }

  // 定时状态：光有同步能力不够，用户还得知道「它会不会自己跑」
  const sch = d.schedule
  if (sch) {
    const parts = []
    if (sch.enabled) parts.push(`每 ${sch.intervalSec} 秒自动同步`)
    else parts.push('自动同步未启用')
    if (sch.lastPhase) parts.push(sch.lastPhase)
    if (sch.failures > 0) parts.push(`累计失败 ${sch.failures} 次`)
    const line = el('div', 'backup-fresh-meta', `定时：${parts.join(' · ')}`)
    if (!sch.enabled) line.classList.add('backup-sched-off')
    row.append(line)
  }

  box.append(row)
}

async function renderObjects() {
  const box = $('#mirror-objects')
  if (!box) return
  box.innerHTML = ''
  try {
    const r = await api('/api/mirror/objects?limit=50')
    if (!r.items?.length) {
      box.append(el('p', 'hint', '本地镜像为空。点「立即同步」开始。'))
      return
    }
    const table = el('div', 'backup-table')
    const head = el('div', 'backup-row backup-head')
    for (const t of ['对象', '大小', '更新时间']) head.append(el('span', '', t))
    table.append(head)
    for (const o of r.items) {
      const row = el('div', 'backup-row')
      const name = el('span', 'backup-name', o.pathname)
      name.title = o.etag || ''
      row.append(name)
      row.append(el('span', '', o.size === null ? '—' : fmtBytes(o.size)))
      row.append(el('span', '', o.at ? fmtDateTimeSec(o.at) : '—'))
      table.append(row)
    }
    box.append(table)
  } catch (e) {
    box.append(el('p', 'hint', `对象列表加载失败：${e.message}`))
  }
}

function render() {
  const d = state.data
  if (!d) return
  const sum = $('#mirror-summary')
  if (sum) {
    sum.innerHTML = ''
    sum.append(el('code', '', 'backups/mirror'))
    sum.append(el('span', 'muted', `  游标 ${d.cursor} · ${d.objects} 个对象`))
  }
  const dir = $('#mirror-dir')
  if (dir) dir.textContent = d.dir
  renderStatus(d)
  void renderObjects()
}

/* ---------- 交互 ---------- */

function bindSync() {
  const btn = $('#btn-mirror-sync')
  if (!btn || btn.dataset.bound) return
  btn.dataset.bound = '1'
  btn.addEventListener('click', async () => {
    if (state.running) return
    state.running = true
    const old = btn.textContent
    btn.textContent = '同步中…'
    btn.disabled = true
    notice('正在从云端拉取变更…')
    try {
      const r = await api('/api/mirror/sync', { method: 'POST', body: {} })
      const parts = [`同步 ${r.applied} 个变化`]
      if (r.removed) parts.push(`删除 ${r.removed} 个`)
      parts.push(`游标 ${r.from} → ${r.cursor}`)
      if (r.fullResync) parts.push('已全量对齐')
      notice(`✓ ${parts.join(' · ')}`, 'ok')
      await refresh()
    } catch (e) {
      notice(`同步失败：${e.message}`, 'bad')
    } finally {
      btn.textContent = old
      btn.disabled = false
      state.running = false
    }
  })
}

function bindFullAlign() {
  const btn = $('#btn-mirror-full')
  if (!btn || btn.dataset.bound) return
  btn.dataset.bound = '1'
  btn.addEventListener('click', async () => {
    if (state.running) return
    if (!confirm('全量对齐会忽略游标，把所有对象重新比对一遍。\n\n数据不会丢，但会重新下载变化的对象。继续？')) return
    state.running = true
    const old = btn.textContent
    btn.textContent = '对齐中…'
    btn.disabled = true
    notice('正在做全量对齐…')
    try {
      const r = await api('/api/mirror/sync', { method: 'POST', body: { force: true } })
      notice(`✓ 全量对齐完成：${r.applied} 个变化 · 游标 ${r.cursor}`, 'ok')
      await refresh()
    } catch (e) {
      notice(`对齐失败：${e.message}`, 'bad')
    } finally {
      btn.textContent = old
      btn.disabled = false
      state.running = false
    }
  })
}

function bindRefresh() {
  const btn = $('#btn-mirror-refresh')
  if (!btn || btn.dataset.bound) return
  btn.dataset.bound = '1'
  btn.addEventListener('click', () => { notice(''); void refresh() })
}

export async function refresh() {
  bindSync()
  bindFullAlign()
  bindRefresh()
  try {
    state.data = await api('/api/mirror')
    render()
  } catch (e) {
    notice(`加载失败：${e.message}`, 'bad')
  }
}
