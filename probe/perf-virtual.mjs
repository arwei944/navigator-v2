/**
 * 序 28「虚拟滚动」的收益评估探针。
 *
 * 方法论（吃过亏，写清楚）：
 *   headless 下 rAF 帧间隔受其他进程干扰极大 —— 实测空闲时也会冒 180ms+ 的帧，
 *   直接拿帧间隔下结论会把噪声当性能问题。所以这里改成：
 *     1. 先量「空闲基线」帧间隔，作为噪声下限；滚动数据只有明显高于它才算数；
 *     2. 判据换成 **确定性计数器**（LayoutCount / RecalcStyleCount / 各自的 Duration），
 *        它们是浏览器自己记的账，不受调度抖动影响；
 *     3. A/B 用「交替多轮 + 取中位」，且 A/B 交错执行，避免「第二轮总是更快」的顺序效应。
 *
 * 用法: node probe/perf-virtual.mjs <cdp-port> [url] [steps]
 */
const PORT = process.argv[2] || '9345'
const URL_ = process.argv[3] || 'http://localhost:4173'
const STEPS = Number(process.argv[4] || 40)

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
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result?.value
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 }
const f = n => n.toFixed(1)

await send('Page.enable')
await send('Runtime.enable')
await send('Performance.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

const METRIC_KEYS = ['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration']
async function snap() {
  const { metrics: m } = await send('Performance.getMetrics')
  const o = {}
  for (const x of m) o[x.name] = x.value
  return o
}
const diff = (a, b) => {
  const o = {}
  for (const k of METRIC_KEYS) o[k] = (b[k] ?? 0) - (a[k] ?? 0)
  o.LayoutDuration *= 1000
  o.RecalcStyleDuration *= 1000
  o.ScriptDuration *= 1000
  return o
}

console.log(`\n=== 序 28 评估：${URL_} · 每次滚动 ${STEPS} 步 ===\n`)

/* ── 0. 空闲基线：不滚动时的帧间隔，作为噪声下限 ── */
async function idleFrames(n = 30) {
  return JSON.parse(await evaluate(`(async () => {
    const out = []
    await new Promise(r => setTimeout(r, 60))
    let last = performance.now()
    for (let i = 0; i < ${n}; i++) {
      await new Promise(res => requestAnimationFrame(() => { const t = performance.now(); out.push(t - last); last = t; res() }))
    }
    return JSON.stringify(out)
  })()`))
}

/* ── 挂载：导航齐 300 卡 ── */
await send('Page.navigate', { url: URL_ + '/' })
let cards = 0
for (let i = 0; i < 80 && cards < 300; i++) { cards = await evaluate(`document.querySelectorAll('.card').length`); if (cards < 300) await sleep(50) }
await sleep(1500)

const idle = await idleFrames(30)
console.log(`[0] 空闲基线（不滚动 30 帧）：中位 ${f(median(idle))} ms · 最大 ${f(Math.max(...idle))} ms`)
console.log(`    ${median(idle) > 40 ? '⚠️ 基线本身就不稳 —— 帧间隔不可作为判据，下面只看计数器' : '基线平稳，帧间隔可作参考'}`)

const scrollScript = `(async () => {
  const box = document.querySelector('.cards-container')
  if (!box) return 'no-container'
  const longs = []
  const po = new PerformanceObserver(l => { for (const e of l.getEntries()) longs.push(e.duration) })
  try { po.observe({ entryTypes: ['longtask'] }) } catch {}
  const frames = []
  const max = box.scrollHeight - box.clientHeight
  // 滚动步长固定为 600px（约半屏），贴近真实滚轮；到顶后回到起点再滚一遍
  let pos = 0
  let last = performance.now()
  for (let i = 0; i < ${STEPS}; i++) {
    pos += 600
    if (pos > max) pos = 0
    box.scrollTop = pos
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => {
      const now = performance.now(); frames.push(now - last); last = now; r()
    })))
  }
  po.disconnect()
  return JSON.stringify({ frames, longs, scrollHeight: box.scrollHeight })
})()`

const setCv = (on) => evaluate(`(() => {
  const old = document.getElementById('__no-cv')
  if (old) old.remove()
  if (!${on}) {
    const s = document.createElement('style')
    s.id = '__no-cv'
    s.textContent = '.cards-grid .card, .cards-list .card { content-visibility: visible !important; contain-intrinsic-size: none !important; }'
    document.head.appendChild(s)
  }
})()`)

/* ── A/B 交替：A = 现状（content-visibility 开），B = 关掉 ── */
const A = [], B = []
for (let round = 0; round < 3; round++) {
  for (const [tag, on, bucket] of [['A', true, A], ['B', false, B]]) {
    await setCv(on)
    await evaluate(`document.querySelector('.cards-container').scrollTop = 0`)
    await sleep(250)
    const m0 = await snap()
    const r = JSON.parse(await evaluate(scrollScript))
    const m1 = await snap()
    bucket.push({ ...diff(m0, m1), long: r.longs.reduce((a, b) => a + b, 0), longN: r.longs.length, frame: median(r.frames), scrollHeight: r.scrollHeight })
  }
}
const agg = (arr) => ({
  layoutN: median(arr.map(x => x.LayoutCount)),
  styleN: median(arr.map(x => x.RecalcStyleCount)),
  layoutMs: median(arr.map(x => x.LayoutDuration)),
  styleMs: median(arr.map(x => x.RecalcStyleDuration)),
  scriptMs: median(arr.map(x => x.ScriptDuration)),
  longMs: median(arr.map(x => x.long)),
  longN: median(arr.map(x => x.longN)),
  frame: median(arr.map(x => x.frame)),
})
const a = agg(A), b = agg(B)

console.log(`\n[1] 滚动 ${STEPS} 步的账（内容高 ${A[0].scrollHeight}px，A/B 各 3 轮取中位）`)
console.log('                    Layout次数  重算样式次数   布局ms   样式ms   脚本ms   longtask')
console.log(`    A 现状(有 cv)      ${String(a.layoutN).padStart(6)}     ${String(a.styleN).padStart(8)}   ${f(a.layoutMs).padStart(7)} ${f(a.styleMs).padStart(8)} ${f(a.scriptMs).padStart(8)}   ${a.longN} 个 ${f(a.longMs)} ms`)
console.log(`    B 关掉 cv          ${String(b.layoutN).padStart(6)}     ${String(b.styleN).padStart(8)}   ${f(b.layoutMs).padStart(7)} ${f(b.styleMs).padStart(8)} ${f(b.scriptMs).padStart(8)}   ${b.longN} 个 ${f(b.longMs)} ms`)
console.log(`    帧间隔中位：A ${f(a.frame)} ms · B ${f(b.frame)} ms（基线 ${f(median(idle))} ms）`)

/* ── DOM 规模 ── */
const dom = JSON.parse(await evaluate(`(() => {
  let nodes = 0
  const walk = el => { nodes++; for (const c of el.children) walk(c) }
  walk(document.getElementById('app'))
  return JSON.stringify({ cards: document.querySelectorAll('.card').length, appNodes: nodes })
})()`))
console.log(`\n[2] DOM 规模：.card ${dom.cards} 个 · #app 内 ${dom.appNodes} 节点 · 每卡约 ${Math.round(dom.appNodes / dom.cards)} 个`)

/* ── 轮 3：把卡片数降到几十，估「虚拟滚动能拿到的收益上限」 ──
   虚拟滚动省掉的就是「不在视口里的那些卡」。所以最直接的估法是：同一个页面，
   只留少量卡片时滚动有多快 —— 两者的差就是虚拟滚动理论上限（不是它能拿到的收益，
   因为虚拟滚动只省 DOM/光栅，不省「可见卡片的绘制」）。 */
const byQuery = async (q) => {
  await evaluate(`(() => {
    const el = document.querySelector('.unified-search-input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, ${JSON.stringify(q)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(700)
  return evaluate(`document.querySelectorAll('.card').length`)
}

const popCompare = []
for (const q of ['', 'git']) {
  const n = await byQuery(q)
  await evaluate(`document.querySelector('.cards-container').scrollTop = 0`)
  await sleep(300)
  const m0 = await snap()
  const r = JSON.parse(await evaluate(scrollScript))
  const m1 = await snap()
  popCompare.push({ q, n, ...diff(m0, m1), long: r.longs.reduce((a, b) => a + b, 0), frame: median(r.frames), maxFrame: Math.max(...r.frames) })
}
console.log('\n[3] 卡片数 → 滚动代价（仅作参考：卡片少时容器可能根本没有可滚区域）')
for (const r of popCompare) {
  console.log(`    ${String(r.n).padStart(4)} 张卡（query="${r.q || '(空)'}"）：帧间隔中位 ${f(r.frame)} ms · 最大 ${f(r.maxFrame)} ms · 布局 ${f(r.LayoutDuration)} ms · 样式 ${f(r.RecalcStyleDuration)} ms · longtask ${f(r.long)} ms`)
}
// 恢复搜索框
await byQuery('')

/* ── 轮 4：把站点数从 300 降到 40，量「每张卡的挂载边际成本」 ──
   这是虚拟滚动的**收益上限**：虚拟滚动最多只能把「不进视口的那些卡」的创建成本省掉。
   做法是加载前打桩 /api/sites，返回截断后的站点表；其余一切不变。
   注意种子数据仍会先渲染 300 张，随后被云端数据替换 —— 所以要等卡片数稳定在 40 再取指标。 */
const seedPath = new URL('../api/sites-data.json', import.meta.url)
const { readFile } = await import('node:fs/promises')
const SEED = JSON.parse(await readFile(seedPath, 'utf-8'))

async function mountWithStub(nSites) {
  const payload = JSON.stringify({ version: 9000 + nSites, sites: SEED.slice(0, nSites), updatedAt: new Date().toISOString() })
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const orig = window.fetch
      window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || ''
        if (url.includes('/api/sites') && !url.includes('snapshots')) {
          return Promise.resolve(new Response(${JSON.stringify(payload)}, {
            status: 200, headers: { 'Content-Type': 'application/json', 'ETag': '"stub-' + ${nSites} + '"' }
          }))
        }
        return orig.apply(this, arguments)
      }
    })()`
  })
  await send('Page.navigate', { url: URL_ + '/' })
  const m0 = await snap()
  let n = 0
  let at = -1
  const t0 = Date.now()
  // 等卡片数与目标一致且稳定
  while (Date.now() - t0 < 6000) {
    n = await evaluate(`document.querySelectorAll('.card').length`)
    if (n === nSites) { await sleep(400); const n2 = await evaluate(`document.querySelectorAll('.card').length`); if (n2 === nSites) { at = Date.now() - t0; break } }
    await sleep(50)
  }
  const m1 = await snap()
  return { n, at, ...diff(m0, m1) }
}

const mounts = {}
for (const n of [300, 40]) mounts[n] = await mountWithStub(n)

// 清掉打桩脚本，恢复真实加载
const { identifiers } = await send('Page.getNavigationHistory')
console.log('\n[4] 挂载边际成本（同一条链路，只改站点数）')
console.log('         卡数   到齐ms   脚本ms   样式ms   布局ms')
for (const n of [300, 40]) {
  const r = mounts[n]
  console.log(`    ${String(n).padStart(6)}   ${String(r.at).padStart(6)}   ${f(r.ScriptDuration).padStart(7)}  ${f(r.RecalcStyleDuration).padStart(7)}  ${f(r.LayoutDuration).padStart(7)}`)
}
const per = (mounts[300].ScriptDuration - mounts[40].ScriptDuration) / (300 - 40)
console.log(`    → 每多一张卡的脚本边际成本约 ${f(per)} ms；260 张「首屏看不到的卡」合计约 ${f(per * 260)} ms`)
console.log(`    → 虚拟滚动理论上最多省掉这一部分（实际还会被「滚动时补挂载」吐回去一部分）\n`)
ws.close()
