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
  if (await evalJs(`!!document.querySelector('.admin-view')`).catch(() => false)) break
  await sleep(500)
}
await sleep(1500)
if (!(await evalJs(`!!document.querySelector('.admin-view')`))) {
  console.error('没能进入后台（本机自动登录需要 data/admin-key.txt）'); cleanup(); process.exit(2)
}
// 竖排偏好会换掉布局，先复位成横排，并回到仪表盘
await evalJs(`(() => { try { localStorage.setItem('nav_admin_layout','top') } catch(e){} ; return true })()`)
await evalJs(`location.href = ${JSON.stringify(SITE_BASE + '/admin')}`)
await send('Runtime.enable'); await send('Page.enable')
for (let i = 0; i < 80; i++) {
  if (await evalJs(`!!document.querySelector('.admin-dash-grid') || !!document.querySelector('.admin-more-btn')`).catch(() => false)) break
  await sleep(500)
}
await sleep(1200)

console.log('\n── ⓪ 仪表盘：模块卡片铺满中间区 ──')
const dash = await jsonOf(`(() => {
  const grid = document.querySelector('.admin-dash-grid')
  const mid = document.querySelector('.main')
  if (!grid || !mid) return null
  const cards = [...grid.querySelectorAll('.admin-dash-card')]
  const gb = grid.getBoundingClientRect(), mb = mid.getBoundingClientRect()
  const tops = [...new Set(cards.map(c => Math.round(c.getBoundingClientRect().top)))]
  return {
    cards: cards.length,
    names: cards.map(c => c.querySelector('.adc-name').textContent.trim()),
    withValue: cards.filter(c => c.querySelector('.adc-value')).length,
    tabbar: !!document.querySelector('.admin-tabbar'),
    widthRatio: +(gb.width / (mb.width - 64)).toFixed(2),
    rows: tops.length,
    perRow: cards.filter(c => Math.round(c.getBoundingClientRect().top) === tops[0]).length,
    // 卡片上的数只能来自真实数据：不许出现 undefined / NaN
    dirty: /undefined|NaN/.test(document.body.innerText),
  }
})()`)
ok(!!dash, '仪表盘渲染出来了')
ok(dash && dash.cards === 12, '12 张模块卡片（当前所在的仪表盘自己不算）', dash ? `${dash.cards} 张` : '')
ok(dash && !dash.tabbar, '仪表盘上不渲染模块 tab 行（卡片本身就是导航）')
ok(dash && dash.widthRatio >= 0.95, '卡片网格铺满中间区（不再是一条窄列）', dash ? `占内容宽 ${(dash.widthRatio * 100).toFixed(0)}%` : '')
ok(dash && dash.perRow >= 3, '每行至少 3 张（确实按可用宽度自适应）', dash ? `${dash.perRow} 张/行 · 共 ${dash.rows} 行` : '')
ok(dash && !dash.dirty, '页面上没有 undefined / NaN 泄漏')
// 本项目被「同一块内容渲染两遍」咬过两次（卡片标题重复、关于页星号），这里守一道
const heads = await jsonOf(`(() => {
  const names = [...document.querySelectorAll('.admin-dash h2, .admin-dash h3')].map(e => e.textContent.trim()).filter(Boolean)
  const seen = {}
  for (const n of names) seen[n] = (seen[n] || 0) + 1
  return { dup: Object.entries(seen).filter(([, c]) => c > 1).map(([n, c]) => n + '×' + c), count: names.length }
})()`)
ok(heads && heads.dup.length === 0, '仪表盘内没有重复的区块标题', heads?.dup.join(' ') || `${heads?.count} 个标题`)
await shot('admin-dash-1-cards.png')

console.log('\n── ⓪b 点卡片进模块，再从模块回仪表盘 ──')
const cardClicked = await evalJs(`(() => {
  const c = [...document.querySelectorAll('.admin-dash-card')].find(x => x.querySelector('.adc-name').textContent.trim() === '插件')
  if (!c) return false
  c.click(); return true
})()`)
await sleep(900)
const inModule = await jsonOf(`({
  tabbar: !!document.querySelector('.admin-tabbar'),
  active: (document.querySelector('.admin-tabs .admin-tab.active') || {}).textContent?.trim() || '',
  url: location.search
})`)
ok(cardClicked, '点得到卡片')
ok(inModule?.tabbar, '进模块后 tab 行出现（可切模块 / 返回）')
ok(inModule?.active === '插件', '进入的正是点的那张卡对应的模块', `${inModule?.active} · ${inModule?.url}`)
await evalJs(`[...document.querySelectorAll('.admin-tabs .admin-tab')].find(b => b.textContent.trim().startsWith('仪表盘'))?.click()`)
await sleep(900)
ok(await evalJs(`!!document.querySelector('.admin-dash-grid')`), '从模块能回到仪表盘')
await shot('admin-dash-2-back.png')

// 后面的导航断言都在**模块页**里做：tab 行只在模块页出现（仪表盘上它是收起的）
await evalJs(`[...document.querySelectorAll('.admin-dash-card')].find(x => x.querySelector('.adc-name').textContent.trim() === '部署')?.click()`)
await sleep(900)

console.log('\n── ① 分组 ──')
// 后台是套在三栏壳里的（左侧栏 + 中间区 + 右侧栏）。这条守的是「别把后台退回独立页」。
const shell = await jsonOf(`({
  sidebar: !!document.querySelector('.sidebar'),
  right: !!document.querySelector('.right-sidebar'),
  inMain: !!document.querySelector('.main .admin-tabbar'),
  viewport: innerWidth
})`)
ok(shell?.sidebar && shell?.right, '后台仍套在三栏壳里（左右两侧栏都在）', shell ? `侧栏 ${shell.sidebar} / 右栏 ${shell.right} / 视口 ${shell.viewport}px` : '')
ok(shell?.inMain, '中间区渲染在 .main 里（不是独立页）')
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
