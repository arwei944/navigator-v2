/**
 * 真机验证：管理后台改为**三栏套壳**后的结构、右栏联动与视觉一致性。
 *
 * 覆盖：
 *   ① 后台下三栏都在（左导航 / 中内容 / 右信息栏），不再是整页独立
 *   ② 左栏「管理后台」高亮
 *   ③ 右栏显示**当前模块**的说明（不是站点详情的空态）
 *   ④ 切换 tab 时右栏跟着变（说明与相关模块跳转都换）
 *   ⑤ 右栏的快捷跳转真的能切模块
 *   ⑥ 中栏宽度没被挤爆 / 页面没有横向滚动条
 *   ⑦ 版本标识、无 undefined
 *
 * 用法：node probe/admin-3col-verify.mjs [cdp-port]
 */
import { writeFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = process.argv[2] || '9402'
const SITE_BASE = (process.env.SITE_BASE || 'http://127.0.0.1:4218').replace(/\/+$/, '')

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
    cwd: ROOT, env: { ...process.env, PORT: '4218' }, stdio: 'ignore', windowsHide: true,
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
    `--user-data-dir=${join(tmpdir(), 'nav-v2-probe-3col')}`,
    '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--window-size=1600,1000', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  console.log(`  （自拉浏览器，PID ${chromeProc.pid}）`)
}

const cleanup = () => { for (const p of [...procs, chromeProc]) { try { if (p && !p.killed) p.kill() } catch { /* 已退出 */ } } }
process.on('exit', cleanup)
const watchdog = setTimeout(() => { console.error('\n❌ 探针整体超时，强制退出。'); cleanup(); process.exit(3) }, 180000)

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
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时（${method}）`)) }, 25000)
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

/* ---------------- 三栏结构 ---------------- */

console.log('\n── ① 三栏结构 ──')
await evalJs(`location.href = ${JSON.stringify(SITE_BASE + '/admin')}`)
await send('Runtime.enable')
await send('Page.enable')
// 本机自动登录 → 直接进后台
await waitFor(`document.querySelector('.admin-tabs')`, 30000, '进入后台')
await sleep(1200)

const shell = await jsonOf(`({
  hasLeft: !!document.querySelector('.sidebar .sidebar-nav'),
  hasMain: !!document.querySelector('main.main'),
  hasRight: !!document.querySelector('.right-sidebar'),
  adminInMain: !!document.querySelector('main.main .admin-view'),
  noStandalone: !document.querySelector('.admin-view') || !!document.querySelector('.app-layout'),
  leftItems: [...document.querySelectorAll('.sidebar .sidebar-nav-item')].map(e => e.textContent.trim()),
  adminNavActive: (() => {
    const a = [...document.querySelectorAll('.sidebar .sidebar-nav-item')].find(i => i.textContent.trim() === '管理后台')
    return a ? a.classList.contains('active') : false
  })(),
  rightWidth: Math.round((document.querySelector('.right-sidebar')?.getBoundingClientRect().width) || 0),
  hScroll: document.documentElement.scrollWidth > window.innerWidth + 2,
  mainW: Math.round((document.querySelector('main.main')?.getBoundingClientRect().width) || 0),
})`)

ok(shell.hasLeft, '左栏在')
ok(shell.hasMain, '中栏（main）在')
ok(shell.hasRight, '右栏在')
ok(shell.adminInMain, '后台内容渲染在 main 里（不再是整页独立）')
ok(shell.noStandalone, '不再是 standalone 布局')
ok(shell.adminNavActive, '左栏「管理后台」处于高亮')
ok(!shell.hScroll, '页面没有横向滚动条')
ok(shell.rightWidth > 100, '右栏有实际宽度（没被挤没）', `${shell.rightWidth}px`)
ok(shell.mainW > 300, '中栏宽度合理', `${shell.mainW}px`)

/* ---------------- 右栏跟随模块 ---------------- */

console.log('\n── ② 右栏跟随当前模块 ──')
const aside = await jsonOf(`({
  hasAside: !!document.querySelector('.admin-aside'),
  title: document.querySelector('.admin-aside .aa-title')?.textContent?.trim() || '',
  desc: document.querySelector('.admin-aside .aa-desc')?.textContent?.trim() || '',
  labels: [...document.querySelectorAll('.admin-aside .aa-label')].map(e => e.textContent.trim()),
  stats: [...document.querySelectorAll('.admin-aside .aa-stats dt')].map(e => e.textContent.trim()),
  links: [...document.querySelectorAll('.admin-aside .aa-link-name')].map(e => e.textContent.trim()),
  notSiteDetail: !document.querySelector('.right-sidebar .empty-state'),
})`)

ok(aside.hasAside, '右栏渲染的是模块说明（AdminAside）')
ok(aside.notSiteDetail, '右栏不再是「站点详情」空态')
ok(aside.title === '概览', '默认 tab 的说明正确', aside.title)
ok(aside.desc.length > 6, '有说明文字', aside.desc.slice(0, 30))
ok(aside.stats.length >= 3, '概览里有指标数字', aside.stats.join('、'))
await shot('admin-3col-overview.png')

// 切到「插件」
await evalJs(`(() => {
  const tab = [...document.querySelectorAll('.admin-tab')].find(t => t.textContent.trim() === '插件')
  if (tab) tab.click(); return !!tab
})()`)
await sleep(900)
const aside2 = await jsonOf(`({
  title: document.querySelector('.admin-aside .aa-title')?.textContent?.trim() || '',
  desc: document.querySelector('.admin-aside .aa-desc')?.textContent?.trim() || '',
  tips: [...document.querySelectorAll('.admin-aside .aa-tips li')].map(e => e.textContent.trim()),
  url: location.search,
})`)
ok(aside2.title === '插件', '切 tab 后右栏标题跟着变', aside2.title)
ok(aside2.title !== aside.title, '右栏内容确实换了（不是静态的）')
ok(aside2.tips.length >= 1, '插件模块有「要点」', aside2.tips[0]?.slice(0, 30) || '')
ok(/tab=plugins/.test(aside2.url), 'tab 进了 URL（可刷新/可分享）', aside2.url)
await shot('admin-3col-plugins.png')

console.log('\n── ③ 右栏快捷跳转 ──')
await evalJs(`(() => {
  const tab = [...document.querySelectorAll('.admin-tab')].find(t => t.textContent.trim() === '站点管理')
  if (tab) tab.click(); return !!tab
})()`)
await sleep(800)
const jumped = await evalJs(`(() => {
  const btn = document.querySelector('.admin-aside .aa-link')
  if (!btn) return 'no-link'
  const name = btn.querySelector('.aa-link-name')?.textContent?.trim() || ''
  btn.click()
  return name
})()`)
ok(jumped !== 'no-link', '站点管理模块有相关模块可跳', String(jumped))
await sleep(800)
const afterJump = await jsonOf(`({
  tab: document.querySelector('.admin-tab.active')?.textContent?.trim() || '',
  asideTitle: document.querySelector('.admin-aside .aa-title')?.textContent?.trim() || '',
})`)
ok(afterJump.tab.length > 0, '跳转后切到了另一个模块', afterJump.tab)
ok(afterJump.asideTitle.length > 0 && afterJump.asideTitle !== '站点管理', '右栏也跟着换了', afterJump.asideTitle)

console.log('\n── ④ 版本与健壮性 ──')
const head = await jsonOf(`({
  version: document.querySelector('.admin-version')?.textContent?.trim() || '',
  noUndefined: !document.querySelector('.admin-view')?.textContent?.includes('undefined'),
  asideNoUndefined: !document.querySelector('.admin-aside')?.textContent?.includes('undefined'),
})`)
ok(head.version.length > 0, '版本标识仍在', head.version)
ok(head.noUndefined, '中栏没有 undefined')
ok(head.asideNoUndefined, '右栏没有 undefined')

console.log('\n── 控制台错误 ──')
ok(consoleErrors.filter(e => !/favicon|clicks|health|api\/sites|_local-key/i.test(e)).length === 0,
  '全程无非预期 console.error', consoleErrors.slice(0, 2).join(' | ').slice(0, 140) || '干净')

clearTimeout(watchdog)
console.log(`\n${failures.length ? '❌' : '✅'} 三栏后台真机验证：${pass} 条通过${failures.length ? `，${failures.length} 条失败` : ''}`)
process.exit(failures.length ? 1 : 0)
