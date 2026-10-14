#!/usr/bin/env node
/**
 * 站点存储 provider 自测：不联网（kv 用内存替身，fs 用临时目录）。
 *
 * 覆盖：
 *   ① 注册校验（缺 id / 缺 create 抛错）
 *   ② resolveSiteStore 的选择优先级（显式 id → env → available）
 *   ③ nextVersion 纯函数与「provider 不改传入 data」这条契约
 *   ④ **契约一致性**：kv 与 fs 两个 provider 跑同一操作序列，结果必须同形
 *   ⑤ CAS 闸门：ifMatch 不符必须抛（并发静默丢更新的唯一防线）
 *   ⑥ 快照：写前落盘、列表、按 SNAPSHOT_KEEP 裁剪
 *   ⑦ capabilities 如实声明（fs 的 cas 必须是 false）
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  registerSiteStore, listSiteStores, resolveSiteStore, nextVersion,
} from '../../shared/site-store.mjs'
import { SNAPSHOT_PREFIX, SNAPSHOT_KEEP } from '../../shared/snapshots.mjs'

let pass = 0
let fail = 0
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass += 1 } catch (e) { console.log('  ✖ ' + name + ' — ' + e.message); fail += 1 }
}
async function checkAsync(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); pass += 1 } catch (e) { console.log('  ✖ ' + name + ' — ' + e.message); fail += 1 }
}

/** 内存版 kv，接口与 #store 同形（get/put/list/del + etag + CAS） */
function makeFakeKv() {
  const map = new Map()
  let n = 0
  return {
    async get(pathname) {
      const r = map.get(String(pathname))
      if (!r) return null
      return {
        ok: true, pathname: String(pathname), etag: r.etag,
        blob: { etag: r.etag }, stream: new Blob([r.body]).stream(),
      }
    },
    async put(pathname, body, opts = {}) {
      const key = String(pathname)
      const cur = map.get(key)
      if (opts.ifMatch != null && (!cur || cur.etag !== opts.ifMatch)) {
        const e = new Error('The precondition in the request does not match')
        e.name = 'BlobPreconditionFailedError'
        throw e
      }
      if (opts.allowOverwrite === false && cur) throw new Error('This blob already exists')
      n += 1
      const etag = 'e' + n
      map.set(key, { body: String(body), etag })
      return { pathname: key, etag }
    },
    async list({ prefix = '', limit = 1000 } = {}) {
      return {
        blobs: [...map.keys()].filter(k => k.startsWith(prefix)).slice(0, limit)
          .map(k => ({ pathname: k, size: map.get(k).body.length, uploadedAt: '' })),
        hasMore: false, cursor: '',
      }
    },
    async del(pathnames) {
      for (const p of (Array.isArray(pathnames) ? pathnames : [pathnames])) map.delete(String(p))
      return {}
    },
  }
}

/** 同一套操作序列，跑遍两个 provider —— 结果必须同形 */
async function exercise(store, label) {
  // 初始：无数据
  const empty = await store.read()
  assert.equal(empty.data, null, `${label}: 初始应为空`)

  // 首次写入（无 ifMatch）
  const d1 = { version: nextVersion(null), sites: [{ id: 'a' }] }
  const w1 = await store.write(d1, {})
  assert.ok(w1.etag, `${label}: write 应回 etag`)

  const r1 = await store.read()
  assert.equal(r1.data.version, 1, `${label}: 版本应为 1`)
  assert.equal(r1.data.sites[0].id, 'a', `${label}: 内容应可读回`)
  assert.equal(r1.etag, w1.etag, `${label}: read 的 etag 应与 write 返回值一致`)

  // CAS：错误的 ifMatch 必须抛
  await assert.rejects(() => store.write({ version: 2, sites: [] }, { ifMatch: 'stale' }), null, `${label}: 过期 ifMatch 应抛`)

  // CAS：正确 ifMatch 通过
  const d2 = { version: nextVersion(r1.data), sites: [{ id: 'a' }, { id: 'b' }] }
  await store.write(d2, { ifMatch: r1.etag })
  const r2 = await store.read()
  assert.equal(r2.data.version, 2, `${label}: 版本应递增到 2`)
  assert.equal(r2.data.sites.length, 2, `${label}: 第二次写入应生效`)

  // 快照：写前落盘（传入的是「被覆盖的当前数据」）
  const snap = await store.writeSnapshot(r1.data)
  assert.equal(snap.ok, true, `${label}: 快照应成功`)
  assert.ok(String(snap.pathname).startsWith(SNAPSHOT_PREFIX), `${label}: 快照路径应带前缀`)

  const snaps = await store.listSnapshots()
  assert.ok(snaps.length >= 1, `${label}: 快照列表应非空`)

  // 裁剪：塞满超过保留数后必须只留 SNAPSHOT_KEEP
  for (let i = 0; i < SNAPSHOT_KEEP + 3; i += 1) {
    await store.writeSnapshot({ version: i + 100, sites: [] })
  }
  const before = (await store.listSnapshots()).length
  assert.ok(before > SNAPSHOT_KEEP, `${label}: 应已超出保留数（实得 ${before}）`)
  const pruned = await store.pruneSnapshots()
  assert.ok(pruned.deleted > 0, `${label}: 应裁掉一些`)
  const after = (await store.listSnapshots()).length
  assert.ok(after <= SNAPSHOT_KEEP, `${label}: 裁剪后应 ≤ ${SNAPSHOT_KEEP}（实得 ${after}）`)

  // provider 不改传入的 data（版本递增是调用方的事）
  const frozen = { version: 7, sites: [] }
  await store.write(frozen, {})
  assert.equal(frozen.version, 7, `${label}: provider 不该改动传入的 data`)

  /* ---- 契约加固：与 api/sites.js 生产语义逐条对齐 ---- */

  // createOnly：对象已存在时必须抛。这是「首次部署」的并发保护 ——
  // 两个冷启动同时读到「没有数据」，只有一个能创建成功，另一个必须失败而不是互相覆盖。
  await assert.rejects(
    () => store.write({ version: 99, sites: [] }, { createOnly: true }),
    null, `${label}: createOnly 在已存在对象上必须抛`
  )

  // readAt：读任意 pathname（快照内容读取用）；不存在时返回 null
  assert.equal(
    await store.readAt(`${SNAPSHOT_PREFIX}missing-${label}.json`),
    null, `${label}: readAt 不存在应返回 null`
  )
}

async function main() {
  console.log('\n注册表校验')
  check('缺 id 抛错', () => { assert.throws(() => registerSiteStore({ create: () => ({}) })) })
  check('缺 create 抛错', () => { assert.throws(() => registerSiteStore({ id: 'x-nocreate' })) })

  console.log('\n解析优先级（resolveSiteStore）')
  check('显式 id 优先', () => {
    const kv = resolveSiteStore({ explicit: 'kv', ctx: { kv: makeFakeKv() } })
    assert.equal(kv.id, 'kv')
    const fsSt = resolveSiteStore({ explicit: 'fs', ctx: { dir: os.tmpdir(), fs, path } })
    assert.equal(fsSt.id, 'fs')
  })
  check('ctx 不满足 available 时回落到可用的那个', () => {
    // 只给 dir（没有 kv）→ 应落到 fs
    const st = resolveSiteStore({ ctx: { dir: os.tmpdir(), fs, path } })
    assert.equal(st.id, 'fs')
  })
  check('显式 id 但 ctx 不满足 → 回落到可用的（不返回一个建不出来的 provider）', () => {
    // 显式要 fs，却只给了 kv：fs 的 available(ctx) 为假，此时不能硬返回 fs ——
    // create(ctx) 会崩在 path.join(undefined)。回落的目标只会是 ctx 真正支持的那个。
    const st = resolveSiteStore({ explicit: 'fs', ctx: { kv: makeFakeKv() } })
    assert.equal(st.id, 'kv')
  })
  check('capabilities 如实合并进实例', () => {
    const kv = resolveSiteStore({ explicit: 'kv', ctx: { kv: makeFakeKv() } })
    const fss = resolveSiteStore({ explicit: 'fs', ctx: { dir: os.tmpdir(), fs, path } })
    assert.equal(kv.cas, true)
    assert.equal(fss.cas, false, 'fs 没有原子 CAS，必须如实声明为 false')
    assert.equal(kv.snapshots, true)
  })

  console.log('\nnextVersion')
  check('空/无 version → 1；有 → 递增', () => {
    assert.equal(nextVersion(null), 1)
    assert.equal(nextVersion({}), 1)
    assert.equal(nextVersion({ version: 3 }), 4)
    assert.equal(nextVersion({ version: '9' }), 10)
  })

  console.log('\n契约一致性（同一操作序列跑两个 provider）')
  await checkAsync('kv provider 满足全部契约', async () => {
    await exercise(resolveSiteStore({ explicit: 'kv', ctx: { kv: makeFakeKv() } }), 'kv')
  })
  await checkAsync('fs provider 满足全部契约', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-store-'))
    try {
      await exercise(resolveSiteStore({ explicit: 'fs', ctx: { dir, fs, path } }), 'fs')
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* 忽略 */ }
    }
  })

  console.log('\n契约加固（与 api/sites.js 生产语义对齐）')

  /** 记录底层 put 收到的 opts —— 用来断言 provider 真的把语义传下去了，而不只是自己「看起来对」 */
  function spyKv() {
    const kv = makeFakeKv()
    const seen = []
    return {
      seen,
      kv: {
        ...kv,
        put: async (pathname, body, opts = {}) => {
          seen.push({ pathname: String(pathname), opts })
          return kv.put(pathname, body, opts)
        },
      },
    }
  }

  await checkAsync('read：坏 JSON 必须抛错（静默返回 null 会被当成「没存过」→ 种子覆盖线上数据）', async () => {
    const kv = makeFakeKv()
    const st = resolveSiteStore({ explicit: 'kv', ctx: { kv } })
    await kv.put('sites.json', '{ 这不是 JSON', { allowOverwrite: true })
    await assert.rejects(() => st.read(), null, '解析失败必须抛，绝不能返回 data:null')
  })

  await checkAsync('write：createOnly 落到 allowOverwrite:false，空库成功、已存在抛错', async () => {
    const s = spyKv()
    const st = resolveSiteStore({ explicit: 'kv', ctx: { kv: s.kv } })
    await st.write({ version: 1, sites: [] }, { createOnly: true })
    assert.equal(s.seen[0].opts.allowOverwrite, false, 'createOnly 必须落到 allowOverwrite:false')
    await assert.rejects(
      () => st.write({ version: 2, sites: [] }, { createOnly: true }),
      null, '已存在时 createOnly 必须抛'
    )
  })

  await checkAsync('write：带 ifMatch 时 allowOverwrite 必须为 true（否则条件写不生效）', async () => {
    const s = spyKv()
    const st = resolveSiteStore({ explicit: 'kv', ctx: { kv: s.kv } })
    await st.write({ version: 1, sites: [] }, {})
    const { etag } = await st.read()
    s.seen.length = 0
    await st.write({ version: 2, sites: [] }, { ifMatch: etag })
    assert.equal(s.seen[0].opts.ifMatch, etag, 'ifMatch 必须原样传给底层')
    assert.equal(s.seen[0].opts.allowOverwrite, true, '带 ifMatch 时 allowOverwrite 必须为 true')
  })

  await checkAsync('writeSnapshot：落盘必须 allowOverwrite:false（撞名宁可报错也不覆盖回滚兜底）', async () => {
    const s = spyKv()
    const st = resolveSiteStore({ explicit: 'kv', ctx: { kv: s.kv } })
    const snap = await st.writeSnapshot({ version: 3, sites: [] })
    assert.equal(snap.ok, true)
    const put = s.seen.find(x => x.pathname.startsWith(SNAPSHOT_PREFIX))
    assert.ok(put, '应落一份快照')
    assert.equal(put.opts.allowOverwrite, false, '快照写入必须禁止覆盖')
  })

  await checkAsync('pruneSnapshots：返回 { ok, deleted }（响应字段不能丢）', async () => {
    const st = resolveSiteStore({ explicit: 'kv', ctx: { kv: makeFakeKv() } })
    const pruned = await st.pruneSnapshots()
    assert.equal(pruned.ok, true)
    assert.equal(typeof pruned.deleted, 'number')
  })

  await checkAsync('readAt：读任意 pathname / 不存在返回 null / 坏 JSON 抛', async () => {
    const kv = makeFakeKv()
    const st = resolveSiteStore({ explicit: 'kv', ctx: { kv } })
    assert.equal(await st.readAt(`${SNAPSHOT_PREFIX}missing.json`), null)
    await kv.put(`${SNAPSHOT_PREFIX}ok.json`, JSON.stringify({ v: 7 }), { allowOverwrite: true })
    assert.deepEqual(await st.readAt(`${SNAPSHOT_PREFIX}ok.json`), { v: 7 })
    await kv.put(`${SNAPSHOT_PREFIX}bad.json`, 'nope{', { allowOverwrite: true })
    await assert.rejects(() => st.readAt(`${SNAPSHOT_PREFIX}bad.json`), null)
  })

  console.log('\n清单')
  check('listSiteStores 列出两 provider 及能力', () => {
    const ids = listSiteStores({ check: false }).map(s => s.id)
    assert.deepEqual(ids, ['kv', 'fs'])
    const kv = listSiteStores({ check: false }).find(s => s.id === 'kv')
    assert.deepEqual(kv.capabilities, { cas: true, snapshots: true, listable: true })
  })

  console.log(`\nsite-store 自测：${pass} 通过 / ${fail} 失败`)
  process.exitCode = fail ? 1 : 0
}

main()
