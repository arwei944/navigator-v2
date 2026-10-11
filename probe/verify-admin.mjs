/**
 * 真机验证管理后台复活（v10 第二批）：/admin 打开即拉到真实数据。
 *
 * 前置：sessionStorage 里放好管理密钥（模拟「密钥直连」登录后的状态）——
 * 后台的凭据读 sessionStorage（`nav_admin_token`），明文密钥不再落 localStorage。
 *
 * 用法：node probe/verify-admin.mjs <cdp-port> [base] <admin-key>
 */
import { writeFileSync } from 'node:fs'

const PORT = process.argv[2] || '9353'
const BASE = process.argv[3] || 'https://nav-dashboard-19166.app.workbuddy.host'
const KEY = process.argv[4]
if (!KEY) { console.error('用法：node probe/verify-admin.mjs <cdp-port> [base] <admin-key>'); process.exit(2) }

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? ` → ${extra}` : ''}`) }
  else { failures.push(`${label}${extra ? ` → ${extra}` : ''}`); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`) }
}
const sleep = ms => new Promise(s => setTimeout(s, ms))

async function target() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const p = list.find(t => t.type === 'page')
      if (p?.webSocketDebuggerUrl) return p
    } catch { /* 未就绪 */ }
    await sleep(500)
  }
  throw new Error(`连不上 CDP ${PORT}`)
}

const t = await target()
const ws = new WebSocket(t.webSocketDebuggerUrl)
let id = 0
const pend = new Map()
const events = []
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) }
  else if (m.method) events.push(m)
})
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pend.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })) })
const evalJs = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval 抛错')
  return r.result.value
}

await send('Page.enable'); await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

console.log(`\n▶ 管理后台复活验证  BASE=${BASE}\n`)

// 先在同源下写入会话凭据，再进 /admin
await send('Page.navigate', { url: BASE + '/' })
await sleep(3500)
await evalJs(`sessionStorage.setItem('nav_admin_token', ${JSON.stringify(KEY)}); true`)
await send('Page.navigate', { url: BASE + '/admin' })
await sleep(5000)

const state = JSON.parse(await evalJs(`JSON.stringify({
  url: location.pathname,
  title: document.title,
  bodyLen: document.body.innerText.length,
  hasLogin: Boolean(document.querySelector('.login-form, form.login, [class*="login"]')),
  tabs: [...document.querySelectorAll('[class*="tab"], .admin-tab, nav button')].map(x => x.textContent.trim()).filter(Boolean).slice(0, 12),
  apiCalls: (window.__adminCalls || []),
})`))

ok(state.url === '/admin', '进入 /admin 路由', state.url)
ok(!state.hasLogin, '凭据已生效：没有停在登录闸门')
ok(state.bodyLen > 200, '后台外壳已渲染', `${state.bodyLen} 字`)
ok(state.tabs.length >= 3, '后台分页签已渲染', state.tabs.join(' / ').slice(0, 80))

// 直接从页面里打一次后台接口，证明数据真的回来了（而不是只渲染了外壳）
const probe = JSON.parse(await evalJs(`(async () => {
  const r = await fetch('/api/ops?audit=1&limit=5', { headers: { 'X-Nav-Key': ${JSON.stringify(KEY)} } })
  const j = await r.json().catch(() => ({}))
  return JSON.stringify({ status: r.status, ok: j.ok, total: j.total })
})()`))
ok(probe.status === 200 && probe.ok === true, '页面内 /api/ops 带 X-Nav-Key 拿到审计数据', `status=${probe.status}`)

const h = JSON.parse(await evalJs(`(async () => {
  const r = await fetch('/api/health', { headers: { 'X-Nav-Key': ${JSON.stringify(KEY)} } })
  const j = await r.json().catch(() => ({}))
  return JSON.stringify({ status: r.status, version: j.version, counts: j.counts, actor: j.actor })
})()`))
ok(h.status === 200 && typeof h.version === 'number', '健康判定可读（巡检数据源）',
  `version=${h.version} counts=${JSON.stringify(h.counts)} actor=${h.actor || '尚未巡检'}`)

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('probe/admin-live.png', Buffer.from(shot.data, 'base64'))
console.log('\n  📸 截图已保存 probe/admin-live.png')

const exceptions = events.filter(e => e.method === 'Runtime.exceptionThrown').length
ok(exceptions === 0, '后台页面零未捕获异常', `实得 ${exceptions}`)

ws.close()
console.log('')
if (failures.length) {
  console.error(`❌ 管理后台验证 ${failures.length} 项失败（通过 ${pass} 项）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`✅ 管理后台验证全部通过：${pass} 项断言`)
process.exit(0)