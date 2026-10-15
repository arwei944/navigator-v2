/**
 * 真机验证：本地控制台的「流水线」面板。
 *
 * ⚠️ **刻意不点「开始流水线」** —— 那个按钮会真的提交代码、推送、构建并部署上线。
 * 探针只验证「看得见、点得着、字段对得上」这一层；编排逻辑由
 * `tools/console/test-release.mjs`（纯函数）与 `nav release run --dry-run`（预检）覆盖。
 *
 * 覆盖：
 *   ① tab 已注册、面板能激活
 *   ② 预检摘要渲染出分支 / 改动数 / 领先数（不是空壳）
 *   ③ 十条步骤全部渲染，编号与顺序对
 *   ④ 选项控件齐备（提交消息 + 三个跳过开关）
 *   ⑤ 按钮在且未被禁用
 *   ⑥ 页面上没有 undefined
 *
 * 前置：控制台源码即产物（tools/console/ui），无需构建。
 * 用法：node probe/release-panel-verify.mjs [cdp-port]
 */
import { writeFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = process.argv[2] || '9397'
const CONSOLE_BASE = 'http://127.0.0.1:5178'

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
if (!(await alive(CONSOLE_BASE + '/'))) {
  const cp = spawn(process.execPath, [join(ROOT, 'tools', 'console', 'server.mjs'), '--port', '5178'], {
    cwd: ROOT, env: process.env, stdio: 'ignore', windowsHide: true,
  })
  procs.push(cp)
  console.log(`  （自拉本地控制台，PID ${cp.pid}）`)
  if (!(await waitForAlive(CONSOLE_BASE + '/', 25000))) { console.error('控制台没起来'); process.exit(2) }
}

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let chromeProc = null
if (!(await alive(`http://127.0.0.1:${PORT}/json/version`))) {
  if (!existsSync(CHROME)) { console.error(`找不到浏览器：${CHROME}`); process.exit(2) }
  chromeProc = spawn(CHROME, [
    ...(process.env.HEADFUL === '1' ? [] : ['--headless=new']),
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(tmpdir(), 'nav-v2-probe-release')}`,
    '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--window-size=1500,1050', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  console.log(`  （自拉浏览器，PID ${chromeProc.pid}）`)
}

const cleanup = () => { for (const p of [...procs, chromeProc]) { try { if (p && !p.killed) p.kill() } catch { /* 已退出 */ } } }
process.on('exit', cleanup)
const watchdog = setTimeout(() => { console.error('\n❌ 探针整体超时，强制退出。'); cleanup(); process.exit(3) }, 150000)

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
await send('Runtime.enable')
await send('Page.enable')

const sleep = ms => new Promise(s => setTimeout(s, ms))
const jsonOf = async e => { const s = await evalJs(`JSON.stringify((() => { try { return (${e}) } catch { return null } })())`); return s ? JSON.parse(s) : null }
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

/* ---------------- 面板 ---------------- */

console.log('\n── 本地控制台 · 流水线面板 ──')
await evalJs(`location.href = ${JSON.stringify(CONSOLE_BASE + '/')}`)
await send('Runtime.enable')
await send('Page.enable')
await waitFor(`document.querySelector('#tabs .tab[data-panel="release"]')`, 25000, '控制台加载')
await waitFor(`(document.querySelector('#env-vars')?.children.length || 0) > 0`, 20000, '控制台脚本就绪')

await evalJs(`(() => { document.querySelector('#tabs .tab[data-panel="release"]').click(); return true })()`)
await waitFor(`document.querySelector('#panel-release')?.classList.contains('active')`, 10000, '流水线面板激活')
await waitFor(`document.querySelectorAll('#release-steps .rel-step').length === 10`, 25000, '时间线取数完成')
await sleep(600)

const page = await jsonOf(`({
  summary: document.querySelector('#release-summary')?.textContent?.trim() || '',
  steps: [...document.querySelectorAll('#release-steps .rel-step')].map(r => ({
    idx: r.querySelector('.rel-idx')?.textContent?.trim() || '',
    label: r.querySelector('.rel-label')?.textContent?.trim() || '',
    status: (r.className.match(/rel-step\\s+(\\w+)/) || [])[1] || '',
    role: r.querySelector('.rel-role')?.textContent?.trim() || '',
  })),
  hasMessage: !!document.querySelector('#release-message'),
  toggles: ['#release-skip-test', '#release-no-push', '#release-skip-build'].map(s => !!document.querySelector(s)),
  hasRun: !!document.querySelector('#btn-release-run'),
  runDisabled: document.querySelector('#btn-release-run')?.disabled === true,
  hasPreflight: !!document.querySelector('#btn-release-preflight'),
  blockers: document.querySelector('#release-blockers')?.textContent?.trim() || '',
  noUndefined: !document.querySelector('#panel-release')?.textContent?.includes('undefined'),
  progress: document.querySelector('#release-progress')?.textContent?.trim() || '',
})`)

ok(page.steps.length === 10, '十条步骤全部渲染', `${page.steps.length} 条`)
ok(page.steps.map(s => s.label).join('→') === '检查工作区→测试门禁→提交→推送→构建→产物门禁→打包→上传→重启容器→线上验证',
  '步骤顺序与 label 正确', page.steps.map(s => s.label).join('→').slice(0, 60))
ok(page.steps.every((s, i) => s.idx === String(i + 1).padStart(2, '0')), '编号连续（01–10）', page.steps.map(s => s.idx).join(' '))
ok(page.steps.every(s => s.role), '每步都有职责说明')
ok(page.steps.every(s => ['pending', 'running', 'ok', 'skipped', 'failed'].includes(s.status)),
  '步骤状态都在合法取值内', [...new Set(page.steps.map(s => s.status))].join('、'))
ok(page.summary.length > 0 && !page.summary.includes('预检失败'), '预检摘要已渲染', page.summary.slice(0, 70))
ok(page.hasMessage, '提交消息输入框在')
ok(page.toggles.every(Boolean), '三个跳过开关都在')
ok(page.hasRun && page.hasPreflight, '「预检」与「开始流水线」按钮都在')
ok(!page.runDisabled, '「开始流水线」未被禁用（预检没把它锁死）')
ok(page.progress.length > 0, '进度计数已渲染', page.progress)
ok(page.noUndefined, '页面上没有 undefined（字段名对得上）')
await shot('console-release-panel.png')

console.log('\n── 控制台错误 ──')
ok(consoleErrors.filter(e => !/favicon|clicks|health/i.test(e)).length === 0,
  '全程无非预期 console.error', consoleErrors.slice(0, 2).join(' | ').slice(0, 140) || '干净')

clearTimeout(watchdog)
console.log(`\n${failures.length ? '❌' : '✅'} 流水线面板真机验证：${pass} 条通过${failures.length ? `，${failures.length} 条失败` : ''}`)
process.exit(failures.length ? 1 : 0)
