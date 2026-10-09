/**
 * 线上 PWA 状态验证：Service Worker 是否真的注册成功、预缓存是否建立。
 * 修复前 `/sw.js` 被 vercel.json 重写成 index.html，注册必然失败（MIME 是 text/html）。
 *
 * 用法: node probe/test-pwa-online.mjs <cdp-port> <base-url>
 */
const PORT = process.argv[2] || '9344'
const BASE = process.argv[3] || 'https://navigator-v2-two.vercel.app'

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const t = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl)
if (!t) throw new Error('没有可用的 Chrome 页面')

const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const pending = new Map()
ws.onmessage = e => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
}
const send = (method, params = {}) => {
  const i = ++id
  ws.send(JSON.stringify({ id: i, method, params }))
  return new Promise(r => pending.set(i, r))
}
const evaluate = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) return 'ERR: ' + r.exceptionDetails.text
  return r.result?.value
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

const results = []
const check = (label, ok, extra = '') => {
  results.push({ label, ok })
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

console.log('\n[1] 首次访问：SW 注册')
await send('Page.navigate', { url: BASE + '/' })
await sleep(5000)
const regs = await evaluate(`navigator.serviceWorker.getRegistrations().then(rs => rs.length)`)
console.log(`  已注册 SW 数量: ${regs}`)
check('Service Worker 注册成功', regs >= 1, `实得 ${regs}`)

console.log('\n[2] SW 是否接管页面 + 预缓存')
await sleep(4000)
const info = await evaluate(`(async () => {
  const keys = await caches.keys()
  let total = 0
  for (const k of keys) { total += (await (await caches.open(k)).keys()).length }
  return JSON.stringify({ keys, total, controlled: !!navigator.serviceWorker.controller })
})()`)
console.log('  ' + info)
const parsed = typeof info === 'string' && info.startsWith('{') ? JSON.parse(info) : {}
check('已建立预缓存', (parsed.total || 0) > 0, `${parsed.total || 0} 条`)

console.log('\n[3] 页面交互仍正常（线上全能框）')
await evaluate(`(() => { const el = document.querySelector('.unified-search-input'); el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); el.focus(); el.value='zhuti'; el.dispatchEvent(new Event('input',{bubbles:true})); return 1 })()`)
await sleep(600)
const items = await evaluate(`[...document.querySelectorAll('.omni-item-title')].map(e => e.textContent.trim())`)
console.log('  zhuti 结果:', JSON.stringify(items.slice(0, 5)))
check('全能框在线上可用', items.some(t => /切换主题/.test(t)))

console.log('\n[4] manifest 图标可访问')
const icons = await evaluate(`(async () => {
  const href = document.querySelector('link[rel=manifest]')?.href || '/manifest.webmanifest'
  const mf = await (await fetch(href)).json()
  const out = []
  for (const ic of mf.icons || []) {
    const r = await fetch(ic.src)
    out.push({ src: ic.src, status: r.status, type: r.headers.get('content-type') })
  }
  return JSON.stringify(out)
})()`)
console.log('  ' + icons)
const iconList = typeof icons === 'string' && icons.startsWith('[') ? JSON.parse(icons) : []
check('manifest 声明的图标全部 200', iconList.length > 0 && iconList.every(i => i.status === 200))

const failed = results.filter(r => !r.ok)
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
ws.close()
process.exit(failed.length ? 1 : 0)
