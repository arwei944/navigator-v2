/**
 * 第三批 · 序 27 的**真机渲染**验收：离线 / 读取失败时，界面到底有没有说出来。
 *
 * 为什么不能只靠单测：这一项的全部价值就在「用户看得见」。`cloudError` 这个状态只要
 * 有一个环节接错（computed 名写错、模板放在会被层叠盖住的位置、tone 类没生效导致
 * 深色主题下不可读），状态码测试全是绿的，而用户依旧面对一张「看起来正常但不动」的网格。
 *
 * 做法：用零依赖 CDP 驱动 headless Chrome，在文档加载前把 `window.fetch` 打桩，
 * 让 `/api/sites` 按我们指定的方式失败，再看真实 DOM。
 * 同一个页面跑两遍：一遍正常（不该出现提示条）、一遍失败（必须出现且文案可读）。
 *
 * 用法:
 *   "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new \
 *     --remote-debugging-port=9348 --user-data-dir=<tmp> --disable-gpu --hide-scrollbars \
 *     --window-size=1440,1000 --proxy-server="http://127.0.0.1:7897" \
 *     --proxy-bypass-list="localhost;127.0.0.1" about:blank
 *   node probe/verify-batch3-ui.mjs 9348 [base-url]
 */
const PORT = process.argv[2] || '9348'
const BASE = process.argv[3] || 'https://navigator-v2-two.vercel.app'

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl)
if (!page) throw new Error('没有可用的 Chrome 页面')

const ws = new WebSocket(page.webSocketDebuggerUrl)
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

/** 在文档加载前打桩：把 /api/sites 的 fetch 变成我们指定的行为 */
const stub = mode => `
(() => {
  const real = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    if (url.includes('/api/sites')) {
      ${mode === 'offline'
        ? "return Promise.reject(new TypeError('Failed to fetch'))"
        : `return Promise.resolve(new Response(JSON.stringify({ error: 'boom' }), { status: 500, headers: { 'content-type': 'application/json' } }))`}
    }
    return real(input, init)
  }
})()
`

console.log(`\n=== 序 27 界面验收：${BASE} ===\n`)

/* ---------- 第一遍：正常加载 ---------- */
console.log('[1] 正常场景：不应出现提示条')
await send('Page.navigate', { url: BASE + '/' })
await sleep(6000)
const cardsNormal = await evaluate(`document.querySelectorAll('.card').length`)
check(cardsNormal > 0, `页面渲染出卡片（${cardsNormal} 张）`)
const noticeNormal = await evaluate(`document.querySelector('.cloud-notice') ? document.querySelector('.cloud-notice').textContent.trim() : ''`)
check(noticeNormal === '', '一切正常时提示条不出现（不制造无谓噪音）', noticeNormal || '（无）')

/* ---------- 第二遍：接口失败 ---------- */
console.log('\n[2] /api/sites 网络失败：必须明确说出来')
// 每次导航前重打桩（addScriptToEvaluateOnNewDocument 只对**之后**的文档生效）
await send('Page.addScriptToEvaluateOnNewDocument', { source: stub('offline') })
await send('Page.navigate', { url: BASE + '/?probe=offline' })
await sleep(7000)

const info = await evaluate(`(() => {
  const el = document.querySelector('.cloud-notice')
  if (!el) return { found: false }
  const style = getComputedStyle(el)
  const btn = el.querySelector('.cloud-notice-btn')
  return {
    found: true,
    text: el.textContent.trim(),
    cls: el.className,
    color: style.color,
    bg: style.backgroundColor,
    borderLeft: style.borderLeftColor,
    btn: btn ? btn.textContent.trim() : '',
    btnVisible: btn ? getComputedStyle(btn).display !== 'none' : false,
    // 是否被其它浮层盖住：抽查提示条自身中心点的实际命中元素
    hitTest: (() => {
      const r = el.getBoundingClientRect()
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(10, r.height / 2))
      return el.contains(top) || el === top
    })(),
    rect: (() => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) } })(),
  }
})()`)

check(info.found, '提示条出现了')
if (info.found) {
  check(/离线|网络|失败|无法/.test(info.text), '文案是人能看懂的原因（不是错误码）', info.text)
  check(info.hitTest, '提示条没有被其它浮层盖住（可点可读）')
  check(info.btn === '重试' && info.btnVisible, '带「重试」按钮', info.btn)
  check(info.rect.h > 0 && info.rect.w > 0, `有实际尺寸 ${info.rect.w}×${info.rect.h}`, `top=${info.rect.top}`)
  check(!/#000000|rgba\(0, 0, 0, 0\)/.test(info.bg), '有背景色（不是透明贴字）', `bg=${info.bg}`)
  console.log(`     类名=${info.cls}  文字色=${info.color}  背景=${info.bg}  左边框=${info.borderLeft}`)
}

const cardsOffline = await evaluate(`document.querySelectorAll('.card').length`)
check(cardsOffline > 0, `接口失败时仍渲染本地兜底内容（${cardsOffline} 张卡），不是白屏`)

/* ---------- 截图留档 ---------- */
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot?.data) {
  const { writeFileSync } = await import('node:fs')
  const out = new URL('./_ui-offline.png', import.meta.url)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log(`\n已截图：${out.pathname.replace(/^\//, '')}`)
}

/* ---------- 汇总 ---------- */
const failed = results.filter(r => !r).length
console.log('\n──────────────────────────────')
if (failed === 0) {
  console.log(`✅ 序 27 界面验收全部通过：${results.length} 项`)
  ws.close()
} else {
  console.log(`❌ 序 27 界面验收：${results.length - failed} 通过 / ${failed} 失败`)
  ws.close()
  process.exit(1)
}
