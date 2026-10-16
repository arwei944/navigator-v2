/**
 * 真机验证：筛选条压到两行（第二行只留常用标签，其余进「更多」面板）。
 *
 * 为什么必须真机跑：「只占两行」是个**渲染后**的事实 —— 单测能证明取数规则，
 * 证明不了「装到 DOM 上真的只有一行」。本项目在这一点上栽过多次
 * （空心方框、标题重复渲染、模块图整体加载失败）。
 *
 * 覆盖：行数 / 总高 / 行内标签数上限 / 「更多」面板内容与位置 /
 * 面板选择生效并自动收起 / 已选中标签必须留在行内 / Esc 与点外部收起 /
 * 窄屏（420px）下仍是一行 / 无未预期异常。
 *
 * 用法：node probe/filter-bar-verify.mjs [cdp-port]
 */
import { writeFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = process.argv[2] || '9411'
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
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(tmpdir(), 'nav-v2-probe-filterbar')}`,
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
async function waitFor(expr, timeout = 20000, label = expr) {
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

// 量筛选条：几行、多高、行内几个
const measure = () => jsonOf(`(() => {
  const bar = document.querySelector('.filter-bar')
  const tabs = document.querySelector('.domain-tabs')
  const wrap = document.querySelector('.chip-row-wrap')
  const row = wrap && wrap.querySelector('.chip-row')
  const more = wrap && wrap.querySelector('.more-btn')
  if (!bar || !tabs || !row) return null
  const kids = [...row.children]
  const tops = [...new Set(kids.map(k => Math.round(k.getBoundingClientRect().top)))]
  const wrapBox = wrap.getBoundingClientRect()
  const moreBox = more ? more.getBoundingClientRect() : null
  return {
    barH: Math.round(bar.getBoundingClientRect().height),
    tabsH: Math.round(tabs.getBoundingClientRect().height),
    rowH: Math.round(wrap.getBoundingClientRect().height),
    rows: tops.length,
    inline: kids.length,
    hasMore: !!more,
    // 标签溢出时，「更多」必须仍完整落在内容区里（它是唯一的入口）
    moreVisible: !!(moreBox && moreBox.width > 0 && moreBox.right <= wrapBox.right + 1),
    // 几何数值：眼睛在小图上分不清「贴边」和「被切」，用数字说话
    geo: {
      moreRight: moreBox ? Math.round(moreBox.right) : null,
      wrapRight: Math.round(wrapBox.right),
      barRight: Math.round(bar.getBoundingClientRect().right),
      padRight: Math.round(parseFloat(getComputedStyle(bar).paddingRight) || 0),
      rowRight: Math.round(row.getBoundingClientRect().right),
      scrollW: row.scrollWidth, clientW: row.clientWidth,
    },
    overflowing: row.scrollWidth > row.clientWidth + 1,
    labels: kids.map(k => k.textContent.replace(/\\s+/g, ' ').trim()),
  }
})()`)

/* ---------------- 打开首页 ---------------- */

await evalJs(`location.href = ${JSON.stringify(SITE_BASE + '/')}`)
await send('Runtime.enable')
await send('Page.enable')
if (!(await waitFor(`document.querySelector('.filter-bar')`, 30000, '筛选条渲染'))) { cleanup(); process.exit(2) }
await waitFor(`document.querySelector('.chip-row') && document.querySelector('.chip-row').children.length > 0`, 20000, '第二行标签出现')
await sleep(600)

console.log('\n── ① 筛选条 ≤ 2 行 ──')
const m = await measure()
ok(!!m, '筛选条 / 方向 tab / 标签行都在')
ok(m && m.rows === 1, '第二行所有标签在同一行（无换行）', m ? `${m.inline} 个标签，${m.rows} 行` : '')
// 两行 = 方向 tab + 标签行 + 间隙(8) + 底部内边距(12)，留 6px 容差
ok(m && m.barH <= m.tabsH + m.rowH + 26, '筛选条总高 = 两行', m ? `${m.barH}px（两行 ${m.tabsH + m.rowH + 20}px）` : '')
ok(m && m.inline <= 8, '行内标签不超过 8 个（其余收进「更多」）', m ? String(m.inline) : '')
ok(m && m.hasMore, '第二行末尾有「更多」入口')
// 截图逮到过：标签一溢出，「更多」被挤到右边缘外只露一半 —— 入口不能被切
ok(m && m.moreVisible, '「更多」完整可见（标签溢出时也不被切掉）',
  m ? `标签${m.overflowing ? `已溢出（${m.geo.scrollW}>${m.geo.clientW}）、可横滑` : '未溢出'}；按钮 right ${m.geo.moreRight} / 内容右边界 ${m.geo.wrapRight}（筛选条 ${m.geo.barRight} − 内边距 ${m.geo.padRight}）` : '')
ok(m && m.geo.moreRight <= m.geo.barRight - m.geo.padRight + 1,
  '「更多」与内容区右边界对齐（没有越出筛选条的内边距）',
  m ? `${m.geo.moreRight} ≤ ${m.geo.barRight - m.geo.padRight}` : '')
await shot('filter-bar-2rows.png')

console.log('\n── ②「更多」面板 ──')
await evalJs(`document.querySelector('.more-btn').click()`)
await sleep(350)
const panel = await jsonOf(`(() => {
  const p = document.querySelector('.more-panel')
  if (!p) return null
  const row = document.querySelector('.chip-row')
  return {
    chips: p.querySelectorAll('.chip').length,
    groups: p.querySelectorAll('.pop-group').length,
    labels: [...p.querySelectorAll('.chip-group-label')].map(e => e.textContent.trim()),
    belowBar: p.getBoundingClientRect().top >= row.getBoundingClientRect().bottom - 2,
    scrollsWithMain: p.scrollHeight <= p.clientHeight + 1,
  }
})()`)
ok(!!panel, '点「更多」展开面板')
ok(panel && panel.chips >= 20, '面板收纳了其余标签', panel ? `${panel.chips} 个` : '')
ok(panel && m && panel.chips > m.inline, '面板比第二行多（确实收进了东西）')
ok(panel && panel.groups >= 3, '面板按方向分组', panel ? `${panel.groups} 组` : '')
ok(panel && panel.labels.includes('用途'), '用途也收进面板', panel ? panel.labels.join(' / ') : '')
ok(panel && panel.belowBar, '面板展开在筛选条下方，不覆盖内容')
ok(panel && panel.scrollsWithMain, '面板内容无需内部滚动（放得下）')
await shot('filter-bar-more.png')

console.log('\n── ③ 面板里选一个最冷门的分类 ──')
const picked = await jsonOf(`(() => {
  const chips = [...document.querySelectorAll('.more-panel .chip')]
  let best = null, bestN = Infinity
  for (const c of chips) {
    const n = parseInt(c.querySelector('.chip-count')?.textContent || '0', 10) || 0
    if (n < bestN) { bestN = n; best = c }
  }
  if (!best) return null
  const out = { label: best.textContent.replace(/\\s+/g, ' ').trim(), count: bestN, url: location.href }
  best.click()
  return out
})()`)
await sleep(700)
ok(!!picked, '面板里点得到标签', picked ? `${picked.label}（${picked.count}）` : '')
ok(await evalJs(`location.search.includes('c=')`), '点击后筛选生效（URL 带上 c 参数）', await evalJs(`location.search`))
ok(!(await evalJs(`!!document.querySelector('.more-panel')`)), '选完自动收起面板')

console.log('\n── ④ 已选中的标签必须留在第二行（最容易被挤出可视区的那个）──')
const after = await measure()
const pickedLabel = picked ? picked.label.replace(/\s*\d+$/, '').trim() : ''
ok(after && after.labels.some(l => l.startsWith(pickedLabel)), '已选中的冷门标签仍在行内可见',
  after ? `行内 ${after.labels.length} 个：${after.labels.join(' / ')}` : '')
ok(after && after.rows === 1 && after.inline <= 8, '加上已选项后仍是单行、不超上限',
  after ? `${after.inline} 个 / ${after.rows} 行` : '')
ok(after && after.barH <= after.tabsH + after.rowH + 26, '选中后筛选条仍是两行', after ? `${after.barH}px` : '')

console.log('\n── ⑤ 收起：Esc 与点外部 ──')
await evalJs(`document.querySelector('.more-btn').click()`)
await sleep(300)
ok(await evalJs(`!!document.querySelector('.more-panel')`), '再次展开面板')
await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
await sleep(250)
ok(!(await evalJs(`!!document.querySelector('.more-panel')`)), 'Esc 收起面板')
await evalJs(`document.querySelector('.more-btn').click()`)
await sleep(300)
ok(await evalJs(`!!document.querySelector('.more-panel')`), '第三次展开面板')
await evalJs(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
await sleep(250)
ok(!(await evalJs(`!!document.querySelector('.more-panel')`)), '点面板外收起面板')

console.log('\n── ⑥ 窄屏（420px）仍是一行 ──')
await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 860, deviceScaleFactor: 1, mobile: true })
await sleep(700)
const narrow = await measure()
ok(narrow && narrow.rows === 1, '420px 下第二行仍不换行（横向滑动）', narrow ? `${narrow.rows} 行` : '')
ok(narrow && narrow.barH <= narrow.tabsH + narrow.rowH + 30, '420px 下筛选条仍是两行', narrow ? `${narrow.barH}px` : '')
await shot('filter-bar-narrow.png')
await send('Emulation.clearDeviceMetricsOverride')
await sleep(300)

console.log('\n── ⑦ 页面无未预期异常 ──')
const real = consoleErrors.filter(e => !/favicon|404|Failed to load resource/i.test(e))
ok(real.length === 0, '无控制台错误', real.slice(0, 2).join(' | '))

clearTimeout(watchdog)
console.log(`\n筛选条真机验证：${pass} 通过 / ${failures.length} 失败`)
if (failures.length) { for (const f of failures) console.log('  ✖ ' + f) }
cleanup()
process.exit(failures.length ? 1 : 0)
