/**
 * 开发流水线面板：一条命令跑完「测试门禁 → 提交 → 推送 → 构建 → 产物门禁 → 打包 → 上传 → 重启 → 线上验证」。
 *
 * 与「发布」「插件」面板的分工：
 *   · 「发布」只做代码上线那一段（构建之后）；
 *   · 「插件」管引擎配置；
 *   · 这里管**整条闭环** —— 从测试到线上验证，一步不落。
 *
 * 编排逻辑全在 lib/release.mjs（与 `nav release` 同源），这里只做预检回显、选项与时间线。
 */
import { $, api, openStream } from './core.js'

const state = { plan: null, steps: [], loading: false, running: false }

function el(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

const STATUS_LABEL = { pending: '待执行', running: '进行中', ok: '完成', skipped: '已跳过', failed: '失败' }

/* ---------- 渲染 ---------- */

function renderSummary() {
  const box = $('#release-summary')
  box.innerHTML = ''
  const p = state.plan
  if (!p) { box.append(el('span', 'dim', state.loading ? '预检中…' : '预检失败')); return }
  const f = p.facts || {}
  box.append(el('span', 'chip', f.branch || '(detached)'))
  box.append(el('span', 'dim', `${f.dirty} 处改动（已暂存 ${f.staged}）· 领先 origin ${f.ahead} 个提交`))
  if (p.blockers?.length) box.append(el('span', 'chip warn', `${p.blockers.length} 项阻塞`))
  else box.append(el('span', 'chip ok', '可以执行'))
}

function renderSteps() {
  const box = $('#release-steps')
  box.innerHTML = ''
  state.steps.forEach((s, i) => {
    const row = el('div', `rel-step ${s.status}`)
    row.append(el('span', 'rel-dot'))
    row.append(el('span', 'rel-idx', String(i + 1).padStart(2, '0')))
    row.append(el('span', 'rel-label', s.label))
    row.append(el('span', 'rel-role', s.role || ''))
    const right = el('span', 'rel-status', STATUS_LABEL[s.status] || s.status)
    if (s.note) right.append(el('span', 'rel-note', ` · ${s.note}`))
    row.append(right)
    box.append(row)
  })
  const done = state.steps.filter(s => s.status === 'ok' || s.status === 'skipped').length
  $('#release-progress').textContent = state.steps.length ? `${done} / ${state.steps.length}` : ''
}

function renderBlockers() {
  const box = $('#release-blockers')
  box.innerHTML = ''
  const b = state.plan?.blockers || []
  if (!b.length) return
  box.append(el('div', 'rel-block-title', `预检发现 ${b.length} 项阻塞`))
  for (const x of b) box.append(el('div', 'rel-block', '✗ ' + x))
}

function setBusy(busy) {
  state.running = busy
  $('#btn-release-run').disabled = busy
  $('#btn-release-run').textContent = busy ? '流水线执行中…' : '开始流水线'
  $('#btn-release-preflight').disabled = busy
  for (const id of ['#release-message', '#release-skip-test', '#release-no-push', '#release-skip-build']) {
    const n = $(id)
    if (n) n.disabled = busy
  }
}

/* ---------- 取数与启动 ---------- */

function optsFromForm() {
  return {
    message: $('#release-message').value.trim(),
    skipTest: $('#release-skip-test').checked,
    noPush: $('#release-no-push').checked,
    skipBuild: $('#release-skip-build').checked,
  }
}

export async function refresh() {
  state.loading = true
  renderSummary()
  try {
    const d = await api('/api/release')
    state.plan = d
    state.steps = d.steps || []
    // 上次跑过就回显它的最终状态（比空白时间线有用）
    if (d.last?.steps?.length && d.last.status !== 'running') {
      state.steps = d.last.steps.map(s => ({ ...s, role: (d.steps.find(x => x.key === s.key) || {}).role || '' }))
    }
    renderSteps()
    renderBlockers()
  } catch (e) {
    state.plan = null
    state.steps = []
    renderSummary()
    renderSteps()
  } finally {
    state.loading = false
    renderSummary()
  }
}

async function run() {
  const opts = optsFromForm()
  const bits = [
    opts.skipTest ? '⚠ 跳过测试门禁' : '测试门禁（约 1–2 分钟）',
    opts.noPush ? '⚠ 不推送远端' : '提交并推送',
    opts.skipBuild ? '⚠ 复用现有 dist' : '重新构建',
    '打包上传到自有服务器并做线上验证',
  ]
  if (!confirm(`跑完整开发流水线？\n\n· ${bits.join('\n· ')}\n\n过程需要几分钟，日志在下方实时输出。`)) return

  setBusy(true)
  try {
    const { jobId } = await api('/api/release', { method: 'POST', body: opts })
    openStream(jobId, '开发流水线', () => { setBusy(false); refresh() }, {
      steps: (payload) => { state.steps = payload; renderSteps() },
      step: (payload) => {
        const i = state.steps.findIndex(s => s.key === payload.key)
        if (i >= 0) state.steps[i] = { ...state.steps[i], ...payload }
        renderSteps()
      },
    })
  } catch (e) {
    setBusy(false)
    const box = $('#release-blockers')
    box.innerHTML = ''
    box.append(el('div', 'rel-block-title', '启动失败'))
    box.append(el('div', 'rel-block', '✗ ' + e.message))
  }
}

export function initPipelinePanel() {
  const r = $('#btn-release-preflight')
  if (r) r.addEventListener('click', () => refresh())
  const go = $('#btn-release-run')
  if (go) go.addEventListener('click', run)
}
