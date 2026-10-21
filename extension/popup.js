/**
 * 扩展弹窗：采集 → 本地筛选 → 服务端规范化预览 → 写入临时工作区。
 *
 * 刻意**不在扩展里直接入主库**：所有条目先落到 `staging/`，
 * 由后台面板逐条确认后再 promote。这样误点「同步」不会把几千条历史
 * 直接冲进 300 条的站点表。
 *
 * 分类规则以服务端返回为准，扩展只负责展示与覆盖；
 * 否则两套规则迟早会给出不同答案。
 */
const DEFAULT_CONFIG = {
  baseUrl: '',
  apiKey: '',
  days: 90,
  minVisits: 1,
  maxItems: 1000,
  blacklist: '',
}

const state = {
  config: { ...DEFAULT_CONFIG },
  groups: [],
  flat: [],
  batch: null,
  items: [],
  selected: new Set(),
  overrides: new Map(),
}

const $ = (sel) => document.querySelector(sel)
const MAX_RENDER = 400

/* ---------------- 基础 ---------------- */

async function loadConfig() {
  const { config } = await chrome.storage.local.get('config')
  state.config = { ...DEFAULT_CONFIG, ...(config || {}) }
}

function baseUrl() {
  return String(state.config.baseUrl || '').replace(/\/+$/, '')
}

function apiUrl(path) {
  return `${baseUrl()}${path}`
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(apiUrl(path), {
    method,
    headers: {
      Accept: 'application/json',
      'X-Nav-Key': state.config.apiKey || '',
      Authorization: `Bearer ${state.config.apiKey || ''}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

/** 与服务端 `normalizeUrl` 保持一致：去协议 / www / query / hash / 尾斜杠，保留路径 */
function normalizeUrl(raw) {
  let input = String(raw || '').trim()
  if (!input || /^(chrome|edge|about|file|javascript|data|blob):/i.test(input)) return ''
  if (!/^https?:\/\//i.test(input)) input = `https://${input}`
  try {
    const u = new URL(input)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    const path = u.pathname.replace(/\/+$/, '')
    return `${host}${path === '/' ? '' : path}`.toLowerCase()
  } catch {
    return ''
  }
}

function domainOf(raw) {
  try {
    const u = new URL(/^https?:\/\//i.test(String(raw)) ? String(raw) : `https://${raw}`)
    return u.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function setStatus(text, kind = '') {
  const el = $('#status')
  el.textContent = text || ''
  el.className = `status ${kind}`
}

/* ---------------- 分类下拉 ---------------- */

function fillCategorySelect(select, current, { emptyLabel } = {}) {
  select.innerHTML = ''
  if (emptyLabel !== undefined) {
    const opt = document.createElement('option')
    opt.value = ''
    opt.textContent = emptyLabel
    select.appendChild(opt)
  }
  for (const group of state.groups) {
    const og = document.createElement('optgroup')
    og.label = group.label
    for (const cat of group.categories || []) {
      const opt = document.createElement('option')
      opt.value = cat.id
      opt.textContent = `${cat.label}（${cat.id}）`
      og.appendChild(opt)
    }
    select.appendChild(og)
  }
  if (current) select.value = current
}

/* ---------------- 采集 ---------------- */

function walkBookmarks(nodes, out) {
  for (const node of nodes || []) {
    if (node.url) {
      out.push({ url: node.url, title: node.title || '', visitCount: 1, lastVisitTime: 0, source: 'bookmark' })
    }
    if (node.children) walkBookmarks(node.children, out)
  }
}

async function collect() {
  const sources = new Set()
  if ($('#src-history').checked) sources.add('history')
  if ($('#src-bookmarks').checked) sources.add('bookmarks')
  if ($('#src-tabs').checked) sources.add('tabs')

  const days = Number($('#days').value) || 0
  const since = days ? Date.now() - days * 86400000 : 0
  const minVisits = Math.max(1, Number($('#minVisits').value) || 1)
  const exclude = $('#exclude').value.split(/[,，\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
  const blacklist = String(state.config.blacklist || '')
    .split(/[\n,，]/).map(s => s.trim().toLowerCase()).filter(Boolean)
  const ownHost = baseUrl() ? domainOf(baseUrl()) : ''

  const raw = []
  if (sources.has('history')) {
    const rows = await chrome.history.search({ text: '', startTime: since, maxResults: 5000 })
    for (const row of rows) {
      if (!row.url) continue
      raw.push({
        url: row.url,
        title: row.title || '',
        visitCount: Math.max(1, row.visitCount || 1),
        lastVisitTime: row.lastVisitTime || 0,
        source: 'history',
      })
    }
  }
  if (sources.has('bookmarks')) {
    walkBookmarks(await chrome.bookmarks.getTree(), raw)
  }
  if (sources.has('tabs')) {
    const tabs = await chrome.tabs.query({})
    for (const tab of tabs) {
      if (!tab.url || !/^https?:/i.test(tab.url)) continue
      raw.push({ url: tab.url, title: tab.title || '', visitCount: 1, lastVisitTime: Date.now(), source: 'tab' })
    }
  }

  // 本地先筛一轮：上传的条目越少，后台确认越轻松
  const seen = new Map()
  const out = []
  for (const item of raw) {
    if (out.length >= state.config.maxItems) break
    const url = normalizeUrl(item.url)
    if (!url) continue
    if (ownHost && (url === ownHost || url.startsWith(`${ownHost}/`))) continue
    if (blacklist.some(b => url === b || url.endsWith(`.${b}`) || url.includes(b))) continue
    if (exclude.some(k => String(item.title || '').toLowerCase().includes(k) || url.includes(k))) continue
    if ((item.visitCount || 1) < minVisits) continue

    const prev = seen.get(url)
    if (prev) {
      prev.visitCount += item.visitCount || 1
      if (String(item.title || '').length > String(prev.title || '').length) prev.title = item.title
      continue
    }
    seen.set(url, item)
    out.push(item)
  }
  return out
}

/* ---------------- 渲染 ---------------- */

function renderSummary() {
  const b = state.batch
  if (!b) { $('#summary').hidden = true; return }
  $('#summary').hidden = false
  const stats = [
    ['采集', b.stats.incoming],
    ['去重后', b.stats.deduped],
    ['新增', b.stats.newSites],
    ['主库已有', b.stats.duplicates],
    ['非法', b.stats.invalid],
  ]
  $('#summary').innerHTML = stats
    .map(([label, value]) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`)
    .join('')
}

function renderList() {
  const list = $('#list')
  list.hidden = !state.items.length
  list.innerHTML = ''
  if (!state.items.length) return

  // 新增优先，其次主库已有
  const ordered = [...state.items].sort((a, b) => Number(Boolean(a.duplicateOf)) - Number(Boolean(b.duplicateOf)))
  for (const item of ordered.slice(0, MAX_RENDER)) {
    const row = document.createElement('div')
    row.className = `item${item.duplicateOf ? ' dup' : ''}`

    const check = document.createElement('input')
    check.type = 'checkbox'
    check.dataset.key = item.key
    check.checked = state.selected.has(item.key)

    const main = document.createElement('span')
    main.className = 'main'
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = item.site?.name || item.title || item.url
    name.title = item.site?.name || item.title || item.url
    const meta = document.createElement('span')
    meta.className = 'meta'
    meta.textContent = `${item.url} · 访问 ${item.visitCount || 0} 次`
    main.append(name, meta)

    const select = document.createElement('select')
    select.dataset.cat = item.key
    fillCategorySelect(select, state.overrides.get(item.key) || item.site?.categoryId || '')

    row.append(check, main, select)
    if (item.duplicateOf) {
      const tag = document.createElement('span')
      tag.className = 'tag dup'
      tag.textContent = '主库已有'
      row.append(tag)
    }
    list.append(row)
  }

  if (ordered.length > MAX_RENDER) {
    const more = document.createElement('div')
    more.className = 'hint'
    more.style.padding = '6px 8px'
    more.textContent = `仅显示前 ${MAX_RENDER} 条（共 ${ordered.length} 条），保存时仍会包含全部选中项。`
    list.append(more)
  }
  updateSelectedCount()
}

function updateSelectedCount() {
  $('#selectedCount').textContent = `已选 ${state.selected.size} / ${state.items.length}`
  $('#save').disabled = !state.selected.size
}

/* ---------------- 扫描 ---------------- */

async function scan() {
  const scanBtn = $('#scan')
  scanBtn.disabled = true
  $('#openAdmin').hidden = true
  try {
    if (!baseUrl() || !state.config.apiKey) {
      throw new Error('先在「设置」里填写站点地址和管理密钥')
    }
    setStatus('正在采集浏览器数据…')
    const raw = await collect()
    if (!raw.length) {
      setStatus('没有符合筛选条件的条目', 'error')
      state.items = []
      state.batch = null
      renderSummary(); renderList()
      return
    }
    setStatus(`采集 ${raw.length} 条，正在生成预览…`)
    const data = await api('/api/ingest?action=preview', { method: 'POST', body: { items: raw } })
    state.batch = data.batch
    state.items = data.batch.items || []
    state.overrides.clear()
    // 默认只勾新增；主库已有默认不勾，避免误覆盖
    state.selected = new Set(state.items.filter(i => !i.duplicateOf).map(i => i.key))
    renderSummary()
    renderList()
    $('#toolbar').hidden = false
    setStatus(`预览完成：${state.items.length} 条可处理。确认后保存到临时工作区。`)
  } catch (e) {
    setStatus(String(e?.message || e), 'error')
  } finally {
    scanBtn.disabled = false
  }
}

/* ---------------- 保存 ---------------- */

async function save() {
  const chosen = state.items.filter(i => state.selected.has(i.key))
  if (!chosen.length) { setStatus('没有选中任何条目', 'error'); return }
  const btn = $('#save')
  btn.disabled = true
  try {
    const items = chosen.map(i => ({
      url: i.url,
      title: i.title,
      visitCount: i.visitCount,
      lastVisitTime: i.lastVisitTime,
      source: i.source,
    }))
    const categoryOverrides = {}
    for (const item of chosen) {
      const over = state.overrides.get(item.key)
      if (over) categoryOverrides[item.url] = over
    }
    const data = await api('/api/ingest', {
      method: 'POST',
      body: { items, categoryOverrides, client: 'browser-extension/0.1.0' },
    })
    const batchId = data.batch?.id || ''
    setStatus(`已保存到临时工作区：${batchId}（${chosen.length} 条，未进主库）`, 'ok')
    const link = $('#openAdmin')
    link.href = `${baseUrl()}/?tab=data-ingest&batch=${encodeURIComponent(batchId)}`
    link.hidden = false
  } catch (e) {
    setStatus(String(e?.message || e), 'error')
    btn.disabled = false
  }
}

/* ---------------- 连接状态 ---------------- */

async function checkConnection() {
  const pill = $('#conn')
  if (!baseUrl() || !state.config.apiKey) {
    pill.textContent = '未配置'
    pill.className = 'pill bad'
    return false
  }
  try {
    const data = await api('/api/ingest?categories=1')
    state.groups = data.groups || []
    state.flat = data.flat || []
    pill.textContent = '已连接'
    pill.className = 'pill ok'
    fillCategorySelect($('#bulkCategory'), '', { emptyLabel: '批量设置分类…' })
    return true
  } catch (e) {
    pill.textContent = '连接失败'
    pill.className = 'pill bad'
    setStatus(`连接失败：${String(e?.message || e)}`, 'error')
    return false
  }
}

/* ---------------- 事件 ---------------- */

function bind() {
  $('#openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage())
  $('#scan').addEventListener('click', scan)
  $('#save').addEventListener('click', save)

  $('#selectAll').addEventListener('change', (e) => {
    if (e.target.checked) state.items.forEach(i => state.selected.add(i.key))
    else state.selected.clear()
    renderList()
  })

  $('#applyBulk').addEventListener('click', () => {
    const cat = $('#bulkCategory').value
    if (!cat) { setStatus('先选择要应用的分类', 'error'); return }
    for (const item of state.items) {
      if (!state.selected.has(item.key)) continue
      state.overrides.set(item.key, cat)
      if (item.site) item.site.categoryId = cat
    }
    renderList()
    setStatus(`已把 ${state.selected.size} 条设为分类 ${cat}（保存时生效）`, 'ok')
  })

  $('#list').addEventListener('change', (e) => {
    const key = e.target.dataset.key
    if (key) {
      if (e.target.checked) state.selected.add(key)
      else state.selected.delete(key)
      updateSelectedCount()
      return
    }
    const catKey = e.target.dataset.cat
    if (catKey && e.target.value) {
      state.overrides.set(catKey, e.target.value)
      // 改分类意味着「这条我要」，自动勾选
      state.selected.add(catKey)
      const row = e.target.closest('.item')
      const check = row?.querySelector('input[type="checkbox"]')
      if (check) check.checked = true
      updateSelectedCount()
    }
  })
}

async function init() {
  await loadConfig()
  $('#days').value = String(state.config.days ?? 90)
  $('#minVisits').value = String(state.config.minVisits ?? 1)
  bind()
  const ok = await checkConnection()
  if (!ok) {
    setStatus('先点右上角「设置」填写站点地址与管理密钥。')
    $('#scan').disabled = false
  }
}

init()