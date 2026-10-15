/**
 * 「重新获取信息」用例：零依赖、不联网（抓取 / 翻译 / 写回都是注入的）。
 *
 * 这里守的是几句用户可见的语义：
 *  1. 刷新**只改页面能读到的字段**，绝不碰别名 / 用途 / 分类 —— 那几项是人填的；
 *  2. 抓到的与库里一致时**不写**（不空转 updatedAt，也不弹「已更新」骗人）；
 *  3. 刷新必须**绕过会话缓存**（用户点的就是「要最新的」）；
 *  4. 任何失败都不抛错，只回 `ok:false` + 原因。
 *
 * 运行：node tools/console/test-site-refresh.mjs
 */
import { refreshSiteMeta } from '../../src/services/siteRefresh.js'

let pass = 0
const failures = []
function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

/** 造一个站点：默认字段齐全 */
function makeSite(over = {}) {
  return {
    id: 's1', name: '旧名', url: 'example.com', desc: '旧描述',
    color: '#111111', initial: '旧', categoryId: 'c1',
    aliases: ['别名A'], purposes: ['coding'],
    ...over,
  }
}

/** 造一个抓取实现，并记录收到的参数（用于断言 skipCache 传下去了） */
function metaReply(data, seen = []) {
  return async (url, opts) => {
    seen.push({ url, opts })
    return { ok: true, status: 200, data }
  }
}

/* ---- 1. 没有网址 → 直接拒绝 ---- */
{
  const r = await refreshSiteMeta({ site: { id: 'x', name: '无网址', url: '' }, update: () => {} })
  eq(r.ok, false, '空网址返回 ok:false')
  eq(r.reason, 'invalid', '空网址的 reason 是 invalid')
}

/* ---- 2. 抓取失败 → 原样带出原因，不抛错 ---- */
{
  const r = await refreshSiteMeta({
    site: makeSite(),
    update: () => { throw new Error('不该被调用') },
    fetchMeta: async () => ({ ok: false, reason: 'timeout', message: '抓取超时（超过 12 秒未响应）' }),
  })
  eq(r.ok, false, '抓取失败返回 ok:false')
  eq(r.reason, 'fetch-failed', 'reason 是 fetch-failed')
  ok(r.message.includes('超时'), '把服务端的原因带出来', r.message)
}

/* ---- 3. 抓到与当前一致 → 不写库、不谎报「已更新」 ---- */
{
  let wrote = null
  const r = await refreshSiteMeta({
    site: makeSite(),
    update: (p) => { wrote = p },
    fetchMeta: metaReply({
      name: '旧名', desc: '旧描述', color: '#111111', domain: 'example.com',
    }),
  })
  eq(r.ok, true, '一致时也是 ok:true（不是失败）')
  eq(r.changed, false, '一致时不写库')
  eq(r.fields.length, 0, '没有字段被改写')
  eq(wrote, null, 'update 根本没被调用')
  eq(r.message, '已是最新', '文案说「已是最新」')
}

/* ---- 4. 抓到新值 → 只改页面能读到的字段 ---- */
{
  const writes = []
  const r = await refreshSiteMeta({
    site: makeSite(),
    update: (p) => writes.push(p),
    fetchMeta: metaReply({
      name: 'Example', desc: '新描述', color: '#222222',
      domain: 'example.com', faviconUrl: 'https://example.com/f.ico',
      needsTranslate: { name: true, desc: true },
    }),
    translate: async () => ({ translated: { name: '示例', desc: '中文描述' }, name: '示例', desc: '中文描述' }),
  })
  eq(r.ok, true, '有新值时 ok:true')
  eq(r.changed, true, '有变化时 changed:true')
  ok(r.fields.includes('name') && r.fields.includes('desc'), 'fields 报告改了名称与描述', r.fields.join('、'))
  eq(writes.length, 2, '两次写：先原文、后译文')
  eq(writes[0].name, 'Example', '第一次写的是抓到的原文名')
  eq(writes[1].name, '示例', '第二次写的是译文名')

  // 关键不变式：别名 / 用途 / 分类是人的判断，刷新绝不能碰
  for (const w of writes) {
    ok(!('aliases' in w), '补丁里不含 aliases')
    ok(!('purposes' in w), '补丁里不含 purposes')
    ok(!('categoryId' in w), '补丁里不含 categoryId')
  }
}

/* ---- 5. 必须绕过会话缓存（用户点的就是「要最新的」） ---- */
{
  const seen = []
  await refreshSiteMeta({
    site: makeSite(),
    update: () => {},
    fetchMeta: metaReply({ name: 'X', domain: 'example.com' }, seen),
  })
  eq(seen.length, 1, '抓取被调用了一次')
  eq(seen[0].opts?.skipCache, true, '抓取时显式要求绕过缓存')
  eq(seen[0].url, 'example.com', '抓的是这条站点的网址')
}

/* ---- 6. 命中反爬（只有推断值）→ 标出来，不当成拿到了真信息 ---- */
{
  const r = await refreshSiteMeta({
    site: makeSite({ name: '', desc: '' }),
    update: () => {},
    fetchMeta: metaReply({ name: 'Example', domain: 'example.com', warning: '命中反爬挑战页，按域名推断' }),
  })
  eq(r.ok, true, '推断值也算刷新成功')
  eq(r.real, false, 'real=false 标明没读到真页面')
}

/* ---- 7. 翻译失败不影响主写回 ---- */
{
  const writes = []
  const r = await refreshSiteMeta({
    site: makeSite(),
    update: (p) => writes.push(p),
    fetchMeta: metaReply({
      name: 'Example', desc: 'd', domain: 'example.com',
      needsTranslate: { name: true, desc: false },
    }),
    translate: async () => { throw new Error('在线引擎配额用尽') },
  })
  eq(r.ok, true, '翻译抛错不影响刷新成功')
  eq(writes.length, 1, '原文仍然写进去了')
  eq(writes[0].name, 'Example', '写的是抓到的原文名')
}

/* ---- 8. 写回抛错 → 归为 error 而不是崩掉调用方 ---- */
{
  const r = await refreshSiteMeta({
    site: makeSite(),
    update: () => { throw new Error('storage quota') },
    fetchMeta: metaReply({ name: 'NewName', domain: 'example.com' }),
    warn: () => {},
  })
  eq(r.ok, false, '写回失败返回 ok:false')
  eq(r.reason, 'error', 'reason 是 error')
}

/* ---- 结果 ---- */
if (failures.length) {
  console.error(`\n❌ 站点刷新 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 站点刷新全部通过：${pass} 条断言`)
