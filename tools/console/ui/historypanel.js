/** 历史面板：提交记录 + 「已推送 / 仅本地」标注 + Vercel 部署状态关联 */
import { $, api, appendLocal } from './core.js'

const state = { data: null, loading: false }

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

/* ---------- 概览 ---------- */

function renderSummary() {
  const box = $('#history-summary')
  box.innerHTML = ''
  const d = state.data
  if (!d) { box.append(el('span', 'dim', '读取中…')); return }

  const pushed = d.commits.filter(c => c.pushed).length
  const linked = d.commits.filter(c => c.deployment).length
  box.append(el('span', 'chip', `上游 ${d.upstream || '(未设置)'}`))
  box.append(el('span', 'chip', `最近 ${d.commits.length} 次提交`))
  box.append(el('span', 'chip ok', `已推送 ${pushed}`))
  box.append(el('span', `chip ${d.commits.length - pushed ? 'warn' : ''}`, `仅本地 ${d.commits.length - pushed}`))
  box.append(el('span', 'chip', `部署关联 ${linked}`))
}

/* ---------- 生产部署基线 ---------- */

function renderLatest() {
  const box = $('#history-deploy')
  box.innerHTML = ''
  const d = state.data
  if (!d) return
  const l = d.latest
  if (!l) {
    if (d.deployCount === 0 && !d.deployNote) box.append(el('div', 'dim', '未读取到部署记录。'))
    return
  }
  const cls = l.state === 'READY' ? 'ok' : l.state === 'ERROR' ? 'err' : 'warn'
  const row = el('div', 'db-row')
  row.append(el('span', 'db-title', '当前生产部署'))
  row.append(el('span', `chip ${cls}`, l.stateLabel))
  row.append(el('span', 'db-time', fmtClock(l.createdAt)))
  if (l.url) {
    const a = el('a', 'link', l.url.replace(/^https:\/\//, ''))
    a.href = l.url
    a.target = '_blank'
    a.rel = 'noreferrer'
    row.append(a)
  }
  box.append(row)
  if (l.commitMessage) {
    box.append(el('div', 'db-sha', `${(l.commitSha || '').slice(0, 7)} ${l.commitMessage}`))
  }
}

function renderNote() {
  const box = $('#history-note')
  const d = state.data
  box.className = 'hint'
  if (!d) { box.textContent = ''; return }
  if (d.deployNote) { box.textContent = d.deployNote; return }
  const linked = d.commits.filter(c => c.deployment).length
  if (linked === 0) {
    box.textContent = `已读取 ${d.deployCount} 条部署记录，但最近 ${d.commits.length} 次提交均未推送部署（部署按 commit SHA 精确匹配，不做近似推断）。`
    return
  }
  box.textContent = '按 commit SHA 关联 Vercel 部署；同一提交多次部署时取最新一条。'
}

/* ---------- 提交列表 ---------- */

function renderDeployBadge(cell, dep) {
  if (!dep) {
    cell.append(el('span', 'chip', '未关联部署'))
    return
  }
  const cls = dep.state === 'READY' ? 'ok' : dep.state === 'ERROR' ? 'err' : 'warn'
  const badge = el('span', `chip ${cls}`, dep.stateLabel)
  cell.append(badge)
  if (dep.url) {
    const a = el('a', 'link', dep.url.replace(/^https:\/\//, ''))
    a.href = dep.url
    a.target = '_blank'
    a.rel = 'noreferrer'
    cell.append(a)
  }
}

function renderList() {
  const box = $('#history-list')
  box.innerHTML = ''
  const d = state.data
  if (!d) { box.append(el('div', 'dim', '读取中…')); return }
  if (d.commits.length === 0) { box.append(el('div', 'dim', '暂无提交记录。')); return }

  for (const c of d.commits) {
    const item = el('div', 'commit-item')

    const head = el('div', 'ci-head')
    head.append(el('span', 'ci-sha', c.short))
    head.append(el('span', 'ci-subject', c.subject))

    const badges = el('div', 'ci-badges')
    badges.append(el('span', `chip ${c.pushed ? 'ok' : 'warn'}`, c.pushed ? '已推送' : '仅本地'))
    renderDeployBadge(badges, c.deployment)
    head.append(badges)
    item.append(head)

    const meta = el('div', 'ci-meta')
    meta.append(el('span', 'ci-author', c.author))
    meta.append(el('span', 'ci-date', fmtClock(c.date)))
    if (c.deployment?.createdAt) meta.append(el('span', 'ci-deploy-at', `部署于 ${fmtClock(c.deployment.createdAt)}`))
    item.append(meta)

    box.append(item)
  }
}

/* ---------- 交互 ---------- */

export async function refresh() {
  if (state.loading) return
  state.loading = true
  try {
    state.data = await api('/api/history?limit=25')
  } catch (e) {
    appendLocal(`读取提交历史失败：${e.message}`, 'stderr')
    state.data = null
  } finally {
    state.loading = false
  }
  renderSummary()
  renderLatest()
  renderNote()
  renderList()
}

export function initHistoryPanel() {
  $('#btn-history-refresh').addEventListener('click', () => refresh())
  // 懒加载：首次切到该标签时由 app.js 触发，避免启动即打 Vercel API
  if ($('#panel-history')?.classList.contains('active')) refresh()
}