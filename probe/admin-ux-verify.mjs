/**
 * 真机验证：管理后台这一轮的四处 UX 改动。
 *
 *   ① 登录页**垂直居中**（原先 flex 默认 stretch 把卡片拉满整屏，看着「贴顶+下方大片空白」）
 *   ② 本机自动登录：在回环地址下打开 /admin 直接进后台
 *   ③ 版本标识：登录页底部与后台 header 都要有，且是真实版本号
 *   ④ 「关于」页面：侧边栏能进、内容渲染、含版本信息
 *
 * ②③ 互斥（自动登录成功后看不到登录页），所以分两轮：
 *   第一轮用 CDP 在文档加载前把 `/api/_local-key` 打成 404 → 看到登录页，验 ①③；
 *   第二轮撤掉拦截 → 验 ②。
 *
 * 用法：node probe/admin-ux-verify.mjs [cdp-port]
 */
import { writeFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = process.argv[2] || '9400'
const SITE_BASE = (process.env.SITE_BASE || 'http://127.0.0.1:4217').replace(/\/+$/, '')
const LIVE = !/^https?:\/\/127\.0\.0\.1/.test(SITE_BASE)

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? ` → ${extra}` : ''}`) }
  else { failures.push(`${label}${extra ? ` → ${extra}` : ''}`); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`) }
}

const alive = async (url) => {
  try { await fetch(url, { signal: AbortSignal.timeout(1500) }); return true } catch { return false }
}
async function waitForAlive(url, ms) {
  const dl = Date.now() + ms
  while (Date.now() < dl) {
    if (await alive(url)) return true
    await new Promise(s => setTimeout(s, 300))
  }
  return false
}

const procs = []
if (!(await alive(SITE_BASE + '/api/health'))) {
  if (LIVE) { console.error('线上不可达'); process.exit(2) }
  if (!existsSync(join(ROOT, 'dist', 'server.js'))) { console.error('没有 dist/server.js，先跑 npm run build'); process.exit(2) }
  const p = spawn(process.execPath, [join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT, env: { ...process.env, PORT: '4217' }, stdio: 'ignore', windowsHide: true,
  })
  procs.push(p)
  console.log(`  （自拉站点服务，PID ${p.pid}）`)
  if (!(await waitForAlive(SITE_BASE + '/api/health', 25000))) { console.error('站点服务没起来'); process.exit(2) }
}

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let chromeProc = null
if (!(await alive(`http://127.0.0.1:${PORT}/json/version`))) {
  if (!existsSync(CHROME)) { console.error(`找不到浏览器：${CHROME}`); process.exit(2) }
  chromeProc = spawn(CHROME, [
    ...(process.env.HEADFUL === '1' ? [] : ['--headless=new']),
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(tmpdir(), 'nav-v2-probe-adminux')}`,
    '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--window-size=1500,1050', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  console.log(`  （自拉浏览器，PID ${chromeProc.pid}）`)
}

const cleanup = () => { for (const p of [...procs, chromeProc]) { try { if (p && !p.killed) p.kill() } catch { /* 已退出 */ } } }
process.on('exit', cleanup)
const watchdog = setTimeout(() => { console.error('\n❌ 探针整体超时，强制退出。'); cleanup(); process.exit(3) }, 180000)

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
    consoleErrors.push(String(m.params.args?.[0]?.value || m.params.args?.[0]?.description || '').slice(0, 160))
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
  pending.set(id, {
    resolve: v => { clearTimeout(timer); resolve(v) },
    reject: e => { clearTimeout(timer); reject(e) },
  })
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
const jsonOfAsync = async e => {
  const s = await evalJs(`(async () => { try { return JSON.stringify(await (${e})) } catch { return null } })()`)
  return s ? JSON.parse(s) : null
}
async function waitFor(expr, timeout = 15000, label = expr) {
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

/* ================= 第一轮：拦住自动登录，验登录页 ================= */

console.log('\n── ① 登录页布局与版本标识 ──')
const BLOCK_KEY = `
  (() => {
    const _f = window.fetch;
    window.fetch = function (u, o) {
      try {
        if (String(u).includes('/api/_local-key')) {
          return Promise.resolve(new Response('{"ok":false}', { status: 404, headers: { 'Content-Type': 'application/json' } }));
        }
      } catch (e) {}
      return _f.apply(this, arguments);
    };
  })();
`
const { identifier: blockId } = await send('Page.addScriptToEvaluateOnNewDocument', { source: BLOCK_KEY })

await evalJs(`location.href = ${JSON.stringify(SITE_BASE + '/admin')}`)
await send('Runtime.enable')
await send('Page.enable')
await waitFor(`document.querySelector('.login-card')`, 25000, '登录页渲染（自动登录已被拦住）')
await sleep(500)

const login = await jsonOf(`(() => {
  const wrap = document.querySelector('.login-wrap')
  const card = document.querySelector('.login-card')
  if (!wrap) return null
  const cs = getComputedStyle(wrap)
  const wr = wrap.getBoundingClientRect()
  const cr = card.getBoundingClientRect()
  const gapTop = cr.top - wr.top
  const gapBottom = wr.bottom - cr.bottom
  return {
    alignItems: cs.alignItems,
    justifyContent: cs.justifyContent,
    gapTop: Math.round(gapTop),
    gapBottom: Math.round(gapBottom),
    cardH: Math.round(cr.height),
    wrapH: Math.round(wr.height),
    cardW: Math.round(cr.width),
    viewportW: window.innerWidth,
    versionText: document.querySelector('.login-version')?.textContent?.trim() || '',
  }
})()`)

ok(login !== null, '登录页渲染出来了（拦截生效）')
if (login) {
  ok(login.alignItems === 'center', '登录页垂直居中（align-items: center）', login.alignItems)
  // 居中的判据：上下留白接近（差 < 40px 容差，含 padding 与卡片自身间距）
  ok(Math.abs(login.gapTop - login.gapBottom) < 40,
    '卡片上下留白接近（不再「贴顶 + 下方大片空白」）', `上 ${login.gapTop}px / 下 ${login.gapBottom}px`)
  ok(login.cardH < login.wrapH - 40, '卡片没有被 stretch 拉满整屏', `卡片 ${login.cardH}px / 容器 ${login.wrapH}px`)
  ok(login.cardW <= login.viewportW, '卡片宽度不超过视口（不会横向溢出）', `${login.cardW}/${login.viewportW}`)
  ok(login.versionText.length > 0, '登录页有版本标识', login.versionText)
  ok(/版本\s*[0-9a-f]{4,}/i.test(login.versionText), '版本号看着像真实提交号', login.versionText)
  await shot('admin-login-centered.png')
}

/* ---------------- 后台 header 的版本标识 ---------------- */

const headerVer = await jsonOfAsync(`(async () => {
  const r = await fetch('/api/deploy-status')
  const j = await r.json()
  return { apiSha: j?.version?.shortSha || '' }
})()`)
ok((headerVer?.apiSha || '').length > 0, '/api/deploy-status 有构建信息', headerVer?.apiSha)

/* ================= 第二轮：撤掉拦截，验本机自动登录 ================= */

console.log('\n── ② 本机自动登录 ──')
if (LIVE) {
  console.log('  （线上模式：回环端点 404 是预期行为，改为验证「线上不会自动登录」）')
  const online = await jsonOfAsync(`(async () => {
    const r = await fetch('/api/_local-key')
    return { status: r.status }
  })()`)
  ok(online?.status === 404, '线上 /api/_local-key 一律 404（密钥绝不下发）', `HTTP ${online?.status}`)
} else {
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: blockId })
  // 清掉上一轮可能留下的凭据，确保「自动登录」是真的自动
  await evalJs(`(() => { try { localStorage.clear(); sessionStorage.clear() } catch (e) {} return true })()`)
  await evalJs(`location.href = ${JSON.stringify(SITE_BASE + '/admin')}`)
  await send('Runtime.enable')
  await send('Page.enable')
  const authed = await waitFor(`document.querySelector('.admin-tabs')`, 25000, '本机自动登录后进入后台')

  if (authed) {
    const head = await jsonOf(`({
      via: document.querySelector('.admin-user-via')?.textContent?.trim() || '',
      version: document.querySelector('.admin-version')?.textContent?.trim() || '',
      versionTitle: document.querySelector('.admin-version')?.getAttribute('title') || '',
      tabs: [...document.querySelectorAll('.admin-tab')].map(t => t.textContent.trim()),
      noUndefined: !document.querySelector('.admin-view')?.textContent?.includes('undefined'),
    })`)
    ok(head.via === '本机自动登录', '后台标注了「本机自动登录」', head.via)
    ok(head.version.length > 0, '后台 header 有版本标识', head.version)
    ok(head.versionTitle.includes(head.version.split('+')[0]), '版本徽标的 tooltip 含完整信息')
    ok(head.tabs.includes('插件'), '后台 tab 里有「插件」', head.tabs.slice(0, 4).join('、'))
    ok(head.noUndefined, '后台没有 undefined')
    await shot('admin-autologin.png')
  }
}

/* ================= ③ 关于页面 ================= */

console.log('\n── ③ 关于页面 ──')
await evalJs(`location.href = ${JSON.stringify(SITE_BASE + '/about')}`)
await send('Runtime.enable')
await send('Page.enable')
await waitFor(`document.querySelector('.about')`, 25000, '关于页渲染')
await sleep(900)

const about = await jsonOf(`({
  title: document.querySelector('.ab-head h1')?.textContent?.trim() || '',
  cards: [...document.querySelectorAll('.ab-card h2')].map(e => e.textContent.trim()),
  sha: document.querySelector('.ab-sha')?.textContent?.trim() || '',
  hasSidebar: !!document.querySelector('.sidebar'),
  sidebarHasAbout: (() => {
    const items = [...document.querySelectorAll('.sidebar .sidebar-nav-item')]
    return items.some(i => i.textContent.trim() === '关于')
  })(),
  aboutActive: (() => {
    const items = [...document.querySelectorAll('.sidebar .sidebar-nav-item')]
    const a = items.find(i => i.textContent.trim() === '关于')
    return a ? a.classList.contains('active') : false
  })(),
  bodyText: (document.querySelector('.about')?.textContent || '').length,
  noUndefined: !document.querySelector('.about')?.textContent?.includes('undefined'),
})`)

ok(about.title === '关于', '关于页标题正确', about.title)
ok(about.cards.length >= 4, '各信息卡都渲染了', about.cards.join('、'))
ok(about.sha.length > 0, '关于页显示版本号', about.sha)
ok(about.hasSidebar, '关于页套壳（有侧边栏）')
ok(about.sidebarHasAbout, '侧边栏有「关于」入口')
ok(about.aboutActive, '在关于页时侧边栏该项高亮')
ok(about.bodyText > 400, '内容不是空壳', `${about.bodyText} 字`)
ok(about.noUndefined, '页面上没有 undefined')
await shot('about-page.png')

console.log('\n── 控制台错误 ──')
ok(consoleErrors.filter(e => !/favicon|clicks|health|api\/sites|_local-key/i.test(e)).length === 0,
  '全程无非预期 console.error', consoleErrors.slice(0, 2).join(' | ').slice(0, 140) || '干净')

clearTimeout(watchdog)
console.log(`\n${failures.length ? '❌' : '✅'} 后台 UX 真机验证：${pass} 条通过${failures.length ? `，${failures.length} 条失败` : ''}`)
process.exit(failures.length ? 1 : 0)
