/**
 * 真机验证：背景音乐播放器（趣味插件）。
 *
 * 为什么必须真机：能不能**出声**是浏览器的策略问题（无手势不许播放），
 * 纯函数测试永远测不到。所以这里用 **CDP 真实输入事件**点播放按钮 ——
 * 合成 click 事件不算用户手势，测出来会是"点了没反应"的假失败。
 *
 * 覆盖：设置里开关 → 播放器挂载（懒加载 chunk）→ 真实点击出声（进度在走）
 *      → 换曲 → 音量落盘 → 关闭卸载 → 无控制台错误
 *
 * 用法：node probe/bgm-verify.mjs [cdp-port] [site-base]
 */
import { writeFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = process.argv[2] || '9511'
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
    `--user-data-dir=${join(tmpdir(), 'nav-v2-probe-bgm')}`,
    '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--mute-audio',                    // 探针环境不需要真的响，但 AudioContext 照常跑
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
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    // Error 对象没有 .value，得从 .description / preview 取文本，否则只能看到空串
    const a = m.params.args?.[0]
    const txt = a?.value ?? a?.description ?? a?.preview?.description ?? JSON.stringify(a?.preview?.properties || [])
    errs.push(String(txt || '').replace(/\s+/g, ' ').slice(0, 400))
  }
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
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable')
const sleep = ms => new Promise(s => setTimeout(s, ms))
const jsonOf = async e => { const s = await evalJs(`JSON.stringify((() => { try { return (${e}) } catch (e) { return { err: String(e) } } })())`); return s ? JSON.parse(s) : null }
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(HERE, name), Buffer.from(r.data, 'base64'))
  console.log(`  📸 ${name}`)
}
/** 真实输入事件（合成 click 不算用户手势，测不出自动播放策略） */
async function realClick(sel) {
  const box = await jsonOf(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  if (!box) return false
  const base = { x: box.x, y: box.y, button: 'left', clickCount: 1 }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: base.x, y: base.y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base })
  return true
}

console.log('\n── ① 工具栏一键开关（不用进设置）──')
await evalJs(`location.href = ${JSON.stringify(SITE_BASE + '/')}`)
await send('Runtime.enable'); await send('Page.enable')
for (let i = 0; i < 60; i++) { if (await evalJs(`location.host`).catch(() => '')) break; await sleep(300) }
// 复位到已知状态：同一次探针必须可重复跑（上一轮留下的 bgmOn 会让断言互相矛盾）
await evalJs(`(() => { try { localStorage.removeItem('preferences') } catch (e) {} ; return true })()`)
await evalJs(`location.reload()`)
await send('Runtime.enable'); await send('Page.enable')
for (let i = 0; i < 60; i++) { if (await evalJs(`location.host`).catch(() => '')) break; await sleep(300) }
for (let i = 0; i < 80; i++) { if (await evalJs(`!!document.querySelector('.settings-btn')`).catch(() => false)) break; await sleep(400) }
await sleep(1200)

ok(await evalJs(`!document.querySelector('.bgm')`), '默认不渲染播放器（插件默认关，首屏不为它付费）')

// 这一条对应真实反馈「线上没有显示这个插件」：插件默认关，而入口原本只在设置里
// （第 3 个分区、要往下滚）。现在工具栏有一个 ♪，一眼可见、一次点击。
ok(await evalJs(`!!document.querySelector('.bgm-toggle')`), '工具栏有背景音乐开关')
await shot('bgm-0-toolbar.png')
await evalJs(`document.querySelector('.bgm-toggle').click()`)
await sleep(900)
ok(await evalJs(`!!document.querySelector('.bgm')`), '点一下工具栏开关，播放器出现（一次点击）')
ok(await evalJs(`document.querySelector('.bgm-toggle')?.classList.contains('active')`), '开关显示生效态')
await evalJs(`document.querySelector('.bgm-toggle').click()`)
await sleep(700)
ok(!(await evalJs(`!!document.querySelector('.bgm')`)), '再点一下关闭（播放器卸载）')
await evalJs(`document.querySelector('.settings-btn').click()`)
await sleep(900)
const sec = await jsonOf(`(() => {
  const all = [...document.querySelectorAll('.settings-section')]
  const hit = all.find(s => /背景音乐/.test(s.textContent))
  if (!hit) return null
  return { tracks: [...hit.querySelectorAll('.theme-toggle-btn')].map(b => b.textContent.trim()), hasToggle: !!hit.querySelector('input[type="checkbox"]'), hasRange: !!hit.querySelector('input[type="range"]') }
})()`)
ok(!!sec, '设置里有「背景音乐」分区')
ok(sec && sec.hasToggle, '关着的时候也有开关（不然打不开）')
ok(sec && sec.tracks.length === 0, '关着时不渲染曲目与音量（省得摆一堆用不上的控件）')
await shot('bgm-1-settings.png')

await evalJs(`(() => { const s = [...document.querySelectorAll('.settings-section')].find(s => /背景音乐/.test(s.textContent)); s.querySelector('input[type="checkbox"]').click(); return true })()`)
await sleep(700)
const sec2 = await jsonOf(`(() => {
  const hit = [...document.querySelectorAll('.settings-section')].find(s => /背景音乐/.test(s.textContent))
  if (!hit) return null
  return { tracks: [...hit.querySelectorAll('.theme-toggle-btn')].map(b => b.textContent.trim()), hasRange: !!hit.querySelector('input[type="range"]') }
})()`)
ok(sec2 && sec2.tracks.length === 3, '打开后列出三首曲目', sec2 ? sec2.tracks.join(' / ') : '')
ok(sec2 && sec2.hasRange, '打开后有音量滑杆')
await shot('bgm-1b-settings-on.png')
await evalJs(`document.querySelector('.settings-close')?.click()`)
await sleep(900)

console.log('\n── ② 播放器挂载（懒加载）──')
// 异步组件加载失败时不会抛到界面上、只是「渲染为空」——所以这里直接把 chunk 拉一次看结果
{
  const { readdirSync } = await import('node:fs')
  const chunk = readdirSync(join(ROOT, 'dist', 'assets')).find(f => /^BgmPlayer-.*.js$/.test(f))
  const imp = await evalJs(`import('/assets/${chunk}').then(m => 'ok:' + Object.keys(m).join(',')).catch(e => 'ERR: ' + (e && e.message ? e.message : String(e)))`)
  ok(String(imp).startsWith('ok'), '播放器 chunk 可独立加载（懒加载入口没问题）', String(imp).slice(0, 60))
}
const pill = await jsonOf(`(() => { const el = document.querySelector('.bgm'); return el ? { state: el.dataset.bgm, track: el.dataset.track, text: el.textContent.replace(/\\s+/g,' ').trim() } : null })()`)
ok(!!pill, '打开开关后右下角出现播放器', pill ? pill.text : '')
ok(pill?.state === 'paused', '初始是暂停态（不擅自出声）')
await shot('bgm-2-player.png')

console.log('\n── ③ 真实点击出声 ──')
const clicked = await realClick('.bgm-main')
ok(clicked, '点得到播放按钮')
await sleep(1400)
const st1 = await jsonOf(`(() => { const el = document.querySelector('.bgm'); return el ? { state: el.dataset.bgm, elapsed: Number(el.querySelector('[data-elapsed]').dataset.elapsed) } : { state: undefined, elapsed: 0 } })()`)
ok(st1?.state === 'playing', '真实点击后进入播放态（浏览器允许在用户手势里出声）', `data-bgm=${st1?.state}`)
await sleep(2200)
const st2 = await jsonOf(`(() => { const el = document.querySelector('.bgm'); return el ? { state: el.dataset.bgm, elapsed: Number(el.querySelector('[data-elapsed]').dataset.elapsed) } : { state: undefined, elapsed: 0 } })()`)
ok(st2.elapsed > st1.elapsed, '已播时长在走（说明音频时钟真的在跑）', `${st1.elapsed}s → ${st2.elapsed}s`)
await shot('bgm-3-playing.png')

console.log('\n── ④ 换曲 / 音量 / 关闭 ──')
const before = await evalJs(`document.querySelector('.bgm')?.dataset.track || ''`)
await evalJs(`[...document.querySelectorAll('.bgm-icon')].find(b => b.title === '下一首')?.click()`)
await sleep(1200)
const after = await evalJs(`document.querySelector('.bgm')?.dataset.track || ''`)
ok(after !== before, '下一首换曲生效', `${before} → ${after}`)
ok(await evalJs(`document.querySelector('.bgm')?.dataset.bgm === 'playing'`), '换曲后仍在播放（不是停了）')

await evalJs(`(() => { const el = document.querySelector('.bgm-vol'); if (!el) return false; el.value = '0.6'; el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
await sleep(500)
const savedVol = await jsonOf(`(() => { try { return JSON.parse(localStorage.getItem('preferences') || '{}').bgmVolume } catch { return null } })()`)
ok(savedVol !== undefined && Math.abs(Number(savedVol) - 0.6) < 0.02, '音量写进了偏好（下次打开还是这个音量）', String(savedVol))

await evalJs(`[...document.querySelectorAll('.bgm-icon')].find(b => b.title && b.title.startsWith('关闭'))?.click()`)
await sleep(700)
ok(!(await evalJs(`!!document.querySelector('.bgm')`)), '点关闭后播放器卸载（偏好里也关了）')
const savedOn = await jsonOf(`(() => { try { return JSON.parse(localStorage.getItem('preferences') || '{}').bgmOn } catch { return null } })()`)
ok(savedOn === false, '关闭状态已落盘', String(savedOn))

console.log('\n── ⑤ 无未预期异常 ──')
const real = errs.filter(e => !/favicon|Failed to load resource/i.test(e))
ok(real.length === 0, '无控制台错误', real.slice(0, 2).join(' | '))
if (real.length) console.log('    错误详情（原始）：' + JSON.stringify(errs.slice(0, 6)))

clearTimeout(watchdog)
console.log(`\n背景音乐真机验证：${pass} 通过 / ${failures.length} 失败`)
if (failures.length) for (const f of failures) console.log('  ✖ ' + f)
cleanup()
process.exit(failures.length ? 1 : 0)
