/**
 * 真机验证：网站关联图谱页（/graph）。
 *
 * 为什么必须真机（单元测试覆盖不了的部分）：
 *  - 「路由 → async chunk → 建图 → 布局 → SVG 渲染」是一条跨层链路，
 *    任何一环断掉页面就是空白 —— 纯函数真值表证不了「页面上真的有东西」；
 *  - 点击节点 → 详情面板 → 邻居列表 →「只看邻居」子图，是渲染与状态联动；
 *  - 滑块/筛选改变后图真的会重算（阈值↑ → 边↓；分类筛选 → 节点↓）；
 *  - 缩放/平移只动外层 transform、不触发节点重排 —— 这是性能设计，只有真机能量化。
 *
 * 覆盖：页面渲染 / 节点边渲染 / 点节点出详情 / 邻居理由可读 / 阈值重算 /
 *      分类筛选 / 只看邻居 / 缩放 / 截图存证。
 *
 * 前置：需要 dist 产物（npm run build）。探针自拉 dist/server.js 与 headless Chrome。
 * 用法：node probe/graph-verify.mjs [cdp-port] [base]
 */
import { writeFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = process.argv[2] || '9393'
const BASE = (process.argv[3] || 'http://127.0.0.1:4212').replace(/\/+$/, '')

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? ` → ${extra}` : ''}`) }
  else { failures.push(`${label}${extra ? ` → ${extra}` : ''}`); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`) }
}

/* ---------------- 服务 + 浏览器：自己拉、自己收 ---------------- */

const alive = async (url) => {
  try { await fetch(url, { signal: AbortSignal.timeout(1200) }); return true } catch { return false }
}
async function waitForAlive(url, ms) {
  const dl = Date.now() + ms
  while (Date.now() < dl) {
    if (await alive(url)) return true
    await new Promise(s => setTimeout(s, 250))
  }
  return false
}

let serverProc = null
const basePort = (BASE.match(/^http:\/\/127\.0\.0\.1:(\d+)/) || [])[1]
if (basePort && !(await alive(BASE + '/'))) {
  if (!existsSync(join(ROOT, 'dist', 'server.js'))) {
    console.error('没有 dist/server.js，先跑 npm run build')
    process.exit(2)
  }
  serverProc = spawn(process.execPath, [join(ROOT, 'dist', 'server.js')],
    { cwd: ROOT, env: { ...process.env, PORT: basePort }, stdio: 'ignore', windowsHide: true })
  console.log(`  （探针自拉 dist 服务，PID ${serverProc.pid}）`)
  if (!(await waitForAlive(BASE + '/api/health', 15000))) {
    console.error(`dist 服务没起来：${BASE}`)
    process.exit(2)
  }
}

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let chromeProc = null
if (!(await alive(`http://127.0.0.1:${PORT}/json/version`))) {
  if (!existsSync(CHROME)) {
    console.error(`找不到浏览器：${CHROME}（可用 CHROME_PATH 指定）`)
    process.exit(2)
  }
  chromeProc = spawn(CHROME, [
    ...(process.env.HEADFUL === '1' ? [] : ['--headless=new']),
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(tmpdir(), 'nav-v2-probe-graph')}`,
    '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--window-size=1440,1000', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  console.log(`  （探针自拉浏览器${process.env.HEADFUL === '1' ? '·有头' : ''}，PID ${chromeProc.pid}）`)
}

const cleanup = () => {
  for (const p of [chromeProc, serverProc]) {
    try { if (p && !p.killed) p.kill() } catch { /* 已退出 */ }
  }
}
process.on('exit', cleanup)

const WATCHDOG_MS = 180000
const watchdog = setTimeout(() => {
  console.error(`\n❌ 探针整体超时（${WATCHDOG_MS}ms）—— 浏览器多半已掉线。强制退出。`)
  cleanup()
  process.exit(3)
}, WATCHDOG_MS)

async function target() {
  for (let i = 0; i < 60; i++) {
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

const t = await target()
const ws = new WebSocket(t.webSocketDebuggerUrl)
let msgId = 0
const pending = new Map()
const consoleErrors = []
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push(String(m.params.args?.[0]?.value || m.params.args?.[0]?.description || '').slice(0, 200))
  }
})
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })

const CDP_TIMEOUT_MS = 15000
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId
  const timer = setTimeout(() => {
    pending.delete(id)
    reject(new Error(`CDP 超时（${method}，${CDP_TIMEOUT_MS}ms）`))
  }, CDP_TIMEOUT_MS)
  pending.set(id, {
    resolve: v => { clearTimeout(timer); resolve(v) },
    reject: e => { clearTimeout(timer); reject(e) },
  })
  ws.send(JSON.stringify({ id, method, params }))
})
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval 抛错')
  return r.result.value
}
const sleep = ms => new Promise(s => setTimeout(s, ms))
const jsonOf = async e => { const s = await evalJs(`JSON.stringify((() => { try { return (${e}) } catch { return null } })())`); return s ? JSON.parse(s) : null }

async function waitFor(expr, timeout = 15000, label = expr) {
  const deadline = Date.now() + timeout
  for (;;) {
    let v = false
    try { v = await evalJs(`(() => { try { return !!(${expr}) } catch { return false } })()`) } catch { /* 导航中文档销毁 */ }
    if (v) return true
    if (Date.now() > deadline) {
      failures.push(`等待超时：${label}`)
      console.log(`  ❌ 等待超时：${label}`)
      return false
    }
    await sleep(150)
  }
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(HERE, name), Buffer.from(r.data, 'base64'))
}

/** 读图谱页的整体渲染状态（节点/边/transform/详情），一次取齐避免多轮往返 */
const stateOf = () => jsonOf(`({
  title: document.querySelector('.gp-title')?.textContent?.trim() || '',
  svg: !!document.querySelector('.gp-svg'),
  nodes: document.querySelectorAll('.gp-node').length,
  edges: document.querySelectorAll('.gp-edge').length,
  labels: document.querySelectorAll('.gp-label').length,
  gTransform: document.querySelector('.gp-svg > g')?.getAttribute('transform') || '',
  detail: !!document.querySelector('.gp-detail'),
  neighbors: document.querySelectorAll('.gp-neighbors .gp-nb').length,
  reasons: [...document.querySelectorAll('.gp-nb-reasons')].map(e => e.textContent.trim()).filter(Boolean).slice(0, 3),
})`)

/* ---------------- 验证 ---------------- */

console.log('\n── 前置 ──')
await evalJs(`location.href = ${JSON.stringify(BASE + '/graph')}`)
await waitFor(`document.querySelector('.gp-svg .gp-node')`, 20000, '图谱页节点渲染出现')

const s0 = await stateOf()
ok(s0.title === '关联图谱', '页面标题渲染', s0.title)
ok(s0.svg, 'SVG 画布存在')
ok(s0.nodes >= 50, '节点数足够（300 站口径）', `${s0.nodes} 个`)
ok(s0.edges > 0, '边已渲染', `${s0.edges} 条`)
ok(s0.labels > 0 && s0.labels < s0.nodes, '标签只给部分节点（不糊成一片）', `${s0.labels}/${s0.nodes}`)

console.log('\n── 1. 点击节点 → 详情面板与邻居理由 ──')
await evalJs(`(() => {
  const nodes = [...document.querySelectorAll('.gp-node')]
  // 挑度数高的节点（半径最大），保证邻居数足够
  nodes.sort((a, b) => (parseFloat(b.querySelector('circle')?.getAttribute('r') || 0)) - (parseFloat(a.querySelector('circle')?.getAttribute('r') || 0)))
  nodes[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return true
})()`)
await waitFor(`document.querySelector('.gp-detail')`, 4000, '详情面板出现')
const s1 = await stateOf()
ok(s1.detail, '详情面板出现')
ok(s1.neighbors > 0, '相关站点列表非空', `${s1.neighbors} 个邻居`)
ok(s1.reasons.length > 0 && s1.reasons.some(r => r.length > 2), '邻居理由可读（不是空文案）', s1.reasons[0] || '')
ok(await evalJs(`!!document.querySelector('.gp-focus')`), '「只看邻居」开关存在')
await shot('graph-detail.png')

console.log('\n── 2. 只看邻居 → 子图收敛 ──')
const beforeSub = await jsonOf(`document.querySelectorAll('.gp-node').length`)
await evalJs(`(() => {
  const c = document.querySelector('.gp-focus input')
  if (!c) return false
  c.click()
  return true
})()`)
await sleep(300)
const afterSub = await jsonOf(`document.querySelectorAll('.gp-node').length`)
ok(afterSub < beforeSub, '开启后节点收敛为子图', `${beforeSub} → ${afterSub}`)
// 收敛后详情仍在
ok(await evalJs(`!!document.querySelector('.gp-detail')`), '子图模式下详情面板仍在')
await evalJs(`(() => { const c = document.querySelector('.gp-focus input'); c && c.click(); return true })()`)
await sleep(200)

console.log('\n── 3. 阈值滑块调高 → 边数下降（图会重算） ──')
const edgesBefore = (await stateOf()).edges
await evalJs(`(() => {
  const sl = document.querySelector('.gp-ctl input[type="range"]')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(sl, '70')
  sl.dispatchEvent(new Event('input', { bubbles: true }))
  sl.dispatchEvent(new Event('change', { bubbles: true }))
  return true
})()`)
let edgesAfter = edgesBefore
for (let i = 0; i < 30; i++) {
  await sleep(250)
  edgesAfter = (await stateOf()).edges
  if (edgesAfter > 0 && edgesAfter < edgesBefore) break
}
ok(edgesAfter < edgesBefore, '阈值 35→70 后边数下降（防「图从不重算」的假接线）', `${edgesBefore} → ${edgesAfter}`)
// 恢复默认阈值
await evalJs(`(() => {
  const sl = document.querySelector('.gp-ctl input[type="range"]')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(sl, '35')
  sl.dispatchEvent(new Event('input', { bubbles: true }))
  sl.dispatchEvent(new Event('change', { bubbles: true }))
  return true
})()`)
await sleep(600)

console.log('\n── 4. 分类筛选 → 节点数收敛 ──')
const nodesBefore = (await stateOf()).nodes
const catOk = await evalJs(`(() => {
  const sel = document.querySelector('.gp-select')
  if (!sel || sel.options.length < 2) return false
  const opt = sel.options[1]
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
  setter.call(sel, opt.value)
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  return opt.value
})()`)
if (catOk) {
  await sleep(400)
  const nodesAfter = (await stateOf()).nodes
  ok(nodesAfter < nodesBefore, '选定分类后节点收敛', `${nodesBefore} → ${nodesAfter}`)
  // 还原
  await evalJs(`(() => {
    const sel = document.querySelector('.gp-select')
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    setter.call(sel, '')
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  await sleep(400)
} else {
  ok(false, '分类下拉有可选项', '下拉为空或只有「全部分类」')
}

console.log('\n── 5. 滚轮缩放 → 只动外层 transform ──')
const trBefore = (await stateOf()).gTransform
await evalJs(`(() => {
  const svg = document.querySelector('.gp-svg')
  const r = svg.getBoundingClientRect()
  svg.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true, cancelable: true,
    clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
    deltaY: -240,
  }))
  return true
})()`)
await sleep(150)
const trAfter = (await stateOf()).gTransform
ok(trAfter !== trBefore && /scale/.test(trAfter), '缩放改变外层 transform', trAfter.slice(0, 60))
ok((await stateOf()).nodes > 0, '缩放后节点仍在（没有重排丢失）')
// 重置视图
await evalJs(`(() => { [...document.querySelectorAll('.gp-btn')].find(b => b.textContent.includes('重置'))?.click(); return true })()`)
await sleep(150)
const trReset = (await stateOf()).gTransform
ok(/scale\(1\)/.test(trReset), '重置视图回到 scale(1)', trReset.slice(0, 40))

console.log('\n── 6. 点空白处取消选中 ──')
// 起点必须先确认「无选中」：选中是 toggle 语义，若一开始就选中着，
// 再点同一个节点反而会把它关掉，测出来的结果就说不清是哪条规则生效
const clickEmpty = `(() => { document.querySelector('.gp-svg').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true })()`
await evalJs(clickEmpty)
await sleep(300)
const cleanStart = !(await evalJs(`!!document.querySelector('.gp-detail')`))

await evalJs(`(() => {
  const nodes = [...document.querySelectorAll('.gp-node')]
  nodes[3]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return true
})()`)
await sleep(300)
const opened = await evalJs(`!!document.querySelector('.gp-detail')`)

await evalJs(clickEmpty)
await sleep(300)
const closed = await evalJs(`!!document.querySelector('.gp-detail')`)
ok(cleanStart && opened && closed === false, '点空白处详情面板关闭',
  `起点无选中=${cleanStart} / 点节点打开=${opened} / 点空白已关闭=${!closed}`)

console.log('\n── 7. 无控制台错误 ──')
ok(consoleErrors.length === 0, '全程无 console.error', consoleErrors.slice(0, 2).join(' | ') || '干净')

console.log('\n── 截图存证 ──')
await shot('graph-overview.png')

clearTimeout(watchdog)
console.log(`\n${failures.length ? '❌' : '✅'} 图谱页真机验证：${pass} 条通过${failures.length ? `，${failures.length} 条失败` : ''}`)
if (failures.length) {
  console.log('\n失败清单：')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
ws.close()
process.exit(0)
