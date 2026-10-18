/**
 * 真机验证：侧栏「关于」项上的版本号。
 *
 * 背景：版本号原先挂在侧栏底部，是个孤立的 `v3.1.0` 块 —— 与 nav 列表里的「关于」项
 * 重复（两个入口都进 About）。2026-10-18 合并为一处：版本号挂在「关于」项右侧，
 * 既是入口也是版本标识，报问题时不必先进页面。
 *
 * 覆盖：
 *   ① 侧栏有「关于」项
 *   ② 同一项内含 .nav-version，文本 = v<package.json.version>（唯一事实来源）
 *   ③ 版本号与「关于」在同一行（垂直重叠，而不是被挤到下一行）
 *   ④ 底部旧的 .sidebar-version 块已不存在（不再有第二个关于入口）
 *   ⑤ 侧栏里没有 undefined
 *
 * 用法：node probe/sidebar-about-version-verify.mjs [cdp-port]
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = process.argv[2] || '9397'
const SITE_BASE = (process.env.SITE_BASE || 'http://127.0.0.1:4216').replace(/\/+$/, '')
const PKG_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

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
    `--user-data-dir=${join(tmpdir(), 'nav-v2-probe-about-ver')}`,
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
async function shotClip(name, clip) {
  const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } })
  writeFileSync(join(HERE, name), Buffer.from(r.data, 'base64'))
}

/* ---------------- 侧栏「关于」项 · 版本号 ---------------- */

console.log('\n── 站点侧栏 · 「关于」项上的版本号 ──')
await evalJs(`location.href = ${JSON.stringify(SITE_BASE + '/')}`)
await send('Runtime.enable')
await send('Page.enable')
await waitFor(`document.querySelector('.sidebar .sidebar-nav')`, 25000, '首页加载')
await sleep(1200)

const r = await jsonOf(`(() => {
  const items = [...document.querySelectorAll('.sidebar .sidebar-nav-item')]
  const about = items.find(e => e.querySelector('.nav-version'))
  const v = about ? about.querySelector('.nav-version') : null
  const rb = about ? about.getBoundingClientRect() : null
  const vb = v ? v.getBoundingClientRect() : null
  return {
    itemCount: items.length,
    aboutText: about ? about.innerText.replace(/\\s+/g, ' ').trim() : '',
    aboutTight: about ? about.textContent.replace(/\\s+/g, '') : '',
    versionText: v ? v.textContent.trim() : '',
    versionVisible: v ? !!v.offsetParent : false,
    sameLine: (rb && vb) ? (vb.top < rb.bottom && vb.bottom > rb.top) : false,
    gapToRight: (rb && vb) ? Math.round(rb.right - vb.right) : null,
    oldBlock: !!document.querySelector('.sidebar-version'),
    undefinedText: !!document.querySelector('.sidebar')?.textContent?.includes('undefined'),
    rowRect: rb ? { x: rb.x, y: rb.y, width: rb.width, height: rb.height } : null,
  }
})()`)

ok(r.itemCount >= 10, '侧栏导航项数量（含「关于」）', String(r.itemCount))
ok(String(r.aboutTight).includes('关于'), '存在「关于」项', r.aboutText)
ok(r.versionText === 'v' + PKG_VERSION, '版本号挂在「关于」项上且取值正确', r.versionText)
ok(r.versionVisible === true, '版本号可见')
ok(r.sameLine === true, '版本号与「关于」在同一行')
ok(!r.oldBlock, '底部旧的 .sidebar-version 块已移除（不再重复）')
ok(!r.undefinedText, '侧栏没有 undefined')

await shot('sidebar-about-version-full.png')
if (r.rowRect && r.rowRect.width > 0) {
  const pad = 8
  await shotClip('sidebar-about-version-row.png', {
    x: Math.max(0, r.rowRect.x - pad),
    y: Math.max(0, r.rowRect.y - pad),
    width: r.rowRect.width + pad * 2,
    height: r.rowRect.height + pad * 2,
  })
}

console.log('\n── 控制台错误 ──')
ok(consoleErrors.filter(e => !/favicon|clicks|health|api\/sites/i.test(e)).length === 0,
  '全程无非预期 console.error', consoleErrors.slice(0, 2).join(' | ').slice(0, 140) || '干净')

clearTimeout(watchdog)
console.log(`\n${failures.length ? '❌' : '✅'} 侧栏「关于」版本号真机验证：${pass} 条通过${failures.length ? `，${failures.length} 条失败` : ''}`)
process.exit(failures.length ? 1 : 0)
