/**
 * `server/store.mjs`（Blob 同名同签名适配层）用例：**真库真表**，不 mock。
 *
 * 这是 v9 数据回归的承重墙 —— 六个接口的 CAS/快照/限流逻辑全压在它上面，
 * 而「条件写防丢更新」是真实踩过坑的不变量。这里不 mock 的理由：mock 只能证明
 * 「接口逻辑对着想象中的存储是对的」，证明不了「存储本身的行为与 Blob 一致」。
 * 两层都要有：test-sites-cas 用假存储验接口逻辑，这里用真 SQLite 验存储语义。
 *
 * 运行：node tools/console/test-store.mjs
 * （NAV_STORE_DIR 指向临时目录，进程内一次性初始化，用例间靠唯一 pathname 隔离）
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 必须在 import store 之前定好数据目录：模块在 import 时就建库
const dir = mkdtempSync(join(tmpdir(), 'nav-store-'))
process.env.NAV_STORE_DIR = dir

const { get, put, list, del, etagOf, close, BlobPreconditionFailedError } = await import('../../server/store.mjs')

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

try {
  /* ══════════ 1. 基本读写：get/put 往返 ══════════ */

  eq(await get('no/such.json'), null, '读不存在的对象返回 null（不是抛错）')

  const w1 = await put('a/one.json', JSON.stringify({ hello: 'world' }), { contentType: 'application/json' })
  ok(w1 && w1.etag, 'put 返回 etag', w1 && w1.etag)
  const r1 = await get('a/one.json')
  ok(r1 && r1.stream, 'get 返回带 stream 的对象')
  const text1 = await new Response(r1.stream).text()
  eq(text1, '{"hello":"world"}', 'stream 读回的内容与写入一致')
  ok(r1.blob && r1.blob.etag && r1.etag, 'etag 在 blob.etag 与顶层都有（sites.js 两个位置都读）', r1.etag)
  ok(/^#?[0-9a-f-]{36}$/i.test(r1.etag), 'etag 是 UUID 形态（每次写入变化）')

  /* ══════════ 2. 覆盖写：etag 必须变化 ══════════ */

  const w2 = await put('a/one.json', JSON.stringify({ hello: 'v2' }), { contentType: 'application/json' })
  ok(w2.etag !== w1.etag, '覆盖写后 etag 变化（条件请求/304 的根基）')
  const r2 = await get('a/one.json')
  eq(await new Response(r2.stream).text(), '{"hello":"v2"}', '覆盖写后读到新内容')

  /* ══════════ 3. CAS：ifMatch 不符 → BlobPreconditionFailedError（防丢更新的命门）══════════ */

  {
    const stale = w1.etag // 故意用过期的 etag
    let threw = null
    try { await put('a/one.json', '{"stale":true}', { ifMatch: stale, allowOverwrite: true }) } catch (e) { threw = e }
    ok(threw instanceof BlobPreconditionFailedError,
      '过期 ifMatch 抛 BlobPreconditionFailedError（不是普通 Error）', threw && threw.name)
    const cur = await get('a/one.json')
    eq(await new Response(cur.stream).text(), '{"hello":"v2"}', '条件写失败后数据未被覆盖（没有静默丢更新）')

    // ifMatch 正确时才允许覆盖
    const w3 = await put('a/one.json', '{"hello":"v3"}', { ifMatch: w2.etag, allowOverwrite: true })
    ok(w3.etag !== w2.etag, 'ifMatch 命中时写入成功')
  }

  /* ══════════ 4. allowOverwrite:false：已存在 → 抛错（宁可报错也不覆盖）══════════ */

  {
    let threw = null
    try { await put('a/one.json', '{"clobber":true}', { allowOverwrite: false }) } catch (e) { threw = e }
    ok(Boolean(threw), 'allowOverwrite:false 且对象已存在 → 抛错', threw && threw.message)
    const cur = await get('a/one.json')
    eq(await new Response(cur.stream).text(), '{"hello":"v3"}', '拒绝覆盖后原数据完好')
  }

  /* ══════════ 5. list：prefix 过滤 + limit + 字段齐全 ══════════ */

  await put('snapshots/s-v1.json', '{}', {})
  await put('snapshots/s-v2.json', '{}', {})
  {
    const all = await list({ prefix: 'snapshots/', limit: 1000 })
    eq(all.blobs.length, 2, 'prefix 过滤命中 2 份快照', all.blobs.map(b => b.pathname).join(','))
    ok(all.blobs.every(b => b.pathname && typeof b.size === 'number' && b.uploadedAt),
      'list 的 blobs 元素带 pathname/size/uploadedAt（快照裁剪与展示依赖它们）')
    const limited = await list({ prefix: 'snapshots/', limit: 1 })
    eq(limited.blobs.length, 1, 'limit 生效')
    const none = await list({ prefix: 'nothing/' })
    eq(none.blobs.length, 0, 'prefix 不命中返回空数组（不是 null）')
  }

  /* ══════════ 6. del：单个与数组 ══════════ */

  {
    await del(['snapshots/s-v1.json'])
    eq((await get('snapshots/s-v1.json')), null, 'del 单个后读不到')
    await del(['snapshots/s-v2.json', 'a/one.json'])
    eq((await get('a/one.json')), null, 'del 数组后读不到')
    eq((await list({ prefix: 'snapshots/' })).blobs.length, 0, '删除后 list 清空')
  }

  /* ══════════ 7. etagOf：只读 etag 不搬 body（HTTP 层 304 用）══════════ */

  {
    const w = await put('etag/of.json', '{"x":1}', {})
    eq(etagOf('etag/of.json'), w.etag, 'etagOf 与 put 返回的 etag 一致')
    eq(etagOf('etag/missing.json'), null, 'etagOf 对不存在的对象返回 null')
  }

  /* ══════════ 8. 首启迁移：空库 + api/sites-data.json → 自动导入 sites.json ══════════ */

  {
    // 本测试进程的库是全新的（临时目录），首启迁移应已把 300 条种子导入 sites.json
    const seeded = await get('sites.json')
    ok(Boolean(seeded), '首启迁移已写入 sites.json')
    const data = JSON.parse(await new Response(seeded.stream).text())
    ok(Array.isArray(data.sites) && data.sites.length >= 300,
      '种子含完整站点表', `实得 ${Array.isArray(data.sites) ? data.sites.length : '非数组'} 条`)
    eq(data.version, 1, '种子 version 为 1（客户端 cloudVersion 不持久化，刷新后从 0 起步可正常应用）')
    ok(Number.isFinite(Date.parse(data.updatedAt)), '带 updatedAt')
  }

  /* ══════════ 9. 大体量：会话 512KB 上限内的写入不劣化 ══════════ */

  {
    const big = { data: { pad: 'x'.repeat(400 * 1024) } }
    const t0 = Date.now()
    const w = await put('session/big-test.json', JSON.stringify(big), { contentType: 'application/json' })
    const r = await get('session/big-test.json')
    const text = await new Response(r.stream).text()
    ok(text.length > 400 * 1024, '400KB 会话体完整写入读出', `${(text.length / 1024).toFixed(0)}KB`)
    ok(Date.now() - t0 < 3000, '400KB 写入读出耗时可接受', `${Date.now() - t0}ms`)
    await del('session/big-test.json')
  }
} finally {
  // 先关句柄再清目录：SQLite 持着 WAL 文件时 rm 会 EBUSY
  try { close() } catch { /* 重复关闭无害 */ }
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清不掉就留给系统临时目录自清 */ }
}

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 存储适配层 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 存储适配层全部通过：${pass} 条断言`)
process.exit(0)
