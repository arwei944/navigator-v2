/**
 * 真机验证：侧栏文字居中。
 *
 * 背景：侧栏原先整体左对齐（`[图标] 文字 …… [角标]`）。2026-10-18 按需求改为
 * 「品牌名 + 导航文字都居中」—— 图标 + 文字作为整体居中，角标 / 版本号改绝对定位贴右
 * （它们若留在 flex 流里会被一起推到中间）。
 *
 * 覆盖：
 *   ① 品牌（logo + Navigator）在侧栏水平居中
 *   ② 导航项（图标 + 文字）在侧栏水平居中
 *   ③ 角标仍贴该项右缘（没被居中推到中间）
 *   ④ 版本号仍贴「关于」项右缘
 *   ⑤ 侧栏无 undefined、无 console.error
 *
 * 用法：node probe/sidebar-center-verify.mjs [cdp-port]
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
    `--user-data-dir=${join(tmpdir(), 'nav-v2-probe-sidebar-center')}`,
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

/* ---------------- 侧栏居中 ---------------- */

console.log('\n── 站点侧栏 · 文字居中 ──')
await evalJs(`location.href = ${JSON.stringify(SITE_BASE + '/')}`)
await send('Runtime.enable')
await send('Page.enable')
await waitFor(`document.querySelector('.sidebar .sidebar-nav')`, 25000, '首页加载')
await sleep(1200)

const r = await jsonOf(`(() => {
  const sb = document.querySelector('.sidebar').getBoundingClientRect()
  const sbCenter = sb.left + sb.width / 2

  const header = document.querySelector('.sidebar .sidebar-header')
  const hb = header.getBoundingClientRect()
  const logo = header.querySelector('.sidebar-logo')
  const brand = header.querySelector('.sidebar-brand')
  const hContentCenter = (logo.getBoundingClientRect().left + brand.getBoundingClientRect().right) / 2

  const items = [...document.querySelectorAll('.sidebar .sidebar-nav-item')]
  // 取一个没有角标 / 版本号的项测「纯图标 + 文字」的居中，避免绝对定位元素干扰
  const plain = items.find(e => !e.querySelector('.badge') && !e.querySelector('.nav-version'))
  const pb = plain.getBoundingClientRect()
  const svg = plain.querySelector('svg')
  const lbl = plain.querySelector('span:not(.badge):not(.nav-version)')
  const pContentCenter = (svg.getBoundingClientRect().left + lbl.getBoundingClientRect().right) / 2

  const withBadge = items.find(e => e.querySelector('.badge'))
  let badgeGap = null
  if (withBadge) {
    const bb = withBadge.getBoundingClientRect()
    const bd = withBadge.querySelector('.badge').getBoundingClientRect()
    badgeGap = Math.round(bb.right - bd.right)
  }

  const about = items.find(e => e.querySelector('.nav-version'))
  let verGap = null
  if (about) {
    const ab = about.getBoundingClientRect()
    const vb = about.querySelector('.nav-version').getBoundingClientRect()
    verGap = Math.round(ab.right - vb.right)
  }

  return {
    sidebarWidth: Math.round(sb.width),
    headerOffset: Math.round(hContentCenter - (hb.left + hb.width / 2)),
    headerVsSidebar: Math.round(hContentCenter - sbCenter),
    plainLabel: lbl.textContent.trim(),
    itemOffset: Math.round(pContentCenter - (pb.left + pb.width / 2)),
    badgeGap, verGap,
    undefinedText: !!document.querySelector('.sidebar')?.textContent?.includes('undefined'),
  }
})()`)

ok(r !== null && r.sidebarWidth > 0, '侧栏已渲染', r ? `${r.sidebarWidth}px 宽` : '')
ok(Math.abs(r.headerVsSidebar) <= 4, '品牌（logo + Navigator）在侧栏水平居中', `偏差 ${r.headerVsSidebar}px`)
ok(Math.abs(r.itemOffset) <= 4, `导航项「${r.plainLabel}」图标+文字整体居中`, `偏差 ${r.itemOffset}px`)
ok(r.badgeGap === null || Math.abs(r.badgeGap - 12) <= 2, '角标仍贴该项右缘（未被居中推走）', r.badgeGap === null ? '本页无角标' : `距右 ${r.badgeGap}px`)
ok(r.verGap === null || Math.abs(r.verGap - 12) <= 2, '版本号仍贴「关于」项右缘', r.verGap === null ? '本页无版本号' : `距右 ${r.verGap}px`)
ok(!r.undefinedText, '侧栏没有 undefined')

await shot('sidebar-center-full.png')

console.log('\n── 控制台错误 ──')
ok(consoleErrors.filter(e => !/favicon|clicks|health|api\/sites/i.test(e)).length === 0,
  '全程无非预期 console.error', consoleErrors.slice(0, 2).join(' | ').slice(0, 140) || '干净')

clearTimeout(watchdog)
console.log(`\n${failures.length ? '❌' : '✅'} 侧栏文字居中真机验证：${pass} 条通过${failures.length ? `，${failures.length} 条失败` : ''}`)
process.exit(failures.length ? 1 : 0)
