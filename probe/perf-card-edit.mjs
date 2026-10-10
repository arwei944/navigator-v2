/**
 * 「改 1 个站点」的真实用户路径代价：右键卡片 → 置顶 / 取消置顶。
 *
 * 这条路径会走到 sitesStore.updateSite → rebuild()，是全站最频繁的写操作之一
 * （置顶、归档、编辑、记一次访问走的是同一条）。用它来 A/B 验证
 * 「rebuild 按来源复用对象引用」是否真的把 300 张卡的重渲染收敛到 1 张。
 *
 * 判据：ScriptDuration（组件重渲染 + patch 的 JS 时间）与 LayoutDuration（重排）。
 * 行为同时校验：置顶徽章要出现、卡片总数不变、数据能落到 localStorage 覆盖层。
 *
 * 用法: node probe/perf-card-edit.mjs <cdp-port> [base-url] [轮次]
 */
const PORT = process.argv[2] || '9345'
const BASE = process.argv[3] || 'http://localhost:4173'
const ROUNDS = Number(process.argv[4] || 6)

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

async function metrics() {
  const m = await send('Performance.getMetrics')
  const get = n => (m.metrics || []).find(x => x.name === n)?.value ?? 0
  return { script: get('ScriptDuration'), layout: get('LayoutDuration') }
}
const median = arr => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)]
const FLUSH = `new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))`

await send('Page.navigate', { url: BASE + '/' })
await sleep(1200)
// 清掉上一版 SW，否则测的是旧 bundle
await evaluate(`(async () => {
  try { const r = await navigator.serviceWorker.getRegistrations(); await Promise.all(r.map(x => x.unregister())) } catch {}
  try { const k = await caches.keys(); await Promise.all(k.map(x => caches.delete(x))) } catch {}
  return 1
})()`).catch(() => {})
await send('Page.reload', { ignoreCache: true })
await sleep(2600)

const cards = await evaluate(`document.querySelectorAll('.card').length`)
// 从干净状态开始：清掉覆盖层，避免上一次实验的置顶残留影响可比性
await evaluate(`(() => {
  try { localStorage.removeItem('nav-sites-overlay') } catch {}
  return 1
})()`)
await send('Page.reload', { ignoreCache: false })
await sleep(2600)

console.log(`\n=== 单卡改动代价（右键「置顶」）：${BASE}，${cards} 张卡，${ROUNDS} 轮 ===\n`)

const s = [], l = []
let badgeOk = true, countOk = true

for (let i = 0; i < ROUNDS; i++) {
  await sleep(500)
  await evaluate(`(() => { document.querySelector('.card')?.scrollIntoView({ block: 'center' }); return 1 })()`)
  const before = await metrics()
  const res = await evaluate(`(async () => {
    const card = document.querySelector('.card')
    const id = card.dataset.siteId
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 60 }))
    await new Promise(r => setTimeout(r, 30))
    const btns = [...document.querySelectorAll('.context-menu-item')]
    const btn = btns.find(b => /^(置顶|取消置顶)$/.test(b.textContent.trim()))
    if (!btn) return { error: '找不到置顶按钮', items: btns.map(b => b.textContent.trim()) }
    const label = btn.textContent.trim()
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise(r => setTimeout(r, 20))
    const target = document.querySelector('[data-site-id="' + id + '"]')
    return {
      label,
      pinned: !!target?.querySelector('.card-pinned'),
      total: document.querySelectorAll('.card').length
    }
  })()`)
  await evaluate(FLUSH)
  const after = await metrics()
  s.push((after.script - before.script) * 1000)
  l.push((after.layout - before.layout) * 1000)
  if (res?.error) { console.log('  ⚠', res.error, res.items); break }
  if (i === 0) {
    badgeOk = res.pinned === true
    countOk = res.total === cards
  }
}

console.log(`  脚本执行  中位 ${median(s).toFixed(2)} ms   样本 [${s.map(x => x.toFixed(2)).join(', ')}]`)
console.log(`  布局      中位 ${median(l).toFixed(2)} ms   样本 [${l.map(x => x.toFixed(2)).join(', ')}]`)
console.log(`\n  置顶徽章正确出现（首轮）: ${badgeOk ? '✅' : '❌'}`)
console.log(`  卡片总数不变            : ${countOk ? '✅' : '❌'}`)

const overlay = await evaluate(`(() => { try { return localStorage.getItem('nav-sites-overlay') ? '有' : '无' } catch { return 'err' } })()`)
console.log(`  覆盖层已落盘            : ${overlay}`)

ws.close()
process.exit(0)
