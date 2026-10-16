/**
 * 真机验证：管理后台中间区形态（卡片仪表盘 + 面包屑 + 摘要数字）。
 *
 * 盯的是「装到 DOM 上是不是真的那样」：
 *  · 仪表盘 12 张卡铺满、带真实摘要、没有 undefined/NaN、没有重复标题；
 *  · 卡片上的数字与点进去面板里的总数**一致**（新增的运维摘要接口就是为这个）；
 *  · 模块页只有面包屑、没有 tab 行，面包屑能返回；
 *  · 快捷键仍能切模块；窄屏不横向溢出。
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
const PORT = process.argv[2] || '9471'
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
    `--user-data-dir=${join(tmpdir(), 'nav-v2-probe-shell')}`,
    '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--window-size=1600,1000', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  console.log(`  （自拉浏览器，PID ${chromeProc.pid}）`)
}
const cleanup = () => { for (const p of [...procs, chromeProc]) { try { if (p && !p.killed) p.kill() } catch { /* 已退出 */ } } }
process.on('exit', cleanup)
const watchdog = setTimeout(() => { console.error('\n❌ 探针整体超时'); cleanup(); process.exit(3) }, 180000)

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

/* ---------------- 状态读取 ---------------- */

const state = () => jsonOf(`(() => {
  const dash = document.querySelector('.admin-dash-grid')
  const crumb = document.querySelector('.admin-crumb')
  const cards = dash ? [...dash.querySelectorAll('.admin-dash-card')] : []
  const mid = document.querySelector('.main')
  const gb = dash ? dash.getBoundingClientRect() : null
  const mb = mid ? mid.getBoundingClientRect() : null
  return {
    dash: !!dash,
    cards: cards.length,
    cardsWithValue: cards.filter(c => c.querySelector('.adc-value')).length,
    gridRatio: gb && mb ? +(gb.width / mb.width).toFixed(2) : 0,
    tabbar: !!document.querySelector('.admin-tabbar'),
    tabs: document.querySelectorAll('.admin-tabs .admin-tab').length,
    crumb: crumb ? crumb.textContent.replace(/\\s+/g, ' ').trim() : '',
    hasBack: !!document.querySelector('.admin-crumb-back'),
    dirty: /undefined|NaN/.test(document.body.innerText),
    viewport: innerWidth,
  }
})()`)

/* ---------------- 进入后台 ---------------- */

await evalJs(`location.href = ${JSON.stringify(SITE_BASE + '/admin')}`)
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
await sleep(1800)
if (!(await evalJs(`!!document.querySelector('.admin-view')`))) {
  console.error('没能进入后台（本机自动登录需要 data/admin-key.txt）'); cleanup(); process.exit(2)
}
// 确保停在仪表盘（?tab= 会记住上次的模块）
await evalJs(`location.href = ${JSON.stringify(SITE_BASE + '/admin')}`)
await send('Runtime.enable'); await send('Page.enable')
for (let i = 0; i < 80; i++) {
  if (await evalJs(`!!document.querySelector('.admin-dash-grid')`).catch(() => false)) break
  await sleep(500)
}
await sleep(1500)

console.log('\n── ⓪ 仪表盘：卡片铺满 + 真实摘要 ──')
const d0 = await state()
ok(d0?.dash, '仪表盘渲染出来了')
ok(d0?.cards === 12, '12 张模块卡片（仪表盘自己不算）', `${d0?.cards} 张`)
ok(d0?.tabbar === false && d0?.tabs === 0, '仪表盘上没有 tab 行（卡片就是导航）')
ok(d0?.gridRatio >= 0.95, '卡片网格铺满中间区', `占中间区 ${(d0?.gridRatio * 100).toFixed(0)}%`)
ok(d0?.hasBack === false, '仪表盘上没有面包屑（还没进模块）')
ok(d0?.dirty === false, '页面上没有 undefined / NaN 泄漏')
ok(d0?.cardsWithValue >= 8, '至少 8 张卡带真实摘要数字', `${d0?.cardsWithValue}/12 张`)
const heads = await jsonOf(`(() => {
  const names = [...document.querySelectorAll('.admin-dash h2, .admin-dash h3')].map(e => e.textContent.trim()).filter(Boolean)
  const seen = {}
  for (const n of names) seen[n] = (seen[n] || 0) + 1
  return { dup: Object.entries(seen).filter(([, c]) => c > 1).map(([n, c]) => n + '×' + c) }
})()`)
ok(heads && heads.dup.length === 0, '仪表盘内没有重复的区块标题', heads?.dup.join(' ') || '')
await shot('admin-shell-1-dash.png')

console.log('\n── ⓪b 卡片上的数字与面板里看到的一致 ──')
// 注意：这里必须用 evalJs（它带 awaitPromise），不能用 jsonOf ——
// jsonOf 的包装函数不会 await，async 表达式会被序列化成 `{}`（这个坑今天踩过一次）
const cmpRaw = await evalJs(`(async () => {
  const t = localStorage.getItem('nav_admin_token') || ''
  const h = { Authorization: 'Bearer ' + t, 'X-Nav-Key': t }
  const g = async u => { const r = await fetch(u, { headers: h }); return r.ok ? r.json() : null }
  const s = await g('/api/ops?summary=1')
  const hist = await g('/api/ops?limit=1')
  const audit = await g('/api/ops?audit=1&limit=1')
  const notify = await g('/api/ops?notifications=1&limit=1')
  const plug = await g('/api/plugins?light=1')
  return JSON.stringify({
    sumHistory: s && s.history ? s.history.total : null,
    listHistory: hist ? hist.total : null,
    sumAudit: s && s.audit ? s.audit.total : null,
    listAudit: audit ? audit.total : null,
    sumNotify: s && s.notify ? s.notify.total : null,
    listNotify: notify ? notify.total : null,
    pluginsLight: plug && plug.ok ? plug.groups.length : null,
    pluginsProbed: plug ? plug.light : null,
  })
})()`)
const cmp = cmpRaw ? JSON.parse(cmpRaw) : null
ok(cmp && cmp.sumHistory != null && cmp.sumHistory === cmp.listHistory, '摘要里的发布历史数 = 发布历史面板的总数', `${cmp?.sumHistory} / ${cmp?.listHistory}`)
ok(cmp && cmp.sumAudit != null && cmp.sumAudit === cmp.listAudit, '摘要里的审计数 = 审计面板的条数', `${cmp?.sumAudit} / ${cmp?.listAudit}`)
ok(cmp && cmp.sumNotify != null && cmp.sumNotify === cmp.listNotify, '摘要里的通知数 = 通知中心的总数', `${cmp?.sumNotify} / ${cmp?.listNotify}`)
ok(cmp && cmp.pluginsLight >= 1 && cmp.pluginsProbed === true, '插件卡用的是轻量清单（不做可用性探测）', `${cmp?.pluginsLight} 个引擎`)

console.log('\n── ① 点卡片进模块：面包屑取代 tab 行 ──')
const clicked = await evalJs(`(() => {
  const c = [...document.querySelectorAll('.admin-dash-card')].find(x => x.querySelector('.adc-name').textContent.trim() === '插件')
  if (!c) return false
  c.click(); return true
})()`)
await sleep(1000)
const d1 = await state()
ok(clicked, '点得到卡片')
ok(d1?.crumb.includes('全部模块'), '模块页出现面包屑，且有「← 全部模块」', d1?.crumb)
ok(d1?.crumb.includes('插件'), '面包屑里显示当前模块名', d1?.crumb)
ok(d1?.crumb.includes('运维'), '面包屑里带分组（不是只给模块名）', d1?.crumb)
ok(d1?.tabbar === false && d1?.tabs === 0, '模块页也没有 tab 行（只剩面包屑）', `tabs=${d1?.tabs}`)
ok(d1?.dirty === false, '模块页没有 undefined / NaN 泄漏')
await shot('admin-shell-2-module.png')

console.log('\n── ② 面包屑返回 ──')
await evalJs(`document.querySelector('.admin-crumb-back').click()`)
await sleep(1000)
ok((await state())?.dash, '点「← 全部模块」回到仪表盘')

console.log('\n── ③ 键盘快捷键仍能切模块 ──')
await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }))`)
await sleep(150)
await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))`)
await sleep(900)
const d3 = await state()
ok(d3?.crumb.includes('站点管理'), 'g + s 快捷键仍能切到站点管理', d3?.crumb)
await evalJs(`document.querySelector('.admin-crumb-back')?.click()`)
await sleep(900)
ok((await state())?.dash, '再次回到仪表盘')

console.log('\n── ④ 窄屏（420px）──')
await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 860, deviceScaleFactor: 1, mobile: true })
await sleep(900)
const d4 = await state()
ok(d4?.cards === 12, '窄屏下 12 张卡都在', `${d4?.cards} 张`)
ok(d4?.dirty === false, '窄屏下没有 undefined / NaN')
const overflowX = await evalJs(`document.documentElement.scrollWidth > document.documentElement.clientWidth + 2`)
ok(overflowX === false, '窄屏下没有横向滚动条')
await shot('admin-shell-3-narrow.png')
await send('Emulation.clearDeviceMetricsOverride')
await sleep(400)

console.log('\n── ⑤ 无未预期异常 ──')
const real = errs.filter(e => !/favicon|Failed to load resource/i.test(e))
ok(real.length === 0, '无控制台错误', real.slice(0, 2).join(' | '))

clearTimeout(watchdog)
console.log(`\n后台中间区形态验证：${pass} 通过 / ${failures.length} 失败`)
if (failures.length) for (const f of failures) console.log('  ✖ ' + f)
cleanup()
process.exit(failures.length ? 1 : 0)
