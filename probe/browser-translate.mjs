/**
 * 真机验收：**浏览器内建本地翻译**（L2）在这台机器上到底能不能用。
 *
 * ## 为什么必须单独跑、而且必须有头
 *
 * L2 走的是 Chrome 内建的 `Translator` API（本地神经模型，零延迟零成本、译文不出机器）。
 * 它有两个在 Node 里**测不出来**的性质：
 *
 *   1. 只在 **安全上下文** 里暴露（https 或 localhost）；
 *   2. 语言包（en→zh 约 40MB）**首次要先下载**，`create()` 会挂在那里等下载完成。
 *
 * 实测：`--headless=new` 下 `typeof Translator === 'function'` 成立、`availability()` 也正常，
 * 但 **`create()` 挂起不返回** —— 所以无头环境**测不了**这条链路。
 * 本探针在这种情况下的行为是：**明确打印 SKIPPED 并以退出码 0 结束**，
 * 绝不把「没测」算成「通过」（这是本项目对探针的硬要求）。
 *
 * ## 分工
 *
 *   · 适配器逻辑（降级、语言码归一、失败粒度、幂等预热…）→ 单测 `test-browser-translate.mjs`（49 条）；
 *   · **底层 API 在真实浏览器里是否真的工作** → 本探针（Node 里无法验证）。
 *
 * ## 用法
 *
 *   node probe/browser-translate.mjs <cdp-port> [base] [--headed]
 *
 * `--headed` 会**自拉一个有头 Chrome**（若该端口已有 CDP 端点就直接用）：
 *   node probe/browser-translate.mjs 9352 http://127.0.0.1:4180 --headed
 *
 * 换浏览器路径用环境变量 `CHROME_PATH`。
 *
 * ## 本机的一条硬约束（实测）
 *
 * headless Chrome 的 DevTools 端点在本机**约 110s 后固定失效**（纯 `about:blank` 也一样）。
 * 所以探针自己拉、自己收，不依赖外部 `chrome ... &` 串联（那条路会留下 headless 残留）。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const args = process.argv.slice(2)
const HEADED = args.includes('--headed')
const rest = args.filter(a => !a.startsWith('--'))
const PORT = rest[0] || '9352'
const BASE = (rest[1] || 'https://nav-dashboard-19166.app.workbuddy.host').replace(/\/+$/, '')

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? ` → ${extra}` : ''}`) }
  else { failures.push(`${label}${extra ? ` → ${extra}` : ''}`); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`) }
}
const note = (label, extra = '') => console.log(`  ⏭ ${label}${extra ? ` → ${extra}` : ''}`)

const CJK = /[\u4e00-\u9fff]/

/** 有头还是无头：`--headless=new` 的 UA 里带 HeadlessChrome */
async function headless() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
  const v = await r.json()
  return /headless/i.test(v.Browser || '')
}

/* ---------------- 浏览器：自己拉、自己收 ---------------- */

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'

async function endpointAlive(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) })
    return true
  } catch { return false }
}

let chromeProc = null
if (!(await endpointAlive(PORT))) {
  if (!existsSync(CHROME)) {
    console.error(`找不到浏览器：${CHROME}\n可用 CHROME_PATH 指定路径。`)
    process.exit(2)
  }
  const flags = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(tmpdir(), HEADED ? 'nav-v2-probe-headed' : 'nav-v2-probe-l2')}`,
    '--no-first-run', '--no-default-browser-check',
    '--window-size=1280,900', 'about:blank',
  ]
  if (!HEADED) flags.unshift('--headless=new', '--disable-gpu', '--hide-scrollbars')
  chromeProc = spawn(CHROME, flags, { stdio: 'ignore', detached: false, windowsHide: true })
  console.log(`  （探针自拉浏览器，${HEADED ? '有头' : '无头'}，PID ${chromeProc.pid}）`)
}
const killChrome = () => { try { if (chromeProc && !chromeProc.killed) chromeProc.kill() } catch { /* 已退出 */ } }
process.on('exit', killChrome)

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

// 顺序要紧：先等端点起来（`targets()` 内部轮询），再问它的 UA ——
// 自拉浏览器时立刻 fetch 会 ECONNREFUSED（第一次跑就踩了）。
const target = await targets()
const isHeadless = await headless()
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
ws.addEventListener('close', () => {
  for (const [, { reject }] of pending) reject(new Error('CDP 连接已断开'))
  pending.clear()
})
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params }))
})
const evalJs = async (expr, awaitPromise = true) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval 抛错')
  return r.result.value
}
const sleep = ms => new Promise(s => setTimeout(s, ms))

/**
 * 心跳：浏览器半死（进程崩了但连接没收到 FIN）时，`close` 不触发，
 * 一条已发出的 `Runtime.evaluate` 会永远等不到回包 → 探针无限挂住。
 * 必须连续失败后**主动收手**，把已有结论吐出来。
 * 注意 L2 语言包下载最长 180s，这个阈值必须比它宽。
 */
let hbFails = 0
let stopping = false
const heartbeat = setInterval(async () => {
  if (stopping) return
  try {
    await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(3000) })
    hbFails = 0
  } catch {
    if (++hbFails >= 4) {
      stopping = true
      clearInterval(heartbeat)
      console.error('\n❌ 探针中断：CDP HTTP 端点连续无响应（浏览器进程退出了？）')
      process.exit(2)
    }
  }
}, 3000)
process.on('unhandledRejection', e => {
  stopping = true
  clearInterval(heartbeat)
  console.error('\n❌ 探针中断：' + String((e && e.message) || e))
  process.exit(2)
})

await send('Page.enable')
await send('Runtime.enable')
console.log(`\n▶ 目标环境：${BASE}`)
console.log(`▶ 浏览器模式：${isHeadless ? '无头（L2 语言包链路将标记 SKIPPED）' : '有头（可完整验证 L2）'}\n`)

await send('Page.navigate', { url: BASE })
for (let i = 0; i < 60; i++) {
  const ready = await evalJs(`document.readyState === 'complete' || !!document.querySelector('.add-site-btn')`).catch(() => false)
  if (ready) break
  await sleep(500)
}
const secure = await evalJs(`window.isSecureContext === true`)
ok(secure, '★ 页面是安全上下文（Translator 只在这里暴露）', String(secure))

/* ══════════ 1. API 存在性与可用性（无头也能测） ══════════ */

const probe = await evalJs(`(() => {
  const T = (typeof Translator !== 'undefined') ? Translator : (self.ai && self.ai.translator) || null
  const D = (typeof LanguageDetector !== 'undefined') ? LanguageDetector : (self.ai && self.ai.languageDetector) || null
  const duck = o => !!o && typeof o.create === 'function'
  return {
    tGlobal: typeof Translator,
    tDuck: duck(T),
    tHasAvailability: !!(T && typeof T.availability === 'function'),
    dGlobal: typeof LanguageDetector,
    dDuck: duck(D),
    dHasAvailability: !!(D && typeof D.availability === 'function'),
  }
})()`)
console.log(`  · typeof Translator = ${probe.tGlobal}（duck: ${probe.tDuck}） typeof LanguageDetector = ${probe.dGlobal}（duck: ${probe.dDuck}）`)

// 存在性用**鸭子类型**判：早期实现挂在 self.ai.translator 命名空间对象上，
// `typeof ... === 'function'` 会把「有但形状不同」误判成「没有」。
ok(probe.tDuck, '内建 Translator 可用（鸭子类型判定）')
ok(probe.tHasAvailability, 'Translator.availability() 存在（能提前问「要不要下载语言包」）')
ok(probe.dDuck, '内建 LanguageDetector 可用（决定 src 语言，避免把 en 锁死）')

// availability：'unavailable' 才是真的不支持
const avail = await evalJs(`(async () => {
  const T = (typeof Translator !== 'undefined') ? Translator : (self.ai && self.ai.translator) || null
  if (!T || typeof T.availability !== 'function') return { err: 'no availability()' }
  try {
    return {
      en2zh: await T.availability({ sourceLanguage: 'en', targetLanguage: 'zh' }),
      zh2en: await T.availability({ sourceLanguage: 'zh', targetLanguage: 'en' }),
    }
  } catch (e) { return { err: String((e && e.message) || e) } }
})()`)
console.log(`  · availability：${JSON.stringify(avail)}`)
if (avail.err) {
  ok(false, 'availability() 可调用', avail.err)
} else {
  ok(avail.en2zh !== 'unavailable', '★ en→zh 不是 unavailable（要么已可用，要么可下载）', String(avail.en2zh))
}

/* ══════════ 2. 语言包下载 + 整句翻译 ══════════ */

/**
 * 无头**也先试**。
 *
 * 原设计里这里直接判 `if (isHeadless) → SKIPPED`，依据是「无头下 `create()` 挂起不返回」。
 * 但后来在真机上看到反例：弹窗挂载时的**静默预热**（`warmUpTranslate`）会把语言包下下来，
 * 于是下一轮 `create()` 立即就绪 —— 探针里真的观测到了「浏览器本地翻译：描述」。
 *
 * 所以改成：两种模式都试；**无头下超时算 SKIPPED（不假装通过）**，有头下超时算失败。
 *
 * 预算上限被本机的另一条约束决定：headless 的 CDP 端点约 110s 后失效，
 * 所以无头只给 70s（有头给 180s，语言包几十 MB）。
 */
const budget = isHeadless ? 70000 : 180000
const skipMode = isHeadless

console.log(`\n  ── 2. 语言包下载 + 整句翻译（${isHeadless ? '无头，预算 70s' : '有头，预算 180s'}） ──`)
await evalJs(`(() => {
  window.__dl = { events: [], err: null, done: false }
  return true
})()`)
const created = await evalJs(`(async () => {
  window.__probeCreate = (async () => {
    const T = (typeof Translator !== 'undefined') ? Translator : (self.ai && self.ai.translator) || null
    try {
      const t = await T.create({
        sourceLanguage: 'en', targetLanguage: 'zh',
        monitor(m) { m.addEventListener('downloadprogress', e => { window.__dl.events.push({ loaded: e.loaded }) }) },
      })
      window.__probeTranslator = t
      window.__dl.done = true
      return { ok: true }
    } catch (e) { window.__dl.err = String((e && e.message) || e); return { ok: false, err: window.__dl.err } }
  })()
  // 让 create() 在后台跑，Node 侧轮询进度，避免单条 eval 卡到超时
  return true
})()`)
ok(created === true, 'create() 已发起（后台等待语言包）')

let l2Verified = false
{
  const deadline = Date.now() + budget
  let finished = null
  let lastLoaded = -1
  while (Date.now() < deadline) {
    await sleep(1000)
    const st = await evalJs(`(() => ({
      done: window.__dl.done, err: window.__dl.err,
      loaded: window.__dl.events.length ? window.__dl.events[window.__dl.events.length - 1].loaded : -1,
      n: window.__dl.events.length
    }))()`)
    if (st.loaded !== lastLoaded) {
      console.log(`  ⬇ 语言包下载进度：${(st.loaded * 100).toFixed(0)}%`)
      lastLoaded = st.loaded
    }
    if (st.err) { finished = st; break }
    if (st.done) { finished = st; break }
  }
  if (finished?.done) {
    l2Verified = true
    ok(true, '★ 语言包已就绪（Translator.create 返回）', '已就绪')
  } else if (skipMode) {
    // 无头下不假装通过：明确标 SKIPPED，并说明它是「没测到」而不是「坏了」
    note('SKIPPED：语言包下载未在 70s 内完成（无头模式）',
      finished?.err ? `错误：${finished.err}` : '需要先下载几十 MB；弹窗挂载时的静默预热会把它带下来，下一轮即可用')
  } else {
    ok(false, '★ 语言包下载完成（Translator.create 返回）',
      finished?.err ? `错误：${finished.err}` : `${Math.round(budget / 1000)}s 未完成`)
  }

  if (finished?.done) {
    const tr = await evalJs(`(async () => {
      const t = window.__probeTranslator
      if (!t) return { err: 'no translator' }
      try {
        const s1 = 'A privacy-first analytics platform for small teams.'
        const s2 = 'Open source alternative to Notion.'
        return { s1: await t.translate(s1), s2: await t.translate(s2), input: [s1, s2] }
      } catch (e) { return { err: String((e && e.message) || e) } }
    })()`)
    if (tr.err) {
      ok(false, '整句翻译不抛错', tr.err)
    } else {
      console.log(`  · 「${tr.input[0]}」\n      → ${tr.s1}`)
      console.log(`  · 「${tr.input[1]}」\n      → ${tr.s2}`)
      ok(CJK.test(tr.s1), '★ 整句英文译成中文（第一句）', tr.s1)
      ok(CJK.test(tr.s2), '★ 整句英文译成中文（第二句）', tr.s2)
      ok(tr.s1 !== tr.input[0], '译文不等于原文（没把原文当译文返回）')
    }

    // LanguageDetector：决定 src 语言，避免「先把语言对锁死成 en」
    const det = await evalJs(`(async () => {
      const D = (typeof LanguageDetector !== 'undefined') ? LanguageDetector : (self.ai && self.ai.languageDetector) || null
      if (!D) return { err: 'no LanguageDetector' }
      try {
        const d = await D.create()
        const [en, zh, ja] = await Promise.all([
          d.detect('A privacy-first analytics platform for small teams.'),
          d.detect('这是一个面向小团队的分析平台。'),
          d.detect('これは日本語の文章です。'),
        ])
        return { en: en[0], zh: zh[0], ja: ja[0] }
      } catch (e) { return { err: String((e && e.message) || e) } }
    })()`)
    if (det.err) {
      ok(false, 'LanguageDetector 可用', det.err)
    } else {
      console.log(`  · 语言识别：en=${det.en?.detectedLanguage}(${det.en?.confidence?.toFixed(3)}) zh=${det.zh?.detectedLanguage}(${det.zh?.confidence?.toFixed(3)}) ja=${det.ja?.detectedLanguage}(${det.ja?.confidence?.toFixed(3)})`)
      ok(det.en?.detectedLanguage === 'en', '英文句识别为 en', JSON.stringify(det.en))
      // 真机返回的是 `zh-Hans` 而不是 `zh` —— 断言要认整个中文语族。
      // 适配器侧由 `normLang('zh-Hans') → 'zh'` 归一（`test-browser-translate` 已钉住），
      // 否则会把 `zh-Hans` 当成语言对去问 `availability()`，拿不到结果。
      ok(/^zh/i.test(det.zh?.detectedLanguage || ''), '★ 中文句识别为中文语族（zh / zh-Hans，不该被误判成 en 再白译一遍）', JSON.stringify(det.zh))
    }

    /* ── 3. 端到端：弹窗里真的用了本地翻译，文案如实标注来源 ── */
    console.log('\n  ── 3. 端到端：弹窗 → 第 2 跳是否如实标注「浏览器本地翻译」 ──')
    await evalJs(`document.querySelector('.add-site-btn').click(); true`)
    await sleep(1400)
    const opened = await evalJs(`!!document.querySelector('input[type=url]')`).catch(() => false)
    ok(opened, '添加弹窗可打开')
    if (opened) {
      await evalJs(`(() => {
        const el = document.querySelector('input[type=url]');
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        el.focus();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, 'https://vercel.com');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        return true;
      })()`)
      let last = ''
      const deadline2 = Date.now() + 45000
      let stable = Date.now()
      while (Date.now() < deadline2) {
        await sleep(400)
        const t = await evalJs(`(() => { const n = document.querySelector('.status-line span:last-child'); return n ? n.textContent.trim() : '' })()`)
        if (t && t !== last) { console.log(`      ${t}`); last = t; stable = Date.now() }
        else if (t && t === last && Date.now() - stable > 8000) break
      }
      const usedBrowser = /浏览器本地翻译/.test(last)
      const usedOnline = /在线引擎/.test(last)
      const usedGlossary = /离线词表|关键词/.test(last)
      if (usedBrowser) ok(true, '★ 端到端确认走了 L2（浏览器本地翻译）', last)
      else if (usedOnline) note('端到端这次走了 L3（在线引擎）而非 L2', last)
      else if (usedGlossary) note('端到端这次只拿到 L1（离线词表关键词）', last)
      else ok(false, '端到端译文来源可辨认（文案里应写明来自哪一层）', last)
      const descEl = await evalJs(`(() => { const t = document.querySelector('textarea.form-textarea'); return t ? t.value : '' })()`)
      console.log(`      ⟹ 描述字段：${descEl}`)
      ok(CJK.test(descEl), '描述字段最终是中文', descEl)
    }
  }
}

console.log(`\n${failures.length ? '❌' : '✅'} 通过 ${pass} 项，失败 ${failures.length} 项` +
  (l2Verified ? '（L2 语言包链路已实际验证）' : '（⚠ L2 语言包链路**未验证**：无头下未在预算内就绪 —— 这是「没测到」，不是「通过」）'))
if (failures.length) { console.log('失败项：'); failures.forEach(f => console.log('  - ' + f)) }
ws.close()
process.exit(failures.length ? 1 : 0)
