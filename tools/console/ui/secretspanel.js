/**
 * 控制台的「密钥」面板：各平台凭据的统一管理面。
 *
 * 解决什么：凭据此前散在 `.env.local`、`data/admin-key.txt`、平台环境变量三处，
 * 想知道「哪个平台的 key 该换了 / 这把还有效吗」只能靠翻文件和猜。
 *
 * 安全口径：
 *   · 服务端只回掩码（后 4 位），本面板**永远拿不到完整值**；
 *   · 输入框是写入口，不回填已有值 —— 想改就重新粘一把，避免「打开面板就泄露」；
 *   · 验证是主动问平台，只读调用，不改变远端状态。
 */
import { $, api } from './core.js'

const state = { data: null, draft: {}, verifying: false, saving: false }

function el(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

function notice(text, kind = '') {
  const box = $('#secrets-notice')
  if (!box) return
  box.textContent = text
  box.className = `notice ${kind}`
  box.hidden = !text
}

/* ---------- 单项渲染 ---------- */

function renderItem(s) {
  const row = el('div', 'secret-row')
  row.dataset.key = s.key

  const head = el('div', 'secret-head')
  const name = el('div', 'secret-name')
  name.append(el('code', '', s.key))
  name.append(el('span', 'secret-label', ` ${s.label}`))
  if (s.required) name.append(el('span', 'badge badge-req', '必需'))
  head.append(name)

  // 状态徽标：已配置 / 未配置 / 形态异常 —— 三者颜色不同，一眼能扫。
  // 单独的 `secret-state` 类不是冗余：同一行里还有「必需」徽标，
  // 没有它就无法从 DOM 上区分「这行的状态」和「这行的属性」（实测踩过）。
  const badge = el('span', `badge secret-state ${s.configured ? (s.shapeOk ? 'ok' : 'warn') : (s.required ? 'bad' : 'muted')}`)
  badge.textContent = s.configured ? (s.shapeOk ? `已配置 ${s.masked}` : '形态异常') : (s.required ? '缺失（必需）' : '未配置')
  head.append(badge)
  row.append(head)

  // 影响范围：用户最需要知道「不配会怎样」
  row.append(el('div', 'secret-scope', s.scope))

  const meta = el('div', 'secret-meta')
  meta.append(el('span', '', `取值：${s.where}`))
  if (s.aliases.length) meta.append(el('span', '', `别名：${s.aliases.join(' / ')}`))
  if (s.viaAlias) meta.append(el('span', 'warn', `实际从别名 ${s.viaAlias} 读到`))
  if (s.rotate) meta.append(el('span', '', '建议定期轮换'))
  row.append(meta)

  // 形态问题要显式列出，而不是只说「异常」
  if (s.configured && !s.shapeOk) {
    const probs = el('ul', 'secret-problems')
    for (const p of s.shapeProblems) probs.append(el('li', '', p))
    row.append(probs)
  }

  const actions = el('div', 'secret-actions')
  const input = el('input')
  input.type = 'password'
  input.className = 'secret-input'
  input.placeholder = s.configured ? '粘贴新值以覆盖（留空则不改）' : '粘贴密钥'
  input.autocomplete = 'off'
  input.addEventListener('input', () => { state.draft[s.key] = input.value })
  actions.append(input)

  const saveBtn = el('button', 'btn', '保存')
  saveBtn.addEventListener('click', () => saveOne(s.key, input))
  actions.append(saveBtn)

  if (s.configured) {
    const verifyBtn = el('button', 'btn ghost', '验证')
    verifyBtn.addEventListener('click', () => verifyOne(s.key, verifyBtn))
    actions.append(verifyBtn)

    const clearBtn = el('button', 'btn danger', '清除')
    clearBtn.addEventListener('click', () => {
      // 破坏性操作必须二次确认，且要说清后果
      if (!confirm(`确定清除 ${s.key}？\n\n影响：${s.scope}`)) return
      saveOne(s.key, null)
    })
    actions.append(clearBtn)
  }

  row.append(actions)
  const result = el('div', 'secret-result')
  result.hidden = true
  row.append(result)
  return row
}

/* ---------- 动作 ---------- */

async function saveOne(key, input) {
  if (state.saving) return
  const value = input ? input.value.trim() : ''
  if (input && !value) { notice('请先填写要保存的值', 'warn'); return }
  state.saving = true
  try {
    await api('/api/secrets/save', { method: 'POST', body: { entries: { [key]: value } } })
    if (input) input.value = ''
    delete state.draft[key]
    notice(`${key} 已${value ? '保存' : '清除'}`, 'ok')
    await refresh()
  } catch (e) {
    // 服务端会回 rejected 明细（形态不符），原样展示才能指导用户改
    notice(e.message || '保存失败', 'bad')
  } finally {
    state.saving = false
  }
}

async function verifyOne(key, btn) {
  if (state.verifying) return
  state.verifying = true
  const old = btn.textContent
  btn.textContent = '验证中…'
  btn.disabled = true
  try {
    const d = await api('/api/secrets/verify', { method: 'POST', body: { keys: [key] } })
    const r = d.results?.[0]
    const row = document.querySelector(`.secret-row[data-key="${key}"] .secret-result`)
    if (row && r) {
      row.hidden = false
      row.textContent = `${r.ok ? '✓' : '✗'} ${r.detail}`
      row.className = `secret-result ${r.ok ? 'ok' : 'bad'}`
    }
  } catch (e) {
    notice(`验证失败：${e.message}`, 'bad')
  } finally {
    btn.textContent = old
    btn.disabled = false
    state.verifying = false
  }
}

/* ---------- 整体渲染 ---------- */

function renderSummary() {
  const box = $('#secrets-summary')
  if (!box || !state.data) return
  box.innerHTML = ''
  const s = state.data.summary
  box.append(el('span', '', `共 ${s.total} 项｜已配置 ${s.configured}`))
  if (s.missingRequired.length) {
    box.append(el('span', 'bad', `｜缺失必需：${s.missingRequired.join('、')}`))
  }
  if (s.shapeIssues.length) {
    box.append(el('span', 'warn', `｜形态异常：${s.shapeIssues.join('、')}`))
  }
  box.append(el('span', 'muted', `｜凭据文件：${state.data.envFile.exists ? '.env.local（已 gitignore）' : '尚未创建'}`))
}

function render() {
  renderSummary()
  const root = $('#secrets-groups')
  if (!root || !state.data) return
  root.innerHTML = ''
  for (const g of state.data.groups) {
    const sec = el('section', 'secret-group')
    sec.append(el('h3', '', g.label))
    for (const item of g.items) sec.append(renderItem(item))
    root.append(sec)
  }
}

export function initSecretsPanel() {
  $('#btn-secrets-refresh')?.addEventListener('click', () => refresh())
  $('#secrets-verify-all')?.addEventListener('click', async () => {
    const btn = $('#secrets-verify-all')
    if (state.verifying) return
    state.verifying = true
    const old = btn.textContent
    btn.textContent = '验证中…'
    btn.disabled = true
    try {
      const d = await api('/api/secrets/verify', { method: 'POST', body: {} })
      const ok = d.results.filter(r => r.ok).length
      notice(`验证完成：${ok}/${d.results.length} 通过`, ok === d.results.length ? 'ok' : 'warn')
      // 把逐条结果写回各自的行，避免只给一个总数
      for (const r of d.results) {
        const row = document.querySelector(`.secret-row[data-key="${r.key}"] .secret-result`)
        if (row) {
          row.hidden = false
          row.textContent = `${r.ok ? '✓' : '✗'} ${r.detail}`
          row.className = `secret-result ${r.ok ? 'ok' : 'bad'}`
        }
      }
    } catch (e) {
      notice(`验证失败：${e.message}`, 'bad')
    } finally {
      btn.textContent = old
      btn.disabled = false
      state.verifying = false
    }
  })
}

export async function refresh() {
  notice('')
  try {
    state.data = await api('/api/secrets')
    render()
  } catch (e) {
    notice(`加载失败：${e.message}`, 'bad')
  }
}
