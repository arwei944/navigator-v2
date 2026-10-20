/**
 * 控制台的「备份」面板：线上数据库的离线副本管理。
 *
 * 解决什么：线上数据只有一份 `/data/store.db`，平台没有持久卷，容器重建就可能归零。
 * 而 `data/` 刻意不进部署包（保护线上库），所以部署这条路径救不回数据。
 * 这里把整份 SQLite 拉到本机，作为唯一能真正兜住平台故障的退路。
 *
 * 展示口径：
 *   · 新鲜度用**颜色**表达（绿=安全 / 黄=该备了 / 红=不能部署），不靠读数字判断；
 *   · 每份备份都显示站点数与对象数 —— 只有字节数的备份无法判断内容是否完整；
 *   · 「能不能部署」的结论直接写在面板上，因为这是用户最需要的判断。
 */
import { $, api } from './core.js'
import { fmtDateTimeSec, fmtBytes } from '../../../shared/format.mjs'

const state = { data: null, running: false }

function el(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

function notice(text, kind = '') {
  const box = $('#backup-notice')
  if (!box) return
  box.textContent = text
  box.className = `notice ${kind}`
  box.hidden = !text
}

/**
 * 时间转「x 小时前」——绝对时间对判断「该不该备份」没有帮助。
 *
 * 这里刻意**不**复用 `fmtRelative`：那个函数把「30 天以上」降级成绝对日期，
 * 而备份的新鲜度语义是「越久越危险」，几个月没备份时必须仍显示"多少天前"，
 * 显示成日期反而看不出紧迫性。
 */
function fmtAge(iso) {
  if (!iso) return '从未'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return '—'
  const min = Math.round(ms / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.round(h / 24)} 天前`
}

/** 新鲜度 → 颜色档位。阈值由服务端给，前端不另立一套。 */
function freshnessLevel(fresh) {
  if (fresh.ok) return 'ok'
  if (fresh.ageHours !== null && fresh.ageHours <= (fresh.maxAgeHours || 24) * 2) return 'warn'
  return 'bad'
}

function renderFreshness(d) {
  const box = $('#backup-freshness')
  if (!box) return
  box.innerHTML = ''
  const f = d.freshness || {}
  const level = freshnessLevel(f)

  const row = el('div', `backup-fresh backup-${level}`)
  row.append(el('div', 'backup-fresh-title', f.ok ? '备份是最新的' : '需要备份'))
  row.append(el('div', 'backup-fresh-reason', f.reason || '—'))
  row.append(el('div', 'backup-fresh-meta',
    `最近备份：${fmtAge(d.lastAt)} · 共 ${d.count} 份 · 阈值 ${d.maxAgeHours} 小时`))

  // 结论直说：用户最想知道的是「现在能不能安全部署」
  const verdict = el('div', 'backup-verdict',
    f.ok ? '✓ 可以安全部署（万一出事有备份可回滚）'
          : '✗ 不建议部署：此时容器重建会丢数据，且没有副本可回滚')
  row.append(verdict)

  // 定时状态：光有备份文件不够，用户还得知道「它会不会自己继续备」
  const sch = d.schedule
  if (sch) {
    const parts = []
    if (sch.enabled) parts.push(`每 ${sch.intervalHours} 小时自动备份`)
    else parts.push('自动备份未启用')
    if (sch.lastPhase) parts.push(sch.lastPhase)
    if (sch.failures > 0) parts.push(`累计失败 ${sch.failures} 次`)
    const line = el('div', 'backup-fresh-meta', `定时：${parts.join(' · ')}`)
    if (!sch.enabled) line.classList.add('backup-sched-off')
    row.append(line)
  }

  box.append(row)
}

function renderList(d) {
  const box = $('#backup-list')
  if (!box) return
  box.innerHTML = ''

  if (!d.count) {
    box.append(el('p', 'hint', '还没有任何备份。点右上角「立即备份」创建第一份。'))
    return
  }

  const table = el('div', 'backup-table')
  const head = el('div', 'backup-row backup-head')
  for (const t of ['时间', '大小', '站点', '对象', '版本']) head.append(el('span', '', t))
  table.append(head)

  for (const it of d.items) {
    const row = el('div', 'backup-row')
    // 第一列给**人可读的时间**，文件名放 title —— 用户关心"这是什么时候的"，
    // 而不是 `store-20261020-204506.db` 这串数字
    const when = it.at ? fmtDateTimeSec(it.at, it.name) : it.name
    const timeCell = el('span', 'backup-name', when)
    timeCell.title = it.name
    row.append(timeCell)
    row.append(el('span', '', fmtBytes(it.size)))
    row.append(el('span', '', it.siteCount === null ? '—' : String(it.siteCount)))
    row.append(el('span', '', it.objects === null ? '—' : String(it.objects)))
    row.append(el('span', '', it.version === null ? '—' : `v${it.version}`))
    table.append(row)
  }
  box.append(table)
}

function render() {
  const d = state.data
  if (!d) return

  const sum = $('#backup-summary')
  if (sum) {
    sum.innerHTML = ''
    sum.append(el('code', '', 'backups/db'))
    sum.append(el('span', 'muted', `  ${d.count} 份 · 最近 ${fmtAge(d.lastAt)}`))
  }

  const dir = $('#backup-dir')
  if (dir) dir.textContent = `${d.dir}${d.dirExists ? '' : '（目录尚未创建，首次备份会自动建）'}`

  renderFreshness(d)
  renderList(d)
}

/* ---------- 交互 ---------- */

function bindRun() {
  const btn = $('#btn-backup-run')
  if (!btn || btn.dataset.bound) return
  btn.dataset.bound = '1'
  btn.addEventListener('click', async () => {
    if (state.running) return
    state.running = true
    const old = btn.textContent
    btn.textContent = '备份中…'
    btn.disabled = true
    notice('正在从线上拉取数据库并校验…')
    try {
      const r = await api('/api/backup/run', { method: 'POST', body: {} })
      const parts = [`已备份 ${r.siteCount} 站点 · ${r.objects} 个对象 · ${fmtBytes(r.bytes)}`]
      if (r.pruned?.length) parts.push(`清理 ${r.pruned.length} 个旧文件`)
      notice(`✓ ${parts.join(' · ')}`, 'ok')
      await refresh()
    } catch (e) {
      notice(`备份失败：${e.message}`, 'bad')
    } finally {
      btn.textContent = old
      btn.disabled = false
      state.running = false
    }
  })
}

function bindRefresh() {
  const btn = $('#btn-backup-refresh')
  if (!btn || btn.dataset.bound) return
  btn.dataset.bound = '1'
  btn.addEventListener('click', () => { notice(''); void refresh() })
}

export async function refresh() {
  bindRun()
  bindRefresh()
  try {
    state.data = await api('/api/backup')
    render()
  } catch (e) {
    notice(`加载失败：${e.message}`, 'bad')
  }
}
