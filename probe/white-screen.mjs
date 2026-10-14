/**
 * 白屏诊断探针：真浏览器打开线上（或本地）页面，抓**控制台错误 + DOM 挂载情况**。
 *
 * 为什么不能直接看 curl：HTTP 200 + HTML/JS 都能下载，只说明服务端活着；
 * 白屏是**运行时**的事（JS 抛错、渲染期访问 undefined、chunk 加载失败…），
 * 只有把页面真跑起来、把 console 里的异常捞出来才看得到。
 *
 * 用法：node probe/white-screen.mjs [url] [waitMs]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = process.argv[2] || 'https://nav-dashboard-19166.app.workbuddy.host/'
const WAIT = Number(process.argv[3] || 9000)
const PORT = '9222'
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const dir = mkdtempSync(join(tmpdir(), 'nav-ws-'))

const sleep = ms => new Promise(r => setTimeout(r, ms))

let chrome = null
function cleanup() {
  try { if (chrome && !chrome.killed) chrome.kill() } catch { /* 已退出 */ }
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* 忽略 */ }
}

async function endpoint() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await r.json()
      const page = list.find(t => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch { /* 还没起来 */ }
    await sleep(250)
  }
  throw new Error('CDP 端点未就绪')
}

const state = { errors: [], logs: [], failed: [] }

function onMessage(ws, raw) {
  let msg
  try { msg = JSON.parse(raw) } catch { return }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
    const text = (msg.params.args || []).map(a => a.value ?? a.description ?? a.type).join(' ')
    state.errors.push('console.error: ' + text.slice(0, 400))
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params?.exceptionDetails || {}
    state.errors.push('uncaught: ' + String(d.exception?.description || d.text || '').slice(0, 500))
  }
  if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') {
    state.logs.push('log: ' + String(msg.params.entry.text || '').slice(0, 300))
  }
  if (msg.method === 'Network.loadingFailed') {
    state.failed.push(`${msg.params.errorText} :: ${msg.params.type || ''}`)
  }
}

async function main() {
  chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
    '--disable-gpu', '--hide-scrollbars', '--window-size=1440,1000', 'about:blank',
  ], { stdio: 'ignore' })

  const wsUrl = await endpoint()
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const raw = typeof ev.data === 'string' ? ev.data : ''
    onMessage(ws, raw)
    let m
    try { m = JSON.parse(raw) } catch { return }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id
    pending.set(mid, res)
    ws.send(JSON.stringify({ id: mid, method, params }))
    setTimeout(() => { if (pending.has(mid)) { pending.get(mid)({ result: {} }); pending.delete(mid) } }, 15000)
  })

  await send('Runtime.enable')
  await send('Log.enable')
  await send('Network.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: URL_ })

  await sleep(WAIT)

  const probe = await send('Runtime.evaluate', {
    expression: `(() => {
      const app = document.getElementById('app');
      const cards = document.querySelectorAll('.card').length;
      const nav = document.querySelectorAll('.sidebar-nav-item').length;
      const text = (document.body.innerText || '').trim().slice(0, 200);
      return JSON.stringify({
        appExists: !!app,
        appChildren: app ? app.children.length : -1,
        appHtmlLen: app ? app.innerHTML.length : -1,
        cards, nav,
        readyState: document.readyState,
        url: location.href,
        text,
        sw: 'serviceWorker' in navigator,
        pipeline: typeof window.__navPipeline__,
      });
    })()`,
    returnByValue: true, awaitPromise: true,
  })
  const out = probe.result?.result?.value || probe.result?.exceptionDetails?.text || '{}'
  let info = {}
  try { info = JSON.parse(out) } catch { info = { raw: out } }

  console.log('\n── 页面状态 ──')
  console.log(JSON.stringify(info, null, 2))

  /** 每轮导航后取样：看有没有渲染、SW 是否接管、`#app` 里到底是什么 */
  const shot = async (label) => {
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        const app = document.getElementById('app')
        return JSON.stringify({
          appChildren: app ? app.children.length : -1,
          cards: document.querySelectorAll('.card').length,
          controller: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
          vapp: app ? app.hasAttribute('data-v-app') : null,
          appHead: app ? String(app.innerHTML).slice(0, 100) : '',
        })
      })()`,
      returnByValue: true, awaitPromise: true,
    })
    const v = r.result?.result?.value || '{}'
    let o = {}
    try { o = JSON.parse(v) } catch { o = { raw: v } }
    console.log(`  ${label}:`, JSON.stringify(o))
    return o
  }

  /**
   * 多轮导航：**这才是白屏真正发生的时刻**。
   * 首次访问时还没有 SW；等 SW 装好并接管后，导航/资源请求改由它处理 —— 时序与
   * 首次完全不同（本地缓存命中、加载更快），只有多刷几次才可能撞上。
   * 只看第一次等于没测。
   */
  const ROUNDS = Number(process.argv[4] || 3)
  let last = null
  for (let i = 2; i <= ROUNDS; i++) {
    await sleep(2500)
    await send('Page.navigate', { url: URL_ })
    await sleep(7000)
    last = await shot(`第 ${i} 次导航`, i)
  }
  const info2 = last || {}
  const swBad = info2.appChildren === 0 || info2.cards === 0
  console.log('\n── 多轮导航（SW 接管后，看最后一次）──')
  console.log(JSON.stringify(info2, null, 2))
  console.log(swBad ? '❌ 多轮导航后白屏' : '✅ 多轮导航后仍正常渲染')
  console.log('\n── 控制台错误 (' + state.errors.length + ') ──')
  for (const e of state.errors.slice(0, 12)) console.log('  ✖ ' + e)
  console.log('\n── 网络失败 (' + state.failed.length + ') ──')
  for (const f of state.failed.slice(0, 12)) console.log('  ✖ ' + f)
  for (const l of state.logs.slice(0, 6)) console.log('  · ' + l)

  const bad = state.errors.length > 0 || info.appChildren === 0 || info.cards === 0
  console.log(bad ? '\n❌ 白屏/异常成立' : '\n✅ 页面渲染正常')
  ws.close()
}

try { await main() } catch (e) { console.error('探针失败: ' + e.message) } finally { cleanup(); process.exit(0) }
