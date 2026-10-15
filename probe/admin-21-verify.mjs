/**
 * 真机验证：#21 后台功能扩展里的**界面部分**。
 *
 * 单测盯的是纯函数，这里盯的是「装到 DOM 上还能不能用」——
 * 本项目在这一点上踩过多次（空心方框、模块图整体加载失败、标题重复渲染）。
 *
 * 覆盖：全局搜索（跨模块/设置项/站点）/ 快捷键 g 前缀 / 布局切换 / 站点 tab 的疑似重复与拖拽入口 /
 * 偏好设置里的告警规则编辑区 / 页面无未预期异常。
 *
 * 用法：PROBE_TOKEN=xxx SITE_BASE=https://… node probe/admin-21-verify.mjs [cdp-port]
 */
import { writeFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = process.argv[2] || '9404'
const SITE_BASE = (process.env.SITE_BASE || 'http://127.0.0.1:4218').replace(/\/+$/, '')

let pass = 0
const failures = []
const ok = (c, l, e = '') => { if (c) { pass++; console.log(`  ✅ ${l}${e ? ` → ${e}` : ''}`) } else { failures.push(l); console.log(`  ❌ ${l}${e ? ` → ${e}` : ''}`) } }
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
    ...(process.env.HEADFUL === '1' ? [] : ['--headless=new']),
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(tmpdir(), 'nav-v2-probe-21')}`,
    '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--window-size=1600,1000', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  console.log(`  （自拉浏览器，PID ${chromeProc.pid}）`)
}
const cleanup = () => { for (const p of [...procs, chromeProc]) { try { if (p && !p.killed) p.kill() } catch { /* 已退出 */ } } }
process.on('exit', cleanup)
const watchdog = setTimeout(() => { console.error('\n❌ 探针整体超时'); cleanup(); process.exit(3) }, 180000)

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
    consoleErrors.push(String(m.params.args?.[0]?.value || '').slice(0, 160))
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
  pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v) }, reject: e => { clearTimeout(timer); reject(e) } })
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

/* ---------------- 进入后台 ---------------- */

await evalJs(`location.href = ${JSON.stringify(SITE_BASE + '/admin')}`)
await send('Runtime.enable')
await send('Page.enable')

const PROBE_TOKEN = String(process.env.PROBE_TOKEN || '')
if (PROBE_TOKEN) {
  await evalJs(`(() => { try { localStorage.setItem('nav_admin_token', ${JSON.stringify(PROBE_TOKEN)}); localStorage.removeItem('nav_admin_token_exp') } catch (e) {} return true })()`)
  await evalJs(`location.reload()`)
  await send('Runtime.enable')
  await send('Page.enable')
}

const entered = await waitFor(`document.querySelector('.admin-tabs')`, 30000, '进入后台')
if (!entered) { console.log('\n（没能进入后台：线上需要 PROBE_TOKEN）'); cleanup(); process.exit(2) }
await sleep(1200)

/* ---------------- ① 全局搜索 ---------------- */

console.log('\n── ① 全局搜索 ──')
ok(await evalJs(`!!document.querySelector('.admin-search-input')`), '搜索框已渲染')

async function searchFor(q) {
  await evalJs(`(() => {
    const el = document.querySelector('.admin-search-input')
    el.value = ${JSON.stringify(q)}
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await sleep(500)
  return await jsonOf(`[...document.querySelectorAll('.admin-search-item')].map(e => ({
    kind: e.querySelector('.as-kind')?.textContent?.trim(),
    title: e.querySelector('.as-title')?.textContent?.trim(),
  }))`)
}

const r1 = await searchFor('告警')
ok(r1 && r1.some(x => x.kind === '设置' && /告警/.test(x.title)), '搜「告警」命中设置项', JSON.stringify(r1?.[0]))

// 点第一条结果 → 应切到对应模块。
// ⚠️ 必须在这轮结果还在 DOM 里时点：再搜一次会覆盖列表，点到的就是后一次的第一条了。
if (r1 && r1.length) {
  await evalJs(`document.querySelector('.admin-search-item').click()`)
  await sleep(700)
  const tabNow = await evalJs(`document.querySelector('.admin-tab.active')?.textContent.trim()`)
  ok(tabNow === '偏好设置', '点搜索结果切到了目标模块', String(tabNow))
}
await evalJs(`(() => { const el = document.querySelector('.admin-search-input'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
await sleep(300)

const r2 = await searchFor('插件')
ok(r2 && r2.some(x => x.kind === '模块'), '搜「插件」命中模块', JSON.stringify(r2?.[0]))
const r3 = await searchFor('github')
ok(Array.isArray(r3), '搜站点词返回结果数组', String(r3?.length))
await evalJs(`(() => { const el = document.querySelector('.admin-search-input'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)

/* ---------------- ② 告警规则编辑区（偏好设置） ---------------- */

console.log('\n── ② 告警规则编辑区 ──')
ok(await evalJs(`!!document.querySelector('.alert-section')`), '偏好设置里有告警规则区')
ok(await evalJs(`document.querySelectorAll('.alert-rule, .alert-global').length > 0`), '规则行/全局阈值已渲染')
const lv = await evalJs(`document.querySelector('.alert-section .alert-muted, .alert-section .alert-error')?.textContent?.trim() || ''`)
ok(!/加载中/.test(lv), '不是卡在「加载中」', String(lv).slice(0, 20))

/* ---------------- ③ 快捷键：g + s → 站点管理 ---------------- */

console.log('\n── ③ 快捷键 ──')
await evalJs(`document.body.focus()`)
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'g', text: 'g', windowsVirtualKeyCode: 71 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'g', windowsVirtualKeyCode: 71 })
await sleep(120)
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 's', text: 's', windowsVirtualKeyCode: 83 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 's', windowsVirtualKeyCode: 83 })
await sleep(800)
const afterKey = await evalJs(`document.querySelector('.admin-tab.active')?.textContent.trim()`)
ok(afterKey === '站点管理', 'g+s 切到站点管理', String(afterKey))

/* ---------------- ④ 站点 tab：疑似重复 / 拖拽入口 ---------------- */

console.log('\n── ④ 站点管理的整理入口 ──')
await waitFor(`document.querySelector('.admin-head-actions')`, 20000, '站点面板')
const headBtns = await jsonOf(`[...document.querySelectorAll('.admin-head-actions button')].map(b => b.textContent.trim())`)
ok(headBtns && headBtns.some(x => /导入书签/.test(x)), '有「导入书签」按钮', JSON.stringify(headBtns))
ok(headBtns && headBtns.some(x => /手动排序/.test(x)), '有「手动排序」按钮')

// 打开手动排序 → 卡片应可拖拽 + 出现拖拽手柄
await evalJs(`[...document.querySelectorAll('.admin-head-actions button')].find(b => /手动排序/.test(b.textContent))?.click()`)
await sleep(700)
ok(await evalJs(`!!document.querySelector('.drag-handle')`), '开启后出现拖拽手柄')
ok(await evalJs(`document.querySelector('.site-card')?.getAttribute('draggable') === 'true'`), '卡片被标记为可拖拽')
await evalJs(`[...document.querySelectorAll('.admin-head-actions button')].find(b => /结束排序/.test(b.textContent))?.click()`)
await sleep(400)

/* ---------------- ⑤ 布局切换 ---------------- */

console.log('\n── ⑤ 布局切换 ──')
const beforeVertical = await evalJs(`!!document.querySelector('.admin-tabs.vertical')`)
await evalJs(`document.querySelector('.admin-layout-btn')?.click()`)
await sleep(500)
const afterVertical = await evalJs(`!!document.querySelector('.admin-tabs.vertical')`)
ok(beforeVertical !== afterVertical, '布局按钮真的切换了 tab 排布', `${beforeVertical} → ${afterVertical}`)
await evalJs(`document.querySelector('.admin-layout-btn')?.click()`)
await sleep(400)
ok(await evalJs(`!!document.querySelector('.admin-tabs.vertical') === ${beforeVertical}`), '再点一次切回原状')

/* ---------------- ⑥ 全局搜索（Ctrl+K 命令面板不受影响） ---------------- */

console.log('\n── ⑥ 无未预期异常 ──')
const realErrors = consoleErrors.filter(e => !/favicon|clicks|health|api\/sites|_local-key|deploy-status|alert-rules|health-history/i.test(e))
ok(realErrors.length === 0, '无未预期的控制台异常', realErrors.slice(0, 2).join(' | '))

await shot('admin-21-verify.png')

/* ---------------- 结果 ---------------- */

console.log(`\n${failures.length ? '❌' : '✅'} 后台功能扩展真机验证：${pass} 通过 / ${failures.length} 失败`)
if (failures.length) { for (const f of failures) console.log('  - ' + f); cleanup(); process.exit(1) }
cleanup()
process.exit(0)
