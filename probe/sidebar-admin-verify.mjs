/**
 * 真机验证：站点侧边栏的「管理后台」一级入口。
 *
 * 背景：「管理后台」原先只在「设置」面板里有个按钮，插件 / 部署这些 tab 因此很难找到。
 * 2026-10-16 把它提到侧边栏，并用一条细线与「浏览范围」那组隔开。
 *
 * 覆盖：
 *   ① 侧边栏存在「管理后台」项（文本与 role 都对）
 *   ② 它与「浏览」组之间有分隔线
 *   ③ 它在导航列表的最后（管理类不与浏览类混排）
 *   ④ 渲染不再出现 undefined
 *   ⑤ **点击真的会到 /admin**（这是整条链路的落点，光有按钮不算数）
 *
 * 用法：node probe/sidebar-admin-verify.mjs [cdp-port]
 */
import { writeFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = process.argv[2] || '9398'
const SITE_BASE = (process.env.SITE_BASE || 'http://127.0.0.1:4216').replace(/\/+$/, '')

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? ` → ${extra}` : ''}`) }
  else { failures.push(`${label}${extra ? ` → ${extra}` : ''}`); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`) }
}

const alive = async (url) => {
  try { await fetch(url, { signal: AbortSignal.timeout(1500) }); return true } catch { return false }
}
async function waitForAlive(url, ms) {
  const dl = Date.now() + ms
  while (Date.now() < dl) {
    if (await alive(url)) return true
    await new Promise(s => setTimeout(s, 300))
  }
  return false
}

const procs = []
if (!(await alive(SITE_BASE + '/api/health'))) {
  if (!existsSync(join(ROOT, 'dist', 'server.js'))) { console.error('没有 dist/server.js，先跑 npm run build'); process.exit(2) }
  const p = spawn(process.execPath, [join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT, env: { ...process.env, PORT: '4216' }, stdio: 'ignore', windowsHide: true,
  })
  procs.push(p)
  console.log(`  （自拉站点服务，PID ${p.pid}）`)
  if (!(await waitForAlive(SITE_BASE + '/api/health', 25000))) { console.error('站点服务没起来'); process.exit(2) }
}

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let chromeProc = null
if (!(await alive(`http://127.0.0.1:${PORT}/json/version`))) {
  if (!existsSync(CHROME)) { console.error(`找不到浏览器：${CHROME}`); process.exit(2) }
  chromeProc = spawn(CHROME, [
    ...(process.env.HEADFUL === '1' ? [] : ['--headless=new']),
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(tmpdir(), 'nav-v2-probe-sidebar')}`,
    '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--window-size=1500,1050', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  console.log(`  （自拉浏览器，PID ${chromeProc.pid}）`)
}

const cleanup = () => { for (const p of [...procs, chromeProc]) { try { if (p && !p.killed) p.kill() } catch { /* 已退出 */ } } }
process.on('exit', cleanup)
const watchdog = setTimeout(() => { console.error('\n❌ 探针整体超时，强制退出。'); cleanup(); process.exit(3) }, 150000)

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
const consoleErrors = []
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push(String(m.params.args?.[0]?.value || m.params.args?.[0]?.description || '').slice(0, 160))
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails
    consoleErrors.push(`[异常] ${String(d?.exception?.description || d?.text || '').split('\n')[0].slice(0, 160)}`)
  }
})
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时（${method}）`)) }, 20000)
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
await send('Runtime.enable')
await send('Page.enable')

const sleep = ms => new Promise(s => setTimeout(s, ms))
const jsonOf = async e => { const s = await evalJs(`JSON.stringify((() => { try { return (${e}) } catch { return null } })())`); return s ? JSON.parse(s) : null }
async function waitFor(expr, timeout = 15000, label = expr) {
  const dl = Date.now() + timeout
  for (;;) {
    let v = false
    try { v = await evalJs(`(() => { try { return !!(${expr}) } catch { return false } })()`) } catch { /* 导航中 */ }
    if (v) return true
    if (Date.now() > dl) { failures.push(`等待超时：${label}`); console.log(`  ❌ 等待超时：${label}`); return false }
    await sleep(200)
  }
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(HERE, name), Buffer.from(r.data, 'base64'))
}

/* ---------------- 侧边栏 ---------------- */

console.log('\n── 站点侧边栏 · 管理后台入口 ──')
await evalJs(`location.href = ${JSON.stringify(SITE_BASE + '/')}`)
await send('Runtime.enable')
await send('Page.enable')
await waitFor(`document.querySelector('.sidebar .sidebar-nav')`, 25000, '首页加载')
await sleep(1200)

const bar = await jsonOf(`({
  items: [...document.querySelectorAll('.sidebar .sidebar-nav-item')].map(e => e.textContent.trim()),
  hasAdmin: !!document.querySelector('.sidebar .sidebar-nav-admin'),
  adminText: document.querySelector('.sidebar .sidebar-nav-admin')?.textContent?.trim() || '',
  hasDivider: !!document.querySelector('.sidebar-nav-divider'),
  dividerBeforeAdmin: (() => {
    const nav = document.querySelector('.sidebar .sidebar-nav')
    if (!nav) return false
    const kids = [...nav.children]
    const di = kids.findIndex(k => k.classList.contains('sidebar-nav-divider'))
    const ai = kids.findIndex(k => k.classList.contains('sidebar-nav-admin'))
    return di >= 0 && ai === di + 1
  })(),
  adminIsLast: (() => {
    const nav = document.querySelector('.sidebar .sidebar-nav')
    if (!nav) return false
    const items = [...nav.querySelectorAll('.sidebar-nav-item')]
    return items.length > 0 && items[items.length - 1].classList.contains('sidebar-nav-admin')
  })(),
  role: document.querySelector('.sidebar .sidebar-nav-admin')?.getAttribute('role') || '',
  noUndefined: !document.querySelector('.sidebar')?.textContent?.includes('undefined'),
})`)

ok(bar.hasAdmin, '侧边栏有「管理后台」项')
ok(bar.adminText === '管理后台', '文案正确', bar.adminText)
ok(bar.items.length === 9, '侧边栏 9 项（原 8 + 管理后台）', bar.items.join(' / '))
ok(bar.hasDivider, '有分组分隔线')
ok(bar.dividerBeforeAdmin, '分隔线紧邻「管理后台」之前（分组正确）')
ok(bar.adminIsLast, '「管理后台」在导航末尾（管理类不与浏览类混排）')
ok(bar.role === 'button', '可点击要素（role=button）')
ok(bar.noUndefined, '侧边栏没有 undefined')
// 截图要在点击**之前** —— 点完就跳到 /admin（独立页，没有侧边栏），截到的会是登录页
await shot('sidebar-admin-entry.png')

/* ---------------- 点击真的到 /admin ---------------- */

await evalJs(`(() => { document.querySelector('.sidebar .sidebar-nav-admin').click(); return true })()`)
await waitFor(`location.pathname === '/admin'`, 12000, '跳转到 /admin')
const landed = await jsonOf(`({ path: location.pathname, hasBody: !!document.querySelector('.admin-body'), hasTabs: !!document.querySelector('.admin-tabs') })`)
ok(landed.path === '/admin', '点击后到达 /admin', landed.path)
ok(landed.hasBody, '/admin 页面已渲染（登录页或后台都算）')

console.log('\n── 控制台错误 ──')
ok(consoleErrors.filter(e => !/favicon|clicks|health|api\/sites/i.test(e)).length === 0,
  '全程无非预期 console.error', consoleErrors.slice(0, 2).join(' | ').slice(0, 140) || '干净')

clearTimeout(watchdog)
console.log(`\n${failures.length ? '❌' : '✅'} 侧边栏入口真机验证：${pass} 条通过${failures.length ? `，${failures.length} 条失败` : ''}`)
process.exit(failures.length ? 1 : 0)
