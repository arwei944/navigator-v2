/**
 * 真机验证：**纯静态托管**下的「添加站点 → 自动补全」降级路径。
 *
 * 背景：`/api/metadata`（Vercel 函数）随静态托管一起消失，自动补全会 404。
 * 兜底是在浏览器里跑与服务端同一个 `inferSite` 引擎（传空 HTML）。
 * 本脚本验证的是用户真正在意的事：粘贴一个网址后，弹窗**到底填上了什么**，
 * 以及界面有没有如实说明「哪些是推断值」。
 *
 * 前置：静态服务（`python -m http.server` 起 `dist/`，不要用 vite preview —— 它有
 * SPA 兜底会掩盖问题）+ 无头 Chrome。
 * 用法：node probe/verify-add-autofill.mjs <cdp-port> [base]
 */
import { writeFileSync } from 'node:fs'

const PORT = process.argv[2] || '9347'
const BASE = process.argv[3] || 'http://127.0.0.1:4174'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? ` → ${extra}` : ''}`) }
  else { failures.push(`${label}${extra ? ` → ${extra}` : ''}`); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`) }
}

async function targets() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await r.json()
      const page = list.find(t => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* 还没起来 */ }
    await new Promise(s => setTimeout(s, 500))
  }
  throw new Error(`连不上 CDP ${PORT}`)
}

const target = await targets()
const ws = new WebSocket(target.webSocketDebuggerUrl)
let msgId = 0
const pending = new Map()
const events = []

ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
  } else if (m.method) events.push(m)
})
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params }))
})
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval 抛错')
  return r.result.value
}
const sleep = ms => new Promise(s => setTimeout(s, ms))

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

console.log(`\n▶ 自动补全降级验证  BASE=${BASE}\n`)

await send('Page.navigate', { url: BASE + '/' })
await sleep(3500)

/* ---------- 1. 打开弹窗 ---------- */
const opened = await evalJs(`(() => {
  const btn = document.querySelector('.add-site-btn')
  if (!btn) return 'no-btn'
  btn.click()
  return 'ok'
})()`)
ok(opened === 'ok', '工具栏「添加网站」按钮可点')
await sleep(1500)

const modalUp = await evalJs(`(() => {
  const input = document.querySelector('.modal input, [class*="modal"] input, input[placeholder*="网址"]')
  return input ? 'ok' : 'no-modal'
})()`)
ok(modalUp === 'ok', '添加站点弹窗已打开（异步组件能加载）')

/* ---------- 2. 输入一个**未知**域名，看本地推断填了什么 ---------- */
/**
 * 输入网址后轮询等抓取完成。**不能睡固定时长**：抓取上限是 12s，慢站（github.com
 * 实测 ~9s）在固定 3.5s 的等待里还没回来，会被误判成「没填上」。
 */
const waitForMeta = async () => {
  for (let i = 0; i < 30; i++) {
    const st = await evalJs(`(document.querySelector('.form-status, [class*="status"]')||{}).textContent || ''`)
    if (st && !/正在抓取/.test(st)) return st
    await sleep(500)
  }
  return '(等待超时)'
}

const fill = await evalJs(`(async () => {
  const input = document.querySelector('.modal input, [class*="modal"] input, input[placeholder*="网址"]')
  if (!input) return 'no-input'
  input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  input.focus()
  input.value = 'https://tapecode.ai/'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return 'ok'
})()`)
ok(fill === 'ok', '已输入目标网址 https://tapecode.ai/')
await sleep(800)               // onUrlInput 的 600ms 防抖
await waitForMeta()

const state = JSON.parse(await evalJs(`JSON.stringify((() => {
  const q = s => document.querySelector(s)
  const modal = q('.modal, [class*="modal"]') || document.body
  const inputs = [...modal.querySelectorAll('input')]
  const status = q('.form-status, [class*="status"]')
  return {
    name: inputs[1]?.value ?? '',
    desc: (modal.querySelector('textarea')||{}).value ?? '',
    statusText: status?.textContent?.trim() || '',
    hasFaviconPreview: !!modal.querySelector('img.favicon-preview, img[alt="favicon"]'),
    bodyHasJsonError: /Unexpected token|is not valid JSON/.test(document.body.innerText),
  }
})())`))

console.log(`\n  📋 弹窗内容：name="${state.name}" desc="${state.desc.slice(0, 40)}"`)
console.log(`     status="${state.statusText}"\n`)

/**
 * 部署形态决定走哪条路径，两条都必须是「填上了」且「说实话」：
 *   - Node 服务（含 /api/metadata）→ 真实抓取，状态栏「已补全：…」
 *   - 纯静态托管 → 本地推断，状态栏「后端抓取不可用，已按域名推断…」
 * 唯一不能接受的是：空白 + 报错（现在的失败态），或 JSON 解析错误外泄。
 */
const realFetch = /已补全/.test(state.statusText)
const localInfer = /已按域名推断/.test(state.statusText)
ok(realFetch || localInfer, '自动补全成功（真实抓取或本地推断二选一）',
  realFetch ? '真实抓取' : localInfer ? '本地推断' : state.statusText)
ok(state.name.trim().length > 0, '名称被自动填上了（不再是空白 + 报错）', state.name)
ok(state.desc.trim().length > 0, '描述被自动填上了', state.desc.slice(0, 40))
ok(!state.bodyHasJsonError, '界面没有 JSON 解析错误外泄')
ok(state.hasFaviconPreview, '图标预览出现了')
if (realFetch) {
  // 真实抓取的描述来自对方页面的 meta/title，不会是「XX（域名）——…方向」这种模板句式
  ok(!new RegExp(`${state.name}（.*）——`).test(state.desc),
    '描述不是本地生成的模板话（是站点自己的描述）', state.desc.slice(0, 40))
}

/* ---------- 3. 输入一个**已收录**域名，确认同样能填上 ---------- */
await evalJs(`(async () => {
  const input = document.querySelector('.modal input, [class*="modal"] input, input[placeholder*="网址"]')
  input.focus()
  input.value = 'https://github.com/'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return 'ok'
})()`)
await sleep(800)
const knownStatus = await waitForMeta()
const known = JSON.parse(await evalJs(`JSON.stringify((() => {
  const modal = document.querySelector('.modal, [class*="modal"]') || document.body
  const inputs = [...modal.querySelectorAll('input')]
  return { name: inputs[1]?.value ?? '', status: (document.querySelector('.form-status, [class*="status"]')||{}).textContent?.trim() || '' }
})())`))
// 两种路径都对：真实抓取 → 页面自己的 <title>（比「沿用已收录名」更准，引擎只在
// 名称来源是域名推断时才做 known-site 替换）；本地推断 → 沿用已收录名。
// github.com 从本机抓取实测 ~9s，是探针里最慢的一步。
ok(known.name.trim().length > 0 && !/（github\.com）——/.test(known.name),
  '已收录域名也能填上名称（真实标题或沿用已收录名）', known.name.slice(0, 40))

/* ---------- 截图 ---------- */
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('probe/add-autofill.png', Buffer.from(shot.data, 'base64'))
console.log('\n  📸 截图已保存 probe/add-autofill.png')

ws.close()

console.log('')
if (failures.length) {
  console.error(`❌ 自动补全降级 ${failures.length} 项失败（通过 ${pass} 项）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`✅ 自动补全降级全部通过：${pass} 项断言`)
process.exit(0)
