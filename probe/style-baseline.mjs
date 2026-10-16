/**
 * 采集**视觉语言值域**，供「20 种布局与现有风格的一致性」量化打分用。
 *
 * 为什么基准要这样取：
 *   中间区正是**要被替换的对象**，拿它当基准等于自己证明自己。
 *   所以打分基准 = 主站页面（首页 / 收藏 / 洞察 / 图谱）+ 后台里**不变的部分**
 *   （左侧栏 / 右侧栏 / 头部）—— 也就是「改造后仍然存在的那套视觉语言」。
 *   后台 13 个面板的现状单列一份，只作参考（用来说明现状自己就漂移到哪了）。
 *
 * 输出：docs/admin-style-baseline.json
 * 用法：node probe/style-baseline.mjs [cdp-port]
 */
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = process.argv[2] || '9422'
const SITE_BASE = (process.env.SITE_BASE || 'http://127.0.0.1:4218').replace(/\/+$/, '')

const alive = async (u) => { try { await fetch(u, { signal: AbortSignal.timeout(1500) }); return true } catch { return false } }
async function waitForAlive(u, ms) { const dl = Date.now() + ms; while (Date.now() < dl) { if (await alive(u)) return true; await new Promise(s => setTimeout(s, 300)) } return false }

const procs = []
if (!(await alive(SITE_BASE + '/api/health'))) {
  if (!existsSync(join(ROOT, 'dist', 'server.js'))) { console.error('没有 dist/server.js，先 npm run build'); process.exit(2) }
  const p = spawn(process.execPath, [join(ROOT, 'dist', 'server.js')], { cwd: ROOT, env: { ...process.env, PORT: '4218' }, stdio: 'ignore', windowsHide: true })
  procs.push(p)
  console.log(`  （自拉站点服务，PID ${p.pid}）`)
  if (!(await waitForAlive(SITE_BASE + '/api/health', 25000))) { console.error('站点服务没起来'); process.exit(2) }
}

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let chromeProc = null
if (!(await alive(`http://127.0.0.1:${PORT}/json/version`))) {
  if (!existsSync(CHROME)) { console.error(`找不到浏览器：${CHROME}`); process.exit(2) }
  chromeProc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(tmpdir(), 'nav-v2-probe-baseline')}`,
    '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--window-size=1600,1000', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  console.log(`  （自拉浏览器，PID ${chromeProc.pid}）`)
}
const cleanup = () => { for (const p of [...procs, chromeProc]) { try { if (p && !p.killed) p.kill() } catch { /* 已退出 */ } } }
process.on('exit', cleanup)
const watchdog = setTimeout(() => { console.error('\n❌ 探针整体超时'); cleanup(); process.exit(3) }, 300000)

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
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
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
  }
})
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时（${method}）`)) }, 30000)
  pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v) }, reject: e => { clearTimeout(timer); reject(e) } })
  ws.send(JSON.stringify({ id, method, params }))
})
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval 抛错')
  return r.result.value
}
await send('Runtime.enable'); await send('Page.enable')
const sleep = ms => new Promise(s => setTimeout(s, ms))
const jsonOf = async e => { const s = await evalJs(`JSON.stringify((() => { try { return (${e}) } catch { return null } })())`); return s ? JSON.parse(s) : null }

const PROPS = ['fontSize', 'fontWeight', 'borderTopLeftRadius', 'borderTopRightRadius',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'rowGap', 'columnGap',
  'color', 'backgroundColor', 'borderTopColor', 'boxShadow']

// 在页面里跑的采集函数：返回 (prop → {值: 次数}) + 元素数
const collector = (rootSel) => `(() => {
  const root = document.querySelector(${JSON.stringify(rootSel)})
  if (!root) return null
  const PROPS = ${JSON.stringify(PROPS)}
  const bag = {}
  const bump = (k, v) => { if (v == null || v === '') return; bag[k] = bag[k] || {}; bag[k][v] = (bag[k][v] || 0) + 1 }
  let n = 0
  for (const el of root.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    n++
    for (const p of PROPS) bump(p, cs[p])
  }
  return { elements: n, bag }
})()`

const merge = (dst, bag) => {
  for (const [prop, vals] of Object.entries(bag || {})) {
    dst[prop] = dst[prop] || {}
    for (const [v, c] of Object.entries(vals)) dst[prop][v] = (dst[prop][v] || 0) + c
  }
}

async function goto(path) {
  await evalJs(`location.href = ${JSON.stringify(SITE_BASE + path)}`)
  await send('Runtime.enable'); await send('Page.enable')
  await sleep(2200)
}

/* ---------- ① 打分基准：主站页面 + 后台不变部分 ---------- */

const baseBag = {}
let baseElements = 0
const samples = []
for (const [path, sel, label] of [
  ['/', '.app-layout', '首页'],
  ['/favorites', '.app-layout', '收藏'],
  ['/insights', '.app-layout', '洞察'],
  ['/graph', '.app-layout', '关联图谱'],
]) {
  await goto(path)
  const r = await jsonOf(collector(sel))
  if (!r) { console.log(`  ✗ ${label}：选择器 ${sel} 没命中`); continue }
  merge(baseBag, r.bag)
  baseElements += r.elements
  samples.push({ label, elements: r.elements })
  console.log(`  ✓ 基准 · ${label}：${r.elements} 个元素`)
}

// 后台里不变的部分：两侧栏 + 头部（中间区将被替换，不入基准）
await goto('/admin')
await sleep(1800)
for (const [sel, label] of [['.sidebar', '左侧栏'], ['.right-sidebar', '右侧栏'], ['.admin-header', '后台头部']]) {
  const r = await jsonOf(collector(sel))
  if (!r) { console.log(`  ✗ ${label}：没命中`); continue }
  merge(baseBag, r.bag)
  baseElements += r.elements
  samples.push({ label: `后台 · ${label}`, elements: r.elements })
  console.log(`  ✓ 基准 · ${label}：${r.elements} 个元素`)
}

/* ---------- ② 参考：后台 13 个面板的现状 ---------- */

const adminBag = {}
let adminElements = 0
const tabCount = Number(await evalJs(`document.querySelectorAll('.admin-tabs button, .admin-tabs a').length`)) || 0
const tabLabels = (await jsonOf(`[...document.querySelectorAll('.admin-tabs button, .admin-tabs a')].map(b => b.textContent.trim())`)) || []
const panes = []
for (let i = 0; i < tabCount; i++) {
  await evalJs(`(() => { const bs=[...document.querySelectorAll('.admin-tabs button, .admin-tabs a')]; if(bs[${i}]) bs[${i}].click() })()`)
  await sleep(650)
  const r = await jsonOf(collector('.admin-view'))
  if (!r) continue
  merge(adminBag, r.bag)
  adminElements += r.elements
  panes.push({ tab: tabLabels[i] || `#${i}`, elements: r.elements })
}
console.log(`  ✓ 参考 · 后台 ${panes.length} 个面板：${adminElements} 个元素`)

/* ---------- 输出 ---------- */

// 出现次数太少的记进来只会是噪声（内容里的偶然值），但阈值不能高到丢掉真正的设计语言
const prune = (obj, min) => Object.fromEntries(
  Object.entries(obj || {}).filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1]))

const out = {
  note: '打分基准 = 主站页面 + 后台不变部分（两侧栏/头部）；后台 13 面板现状单列为参考',
  source: 'probe/style-baseline.mjs（本地 dist + 本机自动登录，1600×1000）',
  baseline: { samples, elements: baseElements, values: {} },
  adminNow: { panes, elements: adminElements, values: {} },
}
for (const [p, v] of Object.entries(baseBag)) out.baseline.values[p] = prune(v, 2)
for (const [p, v] of Object.entries(adminBag)) out.adminNow.values[p] = prune(v, 3)

mkdirSync(join(ROOT, 'docs'), { recursive: true })
writeFileSync(join(ROOT, 'docs', 'admin-style-baseline.json'), JSON.stringify(out))
console.log(`\n已写出 docs/admin-style-baseline.json（基准 ${baseElements} 元素 / 参考 ${adminElements} 元素）`)
for (const p of ['borderTopLeftRadius', 'fontSize', 'backgroundColor', 'boxShadow']) {
  console.log(`  基准 ${p}：${Object.entries(out.baseline.values[p] || {}).slice(0, 8).map(([k, c]) => k + '×' + c).join('  ')}`)
}
clearTimeout(watchdog)
cleanup()
process.exit(0)
