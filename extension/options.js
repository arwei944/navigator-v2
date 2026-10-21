/**
 * 设置页：连接信息与默认筛选。
 *
 * 「测试连接」调 `GET /api/ingest?categories=1`：它同时验证地址、密钥与分类表，
 * 比只 ping 首页可靠 —— 首页能通不代表这台部署有同步接口或密钥正确。
 */
const DEFAULTS = {
  baseUrl: '',
  apiKey: '',
  days: 90,
  minVisits: 1,
  maxItems: 1000,
  blacklist: '',
}

const $ = (id) => document.getElementById(id)

function setStatus(text, kind = '') {
  const el = $('status')
  el.textContent = text
  el.className = kind
}

function readForm() {
  return {
    baseUrl: $('baseUrl').value.trim().replace(/\/+$/, ''),
    apiKey: $('apiKey').value.trim(),
    days: Math.max(0, Number($('days').value) || 0),
    minVisits: Math.max(1, Number($('minVisits').value) || 1),
    maxItems: Math.min(2000, Math.max(1, Number($('maxItems').value) || 1000)),
    blacklist: $('blacklist').value,
  }
}

function fillForm(config) {
  $('baseUrl').value = config.baseUrl || ''
  $('apiKey').value = config.apiKey || ''
  $('days').value = String(config.days ?? 90)
  $('minVisits').value = String(config.minVisits ?? 1)
  $('maxItems').value = String(config.maxItems ?? 1000)
  $('blacklist').value = config.blacklist || ''
}

async function load() {
  const { config } = await chrome.storage.local.get('config')
  fillForm({ ...DEFAULTS, ...(config || {}) })
}

async function save() {
  const config = readForm()
  if (!config.baseUrl) { setStatus('先填写导航站地址', 'error'); return }
  if (!/^https?:\/\//i.test(config.baseUrl)) { setStatus('地址必须以 http:// 或 https:// 开头', 'error'); return }
  if (!config.apiKey) { setStatus('先填写管理密钥', 'error'); return }
  await chrome.storage.local.set({ config })
  setStatus('已保存', 'ok')
}

async function test() {
  const config = readForm()
  const info = $('connInfo')
  if (!config.baseUrl || !config.apiKey) { setStatus('地址和密钥都要填', 'error'); return }
  info.textContent = '正在连接…'
  try {
    const res = await fetch(`${config.baseUrl}/api/ingest?categories=1`, {
      headers: {
        Accept: 'application/json',
        'X-Nav-Key': config.apiKey,
        Authorization: `Bearer ${config.apiKey}`,
      },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`)
    const groups = Array.isArray(data.groups) ? data.groups.length : 0
    const flat = Array.isArray(data.flat) ? data.flat.length : 0
    info.textContent = `连接成功：${groups} 个分组 / ${flat} 个分类`
    setStatus('连接正常', 'ok')
  } catch (e) {
    info.textContent = ''
    setStatus(`连接失败：${String(e?.message || e)}`, 'error')
  }
}

$('save').addEventListener('click', save)
$('test').addEventListener('click', test)
load()