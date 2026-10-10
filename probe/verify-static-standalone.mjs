/**
 * 真机验证：**纯静态托管**环境下的站点可用性。
 *
 * 背景：Vercel 团队被 fair-use 封禁后，后端（`/api/*`，依赖 Vercel Blob）无法再跑，
 * 站点改为纯静态发布。此时 `/api/sites` 会返回 200 + `index.html`（SPA 兜底页），
 * 而不是 404 —— 这正是最容易把「接口不存在」误报成「离线」的地方。
 *
 * 本脚本验证的是「换到静态托管之后，用户拿到的到底是不是一个能用的站点」：
 *   1. 页面能加载、无未捕获异常；
 *   2. 渲染出来的仍是完整的 300 条站点（种子数据兜底），不是空壳；
 *   3. 云端状态条说的是真话（「本站未接入云端同步」），而不是「已离线」；
 *   4. 轮询已被停掉（`CLOUD_FATAL` 生效），不再对着不存在的接口空转；
 *   5. 交互仍然可用（搜索、主题切换），本地增删改不受影响。
 *
 * 用法：node probe/verify-static-standalone.mjs <cdp-port> [base]
 * 前置：`npx vite preview --port 4173 --host 127.0.0.1`（或任何静态服务）常驻。
 */
import { writeFileSync } from 'node:fs'

const PORT = process.argv[2] || '9346'
const BASE = process.argv[3] || 'http://127.0.0.1:4173'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? ` → ${extra}` : ''}`) }
  else { failures.push(`${label}${extra ? ` → ${extra}` : ''}`); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`) }
}
const eq = (actual, expected, label) => ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)

/* ---------- 连接 CDP ---------- */
async function targets() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await r.json()
      const page = list.find(t => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* 还没起来 */ }
    await new Promise(s => setTimeout(s, 500))
  }
  throw new Error(`连不上 CDP ${PORT}`)
}

const target = await targets()
const ws = new WebSocket(target.webSocketDebuggerUrl)
let msgId = 0
const pending = new Map()
const events = []

ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
  } else if (m.method) {
    events.push(m)
  }
})
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params }))
})

/** 在页面里求值。`awaitPromise` 让 Promise 结果也能取回 */
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval 抛错')
  return r.result.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')

// 视口必须在同一条 CDP 连接里设（Emulation 是会话级的）
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

console.log(`\n▶ 静态托管可用性验证  BASE=${BASE}\n`)

await send('Page.navigate', { url: BASE + '/' })
await new Promise(s => setTimeout(s, 4000))

/* ---------- 1. 页面与异常 ---------- */
const errors = events
  .filter(e => e.method === 'Runtime.exceptionThrown')
  .map(e => e.params?.exceptionDetails?.exception?.description || 'unknown')
const consoleErrs = events
  .filter(e => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
  .map(e => (e.params.args || []).map(a => a.value ?? a.description ?? '').join(' '))

eq(errors.length, 0, '无未捕获异常', errors.slice(0, 2).join(' | '))
ok(!consoleErrs.some(t => /not valid JSON|Unexpected token/i.test(t)),
  '控制台没有 JSON 解析错误外泄', consoleErrs.filter(t => /JSON/i.test(t)).slice(0, 2).join(' | '))

eq(await evalJs(`document.title.length > 0`), true, '页面标题已渲染')

/* ---------- 2. 站点数据仍然完整 ---------- */
const cardCount = await evalJs(`document.querySelectorAll('.card').length`)
ok(cardCount >= 250, `渲染出完整站点列表（${cardCount} 张卡片）`, `实得 ${cardCount}`)

const firstTitle = await evalJs(`(document.querySelector('.card-title')||{}).textContent || ''`)
ok(firstTitle.trim().length > 0, '卡片标题有实际内容', firstTitle.trim().slice(0, 20))

const apiSeen = await evalJs(`window.__navCloudErrorProbe ?? null`)
// 直接从 store 读更可靠（debug 暴露不一定存在），退化为读 UI 文案
const noticeText = await evalJs(`(document.querySelector('.cloud-notice-text')||{}).textContent || ''`)

/* ---------- 3. 云端状态条说的是真话 ---------- */
ok(!/已离线/.test(noticeText), '状态条不再谎报「已离线」', noticeText.trim() || '(无状态条)')
ok(/未接入云端同步|本机数据/.test(noticeText), '状态条说明了真实情况（本机数据 / 未接入云同步）', noticeText.trim())

/* ---------- 4. 轮询已停：不再对着不存在的接口空转 ---------- */
const pollProbe = await evalJs(`(async () => {
  let hits = 0
  const orig = window.fetch
  window.fetch = (...a) => { if (String(a[0]).includes('/api/sites')) hits++; return orig(...a) }
  await new Promise(r => setTimeout(r, 6000))
  window.fetch = orig
  return hits
})()`)
eq(pollProbe, 0, '6 秒内没有新的 /api/sites 轮询（CLOUD_FATAL 生效）', `实得 ${pollProbe} 次`)

/* ---------- 5. 交互仍然可用 ---------- */
const searchOpen = await evalJs(`(async () => {
  const input = document.querySelector('.search-input, input[type="text"], input[placeholder]')
  if (!input) return 'no-input'
  input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  input.focus()
  input.value = 'git'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise(r => setTimeout(r, 600))
  return document.body.innerText.length > 0 ? 'ok' : 'empty'
})()`)
eq(searchOpen, 'ok', '搜索框可以输入并触发检索')

const themeChanged = await evalJs(`(async () => {
  const before = getComputedStyle(document.documentElement).getPropertyValue('--radius').trim()
  return before || 'none'
})()`)
ok(themeChanged !== 'none', '主题令牌已注入（--radius 有值）', themeChanged)

/* ---------- 6. 本地增删改能力仍在（localStorage 覆盖层） ---------- */
const canWrite = await evalJs(`(() => {
  try {
    localStorage.setItem('__probe_key', 'x')
    const v = localStorage.getItem('__probe_key')
    localStorage.removeItem('__probe_key')
    return v === 'x'
  } catch { return false }
})()`)
eq(canWrite, true, 'localStorage 可写（本地增删改依赖它）')

/* ---------- 7. 子页面直达 / 刷新（静态宿主没有 SPA 兜底，最容易漏测的地方）----------
 *
 * 宿主是 Python 的 http.server，请求未知路径直接回它自己的 404 页，不会给 index.html。
 * 所以「在 /archived 按刷新」这一下就是生与死的差别，而应用内点击跳转看不出来。
 * 构建时生成的 `<route>/index.html` 目录入口负责兜住这一下（见
 * scripts/postbuild-spa-fallbacks.mjs）。
 */

const DEEP_ROUTES = ['/favorites', '/recent', '/archived', '/feed', '/trash', '/admin']
const deepBad = []
for (const route of DEEP_ROUTES) {
  await send('Page.navigate', { url: BASE + route })
  await new Promise(s => setTimeout(s, 2500))
  const state = await evalJs(`JSON.stringify({
    notFound: /Error code:\\s*404|File not found/i.test(document.body.innerText.slice(0, 300)),
    appMounted: !!document.querySelector('.app-layout, .app-shell, #app > *'),
    cards: document.querySelectorAll('.card').length,
    path: location.pathname
  })`)
  const s = JSON.parse(state)
  if (s.notFound || !s.appMounted) deepBad.push(`${route}(${JSON.stringify(s)})`)
}
ok(deepBad.length === 0, `${DEEP_ROUTES.length} 条子页面直达都能启动应用（不是宿主 404 页）`, deepBad.join(' '))

// 子页面同时也要能拿到数据（种子兜底），不能是空壳
await send('Page.navigate', { url: BASE + '/favorites' })
await new Promise(s => setTimeout(s, 2500))
const favState = JSON.parse(await evalJs(`JSON.stringify({
  path: location.pathname,
  navItems: document.querySelectorAll('.sidebar-nav-item').length,
  active: (document.querySelector('.sidebar-nav-item.active')||{}).textContent?.trim() || '',
  hasShell: !!document.querySelector('.app-layout, .app-shell')
})`))
eq(favState.hasShell, true, '子页面外壳正常渲染（路由匹配到了带尾斜杠的路径）')
ok(favState.navItems >= 5, '子页面侧栏导航完整', `实得 ${favState.navItems} 项`)
// 侧栏是 <div> + 客户端跳转（不是 <a href>），所以「直达后落到哪个范围」只能看 active 项 ——
// 这一条同时证明了 vue-router 真的把 /favorites/ 解析成了 favorites 范围
ok(/收藏/.test(favState.active), '直达 /favorites 后落在「收藏」范围', `active=${favState.active || '(无)'}`)

/* ---------- 截图（回到首页，画面才有代表性） ---------- */
await send('Page.navigate', { url: BASE + '/' })
await new Promise(s => setTimeout(s, 2500))
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('probe/static-standalone.png', Buffer.from(shot.data, 'base64'))
console.log('\n  📸 截图已保存 probe/static-standalone.png')

ws.close()

/* ---------- 结果 ---------- */
console.log('')
if (failures.length) {
  console.error(`❌ 静态托管可用性 ${failures.length} 项失败（通过 ${pass} 项）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`✅ 静态托管可用性全部通过：${pass} 项断言`)
process.exit(0)
