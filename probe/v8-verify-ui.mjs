/**
 * v8 真机验证（零依赖 CDP：Node 22 内置 WebSocket / fetch）。
 *
 * 为什么要跑真机：v8 把「点开才用」的重组件（设置面板 / 主题编辑器 / 便签墙 / 便签卡片）
 * 改成了异步组件，并把主题 store 提到启动时实例化 —— 这两件事在产物断言里只表现为
 * 「体积对上了」，只有真的点一遍才知道它们还打不打得开。
 *
 * 要点：Emulation.setDeviceMetricsOverride 是会话级的，跨连接失效——
 * 设视口、导航、求值、截图必须全在**同一条 WebSocket 连接**里连续做完。
 *
 * 用法: node probe/v8-verify-ui.mjs <cdp-port> [base-url]
 * 默认打本地 preview（vite preview 只绑 [::1]，所以要写 localhost 而非 127.0.0.1）。
 */
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'

const BASE = process.argv[3] || 'http://localhost:4173'
const CDP_PORT = process.argv[2] || '9333'
const OUT = fileURLToPath(new URL('.', import.meta.url))

let ws, msgId = 0
const pending = new Map()

function send(method, params = {}) {
  const id = ++msgId
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)) } }, 20000)
  })
}

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception?.description || ''))
  return r.result?.value
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
function check(label, ok, extra = '') {
  results.push({ label, ok })
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`)
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  const buf = Buffer.from(r.data, 'base64')
  writeFileSync(OUT + name, buf)
  console.log('  shot →', name)
}

async function waitFor(sel, timeout = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const hit = await evaluate(`!!document.querySelector(${JSON.stringify(sel)})`).catch(() => false)
    if (hit) return true
    await sleep(250)
  }
  return false
}

async function waitForGone(sel, timeout = 8000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const hit = await evaluate(`!!document.querySelector(${JSON.stringify(sel)})`).catch(() => true)
    if (!hit) return true
    await sleep(200)
  }
  return false
}

const count = sel => evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const click = sel => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return 'missing'; e.click(); return 'ok' })()`)
const txt = sel => evaluate(`(document.querySelector(${JSON.stringify(sel)})?.textContent || '').trim()`)
const cssVar = name => evaluate(`getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify(name)}).trim()`)

/** 按可见文字点一个元素（按钮文案比类名稳定） */
const clickByText = (sel, text) => evaluate(`
  (() => {
    const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.textContent.trim().includes(${JSON.stringify(text)}))
    if (!el) return 'missing'
    el.click()
    return 'ok'
  })()
`)

async function type(sel, text) {
  // 必须先派发 mousedown：搜索框靠 `@mousedown` 认定「用户进来了」（focused=true），
  // 只做 el.focus() 不足以把下拉打开 —— 少了这一步会得到「意图 chip 不出现」的假失败。
  return evaluate(`
    (() => {
      const el = document.querySelector(${JSON.stringify(sel)})
      if (!el) return 'missing'
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      el.focus()
      el.value = ${JSON.stringify(text)}
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return 'ok'
    })()
  `)
}

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
  const target = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!target) throw new Error('没有可用的 Chrome 页面目标')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = e => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result); pending.delete(m.id) }
  }
  console.log('已连接 CDP:', BASE)

  await send('Page.enable')
  await send('Runtime.enable')
  // 视口、导航、求值、截图同一条连接内完成
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

  // 捕获控制台报错（异步组件加载失败就是在这里现形）
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__errs = []
      window.addEventListener('error', e => window.__errs.push(String(e.message || e.error)))
      window.addEventListener('unhandledrejection', e => window.__errs.push('rejection: ' + String(e.reason && e.reason.message || e.reason)))
    `,
  })

  // 干净起点：清掉历史/备注/便签，保证「首屏冷启动」这一档被真的测到
  await send('Page.navigate', { url: BASE })
  await sleep(1200)
  await evaluate(`(() => { localStorage.clear(); return 1 })()`)
  await send('Page.navigate', { url: BASE })
  await sleep(1500)

  /* ══════════ 1. 首屏 ══════════ */

  const cardsReady = await waitFor('.card', 20000)
  check('首屏渲染出站点卡片', cardsReady)
  const cardCount = await count('.card')
  check('卡片数量 > 0', cardCount > 0, `${cardCount} 张`)

  check('「此刻推荐」横条存在（冷启动降级为「大家在用的」）', await waitFor('.smart-bar', 6000))

  /* ══════════ 2. 智能化：意图 chip ══════════ */

  check('搜索框可输入', (await type('.toolbar-search input', '免费的 AI 画图工具')) === 'ok')
  const chip = await waitFor('.intent-chip', 6000)
  check('自然语言输入触发意图 chip', chip, chip ? await txt('.intent-chip') : '')
  await shot('v8-1-intent-chip.png')
  await type('.toolbar-search input', '')
  await sleep(600)
  check('清空搜索词后 chip 消失（不会粘住）', await waitForGone('.intent-chip', 4000))

  /* ══════════ 3. 便利贴：浮标（同步）→ 停靠面板 → 卡片（异步 chunk）══════════ */

  check('右下角便利贴浮标存在', await waitFor('.dock-fab', 8000))
  await click('.dock-fab')
  const panel = await waitFor('.dock-panel', 6000)
  check('点击浮标展开停靠面板', panel)

  // 面板头三个按钮：新建 / 打开便签墙 / 收起
  await evaluate(`document.querySelectorAll('.dock-act')[0].click()`)
  const noteInDock = await waitFor('.dock-panel .sticky', 8000)
  check('新建便签后便签卡片渲染出来（异步 StickyNote 加载成功）', noteInDock)
  const notesRaw = await evaluate(`localStorage.getItem('nav-notes') || ''`)
  check('便签已落盘到 localStorage', notesRaw.includes('"items"') || notesRaw.length > 20, notesRaw.slice(0, 60))
  await shot('v8-2-dock-note.png')

  // 便签墙（异步 StickyBoard）
  await evaluate(`document.querySelectorAll('.dock-act')[1].click()`)
  const board = await waitFor('.board-root', 8000)
  check('便签墙打开（异步 StickyBoard 加载成功）', board)
  check('便签墙里能看到刚建的便签', (await count('.board-root .sticky')) > 0)
  await shot('v8-3-sticky-board.png')
  await clickByText('.board-btn', '关闭')
  check('便签墙可关闭', await waitForGone('.board-root', 6000))

  /* ══════════ 4. 设置面板（异步）+ 主题市场 ══════════ */

  await click('.settings-btn')
  const modal = await waitFor('.settings-modal', 8000)
  check('设置面板打开（异步 SettingsPanel 加载成功）', modal)
  const themeCards = await count('.theme-card')
  check('主题市场渲染出内置 + 自建主题', themeCards >= 8, `${themeCards} 张主题卡`)

  const activeBefore = await txt('.theme-card.active .theme-name')
  const radiusBefore = await cssVar('--radius')
  // 切到不在生效的那张主题卡
  await evaluate(`
    (() => {
      const card = [...document.querySelectorAll('.theme-card')].find(c => !c.classList.contains('active'))
      card.click()
      return 'ok'
    })()
  `)
  await sleep(700)
  const activeAfter = await txt('.theme-card.active .theme-name')
  const radiusAfter = await cssVar('--radius')
  check('点击主题卡后生效主题切换', activeAfter !== activeBefore, `${activeBefore} → ${activeAfter}`)
  // 断言改材质令牌（圆角）：苹果原生与极简扁平同用 default 取色，--accent 本来就不该变
  check('切主题真的换了形状质感（--radius 变化）', radiusAfter !== radiusBefore, `${radiusBefore} → ${radiusAfter}`)
  await shot('v8-4-theme-market.png')

  // 再点一张取色不同的主题（宣纸），确认配色路径也通
  const accentBefore = await cssVar('--accent')
  const paperCard = await evaluate(`
    (() => {
      const card = [...document.querySelectorAll('.theme-card')].find(c => c.textContent.includes('宣纸'))
      if (!card) return 'missing'
      card.click()
      return 'ok'
    })()
  `)
  if (paperCard === 'ok') {
    await sleep(700)
    const accentAfter = await cssVar('--accent')
    check('切到宣纸后配色真的换了（--accent 变化）', accentAfter !== accentBefore, `${accentBefore} → ${accentAfter}`)
  } else {
    check('主题市场里有「宣纸」主题', false, '未找到该主题卡')
  }

  // 切回原主题，避免把现场留在半途
  await clickByText('.theme-card .theme-name', activeBefore)
  await sleep(600)
  check('可以切回原主题', (await txt('.theme-card.active .theme-name')) === activeBefore)

  /* ══════════ 5. 主题编辑器（异步抽屉）══════════ */

  await clickByText('.data-btn', '编辑')
  const editor = await waitFor('.editor-panel', 8000)
  check('主题编辑器抽屉打开（异步 ThemeEditor 加载成功）', editor)
  check('编辑器里能看到取色项', (await count('.editor-panel input[type="color"]')) > 0)
  await shot('v8-5-theme-editor.png')
  await click('.editor-close')
  check('编辑器可关闭', await waitForGone('.editor-panel', 6000))
  await click('.settings-close')
  check('设置面板可关闭', await waitForGone('.settings-modal', 6000))

  /* ══════════ 6. 站点备注：右键 → 详情备注区 → 落盘 → 卡片角标 ══════════ */

  const opened = await evaluate(`
    (() => {
      const card = document.querySelector('.card')
      const r = card.getBoundingClientRect()
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 20, clientY: r.top + 20 }))
      return 'ok'
    })()
  `)
  check('卡片上能唤出右键菜单', opened === 'ok' && await waitFor('.context-menu', 5000))
  const noteItem = await clickByText('.context-menu-item', '备注')
  check('菜单里有「添加/编辑备注」', noteItem === 'ok')
  const noteInput = await waitFor('.note-input', 8000)
  check('详情面板的备注区打开', noteInput)
  if (noteInput) {
    await type('.note-input', 'v8 真机验证写入的备注')
    await sleep(900)
    const stored = await evaluate(`localStorage.getItem('nav-site-notes') || ''`)
    check('备注已落盘到 localStorage', stored.includes('v8 真机验证写入的备注'), stored.slice(0, 80))
    check('卡片上出现备注角标', await waitFor('.card-note', 6000))
    await shot('v8-6-site-note.png')
  }

  /* ══════════ 7. 控制台无报错 ══════════ */

  const errs = await evaluate(`window.__errs || []`)
  check('整轮操作没有未捕获错误', Array.isArray(errs) && errs.length === 0, (errs || []).join(' | '))

  const failed = results.filter(r => !r.ok)
  console.log(`\n${failed.length ? '❌' : '✅'} v8 真机验证：${results.length - failed.length}/${results.length} 通过`)
  if (failed.length) failed.forEach(f => console.log('  - ' + f.label))
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error('❌ 验证脚本异常:', e.message); process.exit(1) })
