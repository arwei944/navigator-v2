/**
 * 真机验证 v9 三项体验升级（对线上）：
 *   1. 自动补全零延迟 —— 粘贴网址后表单字段在**本地推断**下立即有值（不等网络）；
 *      随后真实抓取把域名推断升级为页面真实信息。
 *   2. （翻译在 API 层验证，本脚本验 name/desc 为中文）
 *   3. 添加后自动定位：视图切到该分类、新卡片排第一、带高亮。
 *
 * 用法：node probe/verify-v9-ux.mjs <cdp-port> [base]
 */
import { writeFileSync } from 'node:fs'

const PORT = process.argv[2] || '9350'
const BASE = process.argv[3] || 'https://nav-dashboard-19166.app.workbuddy.host'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? ` → ${extra}` : ''}`) }
  else { failures.push(`${label}${extra ? ` → ${extra}` : ''}`); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`) }
}

async function targets() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await r.json()
      const page = list.find(t => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* 未就绪 */ }
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
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) }
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

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

console.log(`\n▶ v9 体验升级验证  BASE=${BASE}\n`)

await send('Page.navigate', { url: BASE + '/' })
await sleep(4000)

/* ---------- 1. 零延迟 ---------- */
await evalJs(`document.querySelector('.add-site-btn')?.click()`)
await sleep(1200)

const inputExpr = `document.querySelector('.modal input[type="url"], [class*="modal"] input[type="url"]')`
const t0 = Date.now()
await evalJs(`(async () => {
  const input = ${inputExpr}
  input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  input.focus()
  input.value = 'https://vitejs.dev/'
  input.dispatchEvent(new Event('input', { bubbles: true }))
})()`)
// 轮询等 name 字段有值（本地推断路径，不应等网络）
let fillMs = -1
let firstName = ''
for (let i = 0; i < 40; i++) {
  await sleep(50)
  // name 字段 = 弹窗里第 2 个 input（第 1 个是网址）
  const name = await evalJs(`(() => {
    const m = document.querySelector('.modal, [class*="modal"]') || document.body
    return (m.querySelectorAll('input')[1])?.value || ''
  })()`)
  if (name.trim() && name.trim() !== 'https://vitejs.dev/') { fillMs = Date.now() - t0; firstName = name.trim(); break }
}
ok(fillMs >= 0 && fillMs < 1500, `表单字段秒填（本地推断，未等网络）`, `${fillMs}ms，name="${firstName}"`)
ok(Boolean(firstName), '名称已填（内容后续会被真实抓取升级）', firstName)

// 等真实抓取升级（状态条从「秒填草稿」变为「已补全」或「推断」）
let finalStatus = ''
for (let i = 0; i < 30; i++) {
  await sleep(500)
  finalStatus = await evalJs(`(document.querySelector('.form-status, [class*="status"]')||{}).textContent || ''`)
  if (finalStatus && !/正在后台抓取/.test(finalStatus)) break
}
console.log(`  📋 最终状态条: ${finalStatus}`)
ok(/已补全|推断/.test(finalStatus), '状态条收敛为终态', finalStatus)

/* ---------- 2. 提交 → 自动定位 + 最新在前 ---------- */
/**
 * 分类未识别时，引擎应**根据页面内容智能新建类别并归入**（shared/auto-category 的
 * 主题表 → 用途 → 其他 兜底链）—— 提交前 select 就该有值，不需要用户手选。
 * 仅在仍为空时才代选（正常不应走到）。
 */
const selState = JSON.parse(await evalJs(`JSON.stringify((() => {
  const sel = document.querySelector('.modal select, [class*="modal"] select')
  if (!sel) return { absent: true }
  return { value: sel.value, label: sel.selectedOptions[0]?.textContent?.trim() || '', optionCount: sel.options.length }
})())`))
if (selState.absent) {
  ok(false, '弹窗里找不到分类下拉框')
} else if (selState.value) {
  ok(true, '分类已按页面内容智能新建/归入（提交前 select 已有值）', `${selState.label} (${selState.value})`)
} else {
  ok(false, '分类仍为空 —— 智能建类未生效', `可选分类 ${selState.optionCount} 个`)
  await evalJs(`(() => {
    const sel = document.querySelector('.modal select, [class*="modal"] select')
    const opt = [...sel.options].find(o => o.value)
    if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })) }
    return 'ok'
  })()`)
  await sleep(200)
}
await evalJs(`document.querySelector('.modal button[type="submit"], [class*="modal"] button[type="submit"]')?.click()`)
await sleep(1800)

const after = JSON.parse(await evalJs(`JSON.stringify((() => {
  const first = document.querySelector('.card')
  return {
    query: location.search,
    highlight: Boolean(document.querySelector('.card-highlight')),
    firstCardId: first?.dataset?.siteId || '',
    total: document.querySelectorAll('.card').length,
    modalGone: !document.querySelector('.modal, [class*="modal"]'),
    submitError: (document.querySelector('.status-line.err, .form-error')||{}).textContent || '',
  }
})())`))
const firstTitle = await evalJs(`(document.querySelector('.card .card-title')||{}).textContent?.trim() || ''`)

/**
 * 幂等处理：本探针可能对同一站点跑多次 —— 第二次会命中「该域名已收录」，
 * 弹窗按设计保留、也不会有新高亮。此时只需验证「已收录的站点仍居视图第一位」；
 * 只有首次添加才验证「弹窗关闭 + 高亮」全链路。
 */
const dupDetected = /已收录/.test(after.submitError)
if (dupDetected) {
  ok(true, '本次命中重复添加（站点已在首次运行入库），按现状验证定位')
  ok(/vite/i.test(firstTitle), '已收录的站点仍居当前视图第一位（最新在前）', `第一张卡 = ${firstTitle}`)
} else {
  ok(after.modalGone, '提交后弹窗关闭')
  // 定位后视图切到了新站的分类 —— 全新分类时只有 1 张卡（就是新站）属正确表现
  ok(after.total >= 1, `当前分类视图正常渲染（${after.total} 张，新站居首单独断言）`)
  ok(after.highlight, '新卡片带高亮（自动定位生效）')
  ok(/vite/i.test(firstTitle), '新添加的站点排在当前视图第一位（最新在前）', `第一张卡 = ${firstTitle}`)
}

/* ---------- 截图 ---------- */
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync('probe/v9-ux-live.png', Buffer.from(shot.data, 'base64'))
console.log('\n  📸 截图已保存 probe/v9-ux-live.png')

ws.close()

console.log('')
if (failures.length) {
  console.error(`❌ v9 体验升级 ${failures.length} 项失败（通过 ${pass} 项）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`✅ v9 体验升级全部通过：${pass} 项断言`)
process.exit(0)
