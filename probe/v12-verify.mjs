/**
 * 真机验证：v12 两件事 —— PWA 新版本不再自动刷新、批量操作可以撤回。
 *
 * 为什么必须真机：
 *  - `registerType` 的坑（`autoUpdate` 下 `onNeedRefresh` 是死代码）只有在浏览器里跑 SW 才看得见，
 *    单测与产物断言只能覆盖到「代码在不在包里」这一层；
 *  - 撤销是「点了按钮之后数据真的变回去了吗」，跨 store（undo → sites → localStorage）+
 *    toast 回调，链路只有真按一次才算数。
 *
 * 覆盖：SW 注册且不自动刷新 / 自然语言理解项（回车执行、↓ 退回）/
 *      批量置顶·归档·删除后可撤销 / 反选。
 *
 * 前置：静态服务（`node probe/static-server.mjs 4174 dist`）+ 无头 Chrome。
 * 用法：node probe/v12-verify.mjs <cdp-port> [base]
 */
import { writeFileSync } from 'node:fs'

const PORT = process.argv[2] || '9347'
const BASE = (process.argv[3] || 'http://127.0.0.1:4174').replace(/\/+$/, '')

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

/** 轮询等待，替代固定 sleep（首屏要拉入口 chunk + 300 站数据 + 异步 chunk，耗时随机） */
async function waitFor(expr, timeout = 15000, label = expr) {
  const deadline = Date.now() + timeout
  for (;;) {
    let v = false
    try { v = await evalJs(`(() => { try { return !!(${expr}) } catch { return false } })()`) } catch { /* 导航中文档已销毁，下轮再试 */ }
    if (v) return true
    if (Date.now() > deadline) {
      failures.push(`等待超时：${label}`)
      console.log(`  ❌ 等待超时：${label}`)
      return false
    }
    await sleep(200)
  }
}

/** 真按键：CDP 直接投递给渲染进程，能触发 keydown 监听器 */
async function press(key, code, vk, modifiers = 0) {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers })
}

const J = e => `JSON.stringify((() => { try { return (${e}) } catch { return null } })())`
const jsonOf = async e => { const s = await evalJs(J(e)); return s ? JSON.parse(s) : null }

/**
 * 聚焦一个输入框并写入内容。
 *
 * **必须派发真实的 mousedown**：组件里 `@focus` 在自动化/预览环境不一定派发，
 * 为此 UnifiedSearchBox 专门留了 `@mousedown="onInputPointerDown"` 兜底（它自己的注释
 * 就写了「预览/自动化浏览器里点击输入框可能拿不到焦点」）。只调 `el.focus()` 时
 * 下拉不会展开，表现为「理解项等不到」—— 而回车仍会执行已选中的项，特别容易误诊。
 */
async function setInput(sel, text) {
  return evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)})
    if (!el) return false
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    el.focus()
    el.value = ${JSON.stringify(text)}
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
}

/** 点批量栏里文字完全等于 label 的按钮 */
async function clickBatch(label) {
  return evalJs(`(() => {
    const b = [...document.querySelectorAll('.batch-btn')].find(x => x.textContent.trim() === ${JSON.stringify(label)})
    if (!b) return false
    b.click()
    return true
  })()`)
}

/** 点最新一条带操作按钮的 toast 上的操作键（撤销 / 刷新） */
async function clickToastAction() {
  return evalJs(`(() => {
    const ts = [...document.querySelectorAll('.toast')].filter(t => t.querySelector('.toast-action'))
    const t = ts[ts.length - 1]
    if (!t) return ''
    const label = t.querySelector('.toast-action').textContent.trim()
    t.querySelector('.toast-action').click()
    return label
  })()`)
}

/** 当前 toast 里有没有带「撤销」的提示（返回它的文案） */
async function undoToastText() {
  return evalJs(`(() => {
    const t = [...document.querySelectorAll('.toast')].find(x => x.querySelector('.toast-action')?.textContent.trim() === '撤销')
    return t ? t.querySelector('.toast-msg').textContent.trim() : ''
  })()`)
}

/** 覆盖层（本地改动）里的 edits —— 置顶 / 归档 的落点 */
async function overlayEdits() {
  const d = await jsonOf(`(() => {
    const raw = localStorage.getItem('nav-sites-overlay')
    if (!raw) return null
    const p = JSON.parse(raw)
    return p && typeof p === 'object' && 'data' in p ? p.data : p
  })()`)
  return d?.edits || {}
}

/** 进入批量模式并选中第一张卡（批量栏在「有选中」时才出现） */
async function enterBatchAndSelectOne() {
  const inBatch = await evalJs(`document.querySelector('.toolbar-btn[aria-pressed="true"]') !== null`)
  if (!inBatch) {
    await evalJs(`(() => { const b = document.querySelector('.toolbar-btn[aria-pressed]'); if (b) b.click(); return !!b })()`)
    await sleep(300)
  }
  await evalJs(`(() => { const c = document.querySelector('.card'); if (c) c.click(); return !!c })()`)
  return waitFor(`document.querySelector('.batch-bar')`, 5000, '批量栏出现')
}

await send('Page.enable')
await send('Runtime.enable')
// 会话级：设视口、导航、求值、截图必须同一条连接
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

console.log(`\n▶ v12 验证  BASE=${BASE}\n`)

/* ══════════ 1. PWA：注册了 SW，但**不**自动刷新 ══════════ */
console.log('【PWA 更新（A1）】')
await send('Page.navigate', { url: BASE + '/' })
await waitFor(`document.querySelector('.card')`, 20000, '首屏卡片渲染出来')
await sleep(1200)

// 打一个存活标记：真发生 window.location.reload 时整个 window 会重建，标记随之消失
await evalJs(`window.__v12alive = 1`)
// 注意不能把 Promise 塞进 `JSON.stringify((() => ...)())` —— stringify 一个 Promise 只会得到 `{}`。
// 直接把 async 表达式交给 Runtime.evaluate（awaitPromise 已开）。
const regs = await evalJs(`(async () => (await navigator.serviceWorker.getRegistrations()).length)()`)
ok(regs > 0, 'Service Worker 已注册（PWA 链路是活的）', `${regs} 个注册`)
const navType = await evalJs(`performance.getEntriesByType('navigation')[0]?.type || ''`)
await sleep(3000)
const alive = await evalJs(`window.__v12alive === 1`)
ok(alive, '3 秒内没有发生自动刷新（存活标记还在）')
ok(navType === 'navigate', '本次是正常导航而不是被动 reload', navType)
const swWaitingText = await evalJs(`document.querySelector('.toast-action')?.textContent || ''`)
ok(swWaitingText !== '刷新', '没有新版本时不会凭空弹出刷新提示')

/* ══════════ 2. 自然语言：理解项 + 回车执行 ══════════ */
console.log('\n【自然语言命令（I3）】')
await setInput('.unified-search-input', '切换到深色')
const gotPhrase = await waitFor(`document.querySelector('.omni-item-phrase')`, 8000, '出现「理解」项')
ok(gotPhrase, '打「切换到深色」出现理解项')

const st = await jsonOf(`(() => {
  const items = [...document.querySelectorAll('.search-suggestions .omni-item')]
  const badge = document.querySelector('.omni-item-phrase')
  const item = badge && badge.closest('.omni-item')
  const group = item && item.closest('.omni-group')
  const titleEl = item && item.querySelector('.omni-item-title')
  // 「猜的」徽标是嵌在 .omni-item-title **里面**的，直接取 textContent 会连它一起拿到
  // （「切换主题猜的」）。只取该元素下的文本节点，才是真正的标题。
  const titleOnly = titleEl
    ? [...titleEl.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim()
    : ''
  return {
    total: items.length,
    firstIsPhrase: items[0] === item,
    badge: badge ? badge.textContent.trim() : '',
    title: titleOnly,
    sub: item ? (item.querySelector('.omni-item-sub') || {}).textContent || '' : '',
    groupLabel: group ? group.querySelector('.omni-group-label').textContent.trim() : '',
    activeIsPhrase: item ? item.classList.contains('active') : false,
  }
})()`) || {}
ok(st.firstIsPhrase, '理解项排在结果最前面', `共 ${st.total} 项`)
ok(st.groupLabel === '理解', '分组名是「理解」', st.groupLabel)
ok(st.title === '切换主题', '理解为「切换主题」', st.title)
ok(st.badge.includes('猜的'), '带「猜的」标记（明示这是推测）', st.badge)
ok(st.sub.includes('↓'), '副标题给出退出方式（↓ 看其它结果）', st.sub.trim())
ok(st.activeIsPhrase, '理解项默认选中（回车即执行）')

const themeBefore = await evalJs(`document.documentElement.getAttribute('data-theme')`)
await press('Enter', 'Enter', 13)
await sleep(700)
const themeAfter = await evalJs(`document.documentElement.getAttribute('data-theme')`)
ok(themeBefore !== themeAfter, '回车真的执行了命令（明暗切换）', `${themeBefore} → ${themeAfter}`)
const closed = await evalJs(`document.querySelector('.search-suggestions') === null`)
ok(closed, '执行后收纳了建议面板（onDone 生效）')

/* ══════════ 3. 自然语言：↓ 退回搜索结果 ══════════ */
await setInput('.unified-search-input', '切换到深色')
await waitFor(`document.querySelector('.omni-item-phrase')`, 8000, '再次出现理解项')
await press('ArrowDown', 'ArrowDown', 40)
await sleep(300)
const st2 = await jsonOf(`(() => {
  const items = [...document.querySelectorAll('.search-suggestions .omni-item')]
  const active = items.find(i => i.classList.contains('active'))
  const badge = document.querySelector('.omni-item-phrase')
  return {
    total: items.length,
    activeIsPhrase: !!(active && badge && active === badge.closest('.omni-item')),
    activeIndex: active ? items.indexOf(active) : -1,
    activeTitle: active ? active.querySelector('.omni-item-title').textContent.trim() : '',
  }
})()`) || {}
ok(st2.total >= 2, '除理解项外还有其它结果（↓ 才有去处）', `${st2.total} 项`)
ok(!st2.activeIsPhrase, '按一下 ↓ 选中项就离开「理解」（误命中可一键退回）', `落在第 ${st2.activeIndex + 1} 项：${st2.activeTitle}`)

// 清空，免得干扰后面
await evalJs(`(() => { const b = document.querySelector('.search-clear'); if (b) b.click(); return !!b })()`)
await sleep(300)

/* ══════════ 4. 批量置顶 / 归档 / 删除都能撤销 ══════════ */
console.log('\n【批量操作与撤销（E4）】')

// (a) 置顶 + 撤销
ok(await enterBatchAndSelectOne(), '进入批量模式并选中一张卡')
const firstId = await evalJs(`document.querySelector('.card[data-site-id]')?.dataset.siteId || ''`)
ok(await clickBatch('置顶'), '点了「置顶」')
await sleep(400)
const afterPin = await overlayEdits()
ok(afterPin[firstId]?.pinned === true, '置顶落到了本地改动里', firstId)
const pinToast = await undoToastText()
ok(pinToast.includes('置顶'), '弹出了带「撤销」的提示', pinToast)
// 提示与批量栏都贴底：提示绝不能盖住批量栏的按钮（盖住了就点不到「置顶 / 归档 / 改分类」）。
// 用几何关系断言而不是「点了一下能有反应」—— 合成 click 会绕过命中测试，盖住也照样成功。
const overlap = await jsonOf(`(() => {
  const t = [...document.querySelectorAll('.toast')].find(x => x.querySelector('.toast-action'))
  const bar = document.querySelector('.batch-bar')
  if (!t || !bar) return null
  const a = t.getBoundingClientRect(); const b = bar.getBoundingClientRect()
  return { toastBottom: Math.round(a.bottom), barTop: Math.round(b.top) }
})()`)
ok(overlap && overlap.toastBottom <= overlap.barTop + 1,
  '撤销提示抬到了批量栏之上，不遮挡「置顶 / 归档」等按钮',
  overlap ? `提示底 ${overlap.toastBottom} / 批量栏顶 ${overlap.barTop}` : '取不到几何')
const pinAction = await clickToastAction()
ok(pinAction === '撤销', '点了提示上的「撤销」', pinAction)
await sleep(400)
const afterUnpin = await overlayEdits()
ok(afterUnpin[firstId]?.pinned !== true, '撤销后置顶真的回退了')

// (b) 归档 + 撤销
await enterBatchAndSelectOne()
ok(await clickBatch('归档'), '点了「归档」')
await sleep(400)
const afterArc = await overlayEdits()
ok(afterArc[firstId]?.archived === true, '归档落到了本地改动里')
const arcToast = await undoToastText()
ok(arcToast.includes('归档'), '归档也给了撤销入口', arcToast)
await clickToastAction()
await sleep(400)
const afterUnarc = await overlayEdits()
ok(afterUnarc[firstId]?.archived !== true, '撤销后归档真的回退了')

// (c) 删除 + 撤销（删除走回收站，撤销＝从回收站取回）
const cardsBefore = await evalJs(`document.querySelectorAll('.card').length`)
await enterBatchAndSelectOne()
ok(await clickBatch('批量删除'), '点了「批量删除」')
await waitFor(`document.querySelector('.confirm-dialog')`, 5000, '确认弹窗出现')
await evalJs(`(() => { const b = document.querySelector('.confirm-dialog .btn-danger'); if (b) b.click(); return !!b })()`)
await sleep(600)
const cardsAfterDelete = await evalJs(`document.querySelectorAll('.card').length`)
ok(cardsAfterDelete === cardsBefore - 1, '卡片少了一张', `${cardsBefore} → ${cardsAfterDelete}`)
const delToast = await undoToastText()
ok(delToast.includes('回收站'), '删除也给了撤销入口', delToast)
await clickToastAction()
await sleep(700)
const cardsAfterUndo = await evalJs(`document.querySelectorAll('.card').length`)
ok(cardsAfterUndo === cardsBefore, '撤销后卡片回来了', `${cardsAfterDelete} → ${cardsAfterUndo}`)

// (d) 反选：只对当前可见集取反
await enterBatchAndSelectOne()
const visibleCount = await evalJs(`document.querySelectorAll('.card').length`)
ok(await clickBatch('反选'), '点了「反选」')
await sleep(400)
const selText = await evalJs(`document.querySelector('.batch-count')?.textContent || ''`)
const selNum = Number((selText.match(/(\d+)/) || [])[1] ?? -1)
ok(selNum === visibleCount - 1, '反选＝当前可见集里除了那一个之外全选', `${selText.trim()}（可见 ${visibleCount}）`)

/* ══════════ 截图 ══════════ */
await sleep(400)
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('probe/v12-batch.png', Buffer.from(shot.data, 'base64'))
console.log('\n  📸 截图已保存 probe/v12-batch.png')

ws.close()

console.log('')
if (failures.length) {
  console.error(`❌ v12 验证 ${failures.length} 项失败（通过 ${pass} 项）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`✅ v12 验证全部通过：${pass} 项断言`)
process.exit(0)
