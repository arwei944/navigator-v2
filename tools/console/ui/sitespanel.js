/** 站点面板：站点增删改 + 元信息抓取 + 图标下载 + 云端数据实时同步 */
import { $, api, openStream, appendLocal, isBusy } from './core.js'

const STATUS_LABEL = { pending: '待执行', running: '进行中', success: '完成', failed: '失败', skipped: '跳过' }

const state = {
  sites: [], categories: [], total: 0, matched: 0,
  q: '', category: '', editing: null, faviconUrl: '',
  steps: [], cloud: null, loading: false,
}

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

function setResult(sel, cls, text) {
  const box = $(sel)
  box.className = `result${cls ? ' ' + cls : ''}`
  box.textContent = text
}

/* ---------- 概览 ---------- */

function renderSummary() {
  const box = $('#sites-summary')
  box.innerHTML = ''
  box.append(el('span', 'chip', `本地 ${state.total}`))

  const c = state.cloud
  if (!c) box.append(el('span', 'chip', '云端读取中…'))
  else if (!c.ok) box.append(el('span', 'chip err', '云端读取失败'))
  else box.append(el('span', `chip ${c.count === state.total ? 'ok' : 'warn'}`, `云端 ${c.count}`))

  box.append(el('span', 'chip', `显示 ${state.matched}`))
  if (c?.ok && c.count !== state.total) {
    box.append(el('span', 'chip warn', '存在未同步改动 · 点下方「同步到云端」'))
  }
}

/* ---------- 分类下拉 ---------- */

function renderCategoryOptions() {
  const sel = $('#f-category')
  sel.innerHTML = ''
  for (const g of state.categories) {
    const og = document.createElement('optgroup')
    og.label = g.label
    for (const c of g.categories) {
      const o = document.createElement('option')
      o.value = c.id
      o.textContent = `${c.label}（${c.id}）`
      og.append(o)
    }
    sel.append(og)
  }

  const filter = $('#sites-filter')
  filter.innerHTML = ''
  const all = document.createElement('option')
  all.value = ''
  all.textContent = '全部分类'
  filter.append(all)
  for (const g of state.categories) {
    for (const c of g.categories) {
      const o = document.createElement('option')
      o.value = c.id
      o.textContent = c.label
      filter.append(o)
    }
  }
}

/* ---------- 站点列表 ---------- */

function renderIcon(site) {
  const box = el('div', 'site-ico')
  box.style.background = site.color || '#64748b'
  box.title = site.icon || '未抓取图标（可用「抓图标」补）'
  const fallback = () => box.append(el('span', 'site-ico-fallback', site.initial || (site.name || '?').charAt(0)))
  if (site.icon) {
    const img = el('img')
    img.src = '/' + site.icon
    img.alt = ''
    img.loading = 'lazy'
    img.addEventListener('error', () => { img.remove(); fallback() })
    box.append(img)
  } else {
    fallback()
  }
  return box
}

function renderRow(site) {
  const row = el('div', 'site-row')
  row.append(renderIcon(site))

  const main = el('div', 'site-main')
  main.append(el('div', 'site-name', site.name))
  main.append(el('div', 'site-sub', `${site.id} · ${site.url} · 排序 ${site.sortOrder}`))
  row.append(main)

  const tags = el('div', 'site-tags')
  const dot = el('span', 'dist-dot')
  dot.style.background = site.categoryColor
  tags.append(dot, el('span', 'dim', site.categoryLabel))
  if (!site.known) tags.append(el('span', 'chip err', '未登记分类'))
  if (!site.icon) tags.append(el('span', 'chip warn', '无图标'))
  row.append(tags)

  const ops = el('div', 'site-ops')
  const edit = el('button', 'btn small ghost', '编辑')
  edit.addEventListener('click', () => openForm(site))
  const icon = el('button', 'btn small ghost', '抓图标')
  icon.addEventListener('click', () => fetchIcon(site))
  const del = el('button', 'btn small ghost', '删除')
  del.addEventListener('click', () => removeSite(site))
  ops.append(edit, icon, del)
  row.append(ops)
  return row
}

function renderList() {
  const box = $('#site-list')
  box.innerHTML = ''
  $('#sites-count').textContent = `· 匹配 ${state.matched} / 共 ${state.total}`
  if (!state.sites.length) { box.append(el('div', 'dim', '没有匹配的站点。')); return }
  for (const s of state.sites) box.append(renderRow(s))
}

/* ---------- 表单 ---------- */

function renderIconPreview(src) {
  const box = $('#icon-preview')
  box.innerHTML = ''
  if (!src) return
  const img = el('img')
  img.src = /^(https?:|data:)/.test(src) ? src : '/' + src
  img.alt = ''
  img.addEventListener('error', () => img.remove())
  box.append(img, el('span', '', '图标预览（新增站点保存后会自动抓取写入本地）'))
}

function openForm(site) {
  state.editing = site || null
  state.faviconUrl = ''
  $('#sites-form-title').textContent = site ? `编辑站点 ${site.id}` : '新增站点'
  $('#f-url').value = site ? site.url : ''
  $('#f-name').value = site ? site.name : ''
  $('#f-desc').value = site ? site.desc || '' : ''
  $('#f-category').value = site ? site.categoryId : ($('#f-category').value || '')
  $('#f-color').value = site?.color || '#3b82f6'
  setResult('#site-form-result', '', '')
  renderIconPreview(site?.icon || '')
  $('#sites-form-card').hidden = false
  $('#f-url').focus()
}

function closeForm() {
  state.editing = null
  state.faviconUrl = ''
  $('#sites-form-card').hidden = true
}

async function doFetchMeta() {
  const raw = $('#f-url').value.trim()
  if (!raw) { setResult('#site-form-result', 'err', '请先填写站点地址'); return }
  const btn = $('#btn-fetch-meta')
  btn.disabled = true
  setResult('#site-form-result', '', '抓取中…（超时 15s）')
  try {
    const m = await api('/api/sites/meta?url=' + encodeURIComponent(raw))
    if (m.name) $('#f-name').value = m.name
    if (m.desc) $('#f-desc').value = m.desc
    if (m.categoryId) $('#f-category').value = m.categoryId
    state.faviconUrl = m.faviconUrl || ''
    renderIconPreview(state.faviconUrl)
    setResult('#site-form-result', 'ok', `已抓取 ${m.domain}${m.categoryId ? ` · 分类建议 ${m.categoryId}` : ''}`)
  } catch (e) {
    setResult('#site-form-result', 'err', `抓取失败：${e.message}（可手动填写后保存）`)
  } finally {
    btn.disabled = false
  }
}

async function saveSite() {
  const payload = {
    url: $('#f-url').value.trim(),
    name: $('#f-name').value.trim(),
    desc: $('#f-desc').value.trim(),
    categoryId: $('#f-category').value,
    color: $('#f-color').value,
  }
  const btn = $('#btn-save-site')
  btn.disabled = true
  setResult('#site-form-result', '', '保存中…')
  try {
    if (state.editing) {
      const { site } = await api('/api/sites/update', {
        method: 'POST', body: { id: state.editing.id, patch: payload },
      })
      setResult('#site-form-result', 'ok', `已更新 ${site.id} ${site.name}`)
      appendLocal(`站点已更新：${site.id} ${site.name}`, 'success')
      await refresh()
    } else {
      const faviconUrl = state.faviconUrl
      const { site } = await api('/api/sites/add', { method: 'POST', body: payload })
      appendLocal(`站点已保存到本地：${site.id} ${site.name}`, 'success')
      await refresh()
      closeForm()
      setResult('#sites-sync-result', '', `本地已新增 ${site.id} ${site.name} · 点「同步到云端」即时生效`)
      if (faviconUrl) fetchIcon(site, faviconUrl)
    }
  } catch (e) {
    setResult('#site-form-result', 'err', e.message)
  } finally {
    btn.disabled = false
  }
}

/* ---------- 行内操作 ---------- */

async function fetchIcon(site, faviconUrl) {
  if (isBusy()) { appendLocal('已有任务在运行，图标抓取已跳过（可稍后点「抓图标」）', 'stderr'); return }
  try {
    const { jobId } = await api('/api/sites/icon', {
      method: 'POST', body: { id: site.id, faviconUrl: faviconUrl || '' },
    })
    openStream(jobId, `抓取图标 ${site.id}`, async d => {
      if (d.status === 'success') {
        appendLocal(`图标已写入本地：${site.id}`, 'success')
        await refresh()
      }
    })
  } catch (e) {
    appendLocal(`图标抓取失败：${e.message}`, 'stderr')
  }
}

async function removeSite(site) {
  const ok = confirm(`确认从本地数据中删除「${site.name}」（${site.id}）？\n\n图标文件会保留，改动可通过 git 恢复。删除后需点「同步到云端」才会在线上生效。`)
  if (!ok) return
  try {
    await api('/api/sites/remove', { method: 'POST', body: { id: site.id } })
    appendLocal(`已删除 ${site.id} ${site.name}（本地）`, 'warn')
    await refresh()
    setResult('#sites-sync-result', '', `本地已删除 ${site.id} · 点「同步到云端」即时生效`)
  } catch (e) {
    appendLocal(`删除失败：${e.message}`, 'stderr')
  }
}

/* ---------- 同步时间线 ---------- */

function renderTimeline() {
  const ol = $('#sites-timeline')
  ol.innerHTML = ''
  if (state.steps.length === 0) {
    ol.append(el('li', 'tl-empty', '尚未同步。新增或修改站点后点「同步到云端」。'))
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

async function doSync() {
  if (isBusy()) { setResult('#sites-sync-result', 'err', '已有任务在运行，请等待完成或终止后再试。'); return }
  const commit = $('#sites-sync-commit').checked
  const message = $('#sites-sync-message').value.trim()

  $('#btn-sites-sync').disabled = true
  state.steps = []
  renderTimeline()
  setResult('#sites-sync-result', '', commit ? '同步中（含提交与推送）…' : '同步中（仅云端热更新）…')
  try {
    const { jobId } = await api('/api/sites/sync', {
      method: 'POST', body: { commit, push: commit, message },
    })
    openStream(jobId, '站点数据同步', async d => {
      setResult('#sites-sync-result', d.status === 'success' ? 'ok' : 'err',
        d.status === 'success'
          ? `已同步到云端（${(d.duration / 1000).toFixed(1)}s）`
          : `同步失败，退出码 ${d.code}（详见下方实时日志）`)
      $('#btn-sites-sync').disabled = false
      await refresh()
    }, {
      steps: list => { state.steps = list; renderTimeline() },
      step: applyStep,
    })
  } catch (e) {
    setResult('#sites-sync-result', 'err', e.message)
    $('#btn-sites-sync').disabled = false
  }
}

/* ---------- 交互 ---------- */

export async function refresh() {
  if (state.loading) return
  state.loading = true
  try {
    const [list, st] = await Promise.all([
      api(`/api/sites/list?q=${encodeURIComponent(state.q)}&category=${encodeURIComponent(state.category)}`),
      api('/api/sync/status').catch(() => null),
    ])
    state.sites = list.sites
    state.total = list.total
    state.matched = list.matched
    state.cloud = st?.cloud || null
    if (list.categories.length) state.categories = list.categories
    if (!$('#f-category').options.length) renderCategoryOptions()
  } catch (e) {
    appendLocal(`读取站点列表失败：${e.message}`, 'stderr')
  } finally {
    state.loading = false
  }
  renderSummary()
  renderList()
}

let searchTimer = null

export function initSitesPanel() {
  $('#btn-sites-refresh').addEventListener('click', () => refresh())
  $('#btn-sites-new').addEventListener('click', () => openForm(null))
  $('#btn-cancel-site').addEventListener('click', () => closeForm())
  $('#btn-fetch-meta').addEventListener('click', () => doFetchMeta())
  $('#btn-save-site').addEventListener('click', () => saveSite())
  $('#btn-sites-sync').addEventListener('click', () => doSync())

  $('#sites-search').addEventListener('input', e => {
    state.q = e.target.value
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => refresh(), 250)
  })
  $('#sites-filter').addEventListener('change', e => {
    state.category = e.target.value
    refresh()
  })

  renderTimeline()
  if ($('#panel-sites')?.classList.contains('active')) refresh()
}