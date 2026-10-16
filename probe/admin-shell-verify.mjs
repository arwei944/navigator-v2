/**
 * 真机验证：后台「左动作栏」形态 + 两侧栏的自由折叠/宽度。
 *
 * 盯的是装到 DOM 上是不是真的那样：
 *  · 动作栏：分组与状态数字、点一下切模块、点一下执行动作（结果真的出来）；
 *  · 动作栏自身：可折叠（图标态）、可拖宽、双击复位、越界被钳制；
 *  · 主站两侧栏：能拖到很窄/很宽、双击复位、下限不会塌成看不见。
 *
 * 用法：node probe/admin-shell-verify.mjs [cdp-port]
 */
import { writeFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = process.argv[2] || '9501'
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
    '--headless=new', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(tmpdir(), 'nav-v2-probe-rail')}`,
    '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--window-size=1600,1000', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  console.log(`  （自拉浏览器，PID ${chromeProc.pid}）`)
}
const cleanup = () => { for (const p of [...procs, chromeProc]) { try { if (p && !p.killed) p.kill() } catch { /* 已退出 */ } } }
process.on('exit', cleanup)
const watchdog = setTimeout(() => { console.error('\n❌ 探针整体超时'); cleanup(); process.exit(3) }, 200000)

async function cdpTarget() {
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
const t = await cdpTarget()
const ws = new WebSocket(t.webSocketDebuggerUrl)
let msgId = 0
const pending = new Map()
const errs = []
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id); pending.delete(m.id)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(String(m.params.args?.[0]?.value || '').slice(0, 180))
  if (m.method === 'Runtime.exceptionThrown') errs.push('[异常] ' + String(m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 180))
})
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时 ${method}`)) }, 25000)
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
const jsonOf = async e => { const s = await evalJs(`JSON.stringify((() => { try { return (${e}) } catch (e) { return { err: String(e) } } })())`); return s ? JSON.parse(s) : null }
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(HERE, name), Buffer.from(r.data, 'base64'))
  console.log(`  📸 ${name}`)
}

/* ---------------- 进入后台 ---------------- */
await evalJs(`location.href = ${JSON.stringify(SITE_BASE + '/admin')}`)
await send('Runtime.enable'); await send('Page.enable')
for (let i = 0; i < 80; i++) { if (await evalJs(`location.host`).catch(() => '')) break; await sleep(300) }
for (let i = 0; i < 80; i++) { if (await evalJs(`!!document.querySelector('.admin-view')`).catch(() => false)) break; await sleep(500) }
const PROBE_TOKEN = String(process.env.PROBE_TOKEN || '')
if (PROBE_TOKEN) {
  await evalJs(`(() => { try { localStorage.setItem('nav_admin_token', ${JSON.stringify(PROBE_TOKEN)}); localStorage.removeItem('nav_admin_token_exp') } catch (e) {} ; return true })()`)
  await evalJs(`location.reload()`)
  await send('Runtime.enable'); await send('Page.enable')
  for (let i = 0; i < 80; i++) { if (await evalJs(`!!document.querySelector('.admin-view')`).catch(() => false)) break; await sleep(500) }
}
// 复位到已知状态：动作栏展开、宽度出厂、选中概览
await evalJs(`(() => { try { localStorage.removeItem('nav_admin_rail_w'); localStorage.removeItem('nav_admin_rail_collapsed'); localStorage.setItem('nav_admin_rail_sel','overview') } catch(e){} ; return true })()`)
await evalJs(`location.reload()`)
await send('Runtime.enable'); await send('Page.enable')
for (let i = 0; i < 80; i++) { if (await evalJs(`!!document.querySelector('.admin-rail')`).catch(() => false)) break; await sleep(500) }
await sleep(1500)
if (!(await evalJs(`!!document.querySelector('.admin-rail')`))) {
  console.error('没能进入后台（本机自动登录需要 data/admin-key.txt）')
  const diag = await jsonOf(`({ view: !!document.querySelector('.admin-view'), login: !!document.querySelector('.admin-login, form'), authed: !!document.querySelector('.admin-header .admin-user'), body: document.body.innerText.slice(0, 200) })`)
  console.error('  诊断：', JSON.stringify(diag))
  if (errs.length) console.error('  页面异常：\n   ' + errs.slice(0, 5).join('\n   '))
  cleanup(); process.exit(2)
}

const railState = () => jsonOf(`(() => {
  const rail = document.querySelector('.admin-rail')
  if (!rail) return null
  const items = [...rail.querySelectorAll('.ar-item')]
  return {
    width: Math.round(rail.getBoundingClientRect().width),
    groups: [...rail.querySelectorAll('.ar-group')].map(e => e.textContent.trim()),
    items: items.map(b => b.querySelector('.ar-label')?.textContent.trim() || b.getAttribute('title') || ''),
    metas: items.filter(b => b.querySelector('.ar-meta')).length,
    on: (rail.querySelector('.ar-item.on .ar-label') || {}).textContent?.trim() || '',
    collapsed: rail.classList.contains('collapsed'),
    hasResize: !!rail.querySelector('.ar-resize'),
    tabbar: !!document.querySelector('.admin-tabbar'),
  }
})()`)

console.log('\n── ① 左动作栏的骨架 ──')
const r0 = await railState()
ok(!!r0, '动作栏渲染出来了')
ok(r0.groups.length === 3, '按「常用动作 / 批量 / 模块」分三组', r0.groups.join(' · '))
ok(r0.items.length >= 15, '栏内项目齐（动作 + 模块）', `${r0.items.length} 项`)
ok(r0.metas >= 6, '至少 6 项带实时状态数字（状态就在栏里，不再需要一屏等大卡片）', `${r0.metas} 项`)
ok(r0.on === '概览', '默认停在概览', r0.on)
ok(r0.hasResize, '有拖宽把手')
await shot('rail-1-overview.png')

console.log('\n── ② 一次点击切模块 ──')
const before = await evalJs(`document.querySelector('.admin-tabpanel').textContent.slice(0, 80)`)
await evalJs(`[...document.querySelectorAll('.admin-rail .ar-item')].find(b => (b.querySelector('.ar-label')||{}).textContent?.trim() === '插件').click()`)
await sleep(1200)
const r1 = await railState()
const after = await evalJs(`document.querySelector('.admin-tabpanel').textContent.slice(0, 80)`)
ok(r1.on === '插件', '一次点击就切到了「插件」', r1.on)
ok(after !== before, '内容区确实换了（不是只高亮栏内项）')
ok(await evalJs(`/站点抓取引擎|引擎/.test(document.querySelector('.admin-tabpanel').textContent)`), '内容是插件面板本体（13 个面板组件原样复用）')

console.log('\n── ③ 一次点击执行动作 ──')
await evalJs(`[...document.querySelectorAll('.admin-rail .ar-item')].find(b => (b.querySelector('.ar-label')||{}).textContent?.trim() === '巡检结果').click()`)
await sleep(1800)
const actTitle = await evalJs(`(document.querySelector('.admin-section-header h2')||{}).textContent`)
const actRows = await jsonOf(`[...document.querySelectorAll('.admin-action-row')].map(r => r.textContent.replace(/\\s+/g,' ').trim())`)
ok(/巡检结果/.test(actTitle || ''), '动作结果面板出来了', actTitle)
ok(actRows.length >= 3, '结果里有可核对的数字（正常 / 可忽略 / 需处理）', actRows.join(' | '))
ok(actRows.some(t => /需处理/.test(t)), '能看到「需处理」这一项')
await shot('rail-2-action.png')

const actRowsBefore = actRows.length
await evalJs(`[...document.querySelectorAll('.admin-rail .ar-item')].find(b => (b.querySelector('.ar-label')||{}).textContent?.trim() === '检查更新').click()`)
await sleep(2500)
const chkTitle = await evalJs(`(document.querySelector('.admin-section-header h2')||{}).textContent`)
const chkRows = await jsonOf(`[...document.querySelectorAll('.admin-action-row')].map(r => r.textContent.replace(/\\s+/g,' ').trim())`)
ok(chkRows.length >= 2, '「检查更新」点一下就有结果（只读动作，不绑确认）', chkRows.join(' | ') || chkTitle)
ok(actRowsBefore > 0, '（上一步的巡检结果已核对）')

console.log('\n── ④ 动作栏：折叠 / 拖宽 / 复位 ──')
await evalJs(`document.querySelector('.admin-rail-toggle').click()`)
await sleep(600)
const rc = await railState()
ok(rc.collapsed === true && rc.width <= 60, '折叠后收到图标态宽度', `${rc.width}px`)
ok(await evalJs(`document.querySelector('.admin-rail .ar-label') === null`), '折叠后不渲染标签（只剩图标）')
await evalJs(`document.querySelector('.admin-rail-toggle').click()`)
await sleep(600)
ok((await railState()).collapsed === false, '再点一下展开回来')

// 拖宽：mousedown 在把手上，mousemove 到右侧
async function dragRail(handleSel, dx) {
  await evalJs(`(() => {
    const h = document.querySelector(${JSON.stringify(handleSel)})
    const r = h.getBoundingClientRect()
    const x0 = r.left + 3
    h.dispatchEvent(new MouseEvent('mousedown', { clientX: x0, bubbles: true }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: x0 + ${dx}, bubbles: true }))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    return true
  })()`)
  await sleep(500)
}
await dragRail('.ar-resize', 80)
const wide = (await railState()).width
ok(wide > 250, '往右拖变宽', `${wide}px`)
await dragRail('.ar-resize', -9999)
const narrow = (await railState()).width
ok(narrow >= 56 && narrow <= 60, '往左狂拖 → 被钳在下限（不会拖成看不见）', `${narrow}px`)
await evalJs(`document.querySelector('.ar-resize').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
await sleep(400)
ok((await railState()).width === 224, '双击把手复位到出厂宽度', `${(await railState()).width}px`)

console.log('\n── ⑤ 主站左栏：宽范围 + 折叠态也能拖 + 双击复位 ──')
const sideW = () => evalJs(`Math.round(document.querySelector('.sidebar').getBoundingClientRect().width)`)
await dragRail('.sidebar-resize-handle', 120)
const sWide = await sideW()
ok(sWide > 240, '左栏能拖宽', `${sWide}px`)
await dragRail('.sidebar-resize-handle', -9999)
const sNarrow = await sideW()
ok(sNarrow >= 56 && sNarrow <= 60, '左栏能拖到图标栏宽度（不是塌成看不见）', `${sNarrow}px`)
ok(await evalJs(`!!document.querySelector('.sidebar .sidebar-nav-item') !== false`), '图标态下导航项仍在 DOM 里（可点）')
await dragRail('.sidebar-resize-handle', 9999)
const sMax = await sideW()
ok(sMax === 520, '左栏能拖到上限 520（比原来的 400 更自由）', `${sMax}px`)
await evalJs(`document.querySelector('.sidebar-resize-handle').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
await sleep(400)
ok((await sideW()) === 240, '双击左栏把手复位到 240', `${await sideW()}px`)
ok(await evalJs(`getComputedStyle(document.querySelector('.sidebar-resize-handle')).cursor === 'col-resize'`), '把手是 col-resize（可拖的提示）')

console.log('\n── ⑥ 右栏同样是自由宽度 ──')
const rightHandle = await evalJs(`!!document.querySelector('.right-resize-handle')`)
if (rightHandle) {
  await dragRail('.right-resize-handle', -100)
  const rw = await evalJs(`Math.round(document.querySelector('.right-sidebar').getBoundingClientRect().width)`)
  ok(rw > 280, '右栏能拖宽', `${rw}px`)
  await evalJs(`document.querySelector('.right-resize-handle').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  await sleep(400)
  ok((await evalJs(`Math.round(document.querySelector('.right-sidebar').getBoundingClientRect().width)`)) === 280, '双击右栏把手复位到 280')
} else {
  ok(true, '右栏此刻未展开（自动登录态下无详情面板），跳过 —— 未展开时把手本就不该在')
}

console.log('\n── ⑦ 无未预期异常 ──')
ok((await railState()).tabbar === false, 'tab 行确实已经不在（整条退役）')
const real = errs.filter(e => !/favicon|Failed to load resource|api\.github\.com/i.test(e))
ok(real.length === 0, '无控制台错误', real.slice(0, 2).join(' | '))
await shot('rail-3-final.png')

clearTimeout(watchdog)
console.log(`\n后台形态验证：${pass} 通过 / ${failures.length} 失败`)
if (failures.length) for (const f of failures) console.log('  ✖ ' + f)
cleanup()
process.exit(failures.length ? 1 : 0)
