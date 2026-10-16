/**
 * 校验五款布局体验页 docs/admin-layout-lab-v2.html。
 *
 * 这一页的核心是「能真点」：所以不只验渲染，还要**真的点进去**，确认
 * 计数器在动、动作有反馈、切换真的换了内容、对照表算出来了。
 *
 * 用法：node probe/layout-lab-v2-check.mjs [cdp-port]
 */
import { writeFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PAGE = pathToFileURL(join(ROOT, 'docs', 'admin-layout-lab-v2.html')).href
const PORT = process.argv[2] || '9491'

const alive = async (u) => { try { await fetch(u, { signal: AbortSignal.timeout(1200) }); return true } catch { return false } }
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let chromeProc = null
if (!(await alive(`http://127.0.0.1:${PORT}/json/version`))) {
  if (!existsSync(CHROME)) { console.error(`找不到浏览器：${CHROME}`); process.exit(2) }
  // 直接把 file URL 作为启动参数：从 about:blank 跳 file:// 会被浏览器拦掉
  chromeProc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(tmpdir(), 'nav-v2-probe-lab2')}`,
    '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--window-size=1600,1200', '--allow-file-access-from-files', PAGE,
  ], { stdio: 'ignore', windowsHide: true })
  console.log(`  （自拉浏览器，PID ${chromeProc.pid}）`)
}
const cleanup = () => { try { if (chromeProc && !chromeProc.killed) chromeProc.kill() } catch { /* 已退出 */ } }
process.on('exit', cleanup)
const watchdog = setTimeout(() => { console.error('\n❌ 超时'); cleanup(); process.exit(3) }, 120000)

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find(t => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* 还没起来 */ }
    await new Promise(s => setTimeout(s, 500))
  }
  throw new Error('连不上 CDP')
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
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(String(m.params.args?.[0]?.value || '').slice(0, 200))
  if (m.method === 'Runtime.exceptionThrown') errs.push('[异常] ' + String(m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 200))
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

let pass = 0
const fails = []
const ok = (c, l, e = '') => { if (c) { pass++; console.log(`  ✅ ${l}${e ? ` → ${e}` : ''}`) } else { fails.push(l); console.log(`  ❌ ${l}${e ? ` → ${e}` : ''}`) } }

let ready = false
for (let i = 0; i < 40; i++) {
  const n = await evalJs(`document.querySelectorAll('#cards .plan').length`).catch(() => 0)
  if (n >= 5) { ready = true; break }
  await sleep(400)
}
await sleep(900)

console.log('\n── ① 五款都渲染出来 ──')
ok(ready, '五款原型都渲染出来了')
const cards = await jsonOf(`[...document.querySelectorAll('#cards .plan')].map(c => ({
  id: c.querySelector('.plan-idx').textContent,
  name: c.querySelector('.plan-name').textContent,
  hasFrame: !!c.querySelector('.frame-wrap .frame-scale > div')?.shadowRoot,
  rate: c.querySelector('[data-rate]').textContent,
  clicks: c.querySelector('[data-clicks]').textContent,
}))`)
ok(cards.length === 5, '5 张卡', cards.map(c => c.name).join(' / '))
ok(cards.every(c => c.hasFrame), '每张卡的 Shadow DOM 原型都挂上了')
ok(cards.every(c => /%$/.test(c.rate)), '一次可达率都算出来了', cards.map(c => c.id + ':' + c.rate).join('  '))
await shot('lab2-1-overview.png')

console.log('\n── ② 对照表（12 动作 × 5 款）──')
const cmp = await jsonOf(`(() => {
  const rows = [...document.querySelectorAll('#cmpBody tr')]
  const head = [...document.querySelectorAll('#cmpHead th')].map(e => e.textContent.trim())
  return { heads: head, rows: rows.length, last: rows[rows.length - 1].textContent.replace(/\\s+/g,' ').trim(),
           oneClickCells: rows.slice(0, -1).flatMap(r => [...r.querySelectorAll('td')].slice(1)).filter(td => td.textContent.trim() === '1 次').length }
})()`)
ok(cmp.heads.length === 6, '表头 = 动作 + 5 款', cmp.heads.join(' | '))
ok(cmp.rows === 13, '12 个动作 + 1 行小计', `${cmp.rows} 行`)
ok(cmp.oneClickCells >= 40, '「1 次可达」的格子够多（说明多数动作确实一次点到）', `${cmp.oneClickCells} 格`)
console.log(`     小计行：${cmp.last}`)

console.log('\n── ③ 真点：计数器要动 ──')
const host = i => `document.querySelectorAll('#cards .plan')[${i}].querySelector('.frame-scale > div').shadowRoot`
const clickIn = async (i, sel, label) => {
  const okc = await evalJs(`(() => { const el = ${host(i)}.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true })()`)
  await sleep(260)
  const n = await evalJs(`document.querySelectorAll('#cards .plan')[${i}].querySelector('[data-clicks]').textContent`)
  return { okc, n, label }
}
const c0 = await clickIn(0, '[data-act="发布到云端"]', 'P1 发布')
ok(c0.okc, '① 动作台：点得到「发布到云端」')
ok(c0.n === '1', '① 动作台：点击计数变成 1', `计数=${c0.n}`)
const toastOn = await evalJs(`${host(0)}.querySelector('.toast').classList.contains('on')`)
ok(toastOn, '① 动作台：动作有反馈（toast 出现）')
const asideText = await evalJs(`${host(0)}.querySelector('[data-aside-now]').textContent`)
ok(/发布到云端/.test(asideText), '① 动作台：右侧信息栏跟着更新', asideText)

const c1 = await clickIn(0, '[data-act="检查更新"]', 'P1 检查更新')
ok(c1.n === '2', '① 动作台：再点一次，计数累加到 2', `计数=${c1.n}`)

console.log('\n── ④ 真点：切换要真的换内容 ──')
// ② 左动作栏：点一下 = 选动作 + 右侧换面板
await clickIn(1, '.p2-i[data-panel="导出备份"]', 'P2 导出备份')
const p2title = await evalJs(`${host(1)}.querySelector('[data-p2-title]').textContent`)
ok(p2title === '导出备份', '② 左动作栏：一次点击换了右侧面板', p2title)
// ⑤ 主从工作台：点一下 = 换模块
await clickIn(4, '.p5-n[data-mod="插件"]', 'P5 插件')
const p5title = await evalJs(`${host(4)}.querySelector('[data-p5-title]').textContent`)
ok(p5title === '插件', '⑤ 主从工作台：一次点击换了模块', p5title)
const p5n = await evalJs(`document.querySelectorAll('#cards .plan')[4].querySelector('[data-clicks]').textContent`)
ok(p5n === '1', '⑤ 主从工作台：切换模块只花 1 次点击', `计数=${p5n}`)

console.log('\n── ⑤ 层次指标是实测的 ──')
const hier = await jsonOf(`[...document.querySelectorAll('#cards .plan')].map(c => c.querySelector('[data-metrics]').textContent.replace(/\\s+/g,' ').trim())`)
ok(hier.every(t => /字号跨度/.test(t) && /前 3 大区块/.test(t)), '每款都量出了字号跨度与面积集中度')
const spread = hier.map(t => parseFloat((t.match(/字号跨度[^0-9]*([0-9.]+)/) || [])[1] || 0))
ok(spread.every(v => v > 1), '五款的字号跨度都 > 1（确有层级，不是一水儿同号）', spread.join(' / '))
console.log('     ' + hier.join('\n     '))

console.log('\n── ⑥ 选择与复制 ──')
await evalJs(`document.querySelectorAll('#cards .pick')[2].click()`)
await sleep(300)
ok(await evalJs(`!!document.querySelector('#cards .plan.picked')`), '点「选择这款」能选中')
ok(await evalJs(`document.getElementById('copyBtn').disabled === false`), '选中后「复制我的选择」可用')
ok(await evalJs(`document.getElementById('selName').textContent.includes('一次可达')`), '底部显示已选与一次可达率', await evalJs(`document.getElementById('selName').textContent`))
await shot('lab2-2-pick.png')

// 滚到原型区，各拍一张（看的是「设计本身」长什么样，不是页面外壳）
for (const [i, name] of [[0, 'lab2-p1-actiondesk.png'], [3, 'lab2-p4-table.png']]) {
  await evalJs(`document.querySelectorAll('#cards .plan')[${i}].scrollIntoView({ block: 'start' })`)
  await sleep(600)
  await shot(name)
}

console.log('\n── ⑦ 页面健康 ──')
const health = await jsonOf(`({ hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  overflow: [...document.querySelectorAll('.plan, .tbl')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 2).length })`)
ok(!health.hScroll, '没有横向滚动条')
ok(health.overflow === 0, '没有元素溢出容器', `${health.overflow} 个`)
const real = errs.filter(e => !/favicon|Failed to load resource/i.test(e))
ok(real.length === 0, '无控制台错误', real.slice(0, 2).join(' | '))

clearTimeout(watchdog)
console.log(`\n体验页校验：${pass} 通过 / ${fails.length} 失败`)
if (fails.length) for (const f of fails) console.log('  ✖ ' + f)
cleanup()
process.exit(fails.length ? 1 : 0)
