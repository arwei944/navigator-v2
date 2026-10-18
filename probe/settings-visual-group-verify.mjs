/**
 * 真机验证：设置面板的「外观」分组 + 卡片设置直达入口。
 *
 * 背景：设置面板原先平铺 7 个分节，凡与视觉有关的（主题 / 视觉方案 / 显示）都混在
 * 功能项里；卡片设置更只有工具栏一个入口，是块「孤岛」。2026-10-18 改为三组
 * （外观 / 功能 / 系统），视觉项收进「外观」，并在组内补一个卡片设置直达入口。
 *
 * 覆盖：
 *   ① 设置面板已分组（外观 / 功能 / 系统）
 *   ② 「外观」组含 ≥3 个视觉分节，且主题与视觉方案都在组内
 *   ③ 「外观」组含「卡片与布局」直达入口
 *   ④ 点入口 → 设置面板关闭、卡片设置打开（不叠加两层浮层）
 *   ⑤ 无 console.error
 *
 * 用法：node probe/settings-visual-group-verify.mjs [cdp-port]
 */
import { writeFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = process.argv[2] || '9399'
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
  while (Date.now() < dl) { if (await alive(url)) return true; await new Promise(s => setTimeout(s, 300)) }
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
    `--user-data-dir=${join(tmpdir(), 'nav-v2-probe-settings-group')}`,
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

/* ---------------- 设置面板 · 外观分组 ---------------- */

console.log('\n── 设置面板 · 「外观」分组与卡片入口 ──')
await evalJs(`location.href = ${JSON.stringify(SITE_BASE + '/')}`)
await send('Runtime.enable')
await send('Page.enable')
await waitFor(`document.querySelector('.settings-btn')`, 25000, '首页加载')
await sleep(1000)

await evalJs(`document.querySelector('.settings-btn').click()`)
await waitFor(`document.querySelector('.settings-modal')`, 8000, '设置面板打开')
await sleep(400)

const r = await jsonOf(`(() => {
  const groups = [...document.querySelectorAll('.settings-modal .settings-group')]
  const titleOf = g => (g.querySelector('.group-title')?.textContent || '').trim()
  const titles = groups.map(titleOf)
  const ap = groups.find(g => titleOf(g) === '外观')
  const secs = ap ? [...ap.querySelectorAll('.settings-section')] : []
  const secText = s => (s.querySelector('.section-header')?.textContent || '')
  const entry = ap ? ap.querySelector('.group-entry') : null
  return {
    groupCount: groups.length,
    titles,
    apSections: secs.length,
    hasTheme: secs.some(s => /主题/.test(secText(s))),
    hasScheme: secs.some(s => /视觉方案/.test(secText(s))),
    entryLabel: entry ? (entry.querySelector('.group-entry-label')?.textContent || '').trim() : '',
    entryDesc: entry ? (entry.querySelector('.group-entry-desc')?.textContent || '').trim() : '',
  }
})()`)

ok(r.groupCount >= 3, '设置面板已分组', r.titles.join(' / '))
ok(r.titles.includes('外观'), '存在「外观」组')
ok(r.apSections >= 3, '「外观」组含 ≥3 个视觉分节', String(r.apSections))
ok(r.hasTheme && r.hasScheme, '主题与视觉方案都在「外观」组内')
ok(/卡片/.test(r.entryLabel), '「外观」组含卡片设置直达入口', `${r.entryLabel} · ${r.entryDesc}`)

await shot('settings-visual-group.png')

/* ---------------- 入口联动 ---------------- */

console.log('\n── 卡片设置入口联动 ──')
await evalJs(`document.querySelector('.settings-modal .group-entry').click()`)
await sleep(900)
const after = await jsonOf(`({
  settingsGone: !document.querySelector('.settings-modal'),
  cardOpened: !!document.querySelector('.card-settings'),
})`)
ok(after.settingsGone, '点入口后设置面板已关闭（不叠加两层浮层）')
ok(after.cardOpened, '点入口后卡片设置面板已打开')
await shot('settings-card-entry-opened.png')

console.log('\n── 控制台错误 ──')
ok(consoleErrors.filter(e => !/favicon|clicks|health|api\/sites/i.test(e)).length === 0,
  '全程无非预期 console.error', consoleErrors.slice(0, 2).join(' | ').slice(0, 140) || '干净')

clearTimeout(watchdog)
console.log(`\n${failures.length ? '❌' : '✅'} 设置面板「外观」分组真机验证：${pass} 条通过${failures.length ? `，${failures.length} 条失败` : ''}`)
process.exit(failures.length ? 1 : 0)
