/** 数据面板：站点数据变更摘要（工作区 vs HEAD）+ 分类分布 + 完整性体检 */
import { $, api, appendLocal } from './core.js'

const state = { report: null, summary: null, loading: false }

function el(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

/* ---------- 概览 ---------- */

function renderSummary() {
  const box = $('#data-summary')
  box.innerHTML = ''
  const r = state.report
  if (!r) { box.append(el('span', 'dim', '读取中…')); return }

  box.append(el('span', 'chip', `${r.file}`))
  box.append(el('span', 'chip', `站点 ${r.total}`))
  box.append(el('span', 'chip', `分类 ${r.categories}`))
  box.append(el('span', `chip ${r.unknownCategories.length ? 'warn' : 'ok'}`,
    `未登记分类 ${r.unknownCategories.length}`))
  box.append(el('span', `chip ${r.dupSortOrder.length ? 'warn' : 'ok'}`, `sortOrder 重复 ${r.dupSortOrder.length}`))
  box.append(el('span', `chip ${r.holes.length ? 'warn' : 'ok'}`, `排序空洞 ${r.holes.length}`))
}

/* ---------- 工作区 vs HEAD ---------- */

function chipList(box, items, cls, emptyText, labelOf) {
  if (!items.length) { box.append(el('div', 'dim', emptyText)); return }
  const wrap = el('div', 'chips')
  for (const it of items) {
    const chip = el('span', `chip ${cls}`, labelOf(it))
    wrap.append(chip)
  }
  box.append(wrap)
}

function renderDiff() {
  const box = $('#data-diff')
  box.innerHTML = ''
  const s = state.summary?.sites
  if (!s) { box.append(el('div', 'dim', '读取中…')); return }

  const head = el('div', 'ss-line')
  head.append(el('span', '', `HEAD ${s.headCount}`))
  head.append(el('span', 'dim', '→'))
  head.append(el('span', `ss-cur ${s.changed ? 'warn' : 'ok'}`, `工作区 ${s.currentCount}`))
  const headBox = el('div', 'sites-summary')
  headBox.append(el('div', 'ss-title', '站点数据（api/sites-data.json）'))
  headBox.append(head)
  box.append(headBox)

  if (!s.changed) {
    box.append(el('div', 'ss-detail ok', '工作区与 HEAD 无站点数据差异。'))
    return
  }

  const rows = el('div', 'diff-groups')
  const groups = [
    ['新增', s.diff.added, 'ok', '无新增'],
    ['移除', s.diff.removed, 'err', '无移除'],
    ['修改', s.diff.modified, 'warn', '无修改'],
  ]
  for (const [label, items, cls, empty] of groups) {
    const g = el('div', 'dg-row')
    g.append(el('div', 'dg-label', `${label} ${items.length}`))
    const body = el('div', 'dg-body')
    chipList(body, items, cls, empty, it => (it.labels ? `${it.id}（${it.labels.join('/')}）` : `${it.id} ${it.name}`))
    g.append(body)
    rows.append(g)
  }
  box.append(rows)
}

/* ---------- 分类分布 ---------- */

function renderDist() {
  const box = $('#data-dist')
  box.innerHTML = ''
  const r = state.report
  if (!r) { box.append(el('div', 'dim', '读取中…')); return }
  const max = r.distribution.reduce((n, d) => Math.max(n, d.count), 0) || 1

  for (const d of r.distribution) {
    const row = el('div', 'dist-row')
    const head = el('div', 'dist-head')
    const name = el('span', `dist-name ${d.known ? '' : 'unknown'}`)
    const dot = el('span', 'dist-dot')
    dot.style.background = d.color
    name.append(dot, document.createTextNode(`${d.label}`))
    if (!d.known) name.append(el('span', 'dist-tag', '未登记'))
    head.append(name)
    head.append(el('span', 'dist-count', String(d.count)))
    row.append(head)

    const track = el('div', 'dist-track')
    const bar = el('div', 'dist-bar')
    bar.style.width = `${Math.max(4, Math.round((d.count / max) * 100))}%`
    bar.style.background = d.color
    track.append(bar)
    row.append(track)

    box.append(row)
  }
}

/* ---------- 完整性检查 ---------- */

function integrityRow(box, label, items, cls, format) {
  const row = el('div', 'int-row')
  const head = el('div', 'int-head')
  head.append(el('span', 'int-label', label))
  head.append(el('span', `int-count ${items.length ? cls : 'ok'}`, items.length ? String(items.length) : '通过'))
  row.append(head)
  if (items.length) {
    const list = el('div', 'int-list')
    list.textContent = items.slice(0, 30).map(format).join('、') + (items.length > 30 ? ` … 其余 ${items.length - 30} 项` : '')
    row.append(list)
  }
  box.append(row)
}

function renderIntegrity() {
  const box = $('#data-integrity')
  box.innerHTML = ''
  const r = state.report
  if (!r) { box.append(el('div', 'dim', '读取中…')); return }

  integrityRow(box, '图标缺失', r.missingIcon, 'warn', id => id)
  integrityRow(box, '配色缺失', r.missingColor, 'warn', id => id)
  integrityRow(box, '描述缺失', r.missingDesc, 'warn', id => id)
  integrityRow(box, 'sortOrder 重复', r.dupSortOrder, 'err', n => String(n))
  integrityRow(box, '排序空洞', r.holes, 'warn', n => String(n))
  integrityRow(box, '未登记分类', r.unknownCategories, 'err', id => id)
  integrityRow(box, '域名重复', r.dupDomains, 'err', d => `${d.domain}(${d.ids.join('/')})`)

  const note = el('p', 'hint', `sortOrder 上限 ${r.sortOrderMax}，站点总数 ${r.total}。空洞多因历史新增未重排，可运行 node scripts/fix-sortorder.mjs 一键重排。`)
  box.append(note)
}

/* ---------- 交互 ---------- */

export async function refresh() {
  if (state.loading) return
  state.loading = true
  try {
    const [report, summary] = await Promise.all([
      api('/api/data/report'),
      api('/api/changes/summary').catch(() => null),
    ])
    state.report = report
    state.summary = summary
  } catch (e) {
    appendLocal(`读取数据体检失败：${e.message}`, 'stderr')
    state.report = null
  } finally {
    state.loading = false
  }
  renderSummary()
  renderDiff()
  renderDist()
  renderIntegrity()
}

export function initDataPanel() {
  $('#btn-data-refresh').addEventListener('click', () => refresh())
  if ($('#panel-data')?.classList.contains('active')) refresh()
}