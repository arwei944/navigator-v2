/**
 * v10-P3/P4/P5 的接口守卫：备份恢复、封面提取、AI 降级。
 *
 * 三个都属于「坏了很安静」的能力：备份接口坏了 → 你在某一天才发现没法恢复；
 * 封面坏了 → 卡片少一层图，没人报错；AI 没配 → 入口空着或点开才报错。
 * 所以在这里把它们的**边界**钉住。
 *
 * 运行：node tools/console/test-v10.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.NAV_STORE_DIR = mkdtempSync(join(tmpdir(), 'nav-v10-'))
delete process.env.AI_BASE_URL
delete process.env.AI_API_KEY
// 管理凭据：线上是由 server/main.mjs 从 data/admin-key.txt 回填的，
// 这里直接给环境变量（checkAuthHeader 在调用时才读 env）
process.env.SITES_ADMIN_KEY = 'test-admin-key-0123456789'

const store = await import('../../server/store.mjs')
const backup = (await import('../../api/backup.js')).default
const cover = await import('../../api/cover.js')
const ai = await import('../../api/ai.js')
const { pickCover, pickCoverPrefer } = await import('../../shared/site-infer.mjs')

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

/* ---------------- 请求/响应桩 ---------------- */

function makeRes() {
  const res = {
    statusCode: 200, headers: {}, body: '', ended: false,
    setHeader(k, v) { res.headers[k] = v; return res },
    status(c) { res.statusCode = c; return res },
    json(p) { res.body = JSON.stringify(p); res.ended = true; return res },
    end(b) { if (b) res.body = String(b); res.ended = true; return res },
  }
  return res
}
const KEY = 'test-admin-key-0123456789'
const authReq = (method, body, query = {}) => ({
  method, body, query, headers: { authorization: `Bearer ${KEY}`, 'x-nav-key': KEY }, socket: {},
})

/* ---------------- 1. 封面提取（P3） ---------------- */

eq(pickCover('<meta property="og:image" content="/cover.png">', 'https://s.com/page'), 'https://s.com/cover.png', 'og:image 相对地址按页面解析')
eq(pickCover('<meta property="og:image" content="data:image/gif;base64,R0lGOD">', 'https://s.com/'), '', 'data: 图片不当封面（跟踪像素）')
eq(pickCover('<meta property="og:image" content="javascript:alert(1)">', 'https://s.com/'), '', '非 http(s) 地址被拒')
eq(pickCover('<meta name="twitter:image" content="https://c.com/t.png">', 'https://s.com/'), 'https://c.com/t.png', 'twitter:image 作替补')
eq(pickCover('<meta property="og:image" content="https://a.com/1.png"><meta property="og:image" content="https://a.com/2.png">', 'https://s.com/'), 'https://a.com/1.png', '多个 og:image 取第一个')
eq(pickCover('<html></html>', 'https://s.com/'), '', '没有声明就是没有（封面允许为空）')
eq(pickCoverPrefer(['', '<meta property="og:image" content="https://b.com/a.jpg">'], 'https://s.com/'), 'https://b.com/a.jpg', '多页时子页优先')

{
  // 端点不接受调用方传 URL：site 参数只认站点表里的 id
  const res = makeRes()
  await cover.default({ method: 'GET', query: { site: '../../etc/passwd' }, headers: {} }, res)
  eq(res.statusCode, 400, '非法 site 参数被拒（不能拼进文件路径）')
}
{
  const res = makeRes()
  await cover.default({ method: 'GET', query: { site: 'no-such-site' }, headers: {} }, res)
  eq(res.statusCode, 404, '站点不存在 → 404（不外网）')
}
{
  // 内网站点的封面请求必须被 SSRF 防护挡住（判定依据：不会返回字节）
  await store.put('sites.json', JSON.stringify({
    version: 1, updatedAt: new Date().toISOString(),
    sites: [{ id: 'ssrf1', name: '内网', url: 'http://127.0.0.1:9/' }],
  }), { allowOverwrite: true })
  const res = makeRes()
  await cover.default({ method: 'GET', query: { site: 'ssrf1' }, headers: {} }, res)
  ok(res.statusCode === 204, '内网站点抓封面失败 → 204（不外泄、不 500）', String(res.statusCode))
}

/* ---------------- 2. 备份与恢复（P5） ---------------- */

const SITES = [
  { id: 'b1', name: '备份站一', url: 'a.com', desc: 'd1', categoryId: 'coding', color: '#111', initial: 'B', sortOrder: 0, visitCount: 0, createdAt: 1, updatedAt: 1 },
  { id: 'b2', name: '备份站二', url: 'b.com', desc: 'd2', categoryId: 'tools', color: '#222', initial: 'B', sortOrder: 1, visitCount: 0, createdAt: 2, updatedAt: 2 },
]

{
  await store.put('sites.json', JSON.stringify({ version: 7, updatedAt: new Date().toISOString(), sites: SITES, categories: [{ id: 'coding', label: '编程' }] }), { allowOverwrite: true })
  await store.put('clicks.json', JSON.stringify({ version: 1, clicks: { b1: 3 } }), { allowOverwrite: true })

  const res = makeRes()
  await backup(authReq('GET'), res)
  eq(res.statusCode, 200, '导出 200')
  const dump = JSON.parse(res.body)
  eq(dump.kind, 'navigator-backup', '备份带 kind 标记')
  eq(dump.counts.sites, 2, '导出含 2 个站点')
  eq(dump.counts.categories, 1, '导出含分类')
  eq(dump.counts.version, 7, '导出带当前 version')
  ok(dump.cloud && dump.cloud['clicks.json'], '导出包含旁路数据（点击统计）')
  ok(/attachment; filename=/.test(String(res.headers['Content-Disposition'] || '')), '导出带下载文件名头')
}

{
  // 鉴权：没凭据不能导出
  const res = makeRes()
  await backup({ method: 'GET', query: {}, headers: {}, socket: {} }, res)
  eq(res.statusCode, 401, '无凭据导出 → 401')
}

{
  // 恢复：version 必须前进（否则客户端会把这份数据当旧快照忽略）
  const cur = JSON.parse(await new Response((await store.get('sites.json', {})).stream).text())
  const res = makeRes()
  await backup(authReq('POST', {
    data: { kind: 'navigator-backup', schema: 1, sites: { ...cur, version: 3 }, cloud: {} },
  }), res)
  eq(res.statusCode, 200, '恢复 200')
  const r = JSON.parse(res.body)
  ok(r.restored.version > cur.version, '恢复后 version 严格递增（客户端才肯应用）', `${cur.version} → ${r.restored.version}`)
  eq(r.restored.sites, 2, '恢复站点数正确')
  ok(String(r.safetySnapshot).includes('pre-restore'), '恢复前留了安全快照', r.safetySnapshot)
  const after = JSON.parse(await new Response((await store.get('sites.json', {})).stream).text())
  eq(after.sites.length, 2, '落库后站点数正确')
}

{
  // 坏数据必须整体拒绝，且**不改任何东西**
  const before = JSON.parse(await new Response((await store.get('sites.json', {})).stream).text())
  const res = makeRes()
  await backup(authReq('POST', { data: { kind: 'navigator-backup', sites: { version: 99, sites: [] } } }), res)
  eq(res.statusCode, 400, '空站点表被拒（会白屏的结构）')
  const after = JSON.parse(await new Response((await store.get('sites.json', {})).stream).text())
  eq(after.version, before.version, '拒绝后数据未被改动（version 不变）')

  const res2 = makeRes()
  await backup(authReq('POST', { data: { kind: 'navigator-backup', sites: { version: 99, sites: [{ id: 'x', name: 'X', url: 'x.com' }, { id: 'x', name: 'X2', url: 'y.com' }] } } }), res2)
  eq(res2.statusCode, 400, '重复 id 被拒')
}

{
  const res = makeRes()
  await backup(authReq('POST', { data: { hello: 'world' } }), res)
  eq(res.statusCode, 400, '非备份文件被拒')
}

/* ---------------- 3. AI 降级（P4） ---------------- */

{
  const cfg = ai.aiConfig()
  eq(cfg.ready, false, '未配置 AI 时 ready=false（前端据此隐藏入口）')
  eq(cfg.configured, false, '未配置时 configured=false')

  const res = makeRes()
  await ai.default(authReq('GET'), res)
  eq(res.statusCode, 200, '能力自检 200（前端要靠它决定显不显示）')
  const j = JSON.parse(res.body)
  eq(j.ready, false, '自检也报未就绪')
  ok(Array.isArray(j.actions) && j.actions.includes('polish'), '自检列出可用动作')
  ok(!String(res.body).includes('apiKey') && !String(res.body).includes('sk-'), '自检响应不含任何 key 材料')

  const res2 = makeRes()
  await ai.default(authReq('POST', { action: 'polish', name: 'x' }), res2)
  eq(res2.statusCode, 501, '未配置时调用 → 501（明确说怎么配）')
  ok(/AI_BASE_URL/.test(JSON.parse(res2.body).error || ''), '501 的文案告诉用户配置项')

  const res3 = makeRes()
  await ai.default({ method: 'POST', body: { action: 'polish' }, query: {}, headers: {}, socket: {} }, res3)
  eq(res3.statusCode, 401, 'AI 接口同样要鉴权（它是花钱的接口）')

  const res4 = makeRes()
  await ai.default(authReq('POST', { action: '删除一切' }), res4)
  eq(res4.statusCode, 501, '未知动作也走 501（配置检查在前）—— 不泄漏动作集合给未鉴权者')
}

/* ---------------- 收尾 ---------------- */

store.close()
try { rmSync(process.env.NAV_STORE_DIR, { recursive: true, force: true }) } catch { /* 交给系统临时目录 */ }

if (failures.length) {
  console.error(`\n❌ v10-P3/P4/P5 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ v10-P3/P4/P5 全部通过：${pass} 条断言`)
process.exit(0)