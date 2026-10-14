/**
 * 升级场景复现探针：**装过 Service Worker 的浏览器，遇到一次版本升级会不会白屏**。
 *
 * ## 为什么必须有这个探针
 *
 * 只测「全新浏览器打开一次」等于没测 —— 首次访问时根本没有 SW，导航请求走网络，
 * 永远拿最新 HTML，什么问题都暴露不出来。白屏发生在**第二次以后**：
 * SW 已经接管导航，它若把缓存里的旧 index.html 直接回给浏览器，那份 HTML 引用的
 * `assets/index-<旧 hash>.js` 早被新版本换掉并从磁盘删掉 → 404 → 模块不执行 → 全白。
 *
 * ## 它怎么复现
 *
 *   ① 起本地 dist 服务 → 用真浏览器访问一次（装上 SW）
 *   ② **模拟一次升级**：把 index.html 指向新的 chunk 名，并删掉旧 chunk
 *      （真实部署就是这样：产物 hash 变了，旧文件随 dist 一起被清掉）
 *   ③ 再访问一次 → 看 `#app` 有没有内容
 *
 * ③ 若渲染出卡片，说明「HTML 走网络优先」这条修复是真的成立；
 *   若白屏，说明 SW 仍从缓存回了旧 HTML（预缓存里还有 html）。
 *
 * 用法：node probe/sw-upgrade-sim.mjs [--port 4180]
 */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, copyFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = process.argv[2] || '4181'
const CDP = '9223'
const BASE = `http://127.0.0.1:${PORT}`
const ROOT = join(process.cwd(), 'dist')
const INDEX = join(ROOT, 'index.html')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const profile = mkdtempSync(join(tmpdir(), 'nav-swsim-'))

const sleep = ms => new Promise(r => setTimeout(r, ms))
let chrome = null, server = null
let backup = ''
let newChunk = ''
/** 额外的还原动作（改了几个文件就注册几个，别让探针在 dist 里留下残骸） */
const cleanupExtras = []

function cleanup() {
  try { if (chrome && !chrome.killed) chrome.kill() } catch { /* 已退出 */ }
  try { if (server && !server.killed) server.kill() } catch { /* 已退出 */ }
  // 还原被改动的产物（dist 不入库，改坏了只能靠备份回来）
  try { if (backup) writeFileSync(INDEX, backup, 'utf8') } catch { /* ignore */ }
  /**
   * 顺序要紧：extras 里有一条是「把新 chunk 拷回旧名字」，它得在**删除新 chunk 之前**做。
   * 反过来的话源文件先没了，还原必然 ENOENT —— dist 就留成半残状态，下次探针一上来就
   * 「白屏」，还会让人误判成产品问题（踩过一次）。
   */
  for (const fn of cleanupExtras) { try { fn() } catch { /* ignore */ } }
  try { if (newChunk) rmSync(join(ROOT, 'assets', newChunk), { force: true }) } catch { /* ignore */ }
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
}

async function endpoint() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()
      const page = list.find(t => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch { /* 未就绪 */ }
    await sleep(250)
  }
  throw new Error('CDP 端点未就绪')
}

const errors = []
async function main() {
  if (!existsSync(INDEX)) throw new Error('缺 dist/index.html，请先 npm run build')

  server = spawn(process.execPath, [join(ROOT, 'server.js')], {
    env: { ...process.env, PORT, HOST: '127.0.0.1' }, stdio: 'ignore',
  })
  for (let i = 0; i < 30; i++) {
    try { await fetch(BASE + '/api/sites'); break } catch { await sleep(300) }
  }

  chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
    '--disable-gpu', '--window-size=1440,1000', 'about:blank',
  ], { stdio: 'ignore' })

  const ws = new WebSocket(await endpoint())
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  let navCount = 0
  ws.onmessage = (ev) => {
    const raw = String(ev.data || '')
    let m
    try { m = JSON.parse(raw) } catch { return }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push('uncaught: ' + String(m.params?.exceptionDetails?.exception?.description || '').slice(0, 900))
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      const t = m.params?.type || 'log'
      const text = (m.params?.args || []).map(a => a.value ?? a.description ?? '').join(' ')
      errors.push(`console.${t}: ${String(text).slice(0, 300)}`)
    }
    if (m.method === 'Network.loadingFailed') {
      errors.push(`net-fail: ${m.params?.errorText} (${m.params?.type || ''})`)
    }
    // 数导航次数：页面自己 reload 了几回，一眼看穿「自愈在转圈」还是「真白屏」
    if (m.method === 'Page.frameNavigated' && !m.params?.frame?.parentId) navCount += 1
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id
    pending.set(mid, res)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable')

  const shot = async (label) => {
    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        const app = document.getElementById('app')
        return JSON.stringify({
          children: app ? app.children.length : -1,
          cards: document.querySelectorAll('.card').length,
          controller: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
          chunk: (document.querySelector('script[src*="index-"]')||{}).src || '',
          ready: document.readyState,
          href: location.href,
          heals: (() => { try { return sessionStorage.getItem('nav:sw-selfheal') || '0' } catch (e) { return 'na' } })(),
          scripts: document.scripts.length,
          appHead: app ? String(app.innerHTML).slice(0, 120) : 'NO-APP',
          bodyHead: String(document.body.innerHTML).slice(0, 160),
        })
      })()`,
      returnByValue: true, awaitPromise: true,
    })
    const v = r.result?.result?.value || '{}'
    let o = {}
    try { o = JSON.parse(v) } catch { o = { raw: v } }
    console.log(`  ${label} nav=${navCount}:`, JSON.stringify(o))
    return o
  }

  console.log('\n① 首次访问（装 SW）')
  await send('Page.navigate', { url: BASE })
  await sleep(8000)
  const first = await shot('首次')

  /* ── ② 模拟升级：index.html 指向新 chunk，旧 chunk 删掉 ──
   * 注意 **sw.js 的清单必须一起换**：真实部署里 sw.js 也是新构建的，清单里是新文件名。
   * 只改 index.html 不改 sw.js，会让 SW 拿着旧清单去下载已被删掉的旧 chunk → 安装失败，
   * 那是在测「部署漏发 sw.js」这个别的故障，不是我们要的升级场景（第一版就踩了这个偏差）。 */
  backup = readFileSync(INDEX, 'utf8')
  const m = backup.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/)
  if (!m) throw new Error('index.html 里没找到入口 chunk')
  const oldChunk = m[1]
  newChunk = oldChunk.replace(/index-/, 'index-upgraded-')
  const swPath = join(ROOT, 'sw.js')
  const swBackup = readFileSync(swPath, 'utf8')
  writeFileSync(INDEX, backup.replaceAll(oldChunk, newChunk), 'utf8')
  writeFileSync(swPath, swBackup.replaceAll(oldChunk, newChunk), 'utf8')
  copyFileSync(join(ROOT, 'assets', oldChunk), join(ROOT, 'assets', newChunk))
  rmSync(join(ROOT, 'assets', oldChunk), { force: true })   // 旧产物随部署一起消失
  cleanupExtras.push(() => writeFileSync(swPath, swBackup, 'utf8'))
  // 旧 chunk 是被探针删的，探针负责还回去 —— 否则 index.html 还原后指向一个不存在的文件
  cleanupExtras.push(() => copyFileSync(join(ROOT, 'assets', newChunk), join(ROOT, 'assets', oldChunk)))
  console.log(`\n② 已模拟升级：${oldChunk} → ${newChunk}（旧 chunk 已删除，sw.js 清单同步更新）`)

  /**
   * ③ 二次访问 —— **多次采样**。
   * 单次采样会撞上「自愈脚本正在 reload」的空窗，把一次正常的自我修复误判成白屏
   * （第一版探针就是这么假红的）。看轨迹才分得清是「一直空」还是「中途重载后好了」。
   */
  await send('Page.navigate', { url: BASE })
  const trail = []
  for (let i = 1; i <= 5; i++) {
    await sleep(3000)
    trail.push(await shot(`+${i * 3}s`))
  }
  /**
   * 以**最后一次**采样为准，不能用「曾经渲染出来过」。
   * 中途渲染成功、随后又崩成空白的情况（自愈 reload 打断挂载时就是这副样子）
   * 用 find(any) 会被判成通过 —— 那等于把"闪一下就没了"当成没问题。
   */
  const second = trail[trail.length - 1]

  const okUpgrade = second.children > 0 && second.cards > 0
  console.log('\n── 断言 ──')
  console.log(`  ${first.cards > 0 ? '✅' : '❌'} 首次访问渲染出卡片（${first.cards}）`)
  console.log(`  ${second.controller ? '✅' : '⚠️ '} 二次访问时 SW 已接管（controller=${second.controller}）`)
  console.log(`  ${okUpgrade ? '✅' : '❌'} 升级后仍渲染出卡片（${second.cards}）—— 没有白屏`)
  if (errors.length) {
    console.log(`\n── 控制台/网络（${errors.length} 条，最多列 15）──`)
    for (const e of errors.slice(0, 15)) console.log('  · ' + e)
  }
  console.log(okUpgrade ? '\n✅ 升级场景不白屏' : '\n❌ 升级场景白屏（SW 仍在用旧 HTML）')
  ws.close()
}

try { await main() } catch (e) { console.error('探针失败: ' + e.message) } finally { cleanup(); process.exit(0) }
