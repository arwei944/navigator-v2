/**
 * 无障碍对比度**实测**探针（F3）。
 *
 * ## 为什么必须用浏览器实测，而不是读 CSS 变量
 *
 * 站点颜色有三层真值：
 *   1. `main.css` 的 :root —— 只是**首帧兜底**；
 *   2. `stores/preferences.js#applyPreset` 在运行期把 `--accent`/`--bg-white` 等
 *      写成 :root 的**行内样式**（默认预设是 `themeSchema.js` 的 `#2563eb` 蓝，
 *      与 main.css 里的 `#0071e3` **根本不是同一个值**）；
 *   3. `visualScheme.js#tokensToCssVars` 再覆盖 `--border`/`--border-light` 与语义色。
 *
 * 所以「读 main.css 变量算对比度」算的是用户看不到的颜色。真值只能从
 * `getComputedStyle` 拿 —— 而且要**沿祖先链把半透明背景合成**（玻璃面板 / rgba 卡底），
 * 否则拿 rgba 原值套公式又是错的。
 *
 * ## 测什么
 *
 * 遍历页面里每个**直接含文本**的可见元素，取 computed `color` 与合成后的实际底色，
 * 按 WCAG 2.1 算对比度，并**按字号自动选阈值**：≥24px（或 ≥18.66px 且粗体）算大字 3:1，
 * 其余 4.5:1。占位符单独用 `::placeholder` 的 computed 色补测。明暗两套主题各跑一遍
 * （暗色走真实交互：点工具栏的 `.view-toggle`，不是手动 setAttribute）。
 *
 * 用法：node probe/_contrast-audit.mjs [cdpPort] [staticPort]
 * 产物：probe/_contrast-audit.json（结构化）+ 终端表格
 */
import { spawn } from 'node:child_process'
import { rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'

const CDP_PORT = Number(process.argv[2] || 9351)
const PORT = Number(process.argv[3] || 4174)
const BASE = `http://127.0.0.1:${PORT}`
const DIR = '.chrome-contrast'

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.CHROME_PATH,
].filter(Boolean)
const CHROME = CHROME_CANDIDATES.find(p => { try { return existsSync(p) } catch { return false } })
if (!CHROME) { console.error('找不到 Chrome，可用 CHROME_PATH 指定'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function waitHttp(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok || r.status === 404) return true } catch {}
    await sleep(250)
  }
  return false
}

/* ---- 1. 静态服务器托管 dist（无 SPA 兜底，等价真实宿主）---- */
const server = spawn(process.execPath, ['probe/static-server.mjs', String(PORT), 'dist'], { stdio: 'ignore', detached: false })
if (!(await waitHttp(`${BASE}/index.html`))) { console.error('静态服务器未就绪'); try { server.kill() } catch {}; process.exit(2) }
console.log(`静态服务器 → ${BASE}`)

/* ---- 2. 全新 profile 的无头 Chrome ---- */
rmSync(DIR, { recursive: true, force: true })
mkdirSync(DIR, { recursive: true })
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${DIR}`,
  '--no-proxy-server', '--proxy-bypass-list=*', '--disable-gpu', '--hide-scrollbars',
  '--window-size=1440,1000', 'about:blank',
], { stdio: 'ignore', detached: true })
chrome.unref()
if (!(await waitHttp(`http://127.0.0.1:${CDP_PORT}/json/version`))) { console.error('Chrome 未就绪'); try { server.kill() } catch {}; process.exit(2) }

/* ---- 3. CDP 连接 ---- */
const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
const target = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl)
if (!target) { console.error('没有可用页面'); process.exit(2) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let msgId = 0
const pending = new Map()
const events = []
ws.onmessage = e => {
  const m = JSON.parse(e.data)
  if (m.method) events.push(m)
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

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

/* ---- 页内测量的核心：computed 色 + 祖先背景合成 + WCAG ---- */
const MEASURE = `(() => {
  const lin = c => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  const Lum = c => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
  const parse = s => {
    const m = String(s || '').match(/rgba?\\(([^)]+)\\)/)
    if (!m) return null
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
    if (p.length < 3 || p.slice(0, 3).some(n => !Number.isFinite(n))) return null
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  const over = (fg, bg) => ({ r: fg.r*fg.a + bg.r*(1-fg.a), g: fg.g*fg.a + bg.g*(1-fg.a), b: fg.b*fg.a + bg.b*(1-fg.a), a: 1 })
  const ratio = (a, b) => { const x = Lum(a), y = Lum(b); const hi = Math.max(x,y), lo = Math.min(x,y); return (hi + 0.05) / (lo + 0.05) }
  // 沿祖先链收集半透明背景，从最外层向内合成，得到真实不透明底色
  const effBg = el => {
    const layers = []
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor)
      if (c && c.a > 0) layers.push(c)
      if (c && c.a >= 1) break
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 }  // 画布底白
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg)
    return bg
  }
  const needOf = (size, weight) => (size >= 24 || (size >= 18.66 && weight >= 700)) ? 3.0 : 4.5
  const visible = el => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width >= 1 && r.height >= 1
  }
  const out = []
  const seen = new Set()
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue
    const text = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim()
    if (!text) continue
    const cs = getComputedStyle(el)
    const fg = parse(cs.color); if (!fg) continue
    const bg = effBg(el)
    const size = parseFloat(cs.fontSize) || 14
    const weight = parseInt(cs.fontWeight, 10) || 400
    const cls = String(el.className || '').replace(/\\s+/g, ' ').slice(0, 46)
    const key = cs.color + '|' + size + '|' + weight + '|' + cls + '|' + bg.r + ',' + bg.g + ',' + bg.b
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      kind: 'text', text: text.slice(0, 24), tag: el.tagName.toLowerCase(), cls,
      fg: cs.color, bg: 'rgb(' + Math.round(bg.r) + ', ' + Math.round(bg.g) + ', ' + Math.round(bg.b) + ')',
      size, weight, ratio: +ratio(over(fg, bg), bg).toFixed(2), need: needOf(size, weight),
    })
  }
  // 表单占位符：伪元素色拿不到祖先链，用其宿主元素的合成底
  for (const inp of document.querySelectorAll('input, textarea')) {
    if (!visible(inp)) continue
    const ps = getComputedStyle(inp, '::placeholder')
    const fg = parse(ps.color); if (!fg || fg.a === 0) continue
    const bg = effBg(inp)
    const size = parseFloat(ps.fontSize) || 14
    out.push({
      kind: 'placeholder', text: '(占位符)', tag: inp.tagName.toLowerCase(),
      cls: String(inp.className || '').slice(0, 46),
      fg: ps.color, bg: 'rgb(' + Math.round(bg.r) + ', ' + Math.round(bg.g) + ', ' + Math.round(bg.b) + ')',
      size, weight: 400, ratio: +ratio(over(fg, bg), bg).toFixed(2), need: 4.5,
    })
  }
  return { theme: document.documentElement.getAttribute('data-theme') || 'light', count: out.length, rows: out }
})()`

async function loadAndMeasure() {
  // 清掉事件缓冲，避免把上次的 load 认成本次
  events.length = 0
  await send('Page.navigate', { url: `${BASE}/` })
  await sleep(2500) // 等 Vue 挂载 + 首屏卡片渲染
  await evaluate(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))`)
  return await evaluate(MEASURE)
}

/* ---- 4. 明色 → 点主题按钮 → 暗色 ---- */
const light = await loadAndMeasure()
console.log(`已测明色：${light.count} 个文本元素`)

const btnInfo = await evaluate(`(() => {
  const btns = [...document.querySelectorAll('button')].filter(b => /主题|深色|浅色/.test(b.getAttribute('aria-label') || ''))
  const t = btns[0] || document.querySelector('.view-toggle')
  return { found: btns.length, label: t ? (t.getAttribute('aria-label') || t.className) : null }
})()`)
console.log('主题按钮：' + JSON.stringify(btnInfo))
const clicked = await evaluate(`(() => {
  const btns = [...document.querySelectorAll('button')].filter(b => /主题|深色|浅色/.test(b.getAttribute('aria-label') || ''))
  const b = btns[0] || document.querySelector('.view-toggle')
  if (!b) return false
  b.click(); return true
})()`)
await sleep(1000)
const themeAfter = await evaluate(`document.documentElement.getAttribute('data-theme') || 'light'`)
if (!clicked || themeAfter !== 'dark') {
  console.log(`⚠ 真实切换未生效（clicked=${clicked}, theme=${themeAfter}），退回 setAttribute —— 注意：这只切 CSS 变量，不含 preset 运行期行内色`)
  await evaluate(`document.documentElement.setAttribute('data-theme', 'dark')`)
  await sleep(400)
}
await evaluate(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))`)
const darkRes = await evaluate(MEASURE)
console.log(`已测暗色：${darkRes.count} 个文本元素（theme=${darkRes.theme}）`)

/* ---- 5. 汇总 ---- */
const all = [
  ...light.rows.map(r => ({ ...r, theme: 'light' })),
  ...darkRes.rows.map(r => ({ ...r, theme: 'dark' })),
]
const fails = all.filter(r => r.ratio < r.need - 1e-9)
  .sort((a, b) => (a.ratio / a.need) - (b.ratio / b.need))

const summary = { at: new Date().toISOString(), light: light.rows.length, dark: darkRes.rows.length, fails: fails.length, rows: fails }
writeFileSync('probe/_contrast-audit.json', JSON.stringify({ summary, all }, null, 2))

console.log(`\n对比度实测（F3 · WCAG 2.1 AA）：明 ${light.rows.length} 组 / 暗 ${darkRes.rows.length} 组，**不达标 ${fails.length} 组**`)
if (fails.length) {
  console.log('\n不达标明细（按偏离度排序）：')
  console.log('  主题  实测    需  字号   前景                 底色                 元素')
  for (const f of fails.slice(0, 60)) {
    console.log(`  ${f.theme === 'light' ? '明' : '暗'}  ${String(f.ratio).padStart(5)}:1  ${f.need}  ${String(f.size).padStart(4)}px ${f.fg.padEnd(20)} ${f.bg.padEnd(20)} ${f.tag}.${f.cls} 「${f.text}」`)
  }
  if (fails.length > 60) console.log(`  … 共 ${fails.length} 组，完整见 probe/_contrast-audit.json`)
} else {
  console.log('  ✓ 全部达标')
}

/* ---- 收工 ---- */
try { process.kill(chrome.pid) } catch {}
try { server.kill() } catch {}
await sleep(300)
try { rmSync(DIR, { recursive: true, force: true }) } catch {}
process.exit(fails.length ? 1 : 0)
