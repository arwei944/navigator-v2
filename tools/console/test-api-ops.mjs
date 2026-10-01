/**
 * 线上运维面 `api/ops.js` 的用例：鉴权、查询分支、写入动作。
 *
 * 为什么要单独测它：`api/sites.js` 是数据面，`api/ops.js` 是运维面，
 * 两者都在 Serverless 上跑，本地没有 Blob 无法直接联调。
 * 这里用 `node:test` 的模块 mock 顶掉 `@vercel/blob`，把 handler 当普通函数调，
 * 从而在本地把「鉴权 / 路由 / 落盘语义」跑通，不依赖任何网络或凭据。
 *
 * 运行：node --experimental-test-module-mocks tools/console/test-api-ops.mjs
 */
import { test, mock, after } from 'node:test'
import assert from 'node:assert/strict'

/* ---------------- 假 Blob 存储 ---------------- */

const store = new Map()

mock.module('@vercel/blob', {
  namedExports: {
    get: async (pathname) => {
      if (!store.has(pathname)) return null
      return { stream: new Response(store.get(pathname)).body }
    },
    put: async (pathname, body) => {
      store.set(pathname, typeof body === 'string' ? body : String(body))
      return { pathname }
    },
  },
})

const { default: handler } = await import('../../api/ops.js')

/* ---------------- 请求 / 响应桩 ---------------- */

const KEY = 'test-admin-key'

function makeReq({ method = 'GET', query = {}, body, headers = {} } = {}) {
  return {
    method,
    query,
    body,
    headers: { authorization: `Bearer ${KEY}`, ...headers },
  }
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(k, v) { res.headers[k] = v },
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

after(() => { process.env.SITES_ADMIN_KEY = '' })

process.env.SITES_ADMIN_KEY = KEY

/* ---------------- 鉴权 ---------------- */

test('缺少密钥配置 → 500', async () => {
  const saved = process.env.SITES_ADMIN_KEY
  delete process.env.SITES_ADMIN_KEY
  const res = await call(makeReq())
  assert.equal(res.statusCode, 500)
  process.env.SITES_ADMIN_KEY = saved
})

test('密钥错误 → 401，且响应禁止缓存', async () => {
  const res = await call(makeReq({ headers: { authorization: 'Bearer wrong' } }))
  assert.equal(res.statusCode, 401)
  assert.match(res.headers['Cache-Control'], /no-store/)
})

/* ---------------- 发布历史 ---------------- */

test('history.append 落盘后可在 history 查询中读到', async () => {
  store.clear()
  const w = await call(makeReq({
    method: 'POST',
    body: {
      action: 'history.append',
      record: { runner: 'cloud', trigger: 'admin', ok: true, cloud: { version: 7, count: 300 }, note: '首次' },
    },
  }))
  assert.equal(w.statusCode, 200)
  assert.equal(w.payload.ok, true)
  assert.equal(w.payload.record.cloud.version, 7)

  const r = await call(makeReq({ query: { limit: '10' } }))
  assert.equal(r.statusCode, 200)
  assert.equal(r.payload.total, 1)
  assert.equal(r.payload.items[0].cloud.count, 300)
  assert.equal(r.payload.summary.ok, 1)
  assert.equal(r.payload.triggers.admin, '线上后台')
})

test('history 支持按结果与关键词筛选', async () => {
  store.clear()
  await call(makeReq({ method: 'POST', body: { action: 'history.append', record: { ok: true, note: '常规' } } }))
  await call(makeReq({ method: 'POST', body: { action: 'history.append', record: { ok: false, reason: '热更新失败' } } }))

  const fail = await call(makeReq({ query: { ok: 'fail' } }))
  assert.equal(fail.payload.matched, 1)
  assert.equal(fail.payload.items[0].reason, '热更新失败')
  assert.equal(fail.payload.summary.failed, 1)

  const q = await call(makeReq({ query: { q: '常规' } }))
  assert.equal(q.payload.matched, 1)
})

/* ---------------- 通知中心 ---------------- */

test('notify.push 落盘后可读，且默认未读', async () => {
  store.clear()
  await call(makeReq({
    method: 'POST',
    body: { action: 'notify.push', notification: { kind: 'publish.done', title: '发布完成', body: '300 站点' } },
  }))

  const r = await call(makeReq({ query: { notifications: '1' } }))
  assert.equal(r.statusCode, 200)
  assert.equal(r.payload.total, 1)
  assert.equal(r.payload.summary.unread, 1)
  assert.equal(r.payload.items[0].kind, 'publish.done')
  assert.equal(r.payload.severities.info, '提示')
})

test('notify.read 全部已读后未读数归零', async () => {
  store.clear()
  await call(makeReq({ method: 'POST', body: { action: 'notify.push', notification: { kind: 'publish.done', title: 'A' } } }))
  await call(makeReq({ method: 'POST', body: { action: 'notify.push', notification: { kind: 'publish.fail', title: 'B' } } }))

  const before = await call(makeReq({ query: { notifications: '1' } }))
  assert.equal(before.payload.summary.unread, 2)

  await call(makeReq({ method: 'POST', body: { action: 'notify.read', ids: [] } }))

  const after1 = await call(makeReq({ query: { notifications: '1' } }))
  assert.equal(after1.payload.summary.unread, 0)

  const unreadOnly = await call(makeReq({ query: { notifications: '1', unread: '1' } }))
  assert.equal(unreadOnly.payload.matched, 0)
})

test('notify.read 指定 ids 只标记对应条目', async () => {
  store.clear()
  await call(makeReq({ method: 'POST', body: { action: 'notify.push', notification: { kind: 'publish.done', title: 'A', ts: '2026-01-01T00:00:00.000Z' } } }))
  await call(makeReq({ method: 'POST', body: { action: 'notify.push', notification: { kind: 'publish.fail', title: 'B', ts: '2026-01-02T00:00:00.000Z' } } }))

  const all = await call(makeReq({ query: { notifications: '1' } }))
  const target = all.payload.items.find(n => n.kind === 'publish.fail')
  await call(makeReq({ method: 'POST', body: { action: 'notify.read', ids: [target.id] } }))

  const r = await call(makeReq({ query: { notifications: '1' } }))
  const done = r.payload.items.find(n => n.kind === 'publish.done')
  const fail = r.payload.items.find(n => n.kind === 'publish.fail')
  assert.equal(done.read, false)
  assert.equal(fail.read, true)
})

test('notify.clear 清空通知', async () => {
  store.clear()
  await call(makeReq({ method: 'POST', body: { action: 'notify.push', notification: { kind: 'publish.done' } } }))
  await call(makeReq({ method: 'POST', body: { action: 'notify.clear' } }))
  const r = await call(makeReq({ query: { notifications: '1' } }))
  assert.equal(r.payload.total, 0)
})

test('health.down 冷却期内重复事件被折叠为一条', async () => {
  store.clear()
  const base = { kind: 'health.down', target: 'cex1', title: '站点不可达' }
  await call(makeReq({ method: 'POST', body: { action: 'notify.push', notification: { ...base, ts: '2026-02-01T00:00:00.000Z' } } }))
  await call(makeReq({ method: 'POST', body: { action: 'notify.push', notification: { ...base, ts: '2026-02-01T01:00:00.000Z' } } }))

  const r = await call(makeReq({ query: { notifications: '1' } }))
  assert.equal(r.payload.total, 1)
})

/* ---------------- 异常路径 ---------------- */

test('未知动作 → 400', async () => {
  const res = await call(makeReq({ method: 'POST', body: { action: 'nope' } }))
  assert.equal(res.statusCode, 400)
  assert.match(res.payload.error, /未知动作/)
})

test('非法 JSON body → 400', async () => {
  const res = await call(makeReq({ method: 'POST', body: '{bad json' }))
  assert.equal(res.statusCode, 400)
})

test('不支持的方法 → 405', async () => {
  const res = await call(makeReq({ method: 'DELETE' }))
  assert.equal(res.statusCode, 405)
})