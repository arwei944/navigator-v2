/**
 * 验证侧栏拖拽调宽的 rAF 合并。
 *
 * 关键断言是第 3 条：在**同一帧内**连发 20 次 mousemove 时，宽度不应逐次跟随 ——
 * 只有等到下一帧才写成最后一个位置。这正是「合并」与「逐次写 store」的分界：
 * 逐次写会在这 20 次事件里触发 20 次 300 项网格重排。
 *
 * 用法: node probe/test-resize.mjs <cdp-port> [base-url]
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
  return 1
})()`).catch(() => {})
await send('Page.reload', { ignoreCache: true })
await sleep(2600)

console.log('\n=== 侧栏拖拽调宽（rAF 合并）===\n')

const exists = await evaluate(`!!document.querySelector('.sidebar-resize-handle')`)
check(exists, '侧栏拖拽手柄存在')
if (!exists) { console.log('\n结果：0/1 通过'); ws.close(); process.exit(1) }

const out = await evaluate(`(async () => {
  const handle = document.querySelector('.sidebar-resize-handle')
  const w = () => document.querySelector('.sidebar').getBoundingClientRect().width
  const w0 = w()
  const r = handle.getBoundingClientRect()
  const x0 = r.left + r.width / 2

  handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x0, clientY: r.top + 50 }))
  const cursorDuring = document.body.style.cursor

  // 同一帧内连发 20 次，最终位置 +80px
  for (let i = 1; i <= 20; i++) {
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x0 + i * 4 }))
  }
  const wSameFrame = w()          // 还没到下一帧，应等于 w0

  await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)))
  const wAfterFrame = w()         // 应约等于 w0 + 80

  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x0 + 80 }))
  const wAfterUp = w()
  return { w0, wSameFrame, wAfterFrame, wAfterUp, cursorDuring, cursorAfter: document.body.style.cursor }
})()`)

const grew = out.wAfterFrame - out.w0
check(Math.abs(out.wSameFrame - out.w0) < 1, '同一帧内 20 次 mousemove 未逐次写宽度（已合并）',
  `同帧 ${out.wSameFrame.toFixed(0)}px / 起始 ${out.w0.toFixed(0)}px`)
check(grew > 60 && grew < 100, '下一帧写入最后一个位置（+80px）', `实际 +${grew.toFixed(1)}px`)
check(Math.abs(out.wAfterUp - out.wAfterFrame) < 1, 'mouseup 时补写最后一次坐标，位移不丢')
check(out.cursorDuring === 'col-resize', '拖拽期间光标为 col-resize')
check(out.cursorAfter === '', 'mouseup 后光标复位')

const pass = results.filter(Boolean).length
console.log(`\n结果：${pass}/${results.length} 通过`)
ws.close()
process.exit(pass === results.length ? 0 : 1)
