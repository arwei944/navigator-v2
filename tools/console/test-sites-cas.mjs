/**
 * 第三批 · 序 20 / 22 的守卫：站点数据的**写入安全**。
 *
 * 两件事都属于「静默丢数据」，所以都不能只靠界面上「看起来对了」来验证：
 *
 *   序 22（条件写）—— sites.json 是 read-modify-write（读 version → +1 → 写回），而 Blob 无事务。
 *     两个并发 POST 各自读到同一份 version、各自写 +1，后写的把先写的整份覆盖 —— 一次静默丢更新。
 *     现在写入带 `ifMatch: <读到时的 ETag>`，冲突抛 BlobPreconditionFailedError → 409 让调用方重试。
 *
 *   序 20（元素级门禁）—— 站点表是全站渲染的唯一输入。空数组 / 缺 id / 同 id 落盘即白屏，
 *     而线上没有比它更新的兜底。写入前与读取后都用同一把尺子（shared/sanitize.mjs）量。
 *     另外「读失败」与「没有数据」必须分开：前者 503，绝不写；后者才允许种子初始化。
 *
 * 用 `node:test` 的模块 mock 顶掉 `@vercel/blob`（含 ETag 与条件写语义），不联网、无凭据。
 * 运行：node --experimental-test-module-mocks tools/console/test-sites-cas.mjs
 */
import { test, mock, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { snapshotPathname } from '../../shared/snapshots.mjs'

/* ---------------- 带 ETag 与条件写语义的假 Blob ---------------- */

/** pathname -> { text, etag } */
const store = new Map()
let etagSeq = 0
const nextEtag = () => `etag-${++etagSeq}`

/** 可注入的「在 put 真正落盘之前」钩子 —— 用来模拟 read 与 write 之间的并发写入 */
const hooks = { beforePut: null }
/** 可注入的读故障 —— 用来验证「读失败 ≠ 没有数据」 */
const fail = { get: false }

class BlobPreconditionFailedError extends Error {
  constructor(msg = 'precondition failed') { super(msg); this.name = 'BlobPreconditionFailedError' }
}

mock.module('@vercel/blob', {
  namedExports: {
    BlobPreconditionFailedError,
    get: async (pathname) => {
      if (fail.get) throw new Error('blob read exploded')
      const e = store.get(pathname)
      if (!e) return null
      return { stream: new Response(e.text).body, blob: { etag: e.etag, pathname } }
    },
    put: async (pathname, body, opts = {}) => {
      if (hooks.beforePut) hooks.beforePut(pathname, opts)
      const cur = store.get(pathname)
      if (opts.ifMatch) {
        // 条件写：只有当调用方读到的 ETag 仍是最新的才允许写
        if (!cur || cur.etag !== opts.ifMatch) throw new BlobPreconditionFailedError()
      } else if (opts.allowOverwrite === false && cur) {
        throw new Error('This blob already exists')
      }
      store.set(pathname, { text: String(body), etag: nextEtag() })
      return { pathname }
    },
    list: async ({ prefix = '' } = {}) => ({
      blobs: [...store.keys()].filter(k => k.startsWith(prefix)).map(pathname => ({ pathname, size: 1, uploadedAt: new Date() })),
    }),
    del: async (pathnames) => {
      for (const p of Array.isArray(pathnames) ? pathnames : [pathnames]) store.delete(p)
      return { deleted: 1 }
    },
  },
})

const ADMIN_KEY = 'test-admin-key'
process.env.SITES_ADMIN_KEY = ADMIN_KEY

const { default: handler } = await import('../../api/sites.js')

/* ---------------- 请求 / 响应桩 ---------------- */

function makeReq({ method = 'GET', query = {}, body, headers = {} } = {}) {
  return { method, query, body, headers: { authorization: `Bearer ${ADMIN_KEY}`, ...headers } }
}
function makeRes() {
  const res = {
    statusCode: 200, headers: {}, payload: null,
    setHeader(k, v) { res.headers[k] = v }, removeHeader() {},
    status(k) { res.statusCode = k; return res },
    json(p) { res.payload = p; return res },
  }
  return res
}
async function call(req) { const res = makeRes(); await handler(req, res); return res }

const SITE = (id) => ({ id, name: `站点${id}`, url: `https://${id}.example.com` })
const OK_SITES = [SITE('a'), SITE('b')]

beforeEach(() => { hooks.beforePut = null; fail.get = false })

after(() => { delete process.env.SITES_ADMIN_KEY })

/* ══════════ 序 20：读侧门禁 ══════════ */

test('GET：Blob 为空（首次部署）→ 写入种子并返回 version 1', async () => {
  store.clear()
  const res = await call(makeReq())
  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.version, 1)
  assert.ok(Array.isArray(res.payload.sites) && res.payload.sites.length > 0, '种子应是非空站点表')
  assert.ok(store.has('sites.json'), '种子应真的落盘')
})

test('GET：读失败 → 503 degraded，**不写 Blob**（绝不用种子覆盖真实数据）', async () => {
  store.clear()
  store.set('sites.json', { text: JSON.stringify({ version: 42, sites: [SITE('x')] }), etag: nextEtag() })
  const before = store.get('sites.json').text
  fail.get = true
  const res = await call(makeReq())
  assert.equal(res.statusCode, 503)
  assert.equal(res.payload.degraded, true)
  fail.get = false
  assert.equal(store.get('sites.json').text, before, '读故障时不能改写线上数据')
})

test('GET：存的数据结构不合法 → 503 degraded（不覆盖，留证据给运维回滚）', async () => {
  for (const bad of [[], [{ id: 'a' }], [{ id: 'a', name: 'A', url: 'u' }, { id: 'a', name: 'B', url: 'u' }]]) {
    store.clear()
    store.set('sites.json', { text: JSON.stringify({ version: 7, sites: bad }), etag: nextEtag() })
    const res = await call(makeReq())
    assert.equal(res.statusCode, 503, `sites=${JSON.stringify(bad)} 应判为不合法`)
    assert.equal(res.payload.degraded, true)
  }
})

test('GET：数据合法 → 原样返回', async () => {
  store.clear()
  store.set('sites.json', { text: JSON.stringify({ version: 122, sites: OK_SITES, categories: [] }), etag: nextEtag() })
  const res = await call(makeReq())
  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.version, 122)
  assert.equal(res.payload.sites.length, 2)
})

test('GET：站点表走可重验证缓存（不是 no-store，否则每次轮询全量下载）', async () => {
  store.clear()
  store.set('sites.json', { text: JSON.stringify({ version: 1, sites: OK_SITES }), etag: nextEtag() })
  const res = await call(makeReq())
  assert.match(res.headers['Cache-Control'], /must-revalidate/)
  assert.doesNotMatch(res.headers['Cache-Control'], /no-store/)
})

/* ══════════ 序 20：写侧门禁 ══════════ */

test('POST：无鉴权 → 401', async () => {
  const res = await call(makeReq({ method: 'POST', headers: { authorization: '' }, body: { sites: OK_SITES } }))
  assert.equal(res.statusCode, 401)
})

test('POST：站点表非法 → 400（空数组 / 缺字段 / 重复 id）', async () => {
  for (const sites of [[], 'nope', [{ id: 'a' }], [{ id: '', name: 'N', url: 'u' }], [SITE('a'), SITE('a')]]) {
    const res = await call(makeReq({ method: 'POST', body: { sites } }))
    assert.equal(res.statusCode, 400, `sites=${JSON.stringify(sites)} 应被拒`)
  }
})

test('POST：分类表非法 → 400', async () => {
  const res = await call(makeReq({ method: 'POST', body: { sites: OK_SITES, categories: [{ id: '', name: '' }] } }))
  assert.equal(res.statusCode, 400)
  assert.match(res.payload.error, /分类表/)
})

test('POST：写前读失败 → 503，不写成「没有前值」的样子', async () => {
  store.clear()
  fail.get = true
  const res = await call(makeReq({ method: 'POST', body: { sites: OK_SITES } }))
  assert.equal(res.statusCode, 503)
  fail.get = false
  assert.equal(store.has('sites.json'), false, '读故障时绝不能落盘')
})

/* ══════════ 序 22：条件写 ══════════ */

test('POST：正常写入 → version 递增，且为「即将被覆盖的旧数据」留了快照', async () => {
  store.clear()
  store.set('sites.json', { text: JSON.stringify({ version: 10, sites: [SITE('old')] }), etag: nextEtag() })
  const res = await call(makeReq({ method: 'POST', body: { sites: OK_SITES } }))
  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.version, 11)
  assert.equal(res.payload.snapshot.ok, true, '快照写入结果应回报给调用方')
  const snapshotKeys = [...store.keys()].filter(k => k.startsWith('sites-data.snapshots/'))
  assert.equal(snapshotKeys.length, 1, '应落一份回滚快照')
  assert.match(store.get(snapshotKeys[0]).text, /站点old/, '快照内容应是**写入前**的数据')
})

test('POST：读与写之间被别的写入抢先 → 409 precondition-failed（而不是静默覆盖）', async () => {
  store.clear()
  store.set('sites.json', { text: JSON.stringify({ version: 10, sites: [SITE('old')] }), etag: nextEtag() })
  // 模拟并发：handler 已用 E1 读完，落盘前另一路写入把 ETag 换掉了
  hooks.beforePut = () => { const e = store.get('sites.json'); if (e) e.etag = 'CONCURRENT-WRITE' }
  const res = await call(makeReq({ method: 'POST', body: { sites: OK_SITES } }))
  assert.equal(res.statusCode, 409)
  assert.equal(res.payload.reason, 'precondition-failed')
})

test('POST：写入确实带了 ifMatch（对照：没有它就会覆盖）', async () => {
  store.clear()
  store.set('sites.json', { text: JSON.stringify({ version: 1, sites: [SITE('old')] }), etag: 'E1' })
  let seen = null
  hooks.beforePut = (pathname, opts) => { if (pathname === 'sites.json') seen = opts }
  await call(makeReq({ method: 'POST', body: { sites: OK_SITES } }))
  assert.equal(seen?.ifMatch, 'E1', '主数据写入必须带 ifMatch = 读到的 ETag')
  assert.equal(seen?.allowOverwrite, true, '带 ifMatch 时 allowOverwrite 必须为 true，否则条件写不生效')
})

test('POST：省略 categories → 沿用前值（旧客户端发布不会把分类表清空）', async () => {
  store.clear()
  const cats = [{ id: 'dev', name: '开发', children: [{ id: 'dev.ai', name: 'AI' }] }]
  store.set('sites.json', { text: JSON.stringify({ version: 3, sites: [SITE('old')], categories: cats }), etag: nextEtag() })
  const res = await call(makeReq({ method: 'POST', body: { sites: OK_SITES } }))
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.payload.categories, cats)
})

/* ══════════ 快照 / 回滚面 ══════════ */

test('GET ?snapshots=1：无鉴权 → 401（运维面数据）', async () => {
  const res = await call(makeReq({ query: { snapshots: '1' }, headers: { authorization: '' } }))
  assert.equal(res.statusCode, 401)
})

const SNAP = (v, iso, rand) => snapshotPathname(v, new Date(iso), rand)

test('POST rollback：非法快照名 → 400', async () => {
  store.clear()
  store.set('sites.json', { text: JSON.stringify({ version: 5, sites: [SITE('old')] }), etag: nextEtag() })
  const bad = ['../../etc/passwd', 'sites.json', '', 'sites-data.snapshots/', 'sites-data.snapshots/nope.json']
  for (const snapshot of bad) {
    const res = await call(makeReq({ method: 'POST', body: { action: 'rollback', snapshot } }))
    assert.equal(res.statusCode, 400, `snapshot=${JSON.stringify(snapshot)} 应被拒`)
  }
})

test('POST rollback：快照内容不合法 → 400（不能用旧脏数据把站点表打崩）', async () => {
  store.clear()
  store.set('sites.json', { text: JSON.stringify({ version: 5, sites: [SITE('old')] }), etag: nextEtag() })
  const p = SNAP(4, '2026-01-01T00:00:00.000Z', 'aaaaaa')
  store.set(p, { text: JSON.stringify({ version: 4, sites: [] }), etag: nextEtag() })
  const res = await call(makeReq({ method: 'POST', body: { action: 'rollback', snapshot: p } }))
  assert.equal(res.statusCode, 400)
  assert.match(res.payload.error, /快照内容无效/)
})

test('POST rollback：合法快照 → 回滚成功且 version 继续递增（不回退计数）', async () => {
  store.clear()
  store.set('sites.json', { text: JSON.stringify({ version: 9, sites: [SITE('current')] }), etag: nextEtag() })
  const p = SNAP(4, '2026-01-02T00:00:00.000Z', 'bbbbbb')
  store.set(p, { text: JSON.stringify({ version: 4, sites: [SITE('restored')] }), etag: nextEtag() })
  const res = await call(makeReq({ method: 'POST', body: { action: 'rollback', snapshot: p } }))
  assert.equal(res.statusCode, 200, JSON.stringify(res.payload))
  assert.equal(res.payload.version, 10, 'version 必须继续递增，否则并发条件写会误判')
  assert.equal(res.payload.sites[0].id, 'restored')
  assert.equal(res.payload.restoredFrom, p)
})
