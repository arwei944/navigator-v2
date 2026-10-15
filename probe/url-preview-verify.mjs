/**
 * 真机验证：搜索框的网址预览卡片。
 *
 * 为什么必须真机（单元测试覆盖不了的部分）：
 *  - 「输入像网址 → 下拉顶部出现卡片」是一条跨组件链路（输入 → useOmniBox →
 *    useUrlPreview 抓取 → OmniResults 渲染），纯函数真值表证不了组件真的接上了；
 *  - 抓取是**真网络请求**（/api/metadata），缓存命中 / 失败降级只有真跑一次才知道；
 *  - 徽标三态（已收录 / 抓取中 / 抓取失败）要真的经历一次抓取才能看见。
 *
 * 覆盖：已收录出卡（本地数据 + 已收录徽标）/ 未收录抓取出卡（真网络）/ 普通词不出卡 /
 *      命令前缀不出卡 / 截图存证。
 *
 * 前置：需要 dist 产物（npm run build）。探针自拉 dist/server.js（提供 /api/metadata）
 *       与 headless Chrome，跑完自己收掉。
 * 用法：node probe/url-preview-verify.mjs [cdp-port] [base]
 */
import { writeFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PORT = process.argv[2] || '9391'
const BASE = (process.argv[3] || 'http://127.0.0.1:4212').replace(/\/+$/, '')

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? ` → ${extra}` : ''}`) }
  else { failures.push(`${label}${extra ? ` → ${extra}` : ''}`); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`) }
}

/* ---------------- 服务 + 浏览器：自己拉、自己收 ---------------- */

const alive = async (url) => {
  try { await fetch(url, { signal: AbortSignal.timeout(1200) }); return true } catch { return false }
}
async function waitForAlive(url, ms) {
  const dl = Date.now() + ms
  while (Date.now() < dl) {
    if (await alive(url)) return true
    await new Promise(s => setTimeout(s, 250))
  }
  return false
}

/** dist/server.js 提供静态 + /api/metadata（纯 static-server 给不了抓取接口） */
let serverProc = null
const basePort = (BASE.match(/^http:\/\/127\.0\.0\.1:(\d+)/) || [])[1]
if (basePort && !(await alive(BASE + '/'))) {
  if (!existsSync(join(ROOT, 'dist', 'server.js'))) {
    console.error('没有 dist/server.js，先跑 npm run build')
    process.exit(2)
  }
  serverProc = spawn(process.execPath, [join(ROOT, 'dist', 'server.js')],
    { cwd: ROOT, env: { ...process.env, PORT: basePort }, stdio: 'ignore', windowsHide: true })
  console.log(`  （探针自拉 dist 服务，PID ${serverProc.pid}）`)
  if (!(await waitForAlive(BASE + '/api/health', 15000))) {
    console.error(`dist 服务没起来：${BASE}`)
    process.exit(2)
  }
}

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let chromeProc = null
if (!(await alive(`http://127.0.0.1:${PORT}/json/version`))) {
  if (!existsSync(CHROME)) {
    console.error(`找不到浏览器：${CHROME}（可用 CHROME_PATH 指定）`)
    process.exit(2)
  }
  chromeProc = spawn(CHROME, [
    ...(process.env.HEADFUL === '1' ? [] : ['--headless=new']),
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(tmpdir(), 'nav-v2-probe-urlpreview')}`,
    '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--window-size=1440,1000', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  console.log(`  （探针自拉浏览器${process.env.HEADFUL === '1' ? '·有头' : ''}，PID ${chromeProc.pid}）`)
}

const cleanup = () => {
  for (const p of [chromeProc, serverProc]) {
    try { if (p && !p.killed) p.kill() } catch { /* 已退出 */ }
  }
}
process.on('exit', cleanup)

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

const CDP_TIMEOUT_MS = 15000
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId
  const timer = setTimeout(() => {
    pending.delete(id)
    reject(new Error(`CDP 超时（${method}，${CDP_TIMEOUT_MS}ms）`))
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
const jsonOf = async e => { const s = await evalJs(`JSON.stringify((() => { try { return (${e}) } catch { return null } })())`); return s ? JSON.parse(s) : null }
/** 同 jsonOf，但表达式可返回 Promise（jsonOf 的同步 IIFE 会把 Promise 序列化成 {}） */
const jsonOfAsync = async e => {
  const s = await evalJs(`(async () => { try { return JSON.stringify(await (${e})) } catch { return null } })()`)
  return s ? JSON.parse(s) : null
}

/** 轮询等待表达式为真 */
async function waitFor(expr, timeout = 15000, label = expr) {
  const deadline = Date.now() + timeout
  for (;;) {
    let v = false
    try { v = await evalJs(`(() => { try { return !!(${expr}) } catch { return false } })()`) } catch { /* 导航中文档销毁 */ }
    if (v) return true
    if (Date.now() > deadline) {
      failures.push(`等待超时：${label}`)
      console.log(`  ❌ 等待超时：${label}`)
      return false
    }
    await sleep(150)
  }
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(HERE, name), Buffer.from(r.data, 'base64'))
}

/** 往搜索框输入一段文字（v-model 监听 input 事件，必须 dispatch 才进得去） */
async function type(text) {
  await evalJs(`(() => {
    const el = document.querySelector('.unified-search .search-input')
    if (!el) return false
    // mousedown 与 focus 都要派：无头环境里 focus() 有时拿不到焦点，组件为这种情形
    // 专门留了 onInputPointerDown 兜底（见 UnifiedSearchBox.vue）
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    el.focus()
    el.value = ${JSON.stringify(text)}
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
}

/* ---------------- 验证 ---------------- */

console.log('\n── 前置 ──')
await evalJs(`location.href = ${JSON.stringify(BASE + '/')}`)
await waitFor(`document.querySelector('.unified-search .search-input')`, 15000, '搜索框出现')

// 从站点库拿一个真实已收录域名，保证「已收录」分支与数据无关、每次都成立
const aSite = await jsonOfAsync(`(async () => {
  const r = await fetch('/api/sites'); const j = await r.json()
  const list = j?.sites || j?.data?.sites || []
  return { host: (list[0]?.url || ''), name: (list[0]?.name || '') }
})()`)
ok(Boolean(aSite?.host), '站点库有已收录站点可测', aSite?.host || '')

console.log('\n── 1. 已收录网址 → 本地数据出卡，不必等网络 ──')
await type(aSite.host)
const found = await waitFor(`document.querySelector('.unified-search .omni-item.is-preview .preview-badge.found')`, 4000, '已收录徽标出现')
if (found) {
  const card = await jsonOf(`({
    title: document.querySelector('.unified-search .omni-item.is-preview .omni-item-title')?.textContent?.trim() || '',
    host: document.querySelector('.unified-search .omni-item.is-preview .preview-host')?.textContent?.trim() || '',
    isTop: !!document.querySelector('.unified-search .search-suggestions .omni-group:first-child .omni-item.is-preview'),
    infoCount: document.querySelectorAll('.unified-search .omni-item.is-preview .omni-item-info').length,
    hasInitial: !!document.querySelector('.unified-search .omni-item.is-preview .preview-initial'),
  })`)
  ok(card.title.includes(aSite.name), '卡片标题是站点名', card.title)
  ok(Boolean(card.host), '卡片给出域名', card.host)
  ok(card.isTop, '预览卡片在下拉最顶部')
  // 防回归：预览文本区若和通用文本区同时渲染，标题与副标题会各出现两次（截图逮到过）
  ok(card.infoCount === 1, '卡片只渲染一份文本（标题不重复）', `找到 ${card.infoCount} 份`)
  // 防回归：字母块必须与 favicon **同时存在**（层叠模式）。若改成 v-if/v-else 互斥，
  // 图片加载失败被移除后图标区会留一个空框 —— 线上截图逮到过。
  ok(card.hasInitial, '图标层级里有字母块兜底（加载失败不至于空框）')
  await shot('url-preview-found.png')
} else {
  // 兜底证据：哪怕徽标没等到，也把下拉当前内容打出来，别让失败不可诊断
  const dump = await jsonOf(`document.querySelector('.unified-search .search-suggestions')?.textContent?.slice(0, 200) || '(下拉未展开)'`)
  console.log(`  （下拉内容：${dump}）`)
}

console.log('\n── 2. 未收录网址 → 真抓取，出「这是什么」 ──')
// 动态挑一个「未收录且预期可抓」的公网域名：已收录会走 found 分支（第 1 组测过了）；
// 全命中时退回 example.com，仍有意义 —— 它在本机被 SSRF 判据拦下，正好验失败降级。
const probeHost = await jsonOfAsync(`(async () => {
  // 判据必须与内核的 collected 一致（按**主机名**比对）：库里存在
  // github.com/features/copilot 这种带路径的 url，按整串比会误判成未收录
  const hostnameOf = u => { try { return new URL('https://' + String(u).trim()).hostname.toLowerCase().replace(/^www\\./, '') } catch { return '' } }
  const r = await fetch('/api/sites'); const j = await r.json()
  const hosts = new Set((j.sites || []).map(s => hostnameOf(s.url)).filter(Boolean))
  const cands = ['gitlab.com', 'anthropic.com', 'microsoft.com', 'wikipedia.org']
  return cands.find(c => !hosts.has(c)) || 'example.com'
})()`)
await type('https://' + probeHost)
// 经历过 loading（说明真的发了请求），再等终态
const sawLoading = await waitFor(`!!document.querySelector('.unified-search .omni-item.is-preview .preview-badge.loading')`, 5000, '抓取中徽标出现')
ok(sawLoading, '抓取请求真的发出了（出现过抓取中徽标）')
// 终态判据：卡片在，且徽标不再是「抓取中」。**ready 态本就没有徽标**（三个 v-if 只覆盖
// found/loading/error），所以「徽标不存在」也算终态 —— 只等 `!loading` 会永远等不到。
const settled = await waitFor(
  `(() => {
    const item = document.querySelector('.unified-search .omni-item.is-preview')
    if (!item) return false
    const b = item.querySelector('.preview-badge')
    return !b || !b.classList.contains('loading')
  })()`,
  25000, '抓取终态（ready / error）'
)
if (settled) {
  const card = await jsonOf(`({
    badge: document.querySelector('.unified-search .omni-item.is-preview .preview-badge')?.className || '',
    title: document.querySelector('.unified-search .omni-item.is-preview .omni-item-title')?.textContent?.trim() || '',
    host: document.querySelector('.unified-search .omni-item.is-preview .preview-host')?.textContent?.trim() || '',
    desc: document.querySelector('.unified-search .omni-item.is-preview .preview-desc')?.textContent?.trim() || '',
    hasIcon: !!document.querySelector('.unified-search .omni-item.is-preview .preview-favicon'),
  })`)
  const kind = card.badge.includes('error') ? 'error' : card.badge.includes('found') ? 'found' : 'ready(无徽标)'
  console.log(`  （卡片状态：${kind}）`)
  const isFound = card.badge.includes('found')
  const isError = card.badge.includes('error')
  const isReady = !isError && !isFound
  ok(isReady || isError || isFound, '抓取有了终态', kind)
  if (isReady) {
    ok(Boolean(card.title) && card.title !== probeHost, '抓到了站名（不是裸域名）', card.title)
    ok(card.hasIcon || Boolean(card.title), '图标要么是 favicon、要么回落字母块', card.hasIcon ? 'favicon' : '字母块')
    await shot('url-preview-ready.png')
  } else if (isError) {
    ok(Boolean(card.desc), '抓取失败时失败原因写在描述位', card.desc)
  }
  if (!isFound) {
    ok(card.host === probeHost, '加载与失败态都给出主机名占位', card.host)
  } else {
    console.log(`  （选中的 ${probeHost} 已被收录，走了 found 分支；抓取成功路径由下一轮候选覆盖）`)
  }
}

console.log('\n── 3. 不该出卡的三种输入 ──')
await type('note')
const dropOpen = await waitFor(`!!document.querySelector('.unified-search .search-suggestions')`, 4000, '普通词时下拉确实展开')
ok(dropOpen, '普通词时下拉确实展开（否则下面的负向断言是假通过）')
if (dropOpen) {
  ok(!(await jsonOf(`!!document.querySelector('.unified-search .omni-item.is-preview')`)), '普通词不出预览卡')
}

await type('>note')
await sleep(500)
ok(!(await jsonOf(`!!document.querySelector('.unified-search .omni-item.is-preview')`)), '命令前缀（>）不出预览卡')

await type('')
await sleep(400)
ok(!(await jsonOf(`!!document.querySelector('.unified-search .omni-item.is-preview')`)), '清空输入不出预览卡')

console.log('\n── 4. 回车语义保持 ──')
await type(aSite.host)
const enterOk = await waitFor(`document.querySelector('.unified-search .omni-item.is-preview')`, 4000, '卡片出现')
if (enterOk) {
  // 选中第一条（默认）回车 → 打开站点：下拉收起、输入保留（站点项的既有语义）
  await evalJs(`(() => {
    const el = document.querySelector('.unified-search .search-input')
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })()`)
  await sleep(400)
  const after = await jsonOf(`({
    open: !!document.querySelector('.unified-search .search-suggestions'),
    input: document.querySelector('.unified-search .search-input')?.value || '',
  })`)
  ok(!after.open, '回车打开站点后下拉收起')
  ok(after.input === aSite.host, '输入保留（站点项语义不变）', after.input)
}

console.log('\n── 5. 会话缓存：同域名再输入不闪「抓取中」 ──')
// 第 2 组已经完整抓过 probeHost，缓存里有了；再输一次必须**同步**出结果。
// 这是 P0 的用户可见证据：预览抓到的结果被下游复用，而不是每次都从头联网。
await type('')
await sleep(300)
await type('https://' + probeHost)
const cacheHit = await jsonOf(`(() => {
  const item = document.querySelector('.unified-search .omni-item.is-preview')
  if (!item) return null
  const b = item.querySelector('.preview-badge')
  return { loading: b ? b.classList.contains('loading') : false, host: item.querySelector('.preview-host')?.textContent?.trim() || '' }
})()`)
ok(cacheHit && !cacheHit.loading, '缓存命中时不进「抓取中」（同步出结果）', cacheHit ? `loading=${cacheHit.loading}` : '卡片未出现')
ok(cacheHit?.host === probeHost, '卡片仍是该域名', cacheHit?.host || '')

console.log('\n── 6. 已收录卡片带上「收在哪」 ──')
await type(aSite.host)
const catOk = await waitFor(`document.querySelector('.unified-search .omni-item.is-preview')`, 4000, '已收录卡片出现')
if (catOk) {
  const cat = await jsonOf(`({
    hasCat: !!document.querySelector('.unified-search .omni-item.is-preview .preview-cat'),
    catText: document.querySelector('.unified-search .omni-item.is-preview .preview-cat')?.textContent?.trim() || '',
  })`)
  ok(cat.hasCat && Boolean(cat.catText), '已收录卡片显示分类标签', cat.catText || '(无)')
}

console.log('\n── 7. 整段粘贴：从文本里认出网址 ──')
await type('Gitlab - 代码托管 https://' + probeHost)
const mixedOk = await waitFor(`document.querySelector('.unified-search .omni-item.is-preview')`, 5000, '混合文本也出卡')
if (mixedOk) {
  const mixedHost = await jsonOf(`document.querySelector('.unified-search .omni-item.is-preview .preview-host')?.textContent?.trim() || ''`)
  ok(mixedHost === probeHost, '从「标题 + 网址」里认出网址（不带前后文）', mixedHost || '(空)')
}

clearTimeout(watchdog)
ws.close()
console.log(`\n${failures.length ? `❌ 网址预览真机验证失败 ${failures.length} 项：\n  - ` + failures.join('\n  - ') : `✅ 网址预览真机验证全部通过：${pass} 条断言`}`)
process.exit(failures.length ? 1 : 0)
