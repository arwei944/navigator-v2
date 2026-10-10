/**
 * 站点元信息抓取的**响应容错**用例：零依赖、不联网（打桩 globalThis.fetch）。
 *
 * 这里守的是一句具体的用户可见症状：界面报
 * `抓取失败：Unexpected token 'P', "Payment re"... is not valid JSON（可手动填写）`。
 *
 * 这句话的来历是「直接 `await res.json()`」，而这条链路上有三种响应**永远**不是 JSON：
 * 平台暂停部署时的 402 纯文本、网关的 5xx HTML、被 SPA 兜底接走的 index.html。
 * 用例的做法是把这三种真实响应体原样喂进去，断言：
 *   ① 不再出现 JSON 解析错误；② 能说出 HTTP 状态与原因；③ 服务端自己的 error 文案不被覆盖。
 *
 * 运行：node tools/console/test-meta-fetch.mjs
 */
import { META_TIMEOUT_MS, fetchSiteMeta, httpFailureText, metaFailureText } from '../../src/services/meta.js'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

/* ---------------- fetch 打桩 ---------------- */

const realFetch = globalThis.fetch
let calls = []
let nextResponse = null

globalThis.fetch = async (url, init = {}) => {
  calls.push({ url, init })
  if (typeof nextResponse === 'function') return nextResponse(url, init)
  return nextResponse
}

/** 造一个 Response 替身：只需要 ok / status / text() */
function reply(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    text: async () => body,
  }
}
const jsonReply = (status, obj) => reply(status, JSON.stringify(obj), { 'content-type': 'application/json' })

/** 平台暂停部署时 Vercel 的**真实**响应体（text/plain，逐字节照抄） */
const VERCEL_PAUSED_BODY = 'Payment required\n\nDEPLOYMENT_DISABLED\n\nhnd1::sbnm7-1791663718365-0178f3e62948\n'

/* ---------------- 1. 正常路径：不能因为加了容错就改坏 ---------------- */

{
  const payload = { name: 'Example', desc: '示例站', domain: 'example.com', confidence: { name: 'high' } }
  nextResponse = () => jsonReply(200, payload)
  calls = []
  const r = await fetchSiteMeta('https://example.com')
  eq(r.ok, true, '200 + JSON → ok')
  eq(r.data.name, 'Example', '数据原样带出')
  eq(calls.length, 1, '只发一次请求')
  ok(calls[0].url.startsWith('/api/metadata?url='), '请求路径正确', calls[0].url)
  eq(calls[0].url, '/api/metadata?url=' + encodeURIComponent('https://example.com'), 'url 参数被正确编码')
}

/* ---------------- 2. 平台暂停部署：402 + 纯文本（本次报告的真实场景） ---------------- */

{
  nextResponse = () => reply(402, VERCEL_PAUSED_BODY, { 'content-type': 'text/plain; charset=utf-8' })
  const r = await fetchSiteMeta('https://exchange.papertrade.xyz')
  eq(r.ok, false, '402 纯文本 → 失败')
  eq(r.status, 402, '带上 HTTP 状态')
  eq(r.reason, 'http', 'reason = http')
  ok(/402/.test(r.message), '文案里说得出 402', r.message)
  ok(/暂停/.test(r.message), '文案里点明是部署被暂停', r.message)
  ok(!/Unexpected token|is not valid JSON|JSON/i.test(r.message), '不再出现 JSON 解析错误话术', r.message)
  ok(!/Unexpected token/.test(metaFailureText(r)), '拼成界面文案后同样干净', metaFailureText(r))
}

/* ---------------- 3. 5xx HTML 错误页（网关替换的响应） ---------------- */

{
  nextResponse = () => reply(502, '<html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>', { 'content-type': 'text/html' })
  const r = await fetchSiteMeta('https://example.com')
  eq(r.ok, false, '502 HTML → 失败')
  ok(/502/.test(r.message), '文案里说得出 502', r.message)
  ok(!/Unexpected token/.test(r.message), '不外泄解析错误', r.message)
}

/* ---------------- 4. 200 但返回 HTML（代理 / SPA 兜底；本地 preview 就是这种） ---------------- */

{
  nextResponse = () => reply(200, '<!DOCTYPE html><html><body><div id="app"></div></body></html>', { 'content-type': 'text/html' })
  const r = await fetchSiteMeta('https://example.com')
  eq(r.ok, false, '200 + HTML → 失败（不能把首页当成抓取结果）')
  eq(r.reason, 'non-json', 'reason = non-json')
  ok(/非 JSON/.test(r.message), '文案点明拿到的不是 JSON', r.message)
  ok(/200/.test(r.message), '文案里带上状态码便于定位', r.message)
}

/* ---------------- 5. 服务端自己的 error 文案优先，不被兜底覆盖 ---------------- */

for (const [status, message] of [
  [403, '该接口仅限站内调用'],
  [429, '请求过于频繁，请稍后再试'],
  [400, '无效的 URL'],
]) {
  nextResponse = () => jsonReply(status, { error: message })
  const r = await fetchSiteMeta('https://example.com')
  eq(r.ok, false, `${status} + JSON error → 失败`)
  eq(r.message, message, `${status} 沿用服务端文案（不覆盖成兜底话术）`)
}

/* ---------------- 6. 超时与网络不可达 ---------------- */

{
  // 永不 resolve，只在 abort 时 reject —— 走的就是真实 fetch 的行为
  nextResponse = (url, init) => new Promise((_, reject) => {
    const fire = () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e) }
    if (init?.signal) {
      if (init.signal.aborted) fire()
      else init.signal.addEventListener('abort', fire, { once: true })
    }
  })
  const t0 = Date.now()
  const r = await fetchSiteMeta('https://slow.example', { timeoutMs: 30 })
  eq(r.ok, false, '超时 → 失败')
  eq(r.reason, 'timeout', 'reason = timeout')
  ok(/超时/.test(r.message), '文案说明是超时', r.message)
  ok(Date.now() - t0 < 3000, '超时后马上返回，不会一直挂着', `${Date.now() - t0}ms`)
}

{
  nextResponse = () => { throw new TypeError('fetch failed') }
  const r = await fetchSiteMeta('https://unreachable.example')
  eq(r.ok, false, '网络异常 → 失败')
  eq(r.reason, 'network', 'reason = network')
  ok(/网络/.test(r.message), '文案说明是网络问题', r.message)
}

/* ---------------- 7. 调用方的取消信号能中断（弹窗关掉时） ---------------- */

{
  nextResponse = (url, init) => new Promise((_, reject) => {
    const fire = () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e) }
    if (init?.signal) init.signal.addEventListener('abort', fire, { once: true })
  })
  const ctrl = new AbortController()
  const p = fetchSiteMeta('https://example.com', { signal: ctrl.signal })
  ctrl.abort()
  const r = await p
  eq(r.ok, false, '外部取消 → 失败而不是悬挂')
}

/* ---------------- 8. 状态码兜底文案表 ---------------- */

{
  eq(httpFailureText(402), '云端部署已被平台暂停（HTTP 402），请到部署平台查看用量', '402 有专门文案')
  ok(/拒绝访问/.test(httpFailureText(403)), '403 = 拒绝访问')
  ok(/不存在/.test(httpFailureText(404)), '404 = 接口不存在')
  ok(/频繁/.test(httpFailureText(429)), '429 = 过于频繁')
  ok(/暂时不可用/.test(httpFailureText(503, '')), '5xx = 暂时不可用')
  ok(/418/.test(httpFailureText(418, '')), '未知状态码至少带上数字')
  // 状态码对不上、但正文露出平台特征时，也要说出真正的原因
  ok(/暂停/.test(httpFailureText(400, VERCEL_PAUSED_BODY)), '正文含 DEPLOYMENT_DISABLED 时按平台暂停解释')
}

/* ---------------- 9. 界面文案句式 ---------------- */

{
  eq(metaFailureText({ message: '抓取超时（超过 12 秒未响应）' }), '抓取失败：抓取超时（超过 12 秒未响应）（可手动填写）', '句式统一')
  eq(metaFailureText(null), '抓取失败：未知原因（可手动填写）', '极端输入不炸')
  ok(META_TIMEOUT_MS >= 5000, '默认超时给足抓外站的时间', `${META_TIMEOUT_MS}ms`)
}

globalThis.fetch = realFetch

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 元信息抓取容错 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 元信息抓取容错全部通过：${pass} 条断言`)
