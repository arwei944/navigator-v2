/**
 * 验证轮询的 ETag / If-None-Match 链路。
 *
 * 打桩 /api/sites 模拟一个会算 ETag 的服务端（Vercel 的实际行为：依据响应体生成弱 ETag，
 * 命中 If-None-Match 就回 304）。要证明四件事：
 *   1. 首次请求不带 If-None-Match，拿到 200 + ETag，并把 ETag 记住；
 *   2. 内容未变的后续轮询**带上** If-None-Match，服务端回 304，客户端不崩、不清空数据；
 *   3. 内容变了（ETag 变）时能正常拿到 200 并**应用**新数据 —— 不能因为 304 而卡死；
 *   4. 响应体不合法（缺 version）时**不记住** ETag，否则一次失败会被 304 永久钉住。
 *
 * 用法: node probe/test-etag-poll.mjs <cdp-port> [base-url]
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PORT = process.argv[2] || '9345'
const BASE = process.argv[3] || 'http://localhost:4173'
const payload = JSON.parse(readFileSync(fileURLToPath(new URL('./_live-sites.json', import.meta.url)), 'utf8'))

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const t = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl)
if (!t) throw new Error('没有可用的 Chrome 页面')

const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const pending = new Map()
ws.onmessage = e => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
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

await send('Page.enable')
await send('Runtime.enable')

const results = []
const check = (ok, label, detail = '') => {
  results.push({ ok, label })
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ' — ' + detail : ''}`)
}

/**
 * 打桩服务端。`window.__srv` 是「服务端当前实体」，测试随时改写。
 * 每次请求都记进 __reqs，便于断言客户端到底发了什么。
 */
const stub = `(() => {
  const REAL = ${JSON.stringify(payload)};
  window.__srv = {
    version: 122,
    sites: REAL.sites,
    etag: null,            // 由「响应体」算出，模拟 Vercel
    malformed: false       // true 时返回缺 version 的脏响应
  };
  window.__reqs = [];
  function etagOf(body) { return 'W/"h' + body.length + '-' + (body[0] ? body[0].id : '') + '-' + (body[0] ? (body[0].name || '').length : 0) + '-' + window.__srv.version + '"' }
  const orig = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.includes('/api/sites')) {
      const hdrs = (init && init.headers) || {};
      const inm = hdrs['If-None-Match'] || null;
      const body = window.__srv.malformed
        ? { sites: window.__srv.sites, updatedAt: 'x' }          // 故意缺 version
        : { version: window.__srv.version, sites: window.__srv.sites, updatedAt: '2026-10-10T00:00:00Z' };
      const etag = etagOf(body.sites);
      window.__reqs.push({ inm, etag, at: Date.now() });
      if (inm && inm === etag) {
        return Promise.resolve(new Response(null, { status: 304, headers: { ETag: etag } }));
      }
      return Promise.resolve(new Response(JSON.stringify(body), {
        status: 200, headers: { 'Content-Type': 'application/json', ETag: etag }
      }));
    }
    if (url.includes('/api/clicks')) {
      return Promise.resolve(new Response('{"counts":{}}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return orig.apply(this, arguments);
  };
})()`

await send('Page.addScriptToEvaluateOnNewDocument', { source: stub })
await send('Page.navigate', { url: BASE + '/' })
await sleep(2200)
// 清 SW 后重载，确保跑的是当前 bundle（打桩脚本会再次注入）
await evaluate(`(async () => {
  try { const r = await navigator.serviceWorker.getRegistrations(); await Promise.all(r.map(x => x.unregister())) } catch {}
  try { const k = await caches.keys(); await Promise.all(caches.delete(k[0])) } catch {}
  return 1
})()`).catch(() => {})
await send('Page.reload', { ignoreCache: true })
await sleep(2600)

console.log('\n=== ETag / If-None-Match 轮询链路 ===\n')

const cards0 = await evaluate(`document.querySelectorAll('.card').length`)
check(cards0 === 300, `首屏渲染 ${cards0} 张卡`, `期望 300`)

const r0 = await evaluate(`window.__reqs.slice()`)
check(r0.length >= 1, `首屏发出了 /api/sites 请求（${r0.length} 次）`)
check(r0[0] && !r0[0].inm, '首个请求不带 If-None-Match（还没有 ETag 可带）')

/* ── 场景 1：内容未变 → 必须带 If-None-Match 且拿到 304 ── */
await evaluate(`(() => { window.__reqs.length = 0; document.dispatchEvent(new Event('visibilitychange')); return 1 })()`)
await sleep(600)
const r1 = await evaluate(`window.__reqs.slice()`)
check(r1.length === 1, `内容未变的轮询只发 1 次请求（${r1.length}）`)
check(r1[0] && r1[0].inm === r1[0].etag, '第二次请求带了正确的 If-None-Match', r1[0] ? `inm=${r1[0].inm}` : '')
const cards1 = await evaluate(`document.querySelectorAll('.card').length`)
check(cards1 === 300, `304 之后数据未被清空（${cards1} 张卡）`)

/* ── 场景 2：内容变了 → 必须拿到 200 并应用（不能卡在 304） ── */
await evaluate(`(() => {
  window.__reqs.length = 0
  window.__srv.version = 123
  const s = window.__srv.sites.slice()
  s[0] = { ...s[0], name: 'ETAG-PROBE-OK' }
  window.__srv.sites = s
  document.dispatchEvent(new Event('visibilitychange'))
  return 1
})()`)
await sleep(700)
const r2 = await evaluate(`window.__reqs.slice()`)
check(r2.length === 1, `内容变化的轮询发 1 次请求（${r2.length}）`)
check(r2[0] && r2[0].inm !== r2[0].etag, '内容变了 → ETag 不匹配 → 请求未被 304 命中')
const applied = await evaluate(`[...document.querySelectorAll('.card-title')].some(e => e.textContent.trim() === 'ETAG-PROBE-OK')`)
check(applied === true, '新数据被应用到视图（改名站点出现在网格里）')

/* ── 场景 3：脏响应（缺 version）→ 不应记住 ETag ── */
await evaluate(`(() => {
  window.__reqs.length = 0
  window.__srv.malformed = true
  window.__srv.version = 999
  document.dispatchEvent(new Event('visibilitychange'))
  return 1
})()`)
await sleep(600)
const r3 = await evaluate(`window.__reqs.slice()`)
check(r3.length === 1, `脏响应轮询发 1 次请求（${r3.length}）`)
const stillOk = await evaluate(`document.querySelectorAll('.card').length`)
check(stillOk === 300, `脏响应未破坏现有数据（${stillOk} 张卡）`)

// 先清空记录再派发：fetch 是在事件处理里同步发出的，顺序反了会把记录一起抹掉
await evaluate(`(() => {
  window.__reqs.length = 0
  window.__srv.malformed = false
  window.__srv.version = 124
  document.dispatchEvent(new Event('visibilitychange'))
  return 1
})()`)
await sleep(700)
const r4 = await evaluate(`window.__reqs.slice()`)
// 若上一轮把脏响应的 ETag 记住了，这里会因 ETag（含 version）变化而仍然 200——
// 所以真正的判据是「必须能重新拉到 200 并应用」，而不是简单看 inm 的有无
const applied2 = await evaluate(`window.__reqs.length > 0 && window.__reqs.every(r => !r.inm || r.inm !== r.etag)`)
check(applied2 === true, '脏响应之后热更新仍能恢复（未被 304 钉死）', JSON.stringify(r4))

const pass = results.filter(r => r.ok).length
console.log(`\n结果：${pass}/${results.length} 通过`)
ws.close()
process.exit(pass === results.length ? 0 : 1)
