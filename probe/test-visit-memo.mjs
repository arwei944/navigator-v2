/**
 * 守卫「访问计数」与 rebuild 记忆表的交互。
 *
 * rebuild 现在按「来源对象 / 编辑补丁 / 访问计数」三者身份复用渲染对象，
 * 而 recordVisit 是**就地改** `site.visitCount` 的（为了让卡片立刻 +1，不等落盘）。
 * 两者配合错了会怎样：memo 记的 visits 与真实值不符 → 要么该更新的卡不更新，
 * 要么下次 rebuild 把访问计数回退。所以这里逐条钉住。
 *
 * 用法: node probe/test-visit-memo.mjs <cdp-port> [base-url]
 */
const PORT = process.argv[2] || '9345'
const BASE = process.argv[3] || 'http://localhost:4173'

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

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

const results = []
const check = (ok, label, detail = '') => {
  results.push(ok)
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ' — ' + detail : ''}`)
}

await send('Page.navigate', { url: BASE + '/' })
await sleep(1200)
await evaluate(`(async () => {
  try { const r = await navigator.serviceWorker.getRegistrations(); await Promise.all(r.map(x => x.unregister())) } catch {}
  try { const k = await caches.keys(); await Promise.all(k.map(x => caches.delete(x))) } catch {}
  try {
    // 持久化键就是 store 名本身（插件未设前缀）：访问记录在 history，覆盖层在 nav-sites-overlay
    for (const k of ['nav-sites-overlay', 'nav-sites-trash', 'history']) localStorage.removeItem(k)
  } catch {}
  return 1
})()`).catch(() => {})
await send('Page.reload', { ignoreCache: true })
await sleep(2600)

console.log('\n=== 访问计数 × rebuild 记忆表 ===\n')

const probeId = await evaluate(`document.querySelector('.card').dataset.siteId`)
const visited0 = await evaluate(`document.querySelector('[data-site-id="${probeId}"]').dataset.visited`)
check(visited0 === '0', `初始未访问标记正确（site ${probeId}）`, `data-visited=${visited0}`)

// 点卡片主体 → openSite() → recordVisit + addRecord（无头下 window.open 无副作用）
await evaluate(`(() => {
  const card = document.querySelector('[data-site-id="${probeId}"]')
  card.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return 1
})()`)
await sleep(400)
const visited1 = await evaluate(`document.querySelector('[data-site-id="${probeId}"]').dataset.visited`)
check(visited1 === '1', '打开站点后该卡立刻标记为已访问', `data-visited=${visited1}`)

const count1 = await evaluate(`(() => {
  const raw = localStorage.getItem('nav-sites-overlay')
  if (!raw) return 'no-overlay'
  try {
    // 覆盖层是 encodeStored 写的信封：{ __navDataVersion, data: { visits: {...} } }
    const env = JSON.parse(raw)
    const payload = env && typeof env === 'object' && 'data' in env ? env.data : env
    return payload?.visits?.['${probeId}'] ?? null
  } catch (e) { return 'parse-fail: ' + e.message }
})()`)
check(count1 === 1, '访问计数已落盘（覆盖层 visits）', `visits=${count1}`)

// 触发一次无关的 rebuild：置顶另一张卡 —— 不应把访问计数冲掉
const otherId = await evaluate(`(() => {
  const cards = [...document.querySelectorAll('.card')]
  return cards[1] ? cards[1].dataset.siteId : ''
})()`)
await evaluate(`(async () => {
  const card = document.querySelector('[data-site-id="${otherId}"]')
  card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 60 }))
  await new Promise(r => setTimeout(r, 30))
  const btn = [...document.querySelectorAll('.context-menu-item')].find(b => /^(置顶|取消置顶)$/.test(b.textContent.trim()))
  btn && btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return 1
})()`)
await sleep(500)
const visitedAfterRebuild = await evaluate(`document.querySelector('[data-site-id="${probeId}"]').dataset.visited`)
check(visitedAfterRebuild === '1', '一次无关的 rebuild 之后已访问标记未被冲掉', `data-visited=${visitedAfterRebuild}`)

// 刷新后仍然保持（落盘生效）
await send('Page.reload', { ignoreCache: false })
await sleep(2600)
const visitedAfterReload = await evaluate(`document.querySelector('[data-site-id="${probeId}"]')?.dataset.visited ?? 'missing'`)
check(visitedAfterReload === '1', '刷新后仍为已访问（持久化生效）', `data-visited=${visitedAfterReload}`)

const cards = await evaluate(`document.querySelectorAll('.card').length`)
check(cards === 300, `页面状态健康（${cards} 张卡）`)

const pass = results.filter(Boolean).length
console.log(`\n结果：${pass}/${results.length} 通过`)
ws.close()
process.exit(pass === results.length ? 0 : 1)
