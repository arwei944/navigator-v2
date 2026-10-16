/**
 * 校验决策页 docs/admin-layout-lab.html：真开一次浏览器，确认
 *   ① 20 个布局都渲染出来了、分数都算出来了
 *   ② 分数确实是按基线算的（不是写死的）
 *   ③ 没有控制台异常 / 布局溢出
 * 并留下截图。
 *
 * 用法：node probe/layout-lab-check.mjs [cdp-port]
 */
import { writeFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PAGE = pathToFileURL(join(ROOT, 'docs', 'admin-layout-lab.html')).href
const PORT = process.argv[2] || '9431'

const alive = async (u) => { try { await fetch(u, { signal: AbortSignal.timeout(1200) }); return true } catch { return false } }

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let chromeProc = null
if (!(await alive(`http://127.0.0.1:${PORT}/json/version`))) {
  if (!existsSync(CHROME)) { console.error(`找不到浏览器：${CHROME}`); process.exit(2) }
  chromeProc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(tmpdir(), 'nav-v2-probe-layoutlab')}`,
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
const jsonOf = async e => { const s = await evalJs(`JSON.stringify((() => { try { return (${e}) } catch (e) { return {err:String(e)} } })())`); return s ? JSON.parse(s) : null }
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(HERE, name), Buffer.from(r.data, 'base64'))
  console.log(`  📸 ${name}`)
}

let pass = 0
const fails = []
const ok = (c, l, e = '') => { if (c) { pass++; console.log(`  ✅ ${l}${e ? ` → ${e}` : ''}`) } else { fails.push(l); console.log(`  ❌ ${l}${e ? ` → ${e}` : ''}`) } }

// 页面已经在启动参数里打开了。**不要**用 location.href 从 about:blank 跳 file:// ——
// Chrome 会拦掉这次导航，于是后面所有查询都在空白页上跑，得到「0 张卡」这种假失败。
let cardsReady = 0
for (let i = 0; i < 60; i++) {
  cardsReady = Number(await evalJs(`document.querySelectorAll('#cards .plan').length`).catch(() => 0)) || 0
  if (cardsReady >= 20) break
  await sleep(400)
}
await sleep(700)

console.log('\n── ① 渲染 ──')
const cards = await jsonOf(`[...document.querySelectorAll('#cards .plan')].map(c => ({
  id: c.querySelector('.plan-idx').textContent,
  name: c.querySelector('.plan-name').textContent,
  score: c.querySelector('[data-score]').textContent,
  pick: !!c.querySelector('.pick'),
  frame: !!c.querySelector('.frame-wrap .frame-scale > div')
}))`)
ok(Array.isArray(cards) && cards.length === 20, '20 个布局卡都渲染出来', cards?.length + ' 张')
ok(cards.every(c => c.frame), '每张卡都有真预览（Shadow DOM 宿主已挂载）')
ok(cards.every(c => /^\d+$/.test(c.score)), '一致性分都算出来了', cards.map(c => c.score).join(' / '))

console.log('\n── ② 分数是按基线算的（不是写死的）──')
const detail = await jsonOf(`(() => {
  const out = []
  for (const c of document.querySelectorAll('#cards .plan')) {
    const rows = [...c.querySelectorAll('[data-metrics] tr')].map(tr => tr.children[0].textContent + '：' + tr.children[1].textContent)
    out.push({ id: c.querySelector('.plan-idx').textContent,
               name: c.querySelector('.plan-name').textContent,
               score: +c.querySelector('[data-score]').textContent,
               rows, fresh: c.querySelector('[data-fresh]').textContent.slice(0, 90) })
  }
  return out
})()`)
const sorted = detail.every((d, i) => i === 0 || detail[i - 1].score >= d.score)
ok(sorted, '按一致性分从高到低排序')
const uniq = new Set(detail.map(d => d.score))
const hi = Math.max(...detail.map(d => d.score)), lo = Math.min(...detail.map(d => d.score))
// 分数天然聚在高位：预览都写在产品语言里。要验的是「它确实在按每个布局的实际取值算」——
// 所以看两件事：分值有跨度，且分项明细逐卡不同（写死的话会完全一样）。
ok(hi - lo >= 5, '分数有区分度（不是所有布局同一个分）', `${uniq.size} 个不同分值，跨度 ${hi - lo}（${lo}–${hi}）`)
const rowSigs = new Set(detail.map(d => d.rows.join('|')))
ok(rowSigs.size === detail.length, '每张卡的分项明细都不同（说明是逐卡实测，不是写死的）', `${rowSigs.size}/${detail.length} 种`)
ok(detail.some(d => d.rows.some(r => /新增 [1-9]/.test(r))), '有布局被量出「新增」档的取值（说明分档真的在动）')
const density = detail.map(d => Number((d.rows.find(r => /元素数/.test(r)) || '').replace(/\D/g, '')) || 0)
// 用比值而不是差值：尺度无关，也不至于把阈值调到刚好卡住实测值
ok(Math.max(...density) >= Math.min(...density) * 1.5, '信息密度确实拉开了差距',
  `${Math.min(...density)}–${Math.max(...density)} 个元素（最密的比最疏的多 ${Math.round((Math.max(...density) / Math.min(...density) - 1) * 100)}%）`)
ok(detail.some(d => /从未出现过的值/.test(d.fresh)), '有布局被标记出「偏离婚产品值域」的值', detail.find(d => /从未出现过的值/.test(d.fresh))?.name || '')
console.log('\n  排名（一致性分 · 元素数 · 布局）：')
for (const d of detail) {
  const n = (d.rows.find(r => /元素数/.test(r)) || '').replace(/[^\d]/g, '')
  console.log(`    ${String(d.score).padStart(3)}  ${String(n).padStart(4)} 个元素  ${d.id} ${d.name}`)
}

console.log('\n── ③ 交互 ──')
await evalJs(`document.querySelectorAll('#cards .pick')[0].click()`)
await sleep(300)
ok(await evalJs(`!!document.querySelector('#cards .plan.picked')`), '点「选择这个」能选中')
ok(await evalJs(`document.getElementById('copyBtn').disabled === false`), '选中后「复制我的选择」可用')
ok(await evalJs(`document.getElementById('selName').textContent.includes('一致性')`), '底部显示已选与分数',
  await evalJs(`document.getElementById('selName').textContent`))
await evalJs(`document.querySelectorAll('#cards .pick')[0].click()`)
await sleep(200)
ok(await evalJs(`!document.querySelector('#cards .plan.picked')`), '再点一次取消选择')

console.log('\n── ④ 页面自身健康 ──')
const overflow = await jsonOf(`(() => {
  const de = document.documentElement
  const wide = [...document.querySelectorAll('.plan, .bar-card, .tbl')].filter(e => e.getBoundingClientRect().right > de.clientWidth + 2).length
  return { hScroll: de.scrollWidth > de.clientWidth + 2, wide, cards: document.querySelectorAll('#cards .plan').length }
})()`)
ok(!overflow.hScroll, '页面没有横向滚动条')
ok(overflow.wide === 0, '没有卡片溢出容器', `${overflow.wide} 个`)

await evalJs(`scrollTo(0,0)`); await sleep(400)
await shot('lab-1-overview.png')
const y = await evalJs(`document.getElementById('bars').getBoundingClientRect().top + scrollY - 40`)
await evalJs(`scrollTo(0, ${y})`); await sleep(500)
await shot('lab-2-baseline.png')
const y2 = await evalJs(`document.getElementById('cards').getBoundingClientRect().top + scrollY - 20`)
await evalJs(`scrollTo(0, ${y2})`); await sleep(600)
await shot('lab-3-cards.png')

// 放大 1:1 看一个布局的真实细节
await evalJs(`document.querySelectorAll('#cards .frame-wrap')[0].click()`)
await sleep(900)
ok(await evalJs(`document.getElementById('modal').classList.contains('on')`), '点预览能放大到 1:1')
await shot('lab-4-zoom.png')
await evalJs(`document.getElementById('modalClose').click()`)
await sleep(400)
ok(await evalJs(`!document.getElementById('modal').classList.contains('on')`), '放大后能关掉')
ok(await evalJs(`!!document.querySelector('#cards .frame-wrap .frame-scale > div')`), '关掉后预览回到原位')

console.log('\n── ⑤ 无未预期异常 ──')
const real = errs.filter(e => !/favicon|Failed to load resource/i.test(e))
ok(real.length === 0, '无控制台错误', real.slice(0, 3).join(' | '))

clearTimeout(watchdog)
console.log(`\n决策页校验：${pass} 通过 / ${fails.length} 失败`)
if (fails.length) for (const f of fails) console.log('  ✖ ' + f)
cleanup()
process.exit(fails.length ? 1 : 0)
