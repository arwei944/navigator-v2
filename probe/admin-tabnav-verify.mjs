/**
 * 真机验证：管理后台模块导航升级（分组 + 溢出「更多」+ 键盘）。
 *
 * 单测盯的是「怎么算可见数量」，这里盯的是「算完之后界面是不是真的那样」：
 * 13 个模块一个都不能消失、装不下的确实进得了「更多」、当前模块被收起时还知道自己在哪、
 * 键盘真能用。本项目在「装到 DOM 上还能不能用」这件事上踩过多次。
 *
 * 用法：node probe/admin-tabnav-verify.mjs [cdp-port]
 */
import { writeFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = process.argv[2] || '9451'
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
    `--user-data-dir=${join(tmpdir(), 'nav-v2-probe-tabnav')}`,
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

const navState = () => jsonOf(`(() => {
  const nav = document.querySelector('.admin-tabs')
  if (!nav) return null
  const tabs = [...nav.querySelectorAll('.admin-tab')]
  const more = document.querySelector('.admin-more-btn')
  const panel = document.querySelector('.admin-more-panel')
  // 有效当前模块：可见区里没有 .active 时，当前模块就写在「更多」按钮上
  // （收起态下可见区本来就不该有 active 标签，这是设计的一部分）
  const visActive = (nav.querySelector('.admin-tab.active') || {}).textContent
  const moreIsActive = !!(more && more.classList.contains('active'))
  const effActive = (visActive || '').replace(/\\s+/g, ' ').trim()
    || (moreIsActive ? more.querySelector('.admin-more-label').textContent.replace(/^⋯\\s*/, '').trim() : '')
  return {
    effActive,
    visible: tabs.map(b => b.textContent.replace(/\\s+/g, ' ').trim()),
    groupStarts: nav.querySelectorAll('.admin-tab.group-start').length,
    groupTitles: nav.querySelectorAll('.admin-tab-group').length,
    hasMore: !!more,
    moreLabel: more ? more.querySelector('.admin-more-label').textContent.trim() : '',
    moreActive: more ? more.classList.contains('active') : false,
    panelOpen: !!panel,
    panelItems: panel ? [...panel.querySelectorAll('.admin-more-item')].map(b => b.textContent.trim()) : [],
    panelGroups: panel ? [...panel.querySelectorAll('.admin-more-group')].map(e => e.textContent.trim()) : [],
    scrollW: nav.scrollWidth, clientW: nav.clientWidth,
    active: (nav.querySelector('.admin-tab.active') || {}).textContent?.replace(/\\s+/g, ' ').trim() || '',
    focused: document.activeElement ? document.activeElement.textContent.replace(/\\s+/g, ' ').trim() : '',
    url: location.search,
  }
})()`)

/* ---------------- 进入后台 ---------------- */

await evalJs(`location.href = ${JSON.stringify(SITE_BASE + '/admin')}`)
// 打线上时靠口令换 token 注入（线上没有本机自动登录）；token 只经环境变量传，不写进文件
const PROBE_TOKEN = String(process.env.PROBE_TOKEN || '')
if (PROBE_TOKEN) {
  await evalJs(`(() => { try { localStorage.setItem('nav_admin_token', ${JSON.stringify(PROBE_TOKEN)}); localStorage.removeItem('nav_admin_token_exp') } catch (e) {} ; return true })()`)
  await evalJs(`location.reload()`)
}
await send('Runtime.enable'); await send('Page.enable')
for (let i = 0; i < 80; i++) {
  if (await evalJs(`!!document.querySelector('.admin-tabs')`).catch(() => false)) break
  await sleep(500)
}
await sleep(1500)
if (!(await evalJs(`!!document.querySelector('.admin-tabs')`))) {
  console.error('没能进入后台（本机自动登录需要 data/admin-key.txt）'); cleanup(); process.exit(2)
}
// 竖排偏好会换掉布局，先复位成横排
await evalJs(`(() => { try { localStorage.setItem('nav_admin_layout','top') } catch(e){} ; return true })()`)
await evalJs(`location.reload()`)
await send('Runtime.enable'); await send('Page.enable')
for (let i = 0; i < 80; i++) {
  if (await evalJs(`!!document.querySelector('.admin-more-btn') || document.querySelectorAll('.admin-tabs .admin-tab').length > 6`).catch(() => false)) break
  await sleep(500)
}
await sleep(1200)

console.log('\n── ① 分组 ──')
const s0 = await navState()
ok(!!s0, '导航条渲染出来了')
ok(s0 && s0.groupStarts >= 4, '模块按组分开（有分组分隔线）', s0 ? `${s0.groupStarts} 条分隔线` : '')
await shot('admin-tabnav-1-groups.png')

console.log('\n── ② 溢出「更多」：模块一个都不能少 ──')
ok(s0 && s0.hasMore, '装不下时出现「更多」入口', s0 ? `可见 ${s0.visible.length} 个` : '')
ok(s0 && s0.scrollW <= s0.clientW + 1, '标签行没有被撑出横向滚动（靠「更多」而不是滚出去）',
  s0 ? `${s0.scrollW} ≤ ${s0.clientW}` : '')

await evalJs(`document.querySelector('.admin-more-btn').click()`)
await sleep(300)
const s1 = await navState()
ok(s1 && s1.panelOpen, '「更多」面板能展开')
ok(s1 && s1.panelItems.length > 0, '面板里列出了收起模块', s1 ? s1.panelItems.join(' / ') : '')
ok(s1 && s1.panelGroups.length > 0, '面板里按分组列出', s1 ? s1.panelGroups.join(' / ') : '')
const totalSeen = new Set([...(s1?.visible || []), ...(s1?.panelItems || [])])
ok(totalSeen.size === 13, '可见 + 收起 = 13 个模块，一个都没少', `${totalSeen.size} 个`)
await shot('admin-tabnav-2-more.png')

console.log('\n── ③ 从「更多」里切模块 ──')
const firstHidden = (s1?.panelItems || [])[0] || ''
await evalJs(`document.querySelectorAll('.admin-more-panel .admin-more-item')[0].click()`)
await sleep(700)
const s2 = await navState()
ok(s2 && !s2.panelOpen, '选完自动收起面板')
ok(s2 && s2.url.includes('tab='), '切模块生效（URL 带 tab 参数）', s2 ? s2.url : '')
ok(s2 && s2.effActive.startsWith(firstHidden.split(' ')[0]), '内容切到了选中的模块', `当前=${s2?.effActive} / 选中=${firstHidden}`)

console.log('\n── ④ 当前模块被收起时，导航里仍知道「我在哪」 ──')
ok(s2 && s2.moreActive, '「更多」按钮高亮（当前模块在收起区）', `按钮文案「${s2?.moreLabel}」`)
ok(s2 && !!s2.effActive && s2.moreLabel.includes(s2.effActive),
  '按钮直接显示当前模块名', `「${s2?.moreLabel}」 vs 当前「${s2?.active}」`)

console.log('\n── ⑤ 键盘可达 ──')
await evalJs(`document.querySelector('.admin-tabs .admin-tab').focus()`)
const before = (await navState())?.focused
await evalJs(`document.querySelector('.admin-tabs .admin-tab').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`)
await sleep(500)
const s3 = await navState()
ok(s3 && s3.effActive !== (s2?.effActive || ''), '→ 键切到下一个模块', `${s2?.effActive} → ${s3?.effActive}`)
ok(s3 && s3.focused === s3.effActive, '焦点跟着走（roving tabindex）', `焦点在「${s3?.focused}」`)
await evalJs(`document.querySelector('.admin-tabs .admin-tab[tabindex="0"], .admin-tabs .admin-tab').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))`)
await sleep(500)
const s4 = await navState()
const lastVisible = (s4?.visible || [])[(s4?.visible || []).length - 1] || ''
ok(s4 && s4.effActive === lastVisible, 'End 跳到最后一个可见模块', `${s4?.effActive} / 末尾 ${lastVisible}`)

console.log('\n── ⑥ 竖排模式 ──')
await evalJs(`[...document.querySelectorAll('button')].find(b => /横排|竖排/.test(b.textContent))?.click()`)
await sleep(700)
const s5 = await navState()
ok(s5 && s5.groupTitles >= 4, '竖排显示分组标题', s5 ? `${s5.groupTitles} 个标题` : '')
ok(s5 && !s5.hasMore, '竖排不需要「更多」（列布局不会溢出）')
await shot('admin-tabnav-3-side.png')
await evalJs(`[...document.querySelectorAll('button')].find(b => /横排|竖排/.test(b.textContent))?.click()`)
await sleep(700)
ok((await navState())?.hasMore === true, '切回横排后「更多」回来')

console.log('\n── ⑦ 窄屏（420px）──')
await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 860, deviceScaleFactor: 1, mobile: true })
await sleep(900)
const s6 = await navState()
ok(s6 && s6.hasMore, '窄屏下仍有「更多」入口')
const seenNarrow = new Set([...(s6?.visible || []), ...(s6?.panelItems || [])])
ok(seenNarrow.size === 13 || s6?.panelOpen === false, '窄屏下 13 个模块仍然都可及（可见区 + 更多）',
  `可见 ${s6?.visible.length} 个 + 更多按钮`)
await shot('admin-tabnav-4-narrow.png')
await send('Emulation.clearDeviceMetricsOverride')
await sleep(500)

console.log('\n── ⑧ 无未预期异常 ──')
const real = errs.filter(e => !/favicon|Failed to load resource/i.test(e))
ok(real.length === 0, '无控制台错误', real.slice(0, 2).join(' | '))

clearTimeout(watchdog)
console.log(`\n导航升级真机验证：${pass} 通过 / ${failures.length} 失败`)
if (failures.length) for (const f of failures) console.log('  ✖ ' + f)
cleanup()
process.exit(failures.length ? 1 : 0)
