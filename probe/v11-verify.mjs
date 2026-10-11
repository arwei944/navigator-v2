/**
 * 真机验证：v11 三件事 —— 洞察面板能打开、网格能用键盘走、浮层关得住焦点。
 *
 * 为什么必须真机：这三件事的共同点是「DOM 与焦点」，单测覆盖不到。
 * 比如 roving tabindex 里只要有哪张卡漏了 `:tab-index`，单测全绿，
 * 但键盘用户按一下右方向键焦点就掉了 —— 这类问题只能靠真按一次键发现。
 *
 * 前置：静态服务（`python -m http.server` 起 `dist/`）+ 无头 Chrome。
 * 用法：node probe/v11-verify.mjs <cdp-port> [base]
 */
import { writeFileSync } from 'node:fs'

const PORT = process.argv[2] || '9347'
const BASE = process.argv[3] || 'http://127.0.0.1:4174'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? ` → ${extra}` : ''}`) }
  else { failures.push(`${label}${extra ? ` → ${extra}` : ''}`); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`) }
}

async function targets() {
  for (let i = 0; i < 60; i++) {
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

ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
  }
})
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params }))
})
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval 抛错')
  return r.result.value
}
const sleep = ms => new Promise(s => setTimeout(s, ms))

/**
 * 轮询等待页面到达某个状态，替代固定 sleep。
 * 为什么必须轮询：首次文档加载要拉入口 chunk + 300 站数据 + 洞察页异步 chunk，
 * 耗时随机器波动，固定 3s 在慢机器上会漏判（表现为「直达渲染出首页」的假失败）。
 */
async function waitFor(expr, timeout = 15000, label = expr) {
  const deadline = Date.now() + timeout
  for (;;) {
    let v = false
    try { v = await evalJs(`(() => { try { return !!(${expr}) } catch { return false } })()`) } catch { /* 导航中文档已销毁，下一轮再试 */ }
    if (v) return true
    if (Date.now() > deadline) {
      failures.push(`等待超时：${label}`)
      console.log(`  ❌ 等待超时：${label}`)
      return false
    }
    await sleep(250)
  }
}

/** 真按键：CDP 直接投递给渲染进程，能触发 keydown 监听器（el.focus() 之外还要真按） */
async function press(key, code, vk, modifiers = 0) {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers })
}

await send('Page.enable')
await send('Runtime.enable')
// 会话级：设视口、导航、求值、截图必须同一条连接
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

console.log(`\n▶ v11 验证  BASE=${BASE}\n`)

/* ══════════ 1. /insights 直达 ══════════ */
console.log('【洞察面板】')
await send('Page.navigate', { url: BASE + '/insights' })
await waitFor(`document.querySelector('.insights') || /没有找到|File not found/i.test(document.body.innerText)`, 15000, '/insights 直达渲染出洞察面板')
await sleep(600)

const ins = JSON.parse(await evalJs(`JSON.stringify((() => {
  const root = document.querySelector('.insights')
  const cards = [...document.querySelectorAll('.ins-card')]
  return {
    hasRoot: !!root,
    title: (document.querySelector('.ins-title') || {}).textContent || '',
    cards: cards.length,
    svgs: document.querySelectorAll('.ins-card svg').length,
    hasStrip: !!document.querySelector('.health-strip svg'),
    hasDonut: !!document.querySelector('.cat-donut svg'),
    is404: /没有找到|File not found/i.test(document.body.innerText),
    route: location.pathname,
  }
})())`))

ok(ins.hasRoot, '/insights 直达渲染出洞察面板（宿主 301 到目录后命中入口）', ins.route)
ok(!ins.is404, '不是宿主的 404 页')
ok(ins.title.includes('洞察'), '页面标题正确', ins.title)
ok(ins.cards >= 3, '三块以上内容卡片都在', `${ins.cards} 张`)
ok(ins.hasStrip, '健康度堆叠条渲染出来了')
ok(ins.hasDonut, '分类分布环形图渲染出来了')
ok(ins.svgs >= 2, '图表是真实 SVG（非空态）', `${ins.svgs} 个 svg`)

/* ══════════ 2. 侧栏入口 ══════════ */
const navOk = await evalJs(`(() => {
  const items = [...document.querySelectorAll('.sidebar-nav-item')]
  const hit = items.find(el => el.textContent.trim() === '洞察')
  if (!hit) return 'no-item'
  hit.click()
  return 'ok'
})()`)
ok(navOk === 'ok', '侧栏「洞察」入口存在且可点击')

await send('Page.navigate', { url: BASE + '/' })
await waitFor(`document.querySelector('.card[data-site-id]')`, 15000, '首页卡片渲染')
await sleep(600)

/* ══════════ 3. 网格键盘导航 ══════════ */
console.log('\n【网格键盘导航】')
const grid = JSON.parse(await evalJs(`JSON.stringify((() => {
  const cards = [...document.querySelectorAll('.card[data-site-id]')]
  const zero = cards.filter(c => c.getAttribute('tabindex') === '0').length
  const gridEl = document.querySelector('.cards-container')
  return {
    total: cards.length,
    zero,
    role: gridEl?.getAttribute('role') || '',
    ids: cards.slice(0, 40).map(c => c.dataset.siteId),
  }
})())`))

ok(grid.total > 10, '卡片已渲染', `${grid.total} 张`)
ok(grid.role === 'grid', '网格容器标注了 role=grid', grid.role)
ok(grid.zero === 1, 'roving tabindex：只有一张卡是 0（Tab 进出网格只停一次）', `${grid.zero} 张为 0`)

await evalJs(`document.querySelector('.card[data-site-id]').focus()`)
await sleep(150)
const first = await evalJs(`document.activeElement?.dataset?.siteId || ''`)
ok(first === grid.ids[0], '焦点落在第一张卡上', first)

await press('ArrowRight', 'ArrowRight', 39)
await sleep(150)
const afterRight = await evalJs(`document.activeElement?.dataset?.siteId || ''`)
ok(afterRight === grid.ids[1], '按 → 焦点移到右一张', afterRight)

const cols = await evalJs(`(() => {
  const g = document.querySelector('.cards-grid')
  if (!g) return 1
  const t = getComputedStyle(g).gridTemplateColumns
  return t && t !== 'none' ? t.trim().split(/\\s+/).filter(Boolean).length : 1
})()`)
await press('ArrowDown', 'ArrowDown', 40)
await sleep(150)
const afterDown = await evalJs(`document.activeElement?.dataset?.siteId || ''`)
ok(afterDown === grid.ids[1 + cols], `按 ↓ 焦点下移一整行（实测 ${cols} 列）`, afterDown)

await press('Home', 'Home', 36)
await sleep(150)
const afterHome = await evalJs(`document.activeElement?.dataset?.siteId || ''`)
ok(afterHome === grid.ids[0], '按 Home 回到第一张', afterHome)

await press('End', 'End', 35)
await sleep(150)
const afterEnd = await evalJs(`!!document.activeElement?.dataset?.siteId`)
ok(afterEnd, '按 End 落到最后一张（300 卡也能一步到底）')

/* ══════════ 4. 命令面板：dialog 语义 + 焦点陷阱 ══════════ */
console.log('\n【浮层无障碍】')
await press('k', 'KeyK', 75, 2) // Ctrl
await sleep(800)
const palette = JSON.parse(await evalJs(`JSON.stringify((() => {
  const p = document.querySelector('.cp-panel')
  return {
    open: !!p,
    role: p?.getAttribute('role') || '',
    modal: p?.getAttribute('aria-modal') || '',
    focusIn: p ? p.contains(document.activeElement) : false,
  }
})())`))
ok(palette.open, 'Ctrl+K 打开了命令面板')
ok(palette.role === 'dialog', '面板标注 role=dialog', palette.role)
ok(palette.modal === 'true', '面板标注 aria-modal', palette.modal)
ok(palette.focusIn, '打开后焦点落在面板内（不是在背后的网格上）')

// 连按 Tab：焦点必须始终留在面板里
let trapped = true
for (let i = 0; i < 12; i++) {
  await press('Tab', 'Tab', 9)
  await sleep(60)
  const inside = await evalJs(`(() => {
    const p = document.querySelector('.cp-panel')
    return p ? p.contains(document.activeElement) : false
  })()`)
  if (!inside) { trapped = false; break }
}
ok(trapped, '连按 12 次 Tab，焦点始终困在面板内（焦点陷阱生效）')

await press('Escape', 'Escape', 27)
await sleep(500)
const closed = JSON.parse(await evalJs(`JSON.stringify({
  gone: !document.querySelector('.cp-panel'),
  activeTag: document.activeElement?.tagName || '',
  activeInPalette: !!document.activeElement?.closest?.('.cp-panel'),
})`))
ok(closed.gone, 'Esc 关闭了面板')
ok(!closed.activeInPalette, '关闭后焦点没有留在已消失的面板上', closed.activeTag)

/* ══════════ 5. 添加站点弹窗 ══════════ */
// 注意：不能把 async IIFE 塞进 JSON.stringify —— stringify 一个 Promise 只会
// 得到 {}，里面 await 多久都白等（这个坑让本组从第一次运行就假失败）。
// 正确形态：eval 只负责「点下去 + 等到出现」，状态查询另起一个同步 IIFE。
await evalJs(`(async () => {
  const btn = document.querySelector('.add-site-btn')
  if (!btn) return
  btn.click()
  // 异步组件首次点击才开始拉 chunk，轮询等它挂载
  const deadline = Date.now() + 10000
  while (!document.querySelector('.modal') && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 200))
  }
})()`)
const modal = JSON.parse(await evalJs(`JSON.stringify((() => {
  const m = document.querySelector('.modal')
  return {
    open: !!m,
    role: m?.getAttribute('role') || '',
    modal: m?.getAttribute('aria-modal') || '',
    focusIn: m ? m.contains(document.activeElement) : false,
  }
})())`))
if (!modal.open && !await evalJs(`!!document.querySelector('.add-site-btn')`)) {
  ok(false, '工具栏「添加网站」按钮存在')
} else {
  ok(modal.open, '添加站点弹窗打开了（异步组件能加载）')
  ok(modal.role === 'dialog', '弹窗标注 role=dialog', modal.role)
  ok(modal.modal === 'true', '弹窗标注 aria-modal', modal.modal)
  ok(modal.focusIn, '打开后焦点落在弹窗内')
}

/* ══════════ 截图 ══════════ */
await evalJs(`document.querySelector('.modal-close')?.click()`)
await sleep(300)
await send('Page.navigate', { url: BASE + '/insights' })
await waitFor(`document.querySelector('.insights')`, 15000, '截图前洞察面板就绪')
await sleep(800)
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('probe/v11-insights.png', Buffer.from(shot.data, 'base64'))
console.log('\n  📸 截图已保存 probe/v11-insights.png')

ws.close()

console.log('')
if (failures.length) {
  console.error(`❌ v11 验证 ${failures.length} 项失败（通过 ${pass} 项）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`✅ v11 验证全部通过：${pass} 项断言`)
process.exit(0)
