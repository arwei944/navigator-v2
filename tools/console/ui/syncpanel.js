/** 同步面板：云端版本对比 + 全链路发布时间线（步骤状态 / 耗时 / 详情） */
import { $, api, openStream, appendLocal, isBusy } from './core.js'

const STATUS_LABEL = { pending: '待执行', running: '进行中', success: '完成', failed: '失败', skipped: '跳过' }
const state = { status: null, steps: [], deployment: null, gate: null, snapshots: null }

function el(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

function fmtDur(ms) {
  if (ms === null || ms === undefined) return ''
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function fmtClock(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

/* ---------- 概览 ---------- */

function renderSummary() {
  const box = $('#sync-summary')
  const s = state.status
  box.innerHTML = ''
  if (!s) { box.append(el('span', 'dim', '读取中…')); return }
  const l = s.local
  box.append(el('span', 'chip', `分支 ${l.branch || '(detached)'}`))
  box.append(el('span', `chip ${l.ahead ? 'warn' : ''}`, `领先 ${l.ahead}`))
  box.append(el('span', `chip ${l.behind ? 'warn' : ''}`, `落后 ${l.behind}`))
  box.append(el('span', 'chip', `已暂存 ${l.staged}`))
  box.append(el('span', `chip ${s.hotUpdateReady ? 'ok' : 'warn'}`, s.hotUpdateReady ? '热更新就绪' : '缺少管理密钥'))
  box.append(el('span', `chip ${s.vercel.apiAvailable ? 'ok' : ''}`, s.vercel.apiAvailable ? 'Vercel API 可用' : 'Vercel API 未启用'))
}

function renderCloud() {
  const box = $('#cloud-compare')
  const s = state.status
  box.innerHTML = ''
  if (!s) { box.append(el('div', 'dim', '读取中…')); return }
  const l = s.local
  const c = s.cloud

  const cols = el('div', 'cc-grid')
  const local = el('div', 'cc-col')
  local.append(el('div', 'cc-title', '本地工作区'))
  local.append(el('div', 'cc-count', String(l.count ?? '—')))
  local.append(el('div', 'cc-sub', `站点数 · 领先远端 ${l.ahead}`))
  local.append(el('div', 'cc-meta', l.head ? `${l.head.short} ${l.head.subject}` : '无提交记录'))
  cols.append(local)

  const cloud = el('div', 'cc-col')
  cloud.append(el('div', 'cc-title', '云端（热更新数据）'))
  if (c.ok) {
    cloud.append(el('div', 'cc-count', String(c.count)))
    cloud.append(el('div', 'cc-sub', `站点数 · version ${c.version ?? '—'} · 含图标 ${c.withIcons}`))
    cloud.append(el('div', 'cc-meta', `读取于 ${fmtClock(c.fetchedAt)}`))
  } else {
    cloud.append(el('div', 'cc-count err', '—'))
    cloud.append(el('div', 'cc-sub', `读取失败：${c.error}`))
  }
  cols.append(cloud)
  box.append(cols)

  const badge = el('div', `cc-verdict ${s.converged ? 'ok' : 'warn'}`,
    s.converged
      ? `✅ 本地与云端一致（${l.count} 站点）`
      : `⚠️ 本地 ${l.count ?? '—'} / 云端 ${c.ok ? c.count : '—'}，尚未一致`)
  box.append(badge)

  if (state.deployment) {
    const d = el('div', 'cc-deploy')
    d.append(el('span', 'dim', '本次部署：'))
    const a = el('a', 'link', state.deployment.url)
    a.href = state.deployment.url
    a.target = '_blank'
    a.rel = 'noreferrer'
    d.append(a)
    if (state.deployment.stateLabel || state.deployment.state) {
      d.append(el('span', 'chip', state.deployment.stateLabel || state.deployment.state))
    }
    box.append(d)
  }
}

/* ---------- 时间线 ---------- */

function renderTimeline() {
  const ol = $('#sync-timeline')
  ol.innerHTML = ''
  if (state.steps.length === 0) {
    ol.append(el('li', 'tl-empty', '尚未运行发布流程。填写消息后点击「一键发布」。'))
    return
  }
  state.steps.forEach((s, i) => {
    const li = el('li', `tl-item ${s.status}`)
    li.append(el('span', `tl-dot ${s.status}`))
    li.append(el('span', 'tl-idx', String(i + 1)))
    li.append(el('span', 'tl-label', s.label))

    const meta = el('span', 'tl-meta')
    if (s.duration) meta.append(el('span', 'tl-dur', fmtDur(s.duration)))
    meta.append(el('span', `tl-state ${s.status}`, STATUS_LABEL[s.status] || s.status))
    li.append(meta)

    if (s.detail) li.append(el('div', 'tl-detail', s.detail))
    ol.append(li)
  })
}

function applyStep(step) {
  const i = state.steps.findIndex(x => x.key === step.key)
  if (i >= 0) state.steps[i] = step
  else state.steps.push(step)
  renderTimeline()
}

/* ---------- 发布门禁：预检 → 放行 ---------- */

function gateRow(grid, k, v, cls) {
  const row = el('div', 'gate-row')
  row.append(el('span', 'gate-k', k))
  row.append(el('span', `gate-v ${cls || ''}`, v))
  grid.append(row)
}

function renderGateReport() {
  const box = $('#gate-report')
  box.innerHTML = ''
  const g = state.gate
  if (!g) {
    box.append(el('div', 'dim', '尚未预检。点击「执行预检」查看本次发布将发生什么。'))
    return
  }
  if (g.error) {
    box.append(el('div', 'gate-blocker', `预检失败：${g.error}`))
    return
  }
  const grid = el('div', 'gate-grid')
  gateRow(grid, '放行凭证', `${g.id} · ${g.ttlSeconds}s 内有效`)
  gateRow(grid, '分支 / HEAD', `${g.workspace.branch || '(detached)'} · ${g.workspace.head ? g.workspace.head.short : '-'}`, g.workspace.branch ? '' : 'err')
  gateRow(grid, '领先 / 落后', `${g.workspace.ahead} / ${g.workspace.behind}`)
  gateRow(grid, '将提交文件', g.willCommit.length ? `${g.willCommit.length} 个：${g.willCommit.join('、')}` : '无')
  gateRow(grid, '未暂存文件', g.willNotCommit.length ? `${g.willNotCommit.length} 个` : '无')
  gateRow(grid, '待推送提交', g.pendingCommits.length ? g.pendingCommits.map(c => `${c.short} ${c.subject}`).join('；') : '无')
  gateRow(grid, '云端', g.cloud.ok ? `v${g.cloud.version} · ${g.cloud.count} 站点 · ${g.cloud.withIcons} 带图标` : `读取失败：${g.cloud.error}`, g.cloud.ok ? '' : 'err')
  if (g.data) {
    gateRow(grid, '本地数据', `${g.data.currentCount} 站点（HEAD ${g.data.headCount}）`)
    gateRow(grid, '数据增删改', `+${g.data.added.length} / -${g.data.removed.length} / ~${g.data.modified.length}`)
    if (g.data.added.length) gateRow(grid, '新增', g.data.added.map(s => `${s.id} ${s.name}`).join('、'))
    if (g.data.removed.length) gateRow(grid, '移除', g.data.removed.map(s => `${s.id} ${s.name}`).join('、'))
    if (g.data.modified.length) gateRow(grid, '修改', g.data.modified.map(m => `${m.id}（${m.labels.join('/')}）`).join('、'))
  }
  box.append(grid)
  if (g.blockers.length) box.append(el('div', 'gate-blocker', `阻断项（${g.blockers.length}）：${g.blockers.join('；')}`))
  else box.append(el('div', 'gate-ok', '✅ 无阻断项，可放行发布'))
  if ((g.warnings || []).length) box.append(el('div', 'gate-warn', `提醒（${g.warnings.length}）：${g.warnings.join('；')}`))
}

async function doPreflight() {
  const out = $('#sync-result')
  const btn = $('#btn-gate-preflight')
  btn.disabled = true
  out.className = 'result'
  out.textContent = '预检中…'
  try {
    const g = await api(`/api/publish/preflight?message=${encodeURIComponent($('#sync-message').value.trim())}`)
    state.gate = g
    renderGateReport()
    $('#btn-sync-publish').disabled = !g.ready
    out.className = g.ready ? 'result ok' : 'result err'
    out.textContent = g.ready ? `预检完成，凭证 ${g.id}（${g.ttlSeconds}s 内有效）` : '预检存在阻断项，无法放行'
  } catch (e) {
    state.gate = { error: e.message }
    renderGateReport()
    $('#btn-sync-publish').disabled = true
    out.className = 'result err'
    out.textContent = `预检失败：${e.message}`
  } finally {
    btn.disabled = false
  }
}

/* ---------- 云端数据快照：清单 + 一键回滚 ---------- */

async function refreshSnapshots() {
  const box = $('#snapshot-list')
  box.innerHTML = ''
  box.append(el('div', 'dim', '读取中…'))
  try {
    state.snapshots = await api('/api/publish/snapshots')
    renderSnapshots()
  } catch (e) {
    box.innerHTML = ''
    box.append(el('div', 'gate-blocker', `读取快照失败：${e.message}`))
  }
}

function renderSnapshots() {
  const box = $('#snapshot-list')
  box.innerHTML = ''
  const r = state.snapshots
  if (!r) return
  if (!r.count) {
    box.append(el('div', 'dim', '暂无云端快照（下一次热更新前会自动落盘一份）。'))
    return
  }
  box.append(el('div', 'dim', `共 ${r.count} 份 · 保留最近 ${r.keep} 份（新 → 旧）`))
  for (const s of r.snapshots.slice(0, 20)) {
    const row = el('div', 'snap-row')
    row.append(el('span', 'snap-ver', `v${s.version}`))
    row.append(el('span', 'snap-ts', new Date(s.ts).toLocaleString('zh-CN', { hour12: false })))
    row.append(el('span', 'snap-size', `${(s.size / 1024).toFixed(1)}KB`))
    const btn = el('button', 'btn ghost', '回滚到此')
    btn.addEventListener('click', () => doRollback(s))
    row.append(btn)
    box.append(row)
  }
}

async function doRollback(snap) {
  const out = $('#snap-result')
  out.className = 'result'
  out.textContent = `正在预演回滚到 v${snap.version}…`
  let p
  try {
    const r = await api('/api/publish/rollback', { method: 'POST', body: { snapshot: snap.pathname, dryRun: true } })
    p = r.preview
  } catch (e) {
    out.className = 'result err'
    out.textContent = `回滚预演失败：${e.message}`
    return
  }
  const names = list => list.map(s => s.name || s.id).join('、') || '无'
  const summary = [
    `把云端从 v${p.currentVersion}（${p.currentCount} 站点）回滚到 v${p.snapshotVersion}（${p.snapshotCount} 站点）`,
    `将移除 ${p.willRemove.length} 个：${names(p.willRemove)}`,
    `将恢复 ${p.willRestore.length} 个：${names(p.willRestore)}`,
    `将改回 ${p.willRevert.length} 个：${names(p.willRevert)}`,
  ].join('\n')
  if (!window.confirm(`${summary}\n\n确认回滚？回滚前会先把当前数据存一份快照，回滚本身可撤销。`)) {
    out.className = 'result'
    out.textContent = '已取消回滚。'
    return
  }
  out.textContent = '回滚中…'
  try {
    const r = await api('/api/publish/rollback', { method: 'POST', body: { snapshot: snap.pathname } })
    out.className = 'result ok'
    out.textContent = `✅ 已回滚到 v${p.snapshotVersion}：云端 v${r.previousVersion} → v${r.version} · ${r.count} 站点 · ${r.withIcons} 带图标；回滚前数据已存快照 ${r.safetySnapshot?.pathname || '(无)'}`
    await refresh()
    await refreshSnapshots()
  } catch (e) {
    out.className = 'result err'
    out.textContent = `回滚失败：${e.message}`
  }
}

/* ---------- 交互 ---------- */

export async function refresh() {
  try {
    state.status = await api('/api/sync/status')
  } catch (e) {
    appendLocal(`读取同步状态失败：${e.message}`, 'stderr')
    return
  }
  renderSummary()
  renderCloud()
  if (!$('#sync-message').value) await prefillMessage()
}

async function prefillMessage() {
  try {
    const sum = await api('/api/changes/summary')
    const msg = sum?.suggestion?.message
    if (msg) $('#sync-message').value = msg
  } catch { /* 预填失败不影响主流程 */ }
}

async function doPublish(bypass = false) {
  const out = $('#sync-result')
  if (isBusy()) { out.className = 'result err'; out.textContent = '已有任务在运行，请等待完成或终止后再试。'; return }

  if (bypass) {
    if (!window.confirm('绕过发布门禁直接发布？本次发布将不经预检放行，但会在日志与审计中留痕。')) return
  } else if (!state.gate?.id) {
    out.className = 'result err'
    out.textContent = '请先「执行预检」，再放行发布（或显式使用「绕过门禁发布」）。'
    return
  }

  const message = $('#sync-message').value.trim()
  const push = $('#sync-push').checked
  const skipBuild = $('#sync-skip-build').checked

  $('#btn-sync-publish').disabled = true
  out.className = 'result'
  out.textContent = bypass ? '绕过门禁发布中…实时日志见下方控制台。' : '放行发布中…实时日志见下方控制台。'
  try {
    const body = { message, push, skipBuild }
    if (bypass) body.noGate = true
    else body.gateId = state.gate.id
    const { jobId, gate } = await api('/api/sync/publish', { method: 'POST', body })
    state.gate = null
    renderGateReport()
    if (gate?.bypassed) appendLocal('本次发布已按「绕过门禁」放行，未经预检。', 'stderr')
    state.deployment = null
    state.steps = []
    renderTimeline()
    openStream(jobId, '一键发布', async d => {
      out.className = d.status === 'success' ? 'result ok' : 'result err'
      out.textContent = d.status === 'success'
        ? `发布完成（${(d.duration / 1000).toFixed(1)}s）`
        : `发布失败，退出码 ${d.code}`
      $('#btn-sync-publish').disabled = true
      await refresh()
      await refreshSnapshots()
    }, {
      steps: list => { state.steps = list; renderTimeline() },
      step: applyStep,
      deployment: d => {
        state.deployment = { ...(state.deployment || {}), ...d }
        renderCloud()
      },
    })
  } catch (e) {
    out.className = 'result err'
    out.textContent = `无法启动发布：${e.message}`
    $('#btn-sync-publish').disabled = !state.gate?.id
  }
}

async function doVerify() {
  const out = $('#sync-result')
  if (isBusy()) { out.className = 'result err'; out.textContent = '已有任务在运行，请等待完成。'; return }
  try {
    const { jobId } = await api('/api/sync/verify', { method: 'POST', body: {} })
    out.className = 'result'
    out.textContent = '验证中，轮询云端一致性…'
    openStream(jobId, '云端一致性验证', async d => {
      out.className = d.status === 'success' ? 'result ok' : 'result err'
      out.textContent = d.status === 'success' ? '云端已收敛' : '云端未收敛或读取失败'
      await refresh()
    })
  } catch (e) {
    out.className = 'result err'
    out.textContent = `无法启动验证：${e.message}`
  }
}

export function initSyncPanel() {
  $('#btn-sync-refresh').addEventListener('click', () => refresh())
  $('#btn-sync-verify').addEventListener('click', () => doVerify())
  $('#btn-gate-preflight').addEventListener('click', () => doPreflight())
  $('#btn-sync-publish').addEventListener('click', () => doPublish(false))
  $('#btn-gate-bypass').addEventListener('click', () => doPublish(true))
  $('#btn-snap-refresh').addEventListener('click', () => refreshSnapshots())
  renderTimeline()
  renderGateReport()
  refresh()
  refreshSnapshots()
}