/**
 * 首屏时间线拆解：导航 → DOMContentLoaded → FCP → 卡片出现，
 * 以及各资源对首屏的贡献（体积 / 下载耗时 / 是否在关键路径上）。
 *
 * 目的：判断「主 chunk 860 KB」到底是不是首屏瓶颈，还是瓶颈在别处
 * （字体、CSS、样式重算、或根本就是测量粒度问题）。
 *
 * 用法: node probe/perf-firstpaint.mjs <cdp-port> [base-url] [轮次]
 */
const PORT = process.argv[2] || '9345'
const BASE = process.argv[3] || 'http://localhost:4173'
const ROUNDS = Number(process.argv[4] || 4)

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

await send('Performance.enable')
await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

const median = arr => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)]

/** 冷缓存：清掉 SW 与 Cache，让每次都是首次访问的语义 */
async function hardReload() {
  await evaluate(`(async () => {
    try { const r = await navigator.serviceWorker.getRegistrations(); await Promise.all(r.map(x => x.unregister())) } catch {}
    try { const k = await caches.keys(); await Promise.all(k.map(x => caches.delete(x))) } catch {}
    return 1
  })()`).catch(() => {})
  await send('Network.enable').catch(() => {})
  await send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {})
  await send('Page.reload', { ignoreCache: true })
  await sleep(500)
}

const TIMELINE = `(() => {
  const nav = performance.getEntriesByType('navigation')[0] || {}
  const fcp = (performance.getEntriesByType('paint').find(p => p.name === 'first-contentful-paint') || {}).startTime ?? -1
  const res = performance.getEntriesByType('resource').map(r => ({
    n: r.name.split('/').pop().slice(0, 42),
    type: r.initiatorType,
    dur: Math.round(r.duration),
    size: r.encodedBodySize || r.transferSize || 0,
    start: Math.round(r.startTime),
    end: Math.round(r.responseEnd)
  }))
  return {
    ttfb: Math.round(nav.responseStart || 0),
    domInteractive: Math.round(nav.domInteractive || 0),
    domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
    loadEvent: Math.round(nav.loadEventEnd || 0),
    fcp: Math.round(fcp),
    transferTotal: res.reduce((a, r) => a + r.size, 0),
    res: res.sort((a, b) => b.dur - a.dur)
  }
})()`

console.log(`\n=== 首屏时间线：${BASE}（${ROUNDS} 轮）===\n`)
const rows = []
for (let i = 0; i < ROUNDS; i++) {
  if (i > 0) await hardReload()
  else await send('Page.navigate', { url: BASE + '/' })
  await sleep(700)

  const t0 = Date.now()
  await send('Page.reload', { ignoreCache: i > 0 })
  let cardMs = -1
  for (let k = 0; k < 60; k++) {
    const n = await evaluate(`document.querySelectorAll('.card').length`).catch(() => 0)
    if (n > 0) { cardMs = Date.now() - t0; break }
    await sleep(50)
  }
  const line = await evaluate(TIMELINE)
  rows.push({ ...line, cardMs })
  console.log(`第 ${i + 1} 轮: TTFB ${line.ttfb} / DCL ${line.domContentLoaded} / FCP ${line.fcp} / 卡片 ${cardMs} / 传输 ${(line.transferTotal / 1024).toFixed(0)} KB`)
}

console.log('\n--- 中位数 ---')
const keys = ['ttfb', 'domInteractive', 'domContentLoaded', 'loadEvent', 'fcp', 'transferTotal', 'cardMs']
for (const k of keys) {
  const v = median(rows.map(r => r[k]))
  console.log(`  ${k.padEnd(18)} ${k === 'transferTotal' ? (v / 1024).toFixed(1) + ' KB' : v + ' ms'}`)
}

const last = rows[rows.length - 1]
console.log('\n--- 末轮资源明细（按耗时降序）---')
for (const r of last.res.slice(0, 14)) {
  console.log(`  ${String(r.n).padEnd(44)} ${String(r.dur).padStart(6)} ms  请求@${String(r.start).padStart(5)}  完@${String(r.end).padStart(5)}  ${String((r.size / 1024).toFixed(1)).padStart(8)} KB  [${r.type}]`)
}

ws.close()
process.exit(0)
