/**
 * 发布面板：把构建产物发到自有服务器（BotKeep），并给出「本地源码 / 上次构建 / 线上」
 * 三者的版本对照。
 *
 * 它与「同步」面板的分工：同步管的是**站点数据**进云端 Blob（不用重新部署）；
 * 这里管的是**代码**进服务器（要重新构建、打包、重启进程）。两者互不替代 ——
 * 只改数据不必部署，只改代码部署了也带不走数据。
 *
 * ## 部署端点（N2）
 *
 * 面板可以一次发到多个端点（主站 + 镜像站等）。端点**清单**由服务端从
 * `NAV_DEPLOY_ENDPOINTS` 读出来（`GET /api/deploy/endpoints`），前端只是勾选框 ——
 * 凭据永远不进浏览器，前端拿到的只有 `hasCredentials` 这个布尔。
 * 默认**一个都不勾**：不勾任何端点 = 只发主站默认端点，与单端点时代行为一致。
 * 勾了就发到勾中的那几个，且**逐个端点回报成功/失败**（一个挂了不影响其余）。
 */
import { $, api, renderKv, openStream } from './core.js'

const state = { data: null, loading: false }

/** 端点清单（只读）。选中状态记在 DOM 的 checkbox 上，避免与渲染顺序耦合 */
const epState = { list: [] }

function el(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

function fmtClock(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function ago(iso) {
  if (!iso) return ''
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const m = Math.round(ms / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.round(h / 24)} 天前`
}

/* ---------- 渲染 ---------- */

function renderSummary() {
  const box = $('#deploy-summary')
  box.innerHTML = ''
  const d = state.data
  if (!d) { box.append(el('span', 'dim', state.loading ? '读取中…' : '读取失败')); return }

  const remote = d.remote
  if (!remote?.available) {
    box.append(el('span', 'chip warn', `线上不可达（${remote?.error || '未知'}）`))
    box.append(el('span', 'dim', remote?.url || ''))
    return
  }
  const rSha = remote.version?.sha || ''
  const sSha = d.source?.sha || ''
  const sameAsSource = rSha && sSha && rSha.slice(0, 7) === sSha.slice(0, 7)
  box.append(el('span', `chip ${sameAsSource ? 'ok' : 'warn'}`,
    `${sameAsSource ? '线上已是最新' : '线上与本地不一致'} · 线上 ${String(rSha).slice(0, 7) || '未知'}`))
  box.append(el('span', 'dim', `${remote.url} · ${remote.runtime?.node ? 'node ' + remote.runtime.node : ''}`))
}

function renderVersions() {
  const d = state.data
  if (!d) return
  const s = d.source || {}
  const b = d.build || {}
  const r = d.remote?.version || {}
  renderKv($('#deploy-versions'), [
    ['本地源码', `${s.shortSha || '—'}${s.dirty ? '（有未提交改动）' : ''} · ${s.branch || ''}`],
    ['上次构建', b.available ? `${b.shortSha || '—'}${b.dirty ? '（含未提交改动）' : ''} · ${ago(b.builtAt)}` : '没有构建产物'],
    ['线上运行', d.remote?.available ? `${String(r.shortSha || '—')}${r.dirty ? '（含未提交改动）' : ''} · 构建于 ${fmtClock(r.builtAt)}` : '不可达'],
  ])

  const notes = []
  if (d.drift?.sourceAheadOfBuild) notes.push('本地改动还没构建进产物 —— 发布时会自动重新构建。')
  if (d.drift?.buildAheadOfRemote) notes.push('已构建但线上还没更新 —— 直接点「开始发布」即可（可勾「跳过构建」）。')
  if (!notes.length && d.remote?.available) notes.push('三者一致。')
  $('#deploy-drift').textContent = notes.join(' ')
}

function renderCreds() {
  const d = state.data
  if (!d) return
  const c = d.credentials || {}
  renderKv($('#deploy-creds'), [
    ['API key', c.hasKey ? `已配置（末四位 ${c.keyTail}）` : ['未配置', 'no']],
    ['Workload', c.workloadId || ['未配置', 'no']],
    ['.env.local', c.envFileExists ? ['存在', 'yes'] : ['不存在', 'no']],
  ])
  const w = $('#deploy-wid')
  if (w && !w.value && c.workloadId) w.value = c.workloadId
}

function renderFlow() {
  const d = state.data
  if (!d) return
  const dist = d.dist || {}
  $('#deploy-flow').textContent =
    `当前 dist/ 共 ${dist.files || 0} 个文件、${(((dist.bytes || 0) / 1048576).toFixed(1))} MiB，`
    + `切片后逐片上传。整个过程实时输出在下方日志区。`
}

function renderHistory() {
  const box = $('#deploy-history')
  const list = state.data?.history || []
  box.innerHTML = ''
  if (!list.length) { box.append(el('div', 'dim', '还没有发布记录。')); return }
  for (const h of list) {
    const row = el('div', 'result-row')
    row.append(el('span', `chip ${h.ok ? 'ok' : 'fail'}`, h.ok ? '成功' : '失败'))
    row.append(el('span', 'mono', h.shortSha || '—'))
    row.append(el('span', 'dim', `${fmtClock(h.at)} · ${h.seconds || 0}s${h.online ? ` · 上线 ${h.online}` : ''}`))
    row.append(el('span', 'grow', h.error || h.subject || ''))
    box.append(row)
  }
}

/* ---------- 部署端点（N2）---------- */

/** 读端点清单（不含凭据，只有 id/label/url/hasCredentials）。读不到就退化成「只发默认端点」 */
async function loadEndpoints() {
  try {
    const r = await api('/api/deploy/endpoints')
    epState.list = Array.isArray(r?.endpoints) ? r.endpoints : []
  } catch {
    epState.list = []
  }
}

/** 当前勾中的端点 id。**一个都没勾**是合法状态，代表「只发默认端点」 */
function selectedEndpointIds() {
  return [...document.querySelectorAll('#deploy-endpoints input[type="checkbox"]:checked')]
    .map(cb => cb.dataset.endpointId)
}

function renderEndpoints() {
  const box = $('#deploy-endpoints')
  if (!box) return
  box.innerHTML = ''
  if (!epState.list.length) {
    box.append(el('span', 'dim', '读不到端点清单 —— 只会发布默认端点。'))
    renderEndpointSummary()
    return
  }
  const chosen = new Set(selectedEndpointIds()) // 重渲染时保留已勾选（refresh 会重画）
  for (const e of epState.list) {
    const label = el('label', 'hint')
    label.style.cssText = 'display:flex;align-items:center;gap:6px;white-space:nowrap'
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.dataset.endpointId = e.id
    cb.checked = chosen.has(e.id)
    cb.addEventListener('change', renderEndpointSummary)
    label.append(cb, document.createTextNode(`${e.label || e.id}${e.hasCredentials ? '' : '（未配凭据）'}`))
    box.append(label)
  }
  renderEndpointSummary()
}

/** 一句话说清「将部署到哪」—— 确认弹窗与提示行同源，不各写一套判断 */
function renderEndpointSummary() {
  const hint = $('#deploy-endpoints-hint')
  if (!hint) return
  const ids = selectedEndpointIds()
  hint.textContent = ids.length
    ? `将部署到 ${ids.length} 个端点：${ids.join('、')}`
    : '未选择任何端点 —— 只发布到主站默认端点。'
}

/* ---------- 数据 ---------- */

export async function refresh() {
  state.loading = true
  try {
    const url = $('#deploy-site-url')?.value?.trim() || ''
    state.data = await api(`/api/deploy/status${url ? `?url=${encodeURIComponent(url)}` : ''}`)
  } catch (e) {
    state.data = null
    $('#deploy-drift').textContent = `读取失败：${e.message}`
  }
  state.loading = false
  renderSummary()
  renderVersions()
  renderCreds()
  renderFlow()
  renderHistory()
  await loadEndpoints()
  renderEndpoints()
}

/* ---------- 交互 ---------- */

export function initDeployPanel() {
  $('#btn-deploy-refresh').addEventListener('click', refresh)

  $('#btn-deploy-save-creds').addEventListener('click', async () => {
    const key = $('#deploy-key').value.trim()
    const workloadId = $('#deploy-wid').value.trim()
    if (!key && !workloadId) return
    try {
      await api('/api/deploy/credentials', { method: 'POST', body: { key: key || undefined, workloadId: workloadId || undefined } })
      $('#deploy-key').value = ''
      await refresh()
    } catch (e) {
      alert(`保存失败：${e.message}`)
    }
  })

  $('#btn-deploy-publish').addEventListener('click', async () => {
    const skipBuild = $('#deploy-skip-build').checked
    const ids = selectedEndpointIds()
    // 二次确认里点名**要发到哪几个端点** —— 多端点是不可逆动作，不能只问「确定吗」
    const target = ids.length ? `${ids.length} 个端点：${ids.join('、')}` : '默认端点（主站）'
    const buildNote = skipBuild ? '跳过构建，直接用现有 dist/' : '先重新构建产物，再打包上传'
    if (!confirm(`开始发布到服务器？\n\n目标：${target}\n${buildNote}。\n过程需要几分钟，可在日志区看到每一步（逐个端点回报成功/失败）。`)) return
    try {
      const { jobId } = await api('/api/deploy/publish', { method: 'POST', body: { skipBuild, endpoints: ids } })
      openStream(jobId, '发布到服务器', () => refresh())
      refresh()
    } catch (e) {
      alert(`启动失败：${e.message}`)
    }
  })
}
