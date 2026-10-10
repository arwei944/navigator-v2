/**
 * 线上（生产）第二批改动的验收：轮询 304、SW 预缓存瘦身、字体非阻塞、数据未被影响。
 *
 * 全部检查都在**页面上下文里用 fetch 完成**，不经过 child_process ——
 * 本会话里 `spawnSync curl.exe` 会 `EBUSY`（PTY 环境限制），而浏览器自己有可用的
 * 出站代理，读响应头的能力完全够用，还顺带验证了「真实浏览器能否走通这条路」。
 *
 * 前提：目标 Chrome 必须配了可用代理，例如
 *   --proxy-server="http://127.0.0.1:7897" --proxy-bypass-list="localhost;127.0.0.1"
 *
 * 用法: node probe/verify-batch2-online.mjs <cdp-port> [base-url]
 */
const PORT = process.argv[2] || '9347'
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result?.value
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

const results = []
const check = (ok, label, detail = '') => {
  results.push(ok)
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ' — ' + detail : ''}`)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

console.log(`\n=== 线上验收：${BASE} ===\n`)

// 先落到同源页面，否则相对路径 fetch 无从发起
await send('Page.navigate', { url: BASE + '/' })
await sleep(4000)

const reachable = await evaluate(`document.querySelectorAll('.card').length`)
check(reachable > 0, `页面可达并渲染出卡片（${reachable} 张）`)
if (!reachable) {
  console.log('\n页面不可达，后续检查全部跳过（检查 Chrome 的代理配置）')
  ws.close()
  process.exit(1)
}

/* ── 1. 轮询的条件请求链路 ── */
console.log('\n[1] 轮询条件请求（/api/sites）')
const probe = await evaluate(`(async () => {
  const url = '/api/sites'
  const r1 = await fetch(url, { cache: 'no-store' })
  const etag = r1.headers.get('etag')
  const cc = r1.headers.get('cache-control')
  const j1 = await r1.clone().json().catch(() => null)
  // cache:'no-store' 让浏览器不复用本地副本，于是这个条件请求会真的打到服务端，
  // 304 也就不会被浏览器透明地换成 200 —— 测的是服务端行为本身
  const r2 = await fetch(url, { cache: 'no-store', headers: { 'If-None-Match': etag || '' } })
  let bytes2 = -1
  try { bytes2 = (await r2.arrayBuffer()).byteLength } catch {}
  return JSON.stringify({
    status1: r1.status, etag, cc,
    status2: r2.status, bytes2,
    count: j1 && Array.isArray(j1.sites) ? j1.sites.length : -1,
    version: j1 ? j1.version : -1,
    degraded: !!(j1 && j1.degraded)
  })
})()`)
const p = JSON.parse(probe)
check(p.status1 === 200, '/api/sites 返回 200', `实际 ${p.status1}`)
check(!/no-store/.test(p.cc || ''), 'Cache-Control 已不再是 no-store', p.cc)
check(/max-age=0/.test(p.cc || '') && /must-revalidate/.test(p.cc || ''), '保留「每次必须回源校验」语义', p.cc)
check(!!p.etag, '响应带 ETag', p.etag || '(无)')
check(p.status2 === 304, '带上 If-None-Match 命中 304', `实际 ${p.status2}`)
check(p.bytes2 === 0, '304 的响应体为 0 字节', `${p.bytes2} B`)

/* ── 2. SW 预缓存瘦身 ── */
console.log('\n[2] Service Worker 预缓存')
const sw = await evaluate(`(async () => {
  const r = await fetch('/sw.js', { cache: 'no-store' })
  const txt = await r.text()
  const urls = [...txt.matchAll(/url:\\s*"([^"]+)"/g)].map(m => m[1])
  return JSON.stringify({ status: r.status, type: r.headers.get('content-type'), n: urls.length, icons: urls.filter(u => u.includes('icons/')).length, siteIcons: /site-icons/.test(txt), ext: /png\\|jpe\\?g\\|webp/.test(txt) })
})()`)
const s = JSON.parse(sw)
check(s.status === 200 && /javascript/.test(s.type || ''), '/sw.js 正常返回 JS', `${s.status} ${s.type}`)
check(s.n > 0 && s.n <= 30, `预缓存条目已瘦身（${s.n} 条，改前 294 条）`)
check(s.icons === 0, 'icons/ 已移出预缓存清单')
check(s.siteIcons === true, '站点图标改走运行时缓存（site-icons）')
check(s.ext === true, '运行时缓存规则覆盖 png/jpg/webp')

const cached = await evaluate(`(async () => {
  const keys = await caches.keys()
  let total = 0
  for (const k of keys) total += (await (await caches.open(k)).keys()).length
  return JSON.stringify({ keys, total })
})()`)
console.log(`     浏览器实际建立的缓存：${cached}`)

/* ── 3. 首屏阻塞项 ── */
console.log('\n[3] 首屏阻塞项')
const font = await evaluate(`(async () => {
  const txt = await (await fetch('/', { cache: 'no-store' })).text()
  const link = document.querySelector('link[rel=stylesheet][href*="fonts.googleapis"]')
  return JSON.stringify({
    nonBlocking: /media="print"[^>]*onload|onload="this\\.media/.test(txt),
    noscript: /<noscript>[\\s\\S]*?fonts\\.googleapis[\\s\\S]*?<\\/noscript>/.test(txt),
    media: link ? link.getAttribute('media') : null
  })
})()`)
const f = JSON.parse(font)
check(f.nonBlocking === true, 'Google Fonts 样式表已改非阻塞（media=print + onload）')
check(f.noscript === true, '有 noscript 兜底')
check(f.media === 'all', '运行中的文档里该样式表已生效（media 已由 JS 改回 all）', `media=${f.media}`)

/* ── 4. 数据未被本轮部署影响 ── */
console.log('\n[4] 数据一致性（本轮只改代码，不动数据）')
check(p.count === 300, `站点表仍为 300 条（version=${p.version}）`)
check(p.degraded === false, '无 degraded 标记')

/* ── 5. 端到端：客户端是否真的发了条件请求 ──
   前面的 [1] 只证明「服务端认 If-None-Match」，但省流量靠的是客户端把它发出去。
   这里在文档加载前打桩 window.fetch，记录 App 真实轮询里带不带这个头、
   以及服务端回的是 200 还是 304。轮询间隔 30s，所以要等 35s 才能收到第二轮。 */
console.log('\n[5] 端到端：真实轮询链路（需等一轮 30s 轮询）')
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    window.__poll = []
    const orig = window.fetch
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || ''
      const p = orig.apply(this, arguments)
      if (url.includes('/api/sites') && !url.includes('?')) {
        const inm = (init && init.headers && (init.headers['If-None-Match'] || init.headers['if-none-match'])) || null
        p.then(r => window.__poll.push({ inm, status: r.status })).catch(() => {})
      }
      return p
    }
  })()`
})
await send('Page.reload', { ignoreCache: false })
await sleep(35000)
const poll = JSON.parse(await evaluate(`JSON.stringify(window.__poll || [])`))
console.log('     观测到的请求：' + JSON.stringify(poll))
const first = poll[0] || {}
const later = poll.filter(x => x.inm)
check(poll.length >= 2, `一个加载周期内发生了 ${poll.length} 次轮询请求（含首拉 + 30s 轮询）`)
check(first.status === 200 && !first.inm, '首拉不带 If-None-Match 且拿到 200（无本地副本可校验）', JSON.stringify(first))
check(later.length > 0, '后续轮询带上了 If-None-Match', later.length ? JSON.stringify(later[later.length - 1]) : '(未观测到)')
check(later.every(x => x.status === 304), '带条件头的轮询全部命中 304（内容未变时应为 0 字节）')

const pass = results.filter(Boolean).length
console.log(`\n结果：${pass}/${results.length} 通过`)
ws.close()
process.exit(pass === results.length ? 0 : 1)
