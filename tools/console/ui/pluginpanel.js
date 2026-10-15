/**
 * 控制台的「插件」面板：九个引擎模块的统一管理面。
 *
 * 与站点后台那个同名面板的区别在**生效范围**：
 *   · 这里改的是**本机控制台**的引擎链（控制台自己抓取 / 翻译 / 探活时用）；
 *   · 站点后台改的是**线上那台**（配置进站点库）。
 * 两者刻意不共用一份配置 —— 本机想用 siteprobe 抓取，不该顺带把线上也切过去。
 *
 * 数据源与站内同源：都是 shared/plugin-registry.mjs 的那份注册表聚合。
 */
import { $, api } from './core.js'

const state = { data: null, draft: {}, original: {}, loading: false, saving: false }

function el(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

const STRATEGY_LABEL = { chain: '链式', pick: '单选', locked: '锁定' }

/* ---------- 编辑器取值（与站内面板同一套语义） ---------- */

function initValue(g) {
  if (!g.writable) return ''
  if (g.strategy === 'chain') {
    const c = g.current.configured
    if (c === null) return ''
    if (c.length === 0) return 'none'
    return c.join(',')
  }
  return g.current.mode === 'auto' ? '' : (g.current.requested || '')
}

function usableIds(g) {
  return g.providers.filter(p => p.available).map(p => p.id)
}

function chainIds(g) {
  const v = state.draft[g.env]
  if (v === '' || v === undefined) return g.providers.map(p => p.id)
  if (v === 'none') return []
  return String(v).split(',').map(s => s.trim()).filter(Boolean)
}

function setChain(g, p, on) {
  const ids = new Set(chainIds(g))
  if (on) ids.add(p.id); else ids.delete(p.id)
  if (ids.size === 0) { state.draft[g.env] = 'none'; return }
  const usable = usableIds(g)
  if (usable.length && ids.size === usable.length && usable.every(id => ids.has(id))) { state.draft[g.env] = ''; return }
  state.draft[g.env] = g.providers.filter(x => ids.has(x.id)).map(x => x.id).join(',')
}

const dirtyKeys = () => Object.keys(state.draft).filter(k => state.draft[k] !== state.original[k])

/* ---------- 渲染 ---------- */

function renderSummary() {
  const box = $('#plugins-summary')
  box.innerHTML = ''
  const d = state.data
  if (!d) { box.append(el('span', 'dim', state.loading ? '读取中…' : '读取失败')); return }
  const total = d.groups.length
  const on = d.groups.reduce((n, g) => n + g.providers.filter(p => p.active).length, 0)
  box.append(el('span', 'chip ok', `${total} 个引擎模块`))
  box.append(el('span', 'dim', `${on} 个 provider 生效中 · 配置于 ${d.at ? new Date(d.at).toLocaleTimeString('zh-CN', { hour12: false }) : '—'}`))
}

function renderGroup(g) {
  const box = el('div', 'pl-group')
  const head = el('div', 'pl-group-head')
  head.append(el('strong', null, g.label))
  head.append(el('span', `pl-badge ${g.strategy}`, STRATEGY_LABEL[g.strategy] || g.strategy))
  box.append(head)

  box.append(el('p', 'hint', g.role))

  const cur = el('p', 'pl-current')
  cur.append(el('span', 'pl-k', '当前'))
  cur.append(document.createTextNode(g.current.label))
  cur.append(el('code', 'pl-env', g.env))
  box.append(cur)

  if (g.writable) {
    const ed = el('div', 'pl-editor')
    if (g.strategy === 'chain') {
      for (const p of g.providers) {
        const lab = el('label', 'pl-opt' + (p.available ? '' : ' dim'))
        const cb = document.createElement('input')
        cb.type = 'checkbox'
        cb.checked = chainIds(g).includes(p.id)
        cb.disabled = !p.available
        cb.addEventListener('change', () => { setChain(g, p, cb.checked); render() })
        lab.append(cb, el('span', 'pl-opt-label', p.label), el('code', 'pl-opt-id', p.id))
        if (!p.available) lab.append(el('span', 'pl-tag off', '不可用'))
        else if (p.active) lab.append(el('span', 'pl-tag on', '生效中'))
        ed.append(lab)
      }
      const quick = el('div', 'pl-quick')
      const on = el('button', 'btn ghost', '全部启用（默认）')
      on.addEventListener('click', () => { state.draft[g.env] = ''; render() })
      const off = el('button', 'btn ghost', '全部关闭')
      off.addEventListener('click', () => { state.draft[g.env] = 'none'; render() })
      quick.append(on, off)
      ed.append(quick)
    } else {
      const auto = el('label', 'pl-opt')
      const r0 = document.createElement('input')
      r0.type = 'radio'
      r0.name = `pick-${g.id}`
      r0.checked = state.draft[g.env] === ''
      r0.addEventListener('change', () => { state.draft[g.env] = ''; render() })
      auto.append(r0, el('span', 'pl-opt-label', '自动（按可用性挑一个）'))
      ed.append(auto)

      for (const p of g.providers) {
        const lab = el('label', 'pl-opt' + (p.available ? '' : ' dim'))
        const r = document.createElement('input')
        r.type = 'radio'
        r.name = `pick-${g.id}`
        r.checked = state.draft[g.env] === p.id
        r.addEventListener('change', () => { state.draft[g.env] = p.id; render() })
        lab.append(r, el('span', 'pl-opt-label', p.label), el('code', 'pl-opt-id', p.id))
        if (!p.available) lab.append(el('span', 'pl-tag off', p.note || '不可用'))
        else if (p.active) lab.append(el('span', 'pl-tag on', '生效中'))
        ed.append(lab)
      }
    }
    box.append(ed)
  } else {
    box.append(el('p', 'pl-locked', '🔒 ' + g.note))
  }
  if (g.writable && g.note) box.append(el('p', 'hint', g.note))
  return box
}

function render() {
  renderSummary()
  const box = $('#plugins-groups')
  box.innerHTML = ''
  if (!state.data) return
  for (const g of state.data.groups) box.append(renderGroup(g))

  const n = dirtyKeys().length
  $('#btn-plugins-save').disabled = n === 0 || state.saving
  $('#btn-plugins-reset').disabled = n === 0 || state.saving
  const fl = $('#plugins-file')
  if (fl && state.data) fl.textContent = `配置写入 ${state.data.file}（本机，已被 gitignore）—— 改动立即生效，重启控制台后仍保留。`
}

function notice(text, kind = '') {
  const box = $('#plugins-notice')
  box.innerHTML = ''
  if (!text) return
  box.append(el('div', kind ? `log-line ${kind}` : 'log-line', text))
}

/* ---------- 取数与保存 ---------- */

export async function refresh() {
  state.loading = true
  render()
  try {
    const d = await api('/api/plugins')
    state.data = d
    state.draft = {}
    state.original = {}
    for (const g of d.groups) {
      const v = initValue(g)
      state.draft[g.env] = v
      state.original[g.env] = v
    }
  } catch (e) {
    state.data = null
    notice('读取失败：' + e.message, 'err')
  } finally {
    state.loading = false
    render()
  }
}

async function save() {
  const overrides = {}
  for (const k of dirtyKeys()) overrides[k] = state.draft[k]
  if (!Object.keys(overrides).length) return
  state.saving = true
  render()
  try {
    const r = await api('/api/plugins', { method: 'POST', body: { overrides } })
    state.data = { ...(state.data || {}), groups: r.groups }
    state.original = { ...state.original }
    for (const k of Object.keys(overrides)) state.original[k] = state.draft[k]
    const rej = (r.rejected || []).filter(x => x.reason)
    notice(rej.length
      ? `已应用 ${r.applied.length} 项，${rej.length} 项被拒：${rej.map(x => `${x.name}（${x.reason}）`).join('；')}`
      : `已应用 ${r.applied.length} 项配置，立即生效`, rej.length ? 'err' : 'ok')
  } catch (e) {
    notice('保存失败：' + e.message, 'err')
  } finally {
    state.saving = false
    render()
  }
}

function reset() {
  for (const k of Object.keys(state.original)) state.draft[k] = state.original[k]
  notice('')
  render()
}

export function initPluginPanel() {
  const r = $('#btn-plugins-refresh')
  if (r) r.addEventListener('click', () => refresh())
  const s = $('#btn-plugins-save')
  if (s) s.addEventListener('click', save)
  const rs = $('#btn-plugins-reset')
  if (rs) rs.addEventListener('click', reset)
}
