/**
 * 全能框真机验证（零依赖 CDP，Node 22 内置 WebSocket / fetch）。
 *
 * 要点：Emulation.setDeviceMetricsOverride 是会话级的，跨连接失效——
 * 设视口、导航、求值、截图必须全在**同一条 WebSocket 连接**里连续做完。
 */
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'

// vite preview 只绑 [::1]，用 localhost（Chrome 会解析到 ::1）而不是 127.0.0.1
const BASE = 'http://localhost:4173'
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

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  const buf = Buffer.from(r.data, 'base64')
  writeFileSync(OUT + name, buf)
  console.log('  shot →', name, buf.length, 'bytes')
  return OUT + name
}

async function waitFor(sel, timeout = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const ok = await evaluate(`!!document.querySelector(${JSON.stringify(sel)})`).catch(() => false)
    if (ok) return true
    await sleep(300)
  }
  return false
}

/** 往输入框里打字：直接改 value 派发 input 不够，Vue 的 v-model 与 focus 都要照顾到 */
async function type(sel, text) {
  await evaluate(`
    (() => {
      const el = document.querySelector(${JSON.stringify(sel)})
      if (!el) return 'no-input'
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      el.focus()
      el.value = ${JSON.stringify(text)}
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return 'ok'
    })()
  `)
  await sleep(450)
}

const results = []
function check(label, ok, extra = '') {
  results.push({ label, ok, extra })
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`)
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
  console.log('已连接 CDP')

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

  /* ── 1. 首页：全能框搜命令（拼音） ── */
  console.log('\n[1] 首页：拼音搜命令 zhuti')
  await send('Page.navigate', { url: BASE + '/' })
  await sleep(2500)
  check('首页挂载', await waitFor('.unified-search-input'))

  // PWA 会注册 Service Worker 并缓存上一版 bundle —— 不清掉就会拿旧代码验证新改动，
  // 表现是「明明改了，页面行为却没变」。清完必须 reload 一次才生效。
  const sw = await evaluate(`(async () => {
    if (!navigator.serviceWorker) return 'no-sw'
    const rs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(rs.map(r => r.unregister()))
    if (window.caches) for (const k of await caches.keys()) await caches.delete(k)
    return 'cleared:' + rs.length
  })()`)
  console.log('  SW:', sw)
  await send('Page.navigate', { url: BASE + '/' })
  await sleep(2500)
  await waitFor('.unified-search-input')

  const siteCount = await evaluate(`(window.__nav_sites_len__ = document.querySelectorAll('.site-card').length)`).catch(() => 0)
  console.log('  卡片数:', siteCount)

  await type('.unified-search-input', 'zhuti')
  const zhuti = await evaluate(`
    (() => {
      const rows = [...document.querySelectorAll('.omni-item')]
      return rows.map(r => ({
        title: r.querySelector('.omni-item-title')?.textContent?.trim(),
        sub: r.querySelector('.omni-item-sub')?.textContent?.trim(),
        group: r.closest('.omni-group')?.querySelector('.omni-group-label')?.textContent?.trim()
      }))
    })()
  `)
  console.log('  结果:', JSON.stringify(zhuti, null, 1))
  check('zhuti 命中「切换主题」命令', zhuti.some(x => /切换主题/.test(x.title || '')))
  const zhutiGroups = await evaluate(`[...document.querySelectorAll('.omni-group-label')].map(e => e.textContent.trim())`)
  console.log('  分组顺序:', zhutiGroups.join(' → '))
  const vi = zhutiGroups.indexOf('视图')
  const si = zhutiGroups.indexOf('站点')
  check('命令精确命中时被提到站点组之前', vi !== -1 && (si === -1 || vi < si), zhutiGroups.join('/'))
  await shot('omni-1-zhuti.png')

  /* ── 2. 混合结果：chat ── */
  console.log('\n[2] 混合检索 chat（站点 + 分类 + 站外）')
  await evaluate(`(() => { const el = document.querySelector('.unified-search-input'); el.value=''; el.dispatchEvent(new Event('input',{bubbles:true})); return 1 })()`)
  await type('.unified-search-input', 'chat')
  const chat = await evaluate(`
    (() => [...document.querySelectorAll('.omni-group')].map(g => ({
      group: g.querySelector('.omni-group-label')?.textContent?.trim(),
      items: [...g.querySelectorAll('.omni-item')].map(r => r.querySelector('.omni-item-title')?.textContent?.trim())
    })))()
  `)
  console.log('  分组:', JSON.stringify(chat, null, 1))
  if (!chat.length) {
    console.log('  [诊断]', await evaluate(`JSON.stringify({
      val: document.querySelector('.unified-search-input')?.value,
      open: !!document.querySelector('.search-suggestions'),
      cards: document.querySelectorAll('.site-card').length,
      target: document.querySelector('.unified-search-input') ? 'found' : 'missing',
      activeEl: document.activeElement?.className
    })`))
  }
  check('chat 给出多个分组', chat.length >= 2, `${chat.length} 组`)
  check('站点组排在首个（inline 站点优先）', /站点/.test(chat[0]?.group || ''))
  await shot('omni-2-chat.png')

  /* ── 3. 站点二级页（Tab 展开操作） ── */
  console.log('\n[3] Tab 展开站点操作页')
  await evaluate(`
    (() => {
      const el = document.querySelector('.unified-search-input')
      const e = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
      el.dispatchEvent(e)
      const t = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      el.dispatchEvent(t)
      return 1
    })()
  `)
  await sleep(400)
  let crumb = await evaluate(`document.querySelector('.omni-crumb-text')?.textContent?.trim() || ''`)
  if (!crumb) {
    // 首项可能不是站点，往下找到第一条站点再展开
    for (let i = 0; i < 6 && !crumb; i++) {
      await evaluate(`(() => { const el = document.querySelector('.unified-search-input'); el.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true})); el.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})); return 1 })()`)
      await sleep(250)
      crumb = await evaluate(`document.querySelector('.omni-crumb-text')?.textContent?.trim() || ''`)
    }
  }
  console.log('  面包屑:', crumb)
  check('Tab 进入站点操作页', Boolean(crumb), crumb)
  const acts = await evaluate(`[...document.querySelectorAll('.omni-item-title')].map(e => e.textContent.trim())`)
  console.log('  操作:', JSON.stringify(acts))
  check('操作页含收藏/置顶/归档/编辑/删除', ['收藏', '置顶', '归档', '编辑', '删除'].every(k => acts.some(a => a.includes(k))))
  await shot('omni-3-site-actions.png')

  /* ── 4. Ctrl+K 命令面板 ── */
  console.log('\n[4] Ctrl+K 打开命令面板')
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(300)
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))`)
  await sleep(600)
  const panel = await evaluate(`(() => { const p = document.querySelector('.cp-panel'); return p ? { visible: true, groups: [...p.querySelectorAll('.omni-group-label')].map(e=>e.textContent.trim()) } : { visible: false } })()`)
  console.log('  面板:', JSON.stringify(panel))
  check('Ctrl+K 打开面板', panel.visible === true)
  check('空输入给默认视图（最近/常用）', (panel.groups || []).length > 0, (panel.groups || []).join('/'))
  check('空输入不显示「没有找到匹配结果」', await evaluate(`!document.querySelector('.cp-panel .omni-empty')`) === true)
  check('Ctrl+K 时顶部内联下拉自动收起', await evaluate(`!document.querySelector('.search-suggestions')`) === true)
  await shot('omni-4-palette.png')

  await evaluate(`(() => { const p = document.querySelector('.cp-input'); p.value='zhuti'; p.dispatchEvent(new Event('input',{bubbles:true})); return 1 })()`)
  await sleep(400)
  const p2 = await evaluate(`[...document.querySelectorAll('.cp-panel .omni-item-title')].map(e=>e.textContent.trim())`)
  console.log('  面板搜 zhuti:', JSON.stringify(p2))
  check('面板内拼音也能搜到命令', p2.some(t => /切换主题/.test(t)))
  await shot('omni-5-palette-zhuti.png')

  /* ── 5. /admin 下 Ctrl+K（此前完全无效） ── */
  console.log('\n[5] /admin 独立页面下 Ctrl+K')
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(300)
  await send('Page.navigate', { url: BASE + '/admin' })
  await sleep(2500)
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))`)
  await sleep(700)
  const adminPanel = await evaluate(`!!document.querySelector('.cp-panel')`)
  check('/admin 下 Ctrl+K 可用', adminPanel === true)
  await shot('omni-6-admin-palette.png')

  /* ── 6. 深色主题 ── */
  console.log('\n[6] 深色主题渲染')
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(200)
  await evaluate(`(() => { const p = document.querySelector('.cp-input'); if (p) { p.value='zhuti'; p.dispatchEvent(new Event('input',{bubbles:true})) } return 1 })()`)
  await sleep(300)
  await shot('omni-7-dark-palette.png')

  await send('Page.navigate', { url: BASE + '/' })
  await sleep(2500)
  // 主题被 localStorage 记住，起点不一定是浅色 —— 断言「变了」而不是「等于 dark」
  const themeBefore = await evaluate(`document.documentElement.getAttribute('data-theme')`)
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true, cancelable: true }))`)
  await sleep(700)
  let theme = await evaluate(`document.documentElement.getAttribute('data-theme')`)
  console.log(`  data-theme: ${themeBefore} → ${theme}`)
  check('Ctrl+D 切换主题生效', Boolean(theme) && theme !== themeBefore, `${themeBefore} → ${theme}`)
  // 深色截图需要有深色可截：没落在 dark 就再切一次
  if (theme !== 'dark') {
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true, cancelable: true }))`)
    await sleep(700)
    theme = await evaluate(`document.documentElement.getAttribute('data-theme')`)
    console.log('  再切一次 →', theme)
  }
  await type('.unified-search-input', 'chat')
  await shot('omni-8-dark-inline.png')

  /* ── 7. 移动端 ── */
  console.log('\n[7] 移动端 390px')
  // mobile 必须为 false：mobile:true 时媒体查询按更宽的布局视口评估（实测 mq768=false），
  // 与真机窄屏行为不符，会掩盖真实的窄屏布局问题。
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  await sleep(600)
  await send('Page.navigate', { url: BASE + '/' })
  await sleep(2500)
  await type('.unified-search-input', 'zhuti')
  const box = await evaluate(`(() => {
    const d = document.querySelector('.search-suggestions')
    const w = document.querySelector('.search-input-wrap')
    return d ? {
      mq768: matchMedia('(max-width: 768px)').matches,
      vw: innerWidth, docScrollW: document.documentElement.scrollWidth,
      sugg: [Math.round(d.getBoundingClientRect().left), Math.round(d.getBoundingClientRect().right)],
      wrap: [Math.round(w.getBoundingClientRect().left), Math.round(w.getBoundingClientRect().right)]
    } : null
  })()`)
  console.log('  几何:', JSON.stringify(box))
  check('窄屏媒体查询生效', box?.mq768 === true)
  check('下拉不超出视口', !!box && box.sugg[0] >= -1 && box.sugg[1] <= box.vw + 1, JSON.stringify(box?.sugg))
  check('输入框不超出视口', !!box && box.wrap[1] <= box.vw + 1, JSON.stringify(box?.wrap))
  check('页面无横向滚动', !!box && box.docScrollW <= box.vw + 1, `scrollW=${box?.docScrollW}`)
  await shot('omni-9-mobile.png')

  const failed = results.filter(r => !r.ok)
  console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
  if (failed.length) { console.log('失败项：'); failed.forEach(f => console.log('  -', f.label, f.extra)) }
  ws.close()
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error('脚本异常:', e.message); process.exit(2) })
