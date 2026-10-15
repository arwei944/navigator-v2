/**
 * 真机验证：「部署」这件事的两个面板都能看、能点。
 *
 * 覆盖两处完全不同的消费者：
 *   A. 本地运维控制台（tools/console）的「发布」tab —— 它**做**发布（构建/打包/上传/重启/验证）
 *   B. 站点后台（/admin?tab=deploy）的「部署」面板 —— 它只**看**（线上自述的版本与状态）
 *
 * 为什么必须真机：这两个面板都是「渲染 + 取数」的联合体 ——
 * 接口通了不代表字段名对得上，字段名对了不代表模板没写错。只有真跑一次才看得见
 * 「版本那栏显示的是 undefined」这类缺陷（单测只看得到接口的 JSON）。
 *
 * 前置：dist 产物（npm run build）。探针自拉两个服务与 headless Chrome，跑完自己收掉。
 * 用法：node probe/console-deploy-verify.mjs [cdp-port]
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = process.argv[2] || '9394'
const CONSOLE_BASE = 'http://127.0.0.1:5176'
const SITE_BASE = 'http://127.0.0.1:4214'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? ` → ${extra}` : ''}`) }
  else { failures.push(`${label}${extra ? ` → ${extra}` : ''}`); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`) }
}

/* ---------------- 本机管理密钥（站内后台登录用） ---------------- */

function readAdminKey() {
  try {
    const m = readFileSync(join(ROOT, '.env.local'), 'utf8').match(/^SITES_ADMIN_KEY="?([^"\n]+)"?/m)
    return m ? m[1].trim() : ''
  } catch { return '' }
}

/* ---------------- 服务 + 浏览器 ---------------- */

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
/** 控制台读的是 `--port` 参数、站点读的是 PORT 环境变量 —— 两边的约定不一样，别搞混 */
const spawnSvc = (label, script, args, env) => {
  const p = spawn(process.execPath, [script, ...args], { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'ignore', windowsHide: true })
  procs.push(p)
  console.log(`  （自拉 ${label}，PID ${p.pid}）`)
  return p
}

if (!(await alive(CONSOLE_BASE + '/'))) {
  spawnSvc('本地控制台', join(ROOT, 'tools', 'console', 'server.mjs'), ['--port', '5176'], {})
  if (!(await waitForAlive(CONSOLE_BASE + '/', 20000))) { console.error('控制台没起来'); process.exit(2) }
}
if (!(await alive(SITE_BASE + '/api/health'))) {
  if (!existsSync(join(ROOT, 'dist', 'server.js'))) { console.error('没有 dist/server.js，先跑 npm run build'); process.exit(2) }
  spawnSvc('站点服务', join(ROOT, 'dist', 'server.js'), [], { PORT: '4214' })
  if (!(await waitForAlive(SITE_BASE + '/api/health', 20000))) { console.error('站点服务没起来'); process.exit(2) }
}

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let chromeProc = null
if (!(await alive(`http://127.0.0.1:${PORT}/json/version`))) {
  if (!existsSync(CHROME)) { console.error(`找不到浏览器：${CHROME}`); process.exit(2) }
  chromeProc = spawn(CHROME, [
    ...(process.env.HEADFUL === '1' ? [] : ['--headless=new']),
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(tmpdir(), 'nav-v2-probe-console-deploy')}`,
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
  // 模块级异常不会走 console.error：import 失败、顶层抛错都只在这里出现
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails
    consoleErrors.push(`[异常] ${String(d?.exception?.description || d?.text || '').split('\n')[0].slice(0, 160)}`)
  }
})
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时（${method}）`)) }, 20000)
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
/**
 * 这两个域**必须显式启用**，否则 `Runtime.exceptionThrown` / `consoleAPICalled`
 * 一个都不会推过来 —— 于是「没有异常」变成一句什么都没验证的话（踩过这个坑：
 * 页面模块明明抛错，探针却报告「全程干净」）。
 */
await send('Runtime.enable')
await send('Page.enable')

const sleep = ms => new Promise(s => setTimeout(s, ms))
const jsonOf = async e => { const s = await evalJs(`JSON.stringify((() => { try { return (${e}) } catch { return null } })())`); return s ? JSON.parse(s) : null }
/** 同 jsonOf，但表达式可以返回 Promise（同步 IIFE 会把 Promise 序列化成 {}） */
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

/* ---------------- A. 控制台的「发布」面板 ---------------- */

console.log('\n── A. 本地控制台 · 发布面板 ──')
await evalJs(`location.href = ${JSON.stringify(CONSOLE_BASE + '/')}`)
// 导航会换掉执行上下文，异常/console 的订阅要重新建立，否则新文档里的错误收不到
await send('Runtime.enable')
await waitFor(`document.querySelector('#tabs .tab')`, 20000, '控制台加载')
/**
 * app.js 是 `<script type="module">`，**异步执行**：HTML 一到就点 tab 会赶在
 * 监听器注册之前（点了没反应，而且不报错 —— 这种时序坑最难看出来）。
 * 用「初始化序列最后一个动作产出的 DOM」作为脚本就绪信号。
 */
await waitFor(`(document.querySelector('#env-vars')?.children.length || 0) > 0`, 15000, '控制台脚本就绪（app.js 已执行）')

// 脚本没执行时，把「模块拿到没有、报了什么」直接摊开 —— 否则只剩「没反应」三个字
if (!(await evalJs(`(document.querySelector('#env-vars')?.children.length || 0) > 0`))) {
  const modDiag = await jsonOfAsync(`(async () => {
    const out = { readyState: document.readyState, scripts: [...document.scripts].map(s => (s.src || '(inline)') + ' [' + (s.type || 'classic') + ']') }
    try {
      const r = await fetch('/ui/app.js')
      out.appStatus = r.status
      const t = await r.text()
      out.appBytes = t.length
      out.hasDeployImport = /deploypanel/.test(t)
    } catch (e) { out.appFetchError = String(e).slice(0, 120) }
    try {
      const r2 = await fetch('/ui/deploypanel.js')
      out.dpStatus = r2.status
    } catch (e) { out.dpFetchError = String(e).slice(0, 120) }
    out.loadedResources = performance.getEntriesByType('resource')
      .map(x => x.name).filter(n => /app\\.js|deploypanel|core\\.js/.test(n))
    out.hasEnvVars = !!document.querySelector('#env-vars')
    out.hasHealth = !!document.querySelector('#health')
    out.bootError = window.__navBootError || '(无)'
    // 强制求值一次模块图：已求值成功会命中缓存，求值失败则在这里把原因抛出来
    try { await import('/ui/app.js'); out.dynamicImport = 'ok（命中缓存或求值成功）' }
    catch (e) { out.dynamicImport = '失败：' + String(e && e.message).slice(0, 200) }
    return out
  })()`)
  console.log(`  （模块诊断：${JSON.stringify(modDiag)}）`)
}

const hasTab = await evalJs(`!!document.querySelector('#tabs .tab[data-panel="deploy"]')`)
ok(hasTab, '「发布」tab 已注册')
await evalJs(`(() => { document.querySelector('#tabs .tab[data-panel="deploy"]').click(); return true })()`)
await waitFor(`document.querySelector('#panel-deploy')?.classList.contains('active')`, 8000, '发布面板激活')
if (failures.length) {
  // 失败时把 tab/panel 的真实状态打出来 —— 否则「没激活」这句话没法定位
  const diag = await jsonOf(`({
    tabs: [...document.querySelectorAll('#tabs .tab')].map(t => t.dataset.panel),
    hasPanel: !!document.querySelector('#panel-deploy'),
    panelIds: [...document.querySelectorAll('.panel')].map(p => p.id),
    activePanel: document.querySelector('.panel.active')?.id || '(无)',
    healthText: document.querySelector('#health')?.textContent || '(空)',
    appRan: (document.querySelector('#env-vars')?.children.length || 0) > 0,
  })`)
  console.log(`  （诊断：${JSON.stringify(diag)}）`)
  console.log(`  （异常与错误：${consoleErrors.slice(0, 3).join(' | ') || '无'}）`)
}

// 面板要自己去取数（内容是异步填的）
await waitFor(`(document.querySelector('#deploy-versions')?.children.length || 0) > 0`, 20000, '版本对照取数完成')
const panel = await jsonOf(`({
  summary: document.querySelector('#deploy-summary')?.textContent?.trim() || '',
  kvLabels: [...document.querySelectorAll('#deploy-versions dt')].map(e => e.textContent.trim()),
  kvValues: [...document.querySelectorAll('#deploy-versions dd')].map(e => e.textContent.trim()),
  credLabels: [...document.querySelectorAll('#deploy-creds dt')].map(e => e.textContent.trim()),
  hasPublishBtn: !!document.querySelector('#btn-deploy-publish'),
  hasRefreshBtn: !!document.querySelector('#btn-deploy-refresh'),
  hasSkip: !!document.querySelector('#deploy-skip-build'),
  hasKeyInput: !!document.querySelector('#deploy-key'),
  hasWidInput: !!document.querySelector('#deploy-wid'),
  historyText: document.querySelector('#deploy-history')?.textContent?.trim()?.slice(0, 60) || '',
  flow: document.querySelector('#deploy-flow')?.textContent?.trim()?.slice(0, 40) || '',
})`)
ok(panel.summary.length > 0, '顶部状态栏有内容', panel.summary.slice(0, 70))
ok(panel.kvLabels.length === 3, '版本对照三段齐全（本地源码 / 上次构建 / 线上运行）', panel.kvLabels.join('、'))
ok(panel.kvValues.every(v => v && !v.includes('undefined') && !v.includes('NaN')), '三段都有可读的值（不是 undefined）', panel.kvValues.join(' | ').slice(0, 110))
ok(panel.credLabels.length === 3, '凭据卡三项齐全', panel.credLabels.join('、'))
ok(panel.hasPublishBtn && panel.hasRefreshBtn && panel.hasSkip, '发布 / 刷新 / 跳过构建 三个控件都在')
ok(panel.hasKeyInput && panel.hasWidInput, '凭据输入框在（未配置时用户能就地补上）')
ok(panel.historyText.length > 0, '发布历史区已渲染', panel.historyText)
ok(panel.flow.length > 0, '流程说明已渲染')
await shot('console-deploy-panel.png')

// 刷新按钮不该报错
const errBefore = consoleErrors.length
await evalJs(`(() => { document.querySelector('#btn-deploy-refresh').click(); return true })()`)
await sleep(2500)
ok(consoleErrors.length === errBefore, '点「刷新」不产生控制台错误', consoleErrors.slice(errBefore).join(' | ').slice(0, 100))

/* ---------------- B. 站内后台的「部署」面板 ---------------- */

console.log('\n── B. 站点后台 · 部署面板 ──')
await evalJs(`location.href = ${JSON.stringify(SITE_BASE + '/admin?tab=deploy')}`)
await waitFor(`document.querySelector('.admin-body')`, 20000, '后台加载')

// 先确认接口本身可用（面板读的就是它）。注意必须在**站点页面**上请求 ——
// 控制台跑在 5176，从那儿 fetch 4214 是跨源，会被 CORS 拦掉（探针自身踩过一次）。
const apiShape = await jsonOfAsync(`(async () => {
  const r = await fetch('/api/deploy-status')
  const j = await r.json()
  return { status: r.status, ok: j.ok === true, hasVersion: typeof j.version === 'object', hasRuntime: typeof j.runtime === 'object' }
})()`)
ok(apiShape?.status === 200 && apiShape?.ok, '站点 /api/deploy-status 可用', `HTTP ${apiShape?.status}`)

// 用本机管理密钥登录（key 模式），否则看不到面板
const adminKey = readAdminKey()
if (adminKey) {
  const switched = await evalJs(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /密钥|key/i.test(b.textContent))
    if (!btn) return false
    btn.click(); return true
  })()`)
  if (switched) {
    await sleep(400)
    await evalJs(`(() => {
      const input = [...document.querySelectorAll('input[type="password"]')].pop()
      if (!input) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, ${JSON.stringify(adminKey)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    await evalJs(`(() => {
      const form = document.querySelector('form.login-form')
      if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      return true
    })()`)
    await waitFor(`document.querySelector('.admin-tabs')`, 15000, '登录进入后台')
  }
}

const authed = await evalJs(`!!document.querySelector('.admin-tabs')`)
if (!authed) {
  ok(false, '能进入后台（登录成功）', '登录未完成，后续断言跳过')
} else {
  // 点「部署」tab
  await evalJs(`(() => {
    const tab = [...document.querySelectorAll('.admin-tab')].find(t => t.textContent.trim() === '部署')
    if (tab) tab.click()
    return !!tab
  })()`)
  await waitFor(`(document.querySelector('.deploy .dp-card') !== null)`, 20000, '部署面板渲染')
  await sleep(1500)

  const page = await jsonOf(`({
    title: document.querySelector('.deploy .dp-title')?.textContent?.trim() || '',
    cards: [...document.querySelectorAll('.deploy .dp-card h3')].map(e => e.textContent.trim()),
    sha: document.querySelector('.deploy .dp-sha')?.textContent?.trim() || '',
    hasCheck: [...document.querySelectorAll('.deploy .dp-link')].some(b => /检查更新/.test(b.textContent)),
    planNote: !!document.querySelector('.deploy .dp-sub'),
    gridValues: [...document.querySelectorAll('.deploy .dp-grid dd')].map(e => e.textContent.trim()),
    noUndefined: !document.querySelector('.deploy')?.textContent?.includes('undefined'),
  })`)
  ok(page.title === '部署', '面板标题渲染', page.title)
  ok(page.cards.length >= 3, '各卡片都渲染了', page.cards.join('、'))
  ok(page.sha.length > 0, '版本号已显示', page.sha)
  ok(page.hasCheck, '「检查更新」按钮在')
  ok(page.planNote, '有「完整发布在本地控制台」的说明（不让人误以为这里能发布）')
  ok(page.gridValues.length >= 4, '运行时/数据字段已填充', `${page.gridValues.length} 个`)
  ok(page.noUndefined, '页面上没有 undefined（字段名对得上）')
  await shot('site-admin-deploy.png')
}

console.log('\n── 控制台错误 ──')
// 站内后台在未配置 AI/存储时会打一些预期内的错误日志，只对控制台页面严格
ok(consoleErrors.filter(e => !/favicon|clicks|health/i.test(e)).length === 0,
  '全程无非预期 console.error', consoleErrors.slice(0, 2).join(' | ').slice(0, 140) || '干净')

clearTimeout(watchdog)
console.log(`\n${failures.length ? '❌' : '✅'} 部署面板真机验证：${pass} 条通过${failures.length ? `，${failures.length} 条失败` : ''}`)
if (failures.length) {
  console.log('\n失败清单：')
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
ws.close()
process.exit(0)
