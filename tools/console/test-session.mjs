/**
 * 第三批 · 序 18/19 的守卫：会话凭据的传递方式与体量门禁。
 *
 * 两个问题的答案都不是「加个校验」，而是「把凭据从错误的位置挪走」：
 *
 *   序 18 —— 凭据原先可以放在 `?key=` 与请求体里。query string 会进 Vercel 函数日志、
 *            CDN 日志、浏览器历史、以及跨站请求的 Referer；体里的 key 同样被日志与抓包采到。
 *            现在只认 `Authorization: Bearer`，旧的两种写法返回 400 + 明确 reason。
 *   序 19 —— 浏览器端没有「能挡住 XSS 的加密」，所以共享密钥（永久、不可过期）不再
 *            作为常规入口，「粘贴密钥」降级为登录态兜底，凭据存 sessionStorage。
 *
 * 体积门禁则是另一回事：`任何人可无限次 POST 任意大小 JSON 灌满 Blob` 的正解是
 * 硬上限（content-length + 合并后实际大小），限流只是 best-effort 的补充。
 *
 * 用 `node:test` 的模块 mock 顶掉 `@vercel/blob`，把 handler 当普通函数调，不联网、无凭据。
 * 运行：node --experimental-test-module-mocks tools/console/test-session.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

/* ---------------- 假 Blob 存储 ---------------- */

const store = new Map()

const { mock } = await import('node:test')
mock.module('@vercel/blob', {
  namedExports: {
    get: async (pathname) => (store.has(pathname) ? { stream: new Response(store.get(pathname)).body } : null),
    put: async (pathname, body) => { store.set(pathname, String(body)); return { pathname } },
    BlobPreconditionFailedError: class BlobPreconditionFailedError extends Error {},
  },
})

const { default: handler } = await import('../../api/session.js')

/* ---------------- 请求 / 响应桩 ---------------- */

const KEY = 'my-session-key_123'

function makeReq({ method = 'GET', query = {}, body, headers = {} } = {}) {
  return { method, query, body, headers, socket: { remoteAddress: '203.0.113.9' }, ...({}) }
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(k, v) { res.headers[k] = v },
    removeHeader() {},
    status(code) { res.statusCode = code; return res },
    json(payload) { res.payload = payload; return res },
  }
  return res
}

async function call(req) {
  const res = makeRes()
  await handler(req, res)
  return res
}

const auth = () => ({ authorization: `Bearer ${KEY}` })
const MAX = 256 * 1024

/* ══════════ 序 18：凭据只走 Authorization 头 ══════════ */

test('GET：query 里带 key → 400 + 明确 reason（旧写法已停用）', async () => {
  const res = await call(makeReq({ query: { key: KEY } }))
  assert.equal(res.statusCode, 400)
  assert.equal(res.payload.reason, 'key-in-query-removed')
  assert.match(res.payload.error, /刷新/)
})

test('GET：无凭据 → 200 空快照（不高报错，首次访问是正常路径）', async () => {
  const res = await call(makeReq({ query: {} }))
  assert.equal(res.statusCode, 200)
  assert.deepEqual({ v: res.payload.version, d: res.payload.data }, { v: 0, d: null })
})

test('POST：没有 Authorization 头 → 400 + key-header-required', async () => {
  const res = await call(makeReq({ method: 'POST', body: { data: { a: 1 } } }))
  assert.equal(res.statusCode, 400)
  assert.equal(res.payload.reason, 'key-header-required')
})

test('POST：只有 body 里带 key → 仍然 400（不保留「体里放 key」的兼容路径）', async () => {
  const res = await call(makeReq({ method: 'POST', body: { key: KEY, data: { a: 1 } } }))
  assert.equal(res.statusCode, 400)
  assert.equal(res.payload.reason, 'key-header-required')
})

test('GET：带 Bearer 凭据可正常读到已存快照', async () => {
  store.clear()
  const w = await call(makeReq({ method: 'POST', headers: auth(), body: { data: { favorites: { x: { t: 1 } } } } }))
  assert.equal(w.statusCode, 200)
  assert.equal(w.payload.version, 1)
  const r = await call(makeReq({ headers: auth() }))
  assert.equal(r.statusCode, 200)
  assert.equal(r.payload.version, 1)
  assert.deepEqual(r.payload.data.favorites, { x: { t: 1 } })
})

test('GET 响应禁止缓存（凭据隔离的数据不能被中间层留存）', async () => {
  const res = await call(makeReq({ headers: auth() }))
  assert.match(res.headers['Cache-Control'], /no-store/)
})

test('不支持的方法 → 405', async () => {
  const res = await call(makeReq({ method: 'DELETE', headers: auth() }))
  assert.equal(res.statusCode, 405)
})

/* ══════════ 序 18：体量门禁（硬上限） ══════════ */

test('POST：content-length 超限 → 413（在解析 body 之前就拒）', async () => {
  const res = await call(makeReq({
    method: 'POST', headers: { ...auth(), 'content-length': String(MAX + 1) }, body: '{}',
  }))
  assert.equal(res.statusCode, 413)
})

test('POST：字符串 body 超限 → 413', async () => {
  const huge = JSON.stringify({ data: { blob: 'x'.repeat(MAX) } })
  const res = await call(makeReq({ method: 'POST', headers: auth(), body: huge }))
  assert.equal(res.statusCode, 413)
})

test('POST：**合并后**的实际大小超限 → 413（防「多次小写入把快照喂大」）', async () => {
  store.clear()
  const chunk = 'y'.repeat(180 * 1024)
  const first = await call(makeReq({ method: 'POST', headers: auth(), body: { data: { a: chunk } } }))
  assert.equal(first.statusCode, 200, '单次写入本身合法')
  // 第二次写入很小，但合并结果越界 —— 只check content-length 是挡不住这条的
  const second = await call(makeReq({ method: 'POST', headers: auth(), body: { data: { b: chunk } } }))
  assert.equal(second.statusCode, 413)
  assert.match(second.payload.error, /合并后/)
})

test('POST：非对象 / 数组型 data → 400', async () => {
  for (const data of [null, 42, 'str', [1, 2, 3]]) {
    const res = await call(makeReq({ method: 'POST', headers: auth(), body: { data } }))
    assert.equal(res.statusCode, 400, `data=${JSON.stringify(data)} 应被拒`)
  }
})

/* ══════════ 字段级合并语义（改这块容易误伤） ══════════ */

test('POST：对象字段深入合并，数组/标量整覆盖', async () => {
  store.clear()
  await call(makeReq({ method: 'POST', headers: auth(), body: { data: { prefs: { theme: 'dark' }, todos: [1, 2] } } }))
  const r = await call(makeReq({ method: 'POST', headers: auth(), body: { data: { prefs: { density: 'compact' }, todos: [3] } } }))
  assert.equal(r.statusCode, 200)
  const read = await call(makeReq({ headers: auth() }))
  assert.deepEqual(read.payload.data.prefs, { theme: 'dark', density: 'compact' }, '对象字段应保留旧键')
  assert.deepEqual(read.payload.data.todos, [3], '数组字段应整覆盖而不是拼接')
  assert.equal(read.payload.version, 2, 'version 单调递增')
})

/* ══════════ 限流（best-effort，per-instance） ══════════ */

test('POST：同一来源 1 分钟内超过 30 次 → 429 + Retry-After', async () => {
  store.clear()
  let last = null
  for (let i = 0; i < 31; i++) {
    last = await call(makeReq({ method: 'POST', headers: auth(), body: { data: { n: i } } }))
  }
  assert.equal(last.statusCode, 429)
  assert.equal(last.headers['Retry-After'], '60')
})
