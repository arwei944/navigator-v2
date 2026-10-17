/**
 * 移动端 + 无障碍**行为**核对（F3 / F4），替代人工点按。
 *
 * 与 test-mobile.mjs / test-a11y.mjs 的区别：那两个是**静态**检查（读 CSS / 源码文本），
 * 快但看不到运行时真相。这里用无头 Chrome 真的去：
 *   · 切到 375×667 与 390×844 两档视口，量底部栏的**实际**命中尺寸与是否可见；
 *   · 用 CDP 发真实 Tab 键，读 document.activeElement 看第一个焦点是不是 skip-link；
 *   · 打开侧栏抽屉后调 history.back()（等同 Android 返回手势 / 返回键），
 *     断言抽屉被关闭而不是离开站点 —— 这是 F4 返回手势协同的**行为**验证。
 *
 * 用法：node probe/_mobile-a11y-check.mjs [cdpPort] [staticPort]
 */
import { spawn } from 'node:child_process'
import { rmSync, mkdirSync, existsSync } from 'node:fs'

const CDP_PORT = Number(process.argv[2] || 9361)
const PORT = Number(process.argv[3] || 4176)
const BASE = `http://127.0.0.1:${PORT}`
const DIR = '.chrome-mobile-a11y'

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.CHROME_PATH,
].filter(Boolean).find(p => { try { return existsSync(p) } catch { return false } })
if (!CHROME) { console.error('找不到 Chrome'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitHttp(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok || r.status === 404) return true } catch {}
    await sleep(250)
  }
  return false
}

const server = spawn(process.execPath, ['probe/static-server.mjs', String(PORT), 'dist'], { stdio: 'ignore' })
if (!(await waitHttp(`${BASE}/`))) { console.error('静态服务器未就绪'); try { server.kill() } catch {}; process.exit(2) }

rmSync(DIR, { recursive: true, force: true })
mkdirSync(DIR, { recursive: true })
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${DIR}`,
  '--no-proxy-server', '--proxy-bypass-list=*', '--disable-gpu', '--hide-scrollbars',
  '--window-size=1440,1000', 'about:blank',
], { stdio: 'ignore', detached: true })
chrome.unref()
if (!(await waitHttp(`http://127.0.0.1:${CDP_PORT}/json/version`))) { console.error('Chrome 未就绪'); try { server.kill() } catch {}; process.exit(2) }

const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
const target = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl)
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let msgId = 0
const pending = new Map()
ws.onmessage = e => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
}
const send = (method, params = {}) => {
  const i = ++msgId
  ws.send(JSON.stringify({ id: i, method, params }))
  return new Promise(r => pending.set(i, r))
}
const evaluate = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result?.value
}

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }

await send('Page.enable')
await send('Runtime.enable')

/* 视口测量：底部栏是否可见、每个 tab 的命中区是否 ≥44 */
const MEASURE_BAR = `(() => {
  const bar = document.querySelector('.mobile-tabbar')
  if (!bar) return { found: false }
  const cs = getComputedStyle(bar)
  const r = bar.getBoundingClientRect()
  const tabs = [...bar.querySelectorAll('.tab')].map(t => {
    const rr = t.getBoundingClientRect()
    return { w: Math.round(rr.width), h: Math.round(rr.height) }
  })
  return {
    found: true,
    display: cs.display,
    visible: cs.display !== 'none' && r.height > 0,
    barH: Math.round(r.height),
    tabs,
    paddingBottom: cs.paddingBottom,
  }
})()`

for (const [w, h, label] of [[375, 667, '375×667 (iPhone SE/8)'], [390, 844, '390×844 (iPhone 12/13)']]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true })
  await send('Page.navigate', { url: `${BASE}/` })
  await sleep(2600)
  const m = await evaluate(MEASURE_BAR)
  ok(m.found && m.visible, `[${label}] 底部栏可见`, JSON.stringify(m))
  ok(m.barH >= 44, `[${label}] 底部栏高度 ≥44px`, `实得 ${m.barH}`)
  ok(m.tabs.length >= 3, `[${label}] 底部栏有 ≥3 个 tab`, `实得 ${m.tabs.length}`)
  ok(m.tabs.every(t => t.h >= 44 && t.w >= 44), `[${label}] 每个 tab 命中区 ≥44×44`,
    JSON.stringify(m.tabs))
  // env(safe-area-inset-bottom) 在无头 Chrome 里被解析成 0px（没有刘海/横条），
  // computed style 读不到原始声明 —— 这里只打印实测值；声明本身由 test-mobile.mjs
  // 的静态断言钉住（那才是能稳定观测它的地方）。
  console.log(`  · [${label}] 底部栏 padding-bottom 实测 ${m.paddingBottom}（env() 用法见 test-mobile 静态断言）`)
}

/* a11y：真实 Tab 键 → 第一个焦点应是 skip-link */
{
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await send('Page.navigate', { url: `${BASE}/` })
  await sleep(2600)
  await evaluate(`document.body.focus?.(); (document.activeElement && document.activeElement.blur && document.activeElement.blur())`)
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 9, code: 'Tab', key: 'Tab' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 9, code: 'Tab', key: 'Tab' })
  await sleep(250)
  const first = await evaluate(`(() => {
    const el = document.activeElement
    if (!el) return { tag: null }
    const cs = getComputedStyle(el)
    return { tag: el.tagName.toLowerCase(), cls: String(el.className || ''), text: (el.textContent || '').slice(0, 20), outline: cs.outlineStyle }
  })()`)
  ok(first.cls && /skip-link/.test(first.cls), '第一次 Tab 聚焦到 skip-link（键盘用户可直达主内容）', JSON.stringify(first))
  ok(first.outline && first.outline !== 'none', '聚焦元素有可见焦点环（:focus-visible 生效）', `outline=${first.outline}`)
}

/* F4 返回手势：打开侧栏 → history.back() → 应关闭抽屉而非离开站点 */
{
  await sleep(200)
  const opened = await evaluate(`(() => {
    const more = [...document.querySelectorAll('.mobile-tabbar .tab')].pop()
    if (!more) return { ok: false, why: 'no 更多 button' }
    more.click()
    return { ok: true }
  })()`)
  await sleep(500)
  const beforeBack = await evaluate(`(() => {
    const ov = document.querySelector('.overlay')
    return {
      overlayShown: Boolean(ov && ov.classList.contains('show')),
      historyFlag: Boolean(window.history.state && window.history.state.navDrawer),
      url: location.pathname + location.hash,
    }
  })()`)
  ok(opened.ok, '找到并点击了底部栏「更多」', JSON.stringify(opened))
  ok(beforeBack.overlayShown, '侧栏抽屉已打开（遮罩显示）', JSON.stringify(beforeBack))
  ok(beforeBack.historyFlag, '抽屉打开时压入了哨兵历史记录 navDrawer', JSON.stringify(beforeBack))

  const urlBefore = beforeBack.url
  await evaluate(`history.back()`)
  await sleep(700)
  const afterBack = await evaluate(`(() => {
    const ov = document.querySelector('.overlay')
    return {
      overlayShown: Boolean(ov && ov.classList.contains('show')),
      url: location.pathname + location.hash,
    }
  })()`)
  ok(!afterBack.overlayShown, '原生返回关闭了抽屉（而不是离开站点）', JSON.stringify(afterBack))
  ok(afterBack.url === urlBefore, '返回后 URL 未变（没有真的后退一页）', `${urlBefore} → ${afterBack.url}`)
}

console.log(`\n移动端 + 无障碍行为核对（F3/F4）：${pass} 通过，${failures.length} 失败`)
if (failures.length) {
  for (const f of failures) console.log('  ✗ ' + f)
} else {
  console.log('  ✓ 全部通过')
}

try { process.kill(chrome.pid) } catch {}
try { server.kill() } catch {}
await sleep(300)
try { rmSync(DIR, { recursive: true, force: true }) } catch {}
process.exit(failures.length ? 1 : 0)
