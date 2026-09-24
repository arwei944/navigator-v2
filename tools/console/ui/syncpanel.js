/** 同步面板：云端版本对比 + 全链路发布时间线（步骤状态 / 耗时 / 详情） */
import { $, api, openStream, appendLocal, isBusy } from './core.js'

const STATUS_LABEL = { pending: '待执行', running: '进行中', success: '完成', failed: '失败', skipped: '跳过' }
const state = { status: null, steps: [], deployment: null }

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

async function doPublish() {
  const out = $('#sync-result')
  if (isBusy()) { out.className = 'result err'; out.textContent = '已有任务在运行，请等待完成或终止后再试。'; return }

  const message = $('#sync-message').value.trim()
  const push = $('#sync-push').checked
  const skipBuild = $('#sync-skip-build').checked

  $('#btn-sync-publish').disabled = true
  out.className = 'result'
  out.textContent = '发布中…实时日志见下方控制台。'
  try {
    const { jobId } = await api('/api/sync/publish', { method: 'POST', body: { message, push, skipBuild } })
    state.deployment = null
    state.steps = []
    renderTimeline()
    openStream(jobId, '一键发布', async d => {
      out.className = d.status === 'success' ? 'result ok' : 'result err'
      out.textContent = d.status === 'success'
        ? `发布完成（${(d.duration / 1000).toFixed(1)}s）`
        : `发布失败，退出码 ${d.code}`
      $('#btn-sync-publish').disabled = false
      await refresh()
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
    $('#btn-sync-publish').disabled = false
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
  $('#btn-sync-publish').addEventListener('click', () => doPublish())
  renderTimeline()
  refresh()
}