/**
 * 真机验证：站点后台的「插件」面板 —— 九个引擎模块的管理面。
 *
 * 为什么必须真机：这个面板是「接口 + 模板 + 交互」的联合体。
 * 接口返回 9 组不代表页面上画得出 9 张卡；画得出不代表勾选/单选钮接对了值；
 * 接对了值也不代表「保存」真的改了运行期配置。只有真跑一遍看得见。
 *
 * 覆盖：
 *   ① 后台「插件」tab 在，能激活
 *   ② 9 张卡片全部渲染，标题正确
 *   ③ 链式组是可勾选项、单选组是单选钮（控件类型没接错）
 *   ④ 站点存储卡是**锁定只读**（数据安全单点，不给开关）
 *   ⑤ 「生效中」标记存在（哪一个是当前生效的，看得出来）
 *   ⑥ 页面上没有 undefined（字段名对得上）
 *   ⑦ **真的能改**：关闭一条链 → 保存 → 面板回读生效；再恢复默认
 *   ⑧ 全程无异常
 *
 * 前置：dist 产物（npm run build）。
 * 用法：node probe/plugin-panel-verify.mjs [cdp-port]
 *       SITE_BASE=https://navigator-v2.bot-keep.xyz 时打线上（跳过⑦，不改线上配置）
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = process.argv[2] || '9395'
const SITE_BASE = (process.env.SITE_BASE || 'http://127.0.0.1:4215').replace(/\/+$/, '')
const CONSOLE_BASE = 'http://127.0.0.1:5177'
const LIVE = !/^https?:\/\/127\.0\.0\.1/.test(SITE_BASE)

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? ` → ${extra}` : ''}`) }
  else { failures.push(`${label}${extra ? ` → ${extra}` : ''}`); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`) }
}

function readAdminKey() {
  try {
    const m = readFileSync(join(ROOT, '.env.local'), 'utf8').match(/^SITES_ADMIN_KEY="?([^"\n]+)"?/m)
    return m ? m[1].trim() : ''
  } catch { return '' }
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
if (!LIVE && !(await alive(CONSOLE_BASE + '/'))) {
  const cp = spawn(process.execPath, [join(ROOT, 'tools', 'console', 'server.mjs'), '--port', '5177'], {
    cwd: ROOT, env: process.env, stdio: 'ignore', windowsHide: true,
  })
  procs.push(cp)
  console.log(`  （自拉本地控制台，PID ${cp.pid}）`)
  if (!(await waitForAlive(CONSOLE_BASE + '/', 25000))) { console.error('控制台没起来'); process.exit(2) }
}
if (!(await alive(SITE_BASE + '/api/health'))) {
  if (LIVE) { console.error('线上服务不可达'); process.exit(2) }
  if (!existsSync(join(ROOT, 'dist', 'server.js'))) { console.error('没有 dist/server.js，先跑 npm run build'); process.exit(2) }
  const p = spawn(process.execPath, [join(ROOT, 'dist', 'server.js')], {
    cwd: ROOT, env: { ...process.env, PORT: '4215', SITES_ADMIN_KEY: readAdminKey() }, stdio: 'ignore', windowsHide: true,
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
    `--user-data-dir=${join(tmpdir(), 'nav-v2-probe-plugins')}`,
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

/* ---------------- A. 本地控制台的「插件」面板 ---------------- */

if (!LIVE) {
  console.log('\n── A. 本地控制台 · 插件面板 ──')
  await evalJs(`location.href = ${JSON.stringify(CONSOLE_BASE + '/')}`)
  await send('Runtime.enable')
  await send('Page.enable')
  await waitFor(`document.querySelector('#tabs .tab[data-panel="plugins"]')`, 25000, '控制台加载')
  await waitFor(`(document.querySelector('#env-vars')?.children.length || 0) > 0`, 20000, '控制台脚本就绪')

  await evalJs(`(() => { document.querySelector('#tabs .tab[data-panel="plugins"]').click(); return true })()`)
  await waitFor(`document.querySelector('#panel-plugins')?.classList.contains('active')`, 10000, '插件面板激活')
  await waitFor(`(document.querySelector('#plugins-groups .pl-group') !== null)`, 25000, '插件面板取数完成')
  await sleep(800)

  const cpage = await jsonOf(`({
    groups: document.querySelectorAll('#plugins-groups .pl-group').length,
    titles: [...document.querySelectorAll('#plugins-groups .pl-group strong')].map(e => e.textContent.trim()),
    checkboxes: document.querySelectorAll('#plugins-groups input[type="checkbox"]').length,
    radios: document.querySelectorAll('#plugins-groups input[type="radio"]').length,
    locked: document.querySelectorAll('#plugins-groups .pl-locked').length,
    activeTags: document.querySelectorAll('#plugins-groups .pl-tag.on').length,
    hasSave: !!document.querySelector('#btn-plugins-save'),
    fileHint: document.querySelector('#plugins-file')?.textContent?.trim() || '',
    noUndefined: !document.querySelector('#panel-plugins')?.textContent?.includes('undefined'),
  })`)
  ok(cpage.groups === 9, '9 个引擎模块渲染', cpage.titles.slice(0, 4).join('、') + '…')
  ok(cpage.checkboxes >= 6 && cpage.radios >= 2, '链式=勾选、单选=单选钮', `${cpage.checkboxes} 复选 / ${cpage.radios} 单选`)
  ok(cpage.locked >= 1, '站点存储渲染为锁定只读')
  ok(cpage.activeTags >= 1, '有「生效中」标记', `${cpage.activeTags} 处`)
  ok(cpage.hasSave, '有「保存更改」按钮')
  ok(/plugins\.local\.json/.test(cpage.fileHint), '说明了配置写在哪', cpage.fileHint.slice(0, 50))
  ok(cpage.noUndefined, '页面上没有 undefined（字段名对得上）')
  await shot('console-plugin-panel.png')
}

/* ---------------- B. 进入后台 ---------------- */

console.log(`\n── 站点后台 · 插件面板 ${LIVE ? '（线上）' : '（本地）'} ──`)
await evalJs(`location.href = ${JSON.stringify(SITE_BASE + '/admin?tab=plugins')}`)
await send('Runtime.enable')
await send('Page.enable')
await waitFor(`document.querySelector('.admin-body')`, 25000, '后台加载')

const adminKey = readAdminKey()
if (adminKey) {
  /**
   * 直接注入会话凭据再刷新 ——「使用密钥进入」这条路径前端本来就支持（key 模式），
   * 比走登录表单稳：表单是异步挂载的，点按钮 → 等输入框 → 提交 这一串在无头环境里
   * 时序很脆（踩过一次：按钮点到了、表单也提交了，但页面停在原地不报错）。
   */
  await evalJs(`(() => { sessionStorage.setItem('nav_admin_token', ${JSON.stringify(adminKey)}); return true })()`)
  await evalJs(`location.reload()`)
  await send('Runtime.enable')
  await send('Page.enable')
  await waitFor(`document.querySelector('.admin-body')`, 20000, '重新加载')
  await waitFor(`document.querySelector('.admin-tabs')`, 15000, '登录进入后台')
}

const authed = await evalJs(`!!document.querySelector('.admin-tabs')`)
if (!authed) {
  const diag = await jsonOf(`({
    buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).slice(0, 12),
    notice: document.querySelector('.admin-body')?.textContent?.trim()?.slice(0, 200) || '(空)',
    hasKey: ${JSON.stringify(Boolean(adminKey))},
  })`)
  console.log(`  （登录诊断：${JSON.stringify(diag)}）`)
  ok(false, '能进入后台（登录成功）', '登录未完成，后续断言跳过')
} else {
  // 点「插件」tab
  await evalJs(`(() => {
    const tab = [...document.querySelectorAll('.admin-tab')].find(t => t.textContent.trim() === '插件')
    if (tab) tab.click()
    return !!tab
  })()`)
  await waitFor(`(document.querySelector('.plugins .pl-card') !== null)`, 25000, '插件面板渲染')
  await sleep(1200)

  const page = await jsonOf(`({
    title: document.querySelector('.plugins .pl-title')?.textContent?.trim() || '',
    cards: [...document.querySelectorAll('.plugins .pl-card h3')].map(e => e.textContent.trim()),
    locked: [...document.querySelectorAll('.plugins .pl-locked')].map(e => e.textContent.trim().slice(0, 40)),
    checkboxCount: document.querySelectorAll('.plugins .pl-editor input[type="checkbox"]').length,
    radioCount: document.querySelectorAll('.plugins .pl-editor input[type="radio"]').length,
    activeTags: [...document.querySelectorAll('.plugins .pl-tag.on')].length,
    badgeKinds: [...document.querySelectorAll('.plugins .pl-badge')].map(e => e.textContent.trim()),
    hasNote: !!document.querySelector('.plugins .pl-sub'),
    noUndefined: !document.querySelector('.plugins')?.textContent?.includes('undefined'),
    hasSaveBtn: !!document.querySelector('.plugins .pl-btn.primary'),
  })`)

  ok(page.title === '插件', '面板标题渲染', page.title)
  ok(page.cards.length === 9, '9 个引擎模块卡片全部渲染', page.cards.join('、'))
  ok(page.checkboxCount >= 6, '链式组渲染成可勾选项', `${page.checkboxCount} 个复选框`)
  ok(page.radioCount >= 2, '单选组渲染成单选钮', `${page.radioCount} 个单选钮`)
  ok(page.locked.length >= 1, '站点存储卡是锁定只读（数据安全单点）', page.locked[0] || '')
  ok(page.activeTags >= 1, '有「生效中」标记', `${page.activeTags} 处`)
  ok(page.hasNote, '有面板说明文案')
  ok(page.noUndefined, '页面上没有 undefined（字段名对得上）')
  await shot('site-admin-plugins.png')

  /* ---------------- ⑦ 真的能改（仅本地） ---------------- */

  if (!LIVE) {
    console.log('\n── 交互：关掉一条链再恢复 ──')
    // 挑「图标提供者链」下手：它有多个可用 provider，改了立刻能验证、恢复也简单
    const closed = await evalJs(`(() => {
      const card = [...document.querySelectorAll('.plugins .pl-card')].find(c => c.querySelector('h3')?.textContent.includes('图标提供者'))
      if (!card) return '找不到卡片'
      card.scrollIntoView({ block: 'center' })
      const btn = [...card.querySelectorAll('.pl-link')].find(b => /全部关闭/.test(b.textContent))
      if (!btn) return '找不到按钮'
      btn.click()
      return 'ok'
    })()`)
    ok(closed === 'ok', '能点到「全部关闭」', closed)

    await sleep(300)
    const hasSave = await evalJs(`!!document.querySelector('.plugins .pl-btn.primary')`)
    ok(hasSave, '改动后出现「保存更改」按钮')

    await evalJs(`(() => { document.querySelector('.plugins .pl-btn.primary').click(); return true })()`)
    await waitFor(`document.querySelector('.plugins .pl-notice')`, 15000, '保存后出现结果提示')
    const notice = await evalJs(`document.querySelector('.plugins .pl-notice')?.textContent?.trim() || ''`)
    ok(/已应用/.test(notice), '保存成功并给出回执', notice.slice(0, 70))

    // 从接口回读，确认真的落到了运行期配置（不是只弹了个提示）
    const readBack = await jsonOfAsync(`(async () => {
      const k = sessionStorage.getItem('nav_admin_token') || ''
      const r = await fetch('/api/plugins', { headers: { Authorization: 'Bearer ' + k, 'X-Nav-Key': k } })
      const j = await r.json()
      const g = (j.groups || []).find(x => x.id === 'image-engine')
      return { overrides: j.overrides, iconMode: g?.current?.mode, iconIds: g?.current?.ids }
    })()`)
    ok(readBack?.overrides?.NAV_ICON_PROVIDERS === 'none', '配置已写入运行期（接口回读为 none）', JSON.stringify(readBack?.overrides))
    ok(readBack?.iconIds?.length === 0, '图标链实际已清空', JSON.stringify(readBack?.iconIds))

    // 恢复默认
    await evalJs(`(() => {
      const card = [...document.querySelectorAll('.plugins .pl-card')].find(c => c.querySelector('h3')?.textContent.includes('图标提供者'))
      const btn = [...card.querySelectorAll('.pl-link')].find(b => /全部启用/.test(b.textContent))
      if (btn) btn.click()
      return true
    })()`)
    await sleep(300)
    await evalJs(`(() => { document.querySelector('.plugins .pl-btn.primary')?.click(); return true })()`)
    await waitFor(`!document.querySelector('.plugins .pl-btn.primary')`, 15000, '恢复后按钮消失（已无未保存改动）')
    const restored = await jsonOfAsync(`(async () => {
      const k = sessionStorage.getItem('nav_admin_token') || ''
      const r = await fetch('/api/plugins', { headers: { Authorization: 'Bearer ' + k, 'X-Nav-Key': k } })
      const j = await r.json()
      const g = (j.groups || []).find(x => x.id === 'image-engine')
      return { mode: g?.current?.mode, n: g?.current?.ids?.length || 0 }
    })()`)
    ok(restored?.mode === 'default' && restored?.n >= 2, '恢复默认后链路回到默认全量', JSON.stringify(restored))
  } else {
    console.log('  （线上模式：跳过写操作，不改线上配置）')
  }
}

console.log('\n── 控制台错误 ──')
ok(consoleErrors.filter(e => !/favicon|clicks|health/i.test(e)).length === 0,
  '全程无非预期 console.error', consoleErrors.slice(0, 2).join(' | ').slice(0, 140) || '干净')

clearTimeout(watchdog)
console.log(`\n${failures.length ? '❌' : '✅'} 插件面板真机验证：${pass} 条通过${failures.length ? `，${failures.length} 条失败` : ''}`)
process.exit(failures.length ? 1 : 0)
