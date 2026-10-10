/**
 * 「点击卡片必须在**新标签页**打开、且绝不覆盖当前页」的真机验收。
 *
 * 为什么需要它：这个需求在代码层面「看起来显然对」过 —— 原实现是
 * `window.open(url, '_blank', 'noopener')`，在桌面 Chrome 里实测也确实是新开标签页。
 * 但用户反馈「点击卡片直接覆盖原有网址打开」。根因是**规范层面**的：只要给 window.open
 * 传了第三个参数（windowFeatures），这次调用就被定性为**弹窗请求**，于是内嵌 WebView /
 * App 内置浏览器 / IDE 预览面板把它拦掉或就地打开。静态看代码看不出这个差异。
 *
 * 所以这里量的是**用户可见的行为**，用 trusted 输入事件（Input.dispatchMouseEvent）而非
 * `element.click()` —— 后者缺少用户手势语义，反映不出上面的环境差异：
 *
 *   1. 点击前后当前页的 `location.href` 不变（**没被覆盖**）；
 *   2. 有一次对 `a[target="_blank"]` 的点击，且 href 正是该卡片的站点地址（**发起了新标签页导航**）；
 *   3. 真的多出一个外部浏览上下文（**新页确实开了**）。
 *
 * 第 2 条用捕获阶段的 document 监听记录，避免受目标站重定向（如 chat.openai.com → chatgpt.com）
 * 影响 —— 我们要断言的是「应用请求了什么」，而不是「目标站把我们带到哪」。
 *
 * 用法: node probe/verify-card-open.mjs <cdp-port> [base-url]
 */
const PORT = process.argv[2] || '9349'
const BASE = process.argv[3] || 'https://navigator-v2-two.vercel.app'

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl)
if (!page) throw new Error('没有可用的 Chrome 页面')

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const pending = new Map()
const events = []
ws.onmessage = e => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return }
  if (m.method) events.push(m)
}
const send = (method, params = {}) => {
  const i = ++id
  ws.send(JSON.stringify({ id: i, method, params }))
  return new Promise(r => pending.set(i, r))
}
const evaluate = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result?.value
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

const results = []
const check = (ok, label, detail = '') => {
  results.push(ok)
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ' — ' + detail : ''}`)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Target.setDiscoverTargets', { discover: true })

console.log(`\n=== 卡片打开行为验收：${BASE} ===\n`)
await send('Page.navigate', { url: BASE + '/' })
await sleep(6000)

/**
 * 等页面「安定」下来再动手。
 *
 * 生产站点部署了新版本时，PWA 的 `onNeedRefresh` 会触发 `location.reload()`
 * （见 src/main.js）—— 于是我们注入的监听器会被整页刷新抹掉，
 * 表现为「点击有效果、但记录数组是 undefined」。这里用一个存活标记轮询，
 * 确认页面不再自我刷新后才继续。
 */
async function waitUntilStable() {
  for (let i = 0; i < 6; i++) {
    await evaluate(`window.__probeToken = 'tok'; true`)
    await sleep(1600)
    if (await evaluate('window.__probeToken') === 'tok') return true
  }
  return false
}
const stable = await waitUntilStable()
check(stable, '页面已安定（等待 PWA 自动更新触发的整页刷新结束）')

/** 安装「记录应用请求打开哪些地址」的捕获监听（幂等） */
async function installListener() {
  const installed = await evaluate(`(() => {
    if (!window.__opened) window.__opened = [];
    if (!window.__listenInstalled) {
      document.addEventListener('click', e => {
        const a = e.target && e.target.closest ? e.target.closest('a[target="_blank"]') : null;
        if (a) window.__opened.push(a.href);
      }, true);
      window.__listenInstalled = true;
    }
    return Array.isArray(window.__opened);
  })()`)
  if (!installed) throw new Error('监听器安装失败（页面可能又被刷新了）')
}

const cards = await evaluate(`document.querySelectorAll('.card').length`)
check(cards > 0, `页面渲染出卡片（${cards} 张）`)
if (!cards) { console.log('\n页面不可达，后续检查跳过'); ws.close(); process.exit(1) }

const before = await (async () => {
  const targets = (await send('Target.getTargets')).targetInfos.map(t => t.targetId)
  const href = await evaluate('location.href')
  return { targets, href }
})()

await installListener()

/** 对某个选择器的元素发一次真实鼠标点击 */
async function clickReal(selector) {
  const pt = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`)
  if (!pt) throw new Error(`找不到元素：${selector}`)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 })
}

/* ---------- 1. 点击卡片主体 ---------- */
console.log('[1] 点击卡片主体')
const cardInfo = await evaluate(`(() => {
  const c = document.querySelector('.card');
  return { id: c.dataset.siteId, url: (c.querySelector('.card-url') || {}).textContent || '' };
})()`)
await clickReal('.card')
await sleep(2500)

const afterWrite = await evaluate('location.href').catch(() => '(页面已不可用)')
const opened = await evaluate('window.__opened')
const targetsAfter = (await send('Target.getTargets')).targetInfos
const newTargets = targetsAfter.filter(t => !before.targets.includes(t.targetId) && t.type === 'page')

check(afterWrite === before.href, '当前页没有被导航走（不覆盖原有网址）', `href=${afterWrite}`)
check(Array.isArray(opened) && opened.length === 1, '发起了一次新标签页链接导航',
  `记录到 ${opened && opened.length} 次：${(opened || []).join(', ')}`)
check(Boolean(opened && opened[0] && cardInfo.url && opened[0].includes(cardInfo.url)),
  '打开的是该卡片自己的站点地址', `卡片=${cardInfo.url} 实际=${opened && opened[0]}`)
check(newTargets.length >= 1, '确实新开了一个浏览上下文（新页真的开了）',
  newTargets.map(t => t.url).join(', '))
const windowOpens = events.filter(e => e.method === 'Page.windowOpen')
check(windowOpens.length >= 1, '确实发起了一次「新窗口」请求',
  `${windowOpens.length} 次`)
check(windowOpens.every(e => e.params.windowName === '_blank'), '目标都是 _blank',
  windowOpens.map(e => e.params.windowName).join(', '))
check(windowOpens.every(e => e.params.userGesture !== false),
  '是用户手势触发的（不会被弹窗拦截器判为脚本自动打开）',
  windowOpens.map(e => String(e.params.userGesture)).join(', '))

/**
 * 「是链接导航还是 window.open 弹窗请求」**这件事 CDP 观测不到**，故只作诊断输出、不断言。
 *
 * 实测依据：`Page.windowOpen` 的 `windowFeatures` 对**普通锚点点击**也会填一整套默认值
 * （`menubar,toolbar,status,scrollbars,resizable`，外加上 `rel=noopener` 带来的 `noopener`），
 * 所以「windowFeatures 为空 = 链接导航」这个猜想是错的。
 * 该区分只能靠**源码级**保证，见 tools/console/test-frontend.mjs：
 * ① openInNewTab 必须合成 `<a target="_blank" rel="noopener noreferrer">` 并 click()；
 * ② `src/` 下不得再出现任何 `window.open(` 调用。
 */
console.log(`     （诊断）windowFeatures = ${JSON.stringify(windowOpens.flatMap(e => e.params.windowFeatures || []))}`)

/* ---------- 2. 右键菜单里的「新窗口打开」 ---------- */
console.log('\n[2] 右键菜单 → 打开')
const beforeRight = (await send('Target.getTargets')).targetInfos.map(t => t.targetId)
events.length = 0
await installListener()
await evaluate('window.__opened = []; true')
// 打开右键菜单
{
  const pt = await evaluate(`(() => {
    const r = document.querySelector('.card').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'right', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'right', clickCount: 1 })
  await sleep(700)
}
const menuItems = await evaluate(`[...document.querySelectorAll('.context-menu-item')].map(e => e.textContent.trim())`)
check(menuItems.length > 0, '右键菜单打开了', menuItems.slice(0, 5).join(' | '))
// 点第一个含「打开」的项
const openLabel = menuItems.find(t => /打开/.test(t))
if (openLabel) {
  const clicked = await evaluate(`(() => {
    const el = [...document.querySelectorAll('.context-menu-item')].find(e => /打开/.test(e.textContent));
    if (!el) return false;
    const r = el.getBoundingClientRect();
    window.__menuPt = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    return true;
  })()`)
  if (clicked) {
    const mp = await evaluate('window.__menuPt')
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mp.x, y: mp.y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mp.x, y: mp.y, button: 'left', clickCount: 1 })
    await sleep(2200)
  }
} else {
  console.log('  （菜单里没找到含「打开」的项，跳过）')
}
const afterRight = await evaluate('location.href').catch(() => '(不可用)')
const openedRight = await evaluate('window.__opened')
const targetsRight = (await send('Target.getTargets')).targetInfos
const newRight = targetsRight.filter(t => !beforeRight.includes(t.targetId) && t.type === 'page')
check(afterRight === before.href, '右键菜单打开后当前页也没被导航走')
check(Boolean(openedRight && openedRight.length >= 1), '右键菜单同样走新标签页链接导航',
  (openedRight || []).join(', '))
check(newRight.length >= 1, '右键菜单确实新开了页', newRight.map(t => t.url).join(', '))

/* ---------- 汇总 ---------- */
const failed = results.filter(r => !r).length
console.log('\n──────────────────────────────')
if (failed === 0) {
  console.log(`✅ 卡片打开行为验收全部通过：${results.length} 项`)
  ws.close()
} else {
  console.log(`❌ 卡片打开行为验收：${results.length - failed} 通过 / ${failed} 失败`)
  ws.close()
  process.exit(1)
}
