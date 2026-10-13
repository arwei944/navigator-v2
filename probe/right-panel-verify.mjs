/**
 * 真机验证：右边栏设置面板（显示模式 / 区块显隐 / 内联编辑 / 编辑期冻结）。
 *
 * 为什么必须真机：
 *  - 「悬停移开后面板还在吗」是一条**时间上**的行为 —— 纯函数真值表能证明
 *    `reduceRightPanel` 返回对，但证不了组件真的没在 mouseleave 时清空；
 *  - 内联编辑保存后要同时更新**面板**与**卡片**两处，跨 store（sites → rebuild → 新对象）
 *    的链路只有真点一次才看得见（这里踩过：面板攥着旧对象引用，保存后停在旧值）；
 *  - 编辑期冻结（frozen）防的是"鼠标划过卡片"，同样只能在真实事件流里验。
 *
 * 覆盖：默认 hover 模式移开保留 / 内联编辑保存并同步到卡片 / 编辑期悬停不抢走面板 /
 *      取消不改数据 / 区块开关生效 / click 模式忽略悬停 / pin 模式 toggle + 图钉。
 *
 * 前置：无（探针自己拉静态服务与浏览器，跑完自己收掉）。
 * 用法：node probe/right-panel-verify.mjs [cdp-port] [base]
 *
 * **为什么自拉自收**：手工用 `chrome ... &` 串联在本机不可靠 —— 后台任务会被回收、
 * `kill` 打错 PID 会留下一堆 headless 残留（本机曾累积到 40+），而浏览器半死时探针会
 * 无限挂住。自己拉就只有一个 owner。换浏览器路径用环境变量 `CHROME_PATH`。
 */
import { writeFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = process.argv[2] || '9371'
const BASE = (process.argv[3] || 'http://127.0.0.1:4199').replace(/\/+$/, '')

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? ` → ${extra}` : ''}`) }
  else { failures.push(`${label}${extra ? ` → ${extra}` : ''}`); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`) }
}

/* ---------------- 静态服务 + 浏览器：自己拉、自己收 ---------------- */

const alive = async (url) => {
  try { await fetch(url, { signal: AbortSignal.timeout(1200) }); return true } catch { return false }
}

/** 本地 base 且没在监听时，自己起一个（复刻宿主行为的 probe/static-server.mjs） */
let serverProc = null
const basePort = (BASE.match(/^http:\/\/127\.0\.0\.1:(\d+)/) || [])[1]
if (basePort && !(await alive(BASE + '/'))) {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    console.error('没有 dist 产物，先跑 npm run build')
    process.exit(2)
  }
  serverProc = spawn(process.execPath, [join(HERE, 'static-server.mjs'), basePort, 'dist'],
    { cwd: ROOT, stdio: 'ignore', detached: false, windowsHide: true })
  console.log(`  （探针自拉静态服务，PID ${serverProc.pid}）`)
  if (!(await waitFor__alive(BASE + '/', 8000))) {
    console.error(`静态服务没起来：${BASE}`)
    process.exit(2)
  }
}
async function waitFor__alive(url, ms) {
  const dl = Date.now() + ms
  while (Date.now() < dl) {
    if (await alive(url)) return true
    await new Promise(s => setTimeout(s, 250))
  }
  return false
}

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let chromeProc = null
if (!(await alive(`http://127.0.0.1:${PORT}/json/version`))) {
  if (!existsSync(CHROME)) {
    console.error(`找不到浏览器：${CHROME}\n可用 CHROME_PATH 指定路径，或先自己起一个带 --remote-debugging-port=${PORT} 的实例。`)
    process.exit(2)
  }
  chromeProc = spawn(CHROME, [
    // 默认无头；`HEADFUL=1` 切有头 —— 本机 headless 的 CDP 会在 25s~110s 之间随机掉线
    // （位置随机、与页面无关），整轮偏长时用有头明显更稳（实测 ≥151s 正常）。
    ...(process.env.HEADFUL === '1' ? [] : ['--headless=new']),
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(tmpdir(), 'nav-v2-probe-rightpanel')}`,
    '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--window-size=1440,1000', 'about:blank',
  ], { stdio: 'ignore', detached: false, windowsHide: true })
  console.log(`  （探针自拉浏览器${process.env.HEADFUL === '1' ? '·有头' : ''}，PID ${chromeProc.pid}）`)
}

const cleanup = () => {
  for (const p of [chromeProc, serverProc]) {
    try { if (p && !p.killed) p.kill() } catch { /* 已退出 */ }
  }
}
process.on('exit', cleanup)

/**
 * 整体看门狗：本机 headless Chrome 会在 25s~110s 之间随机掉线，掉线后 CDP 连接
 * 既不该回消息也不关闭。单条请求有超时（见 send），但只要还有别的句柄挂着，
 * node 就不会退出 —— 实测出现过「进程活着、什么都不做、6 分钟不结束」。
 * 用硬时限把这种情况变成一次明确的失败，而不是留一个僵尸进程等人发现。
 */
const WATCHDOG_MS = 150000
const watchdog = setTimeout(() => {
  console.error(`\n❌ 探针整体超时（${WATCHDOG_MS}ms）—— 浏览器多半已掉线。强制退出。`)
  cleanup()
  process.exit(3)
}, WATCHDOG_MS)

async function target() {
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

const t = await target()
const ws = new WebSocket(t.webSocketDebuggerUrl)
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

/** 单条 CDP 请求的超时：见 send() 的注释 —— 掉线时必须快速失败，不能挂死 */
const CDP_TIMEOUT_MS = 15000

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId
  // CDP 请求**必须带超时**：本机 headless Chrome 会在 25s~110s 之间随机掉线（实测位置随机、
  // 与页面无关），掉线后 `ws` 既不回消息也不关闭 —— 没有这道超时，Promise 永不 settle，
  // 上面的 waitFor 的 try/catch 捕不到挂起（那不是 reject），整个探针会**永久挂住**。
  // 加超时后表现为「明确报错退出」，重跑即可，而不是留一个僵尸进程。
  const timer = setTimeout(() => {
    pending.delete(id)
    reject(new Error(`CDP 超时（${method}，${CDP_TIMEOUT_MS}ms）—— 浏览器多半已掉线`))
  }, CDP_TIMEOUT_MS)
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
const sleep = ms => new Promise(s => setTimeout(s, ms))

/** 轮询等待，替代固定 sleep（首屏要拉入口 chunk + 站点数据 + 异步设置抽屉） */
async function waitFor(expr, timeout = 15000, label = expr) {
  const deadline = Date.now() + timeout
  for (;;) {
    let v = false
    try { v = await evalJs(`(() => { try { return !!(${expr}) } catch { return false } })()`) } catch { /* 导航中文档销毁，下轮再试 */ }
    if (v) return true
    if (Date.now() > deadline) {
      failures.push(`等待超时：${label}`)
      console.log(`  ❌ 等待超时：${label}`)
      return false
    }
    await sleep(150)
  }
}

const J = e => `JSON.stringify((() => { try { return (${e}) } catch { return null } })())`
const jsonOf = async e => { const s = await evalJs(J(e)); return s ? JSON.parse(s) : null }

const CARD = i => `document.querySelectorAll('.card')[${i}]`

/** 悬停 / 移开：mouseenter 与 mouseleave 都不冒泡，直接派发到卡片本身 */
const hoverCard = i => evalJs(`(() => { const c = ${CARD(i)}; if (!c) return false; c.dispatchEvent(new MouseEvent('mouseenter')); return true })()`)
const leaveCard = i => evalJs(`(() => { const c = ${CARD(i)}; if (!c) return false; c.dispatchEvent(new MouseEvent('mouseleave')); return true })()`)

/** 右键卡片并点菜单项（真实 DOM 事件，走 SiteCard → contextMenu store → Host） */
async function contextAction(i, label) {
  await evalJs(`(() => { const c = ${CARD(i)}; if (c) c.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 120 })) })()`)
  const appeared = await waitFor(`document.querySelector('.context-menu')`, 5000, '右键菜单出现')
  if (!appeared) return false
  const clicked = await evalJs(`(() => {
    const b = [...document.querySelectorAll('.context-menu-item')].find(x => x.textContent.trim() === ${JSON.stringify(label)})
    if (!b) return false
    b.click()
    return true
  })()`)
  await sleep(120)
  return clicked
}

/** 面板现状快照：名字 / 是否编辑态 / 是否有图钉 / 区块标签 */
const panelState = () => jsonOf(`(() => {
  const n = document.querySelector('.site-detail-panel .detail-name')
  return {
    name: n ? n.textContent.trim() : null,
    editing: !!document.querySelector('.detail-edit'),
    hasPin: !!document.querySelector('.right-pin-toggle'),
    sections: [...document.querySelectorAll('.site-detail-panel .section-label')].map(e => e.textContent.trim()),
    hasEmpty: !!document.querySelector('.right-sidebar .empty-state'),
  }
})()`)

const cardName = i => evalJs(`(() => { const c = ${CARD(i)}; const n = c && c.querySelector('.card-title'); return n ? n.textContent.trim() : null })()`)

/* ---- 设置抽屉 ---- */
async function openSettings() {
  await evalJs(`document.querySelector('.settings-btn')?.click()`)
  return waitFor(`document.querySelector('.settings-modal')`, 12000, '设置抽屉出现')
}
async function closeSettings() {
  await evalJs(`document.querySelector('.settings-close')?.click()`)
  return waitFor(`!document.querySelector('.settings-modal')`, 6000, '设置抽屉关闭')
}
const clickMode = label => evalJs(`(() => {
  const b = [...document.querySelectorAll('.settings-modal .theme-toggle-btn')].find(x => x.textContent.trim() === ${JSON.stringify(label)})
  if (!b) return false
  b.click()
  return true
})()`)
/** 按标签精确点某个区块开关（设置面板里「详细区块」那一组） */
const toggleSection = label => evalJs(`(() => {
  const row = [...document.querySelectorAll('.settings-modal .setting-toggle')]
    .find(r => r.querySelector('.setting-label')?.textContent.trim() === ${JSON.stringify(label)})
  if (!row) return false
  const inp = row.querySelector('input[type=checkbox]')
  inp.checked = !inp.checked
  inp.dispatchEvent(new Event('change', { bubbles: true }))
  return true
})()`)
/**
 * 设置里选「进入页面时」的折叠策略。
 *
 * **必须按标签定位到那一行**，不能用 `querySelector('.setting-select')` ——
 * 设置面板里 `DisplaySection`（含「默认排序」下拉）排在右边栏分区**之前**，
 * 全局取第一个会拿到排序框，然后静默地什么都没改（本探针初版就是这么假通过的）。
 */
const selectCollapse = label => evalJs(`(() => {
  const row = [...document.querySelectorAll('.settings-modal .setting-row')]
    .find(r => r.querySelector('.setting-label')?.textContent.trim() === '进入页面时')
  if (!row) return false
  const sel = row.querySelector('select')
  if (!sel) return false
  const opt = [...sel.options].find(o => o.textContent.trim() === ${JSON.stringify(label)})
  if (!opt) return false
  sel.value = opt.value
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  return true
})()`)

/* ==================== 开跑 ==================== */

console.log('\n▸ 右边栏设置面板 · 真机验证')

await send('Page.enable')
await send('Page.navigate', { url: BASE + '/' })
const ready = await waitFor(`document.querySelectorAll('.card').length >= 3`, 25000, '站点卡片渲染')
ok(ready, '首屏渲染出站点卡片')
if (!ready) {
  console.log(`\n❌ ${failures.length} 项失败`)
  process.exit(1)
}

// 每次刷新都从干净偏好开始：探针上一轮可能把模式改成 pin，残留会污染下一次运行
await evalJs(`(() => { try { localStorage.removeItem('nav-preferences') } catch {} })()`)

/* ---------- 1. 设置入口与分区存在 ---------- */
await openSettings()
const sectionHeaders = await jsonOf(`[...document.querySelectorAll('.settings-modal .section-header')].map(e => e.textContent.trim())`)
ok((sectionHeaders || []).some(h => h.includes('右边栏')), '设置抽屉里有「右边栏（站点详情）」分区', (sectionHeaders || []).join(' | '))
const sectionToggles = await jsonOf(`[...document.querySelectorAll('.settings-modal .setting-toggle .setting-label')].map(e => e.textContent.trim())`)
const wantSections = ['简介', '别名', '用途', '备注', '使用统计', '时间线', '快速操作']
ok(wantSections.every(s => (sectionToggles || []).includes(s)), '七个区块开关都在设置里', (sectionToggles || []).join(' | '))
await closeSettings()

/* ---------- 2. 默认 hover：悬停即显示，移开**保留**（本次要修的核心毛病） ---------- */
await hoverCard(0)
let st = await waitFor(`document.querySelector('.site-detail-panel .detail-name')`, 6000, '悬停后面板出现') && await panelState()
const firstName = await cardName(0)
ok(st && st.name === firstName, 'hover 模式：悬停卡片后面板显示该站', `${st && st.name} vs ${firstName}`)

await leaveCard(0)
await sleep(400)
st = await panelState()
ok(st && st.name === firstName, '★ 鼠标移开后面板**保留**（旧行为是立刻清空）', st && st.name)
ok(st && !st.hasEmpty, '★ 移开后不是空状态')

/* ---------- 3. 内联编辑：保存生效并同步到卡片 ---------- */
const edited = `演示站-${Date.now() % 100000}`
await evalJs(`document.querySelector('.detail-edit-btn')?.click()`)
ok(await waitFor(`document.querySelector('.detail-edit')`, 6000, '编辑态出现'), '点铅笔进入编辑态')

const wroteName = await evalJs(`(() => {
  const g = [...document.querySelectorAll('.detail-edit .form-group')]
    .find(x => x.querySelector('.form-label')?.textContent.trim().startsWith('名称'))
  if (!g) return false
  const el = g.querySelector('input')
  el.value = ${JSON.stringify(edited)}
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
ok(wroteName, '编辑态能写入名称')

// 编辑期冻结：此时悬停别的卡片不得把面板抢走（否则未保存的改动当场丢失）
await hoverCard(1)
await sleep(300)
st = await panelState()
ok(st && st.editing === true, '★ 编辑期间悬停别的卡片，面板仍停在编辑态（frozen 生效）')

const saved = await evalJs(`(() => { const b = document.querySelector('.detail-edit .edit-btn.primary'); if (!b) return false; b.click(); return true })()`)
ok(saved, '点保存')
await sleep(400)
st = await panelState()
ok(st && st.editing === false, '保存后退出编辑态')
ok(st && st.name === edited, '★ 保存后面板显示新名称（不是旧对象的值）', st && st.name)
const cname = await cardName(0)
ok(cname === edited, '★ 保存后卡片名称同步更新', `${cname}`)

/* ---------- 4. 取消不改数据 ---------- */
await evalJs(`document.querySelector('.detail-edit-btn')?.click()`)
await waitFor(`document.querySelector('.detail-edit')`, 6000, '再次进入编辑态')
await evalJs(`(() => {
  const g = [...document.querySelectorAll('.detail-edit .form-group')].find(x => x.querySelector('.form-label')?.textContent.trim().startsWith('名称'))
  if (!g) return false
  const el = g.querySelector('input'); el.value = '不该保存的名字'; el.dispatchEvent(new Event('input', { bubbles: true })); return true
})()`)
await evalJs(`[...document.querySelectorAll('.detail-edit .edit-btn')].find(b => b.textContent.trim() === '取消')?.click()`)
await sleep(300)
st = await panelState()
ok(st && st.name === edited, '取消后名称回到保存值（未写入"不该保存的名字"）', st && st.name)
ok((await cardName(0)) === edited, '取消不影响卡片')

/* ---------- 5. 区块开关：关掉备注即消失，恢复后回来 ---------- */
ok((st.sections || []).some(s => s.startsWith('备注')), '默认备注区块存在')
await openSettings()
await toggleSection('备注')
await toggleSection('时间线')
await closeSettings()
await sleep(350)
st = await panelState()
ok(!(st.sections || []).some(s => s.startsWith('备注')), '★ 关掉「备注」后该区块消失', (st.sections || []).join(' | '))
ok(!(st.sections || []).some(s => s.startsWith('时间线')), '关掉「时间线」后该区块消失')
ok((st.sections || []).some(s => s.startsWith('简介')), '未关掉的「简介」仍在（开关是逐项生效，不是一刀切）')

await openSettings()
await toggleSection('备注')
await toggleSection('时间线')
await closeSettings()
await sleep(350)
st = await panelState()
ok((st.sections || []).some(s => s.startsWith('备注')), '恢复开关后备注区块回来')
ok((st.sections || []).some(s => s.startsWith('时间线')), '恢复开关后时间线区块回来')

/* ---------- 6. click 模式：忽略悬停，主动打开才切换 ---------- */
await openSettings()
await clickMode('点击驱动')
await closeSettings()
await sleep(250)

const before = (await panelState()).name
await hoverCard(2)
await sleep(400)
st = await panelState()
ok(st.name === before, '★ click 模式：悬停不改变面板', `${st.name} vs ${before}`)

await contextAction(2, '查看详情')
await sleep(400)
st = await panelState()
const third = await cardName(2)
ok(st.name === third, '★ click 模式：右键「查看详情」才切换', `${st.name} vs ${third}`)
ok(!st.hasPin, 'click 模式不显示图钉按钮')

/* ---------- 7. pin 模式：图钉 + 主动打开即 toggle ---------- */
await openSettings()
await clickMode('图钉固定')
await closeSettings()
await sleep(250)

await contextAction(1, '查看详情')
await sleep(400)
st = await panelState()
const second = await cardName(1)
ok(st.name === second, 'pin 模式：主动打开钉住目标', `${st.name} vs ${second}`)
ok(st.hasPin === true, '★ pin 模式显示图钉按钮（与 click 的唯一可见差别）')

await contextAction(1, '查看详情')
await sleep(400)
st = await panelState()
ok(st.name === null && st.hasEmpty, '★ pin 模式：再选同一张即收起（toggle）', st.name)

// 图钉按钮本身也能拔掉
await contextAction(1, '查看详情')
await sleep(350)
await evalJs(`document.querySelector('.right-pin-toggle')?.click()`)
await sleep(350)
st = await panelState()
ok(st.name === null && st.hasEmpty, '点图钉按钮可拔掉固定')

/* ---------- 8. 折叠策略改动立即生效（不用刷新） ---------- */
await openSettings()
const pickedCollapse = await selectCollapse('折叠（按需展开）')
ok(pickedCollapse === true, '设置里能选中「折叠（按需展开）」策略')
await closeSettings()
await sleep(350)
const collapsedNow = await evalJs(`(() => {
  const a = document.querySelector('.right-sidebar')
  return a ? a.classList.contains('collapsed') : null
})()`)
ok(collapsedNow === true, '★ 把策略改成「每次折叠」后立即折叠（无需刷新页面）', String(collapsedNow))

await openSettings()
const pickedBack = await selectCollapse('展开详情面板')
ok(pickedBack === true, '设置里能选回「展开详情面板」策略')
await clickMode('悬停预览')
await closeSettings()
await sleep(300)
const restored = await evalJs(`(() => {
  const a = document.querySelector('.right-sidebar')
  return a ? a.classList.contains('collapsed') : null
})()`)
ok(restored === false, '改回「展开」后立即展开（恢复默认态）')

/* ---------- 截图 ---------- */
try {
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync('probe/right-panel.png', Buffer.from(shot.data, 'base64'))
  console.log('  📷 截图 → probe/right-panel.png')
} catch (e) {
  console.log(`  ⚠ 截图失败：${e.message}`)
}

/* ==================== 结果 ==================== */
clearTimeout(watchdog)
try { ws.close() } catch { /* 已关闭 */ }
cleanup()
if (failures.length) {
  console.error(`\n❌ 右边栏真机验证 ${failures.length} 项失败（通过 ${pass} 项）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 右边栏真机验证全部通过：${pass} 项`)
// 显式退出：WebSocket / 子进程句柄未必立刻释放，靠事件循环自然结束会挂住
process.exit(0)
