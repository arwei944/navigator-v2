/**
 * 第二批性能优化的量化基线/对照脚本。
 *
 * 三个场景，各自用最适合的测法（不要一律用 wall-clock —— headless 下它会被
 * 其它进程与 CDP 往返污染）：
 *   1. 首屏 —— 页内 MutationObserver 记录「第一张卡进入 DOM」的时刻，
 *      并用 Network 域累计首访真实下载字节（encodedDataLength）。
 *      脚本执行耗时取 CDP `Performance.getMetrics()` 的 ScriptDuration 差值。
 *   2. 拼音搜索 —— ScriptDuration 差值，包住 Vue 的微任务 flush + 两帧。
 *   3. 切换分类 —— 同上，并分别报脚本与布局，避免把布局成本误记成脚本成本。
 *   4. 产物体积 —— dist 各资源原始 / gzip 大小（图标另计，它们不是文本资源）。
 *
 * 用法: node probe/perf-batch2.mjs <cdp-port> [base-url] [轮次]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = process.argv[2] || '9345'
const BASE = process.argv[3] || 'http://localhost:4173'
const ROUNDS = Number(process.argv[4] || 5)
const DIST = fileURLToPath(new URL('../dist/', import.meta.url))

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const t = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl)
if (!t) throw new Error('没有可用的 Chrome 页面')

const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const pending = new Map()
const evHandlers = []
ws.onmessage = e => {
  const m = JSON.parse(e.data)
  if (m.method) for (const h of evHandlers) h(m)
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
await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

async function metrics() {
  const m = await send('Performance.getMetrics')
  const get = n => (m.metrics || []).find(x => x.name === n)?.value ?? 0
  return { script: get('ScriptDuration'), layout: get('LayoutDuration') }
}
const median = arr => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)]
const FLUSH = `new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))`

/** 页内首屏记录器：第一张卡进入 DOM 的时刻 + FCP，都是相对导航起点的毫秒 */
const FP_RECORDER = `(() => {
  window.__fp = { cardAt: -1 }
  const arm = () => {
    const obs = new MutationObserver(() => {
      if (window.__fp.cardAt < 0 && document.querySelector('.card')) {
        window.__fp.cardAt = performance.now()
        obs.disconnect()
      }
    })
    obs.observe(document.documentElement, { childList: true, subtree: true })
    // 万一卡片在 MutationObserver 之前就已经存在（缓存命中极快的情况）
    if (document.querySelector('.card')) window.__fp.cardAt = performance.now()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arm)
  else arm()
})()`

await send('Page.addScriptToEvaluateOnNewDocument', { source: FP_RECORDER })

console.log(`\n=== 第二批性能对照：${BASE} （${ROUNDS} 轮取中位）===\n`)

/* ── 0. 先卸载 SW 并清缓存，让「首访」语义成立 ── */
await send('Page.navigate', { url: BASE + '/' })
await sleep(1200)
await evaluate(`(async () => {
  try { const r = await navigator.serviceWorker.getRegistrations(); await Promise.all(r.map(x => x.unregister())) } catch {}
  try { const k = await caches.keys(); await Promise.all(k.map(x => caches.delete(x))) } catch {}
  return 1
})()`).catch(() => {})

/* ── 1. 首屏（每次都是冷缓存）── */
const firsts = []
for (let i = 0; i < ROUNDS; i++) {
  await send('Network.clearBrowserCache').catch(() => {})
  await send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {})
  await send('Page.navigate', { url: BASE + '/' })
  // 等首屏记录器给出结果
  let fp = null
  for (let k = 0; k < 100; k++) {
    fp = await evaluate(`window.__fp && { cardAt: window.__fp.cardAt, cards: document.querySelectorAll('.card').length }`).catch(() => null)
    if (fp && fp.cardAt > 0) break
    await sleep(80)
  }
  await evaluate(FLUSH)
  // 下载量走页内 resource timing：CDP 的 Network.loadingFinished 在跨导航时会漏，
  // 而 encodedBodySize 是这一趟文档自己的账，不会串
  const net = await evaluate(`performance.getEntriesByType('resource')
    .reduce((a, r) => a + (r.encodedBodySize || r.transferSize || 0), 0)`).catch(() => 0)
  const cards = fp?.cards ?? 0
  firsts.push({ cardAt: fp?.cardAt ?? -1, net, cards })
  console.log(`  第 ${i + 1} 轮: 首卡 ${Math.round(fp?.cardAt ?? -1)} ms ／ 首访下载 ${(net / 1024).toFixed(0)} KB ／ ${cards} 卡`)
}
await send('Network.setCacheDisabled', { cacheDisabled: false }).catch(() => {})
const mFirst = {
  cardAt: median(firsts.map(x => x.cardAt)),
  net: median(firsts.map(x => x.net)),
  cards: firsts[0].cards
}
console.log(`\n[首屏中位] 首卡 ${Math.round(mFirst.cardAt)} ms ／ 首访下载 ${(mFirst.net / 1024).toFixed(0)} KB ／ ${mFirst.cards} 卡`)

/* ── 2. 拼音搜索（逐键，走 omni 检索 + Fuse 兜底）── */
console.log('\n[检索] 逐键输入拼音串 shejisucai')
await evaluate(`(() => { const el = document.querySelector('.unified-search-input'); el.focus(); return 1 })()`)
const searchS = []
for (let i = 0; i < ROUNDS; i++) {
  await sleep(450)
  const before = await metrics()
  const n = 1 + (i % 8)
  await evaluate(`(async () => {
    const el = document.querySelector('.unified-search-input')
    el.focus()
    el.value = 'shejisucai'.slice(0, ${n})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 0))
    return 1
  })()`)
  await evaluate(FLUSH)
  const after = await metrics()
  searchS.push((after.script - before.script) * 1000)
}
console.log(`  ${'拼音搜索每键'.padEnd(20)} 中位 ${median(searchS).toFixed(2).padStart(6)} ms   样本 [${searchS.map(x => x.toFixed(1)).join(', ')}]`)

await evaluate(`(() => {
  const el = document.querySelector('.unified-search-input')
  el.value = ''
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return 1
})()`)
await sleep(450)

/* ── 3. 切换分类 ── */
const cats = await evaluate(`document.querySelectorAll('.chip').length`)
console.log(`\n[渲染] 切换分类（${cats} 个可点筛选项）`)
const catS = [], catL = []
for (let i = 0; i < ROUNDS; i++) {
  await sleep(450)
  const before = await metrics()
  await evaluate(`(() => {
    const els = [...document.querySelectorAll('.chip')]
    const el = els[${i + 1} % Math.max(1, els.length)]
    el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return 1
  })()`)
  await evaluate(FLUSH)
  const after = await metrics()
  catS.push((after.script - before.script) * 1000)
  catL.push((after.layout - before.layout) * 1000)
}
console.log(`  ${'切换分类'.padEnd(20)} 脚本 中位 ${median(catS).toFixed(2).padStart(6)} ms ／ 布局 中位 ${median(catL).toFixed(2).padStart(6)} ms`)

/* ── 4. 产物体积 ── */
console.log('\n[产物] dist 资源体积')
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else out.push({ rel: p.slice(DIST.length).replace(/\\/g, '/'), size: st.size })
  }
  return out
}
const html = readFileSync(join(DIST, 'index.html')).toString()
let appGz = 0, shellRaw = 0
const rows = []
for (const f of walk(DIST)) {
  // 应用代码与外壳（js/css/html/webmanifest）vs 站点图标（icons/，运行时按需缓存）
  const isApp = /\.(js|css|html|webmanifest)$/.test(f.rel) && !f.rel.startsWith('/icons/')
  if (!isApp) continue
  const gz = gzipSync(readFileSync(join(DIST, f.rel))).length
  appGz += gz
  shellRaw += f.size
  rows.push({ rel: f.rel, size: f.size, gz })
}
rows.sort((a, b) => b.gz - a.gz)
for (const r of rows.slice(0, 6)) {
  console.log(`  ${r.rel.padEnd(42)} ${String((r.size / 1024).toFixed(1)).padStart(8)} KB → ${String((r.gz / 1024).toFixed(1)).padStart(7)} KB gz`)
}
// SW 预缓存清单里实际要下载的字节
const sw = readFileSync(join(DIST, 'sw.js'), 'utf8')
const precacheUrls = [...sw.matchAll(/url:\s*"([^"]+)"/g)].map(x => x[1])
let precacheBytes = 0
for (const u of precacheUrls) { try { precacheBytes += statSync(join(DIST, u.replace(/^\//, ''))).size } catch {} }
console.log(`  应用外壳合计 gz ${(appGz / 1024).toFixed(1)} KB ／ 原始 ${(shellRaw / 1024).toFixed(1)} KB`)
console.log(`  SW 预缓存 ${precacheUrls.length} 条 / ${(precacheBytes / 1024 / 1024).toFixed(2)} MB`)
console.log(`  index.html 里的 preload/modulepreload 提示数：${(html.match(/rel="(modulepreload|preload)"/g) || []).length}`)

const out = {
  首卡出现ms: Math.round(mFirst.cardAt),
  首访下载KB: +(mFirst.net / 1024).toFixed(0),
  卡片数: mFirst.cards,
  拼音搜索每键ms: +median(searchS).toFixed(2),
  切分类脚本ms: +median(catS).toFixed(2),
  切分类布局ms: +median(catL).toFixed(2),
  应用外壳gzKB: +(appGz / 1024).toFixed(1),
  SW预缓存条数: precacheUrls.length,
  SW预缓存MB: +(precacheBytes / 1024 / 1024).toFixed(2)
}
console.log('\n=== 汇总 ===')
console.log(JSON.stringify(out, null, 2))

ws.close()
process.exit(0)
