/**
 * 第三批 · 序 17 的守卫：SSRF 防线的**连接层**部分。
 *
 * `test-guard.mjs` 用 27 条断言覆盖了「字面主机名」那一层（localhost / 内网 IP / .internal…）。
 * 但那一层**挡不住 DNS rebinding** —— 攻击者让域名第一次解析成公网 IP、第二次解析成
 * 169.254.169.254，预检就白做了。真正的防线是 `createPinnedLookup`：它把「用于校验的 IP」
 * 与「用于连接的 IP」锁成同一次解析的结果。
 *
 * 本文件因此分四组：
 *   [1] IPv6 段判定的**多种合法写法**（`fe80::1` 与 `fe80:0:0:0:0:0:0:1` 必须同判）
 *   [2] `createPinnedLookup` 的单元语义（含「任一地址非法即整条拒绝」）
 *   [3] 反 rebound 的核心断言：换一次解析结果不能换出未校验的地址
 *   [4] `fetchCapped` 的**真实传输层**行为（起本地服务器实测：截断 / 不跟重定向 / 解压 / 拦截）
 *
 * 零依赖、只连本机回环（且连接路径本身就是要验证的被测对象）。
 * 运行：node tools/console/test-netguard.mjs
 */
import { createServer } from 'node:http'
import { lookup as dnsLookup } from 'node:dns'
import { gzipSync } from 'node:zlib'
import { isPrivateV4, isPrivateV6, isBlockedIp, isBlockedHost, createPinnedLookup } from '../../shared/net-guard.mjs'
import { fetchCapped } from '../../shared/http-fetch.mjs'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(a === b, label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

/* ══════════ [1] IPv6：写法不同，判定必须一致 ══════════ */

// 同一地址有多种合法写法（压缩 ::、前导零、大小写）。用前缀字符串硬编会漏判，
// 所以实现是把地址展开成 8 组 16 位再判段 —— 这里就是验证那套展开逻辑。
const V6_BLOCKED = [
  '::1', '::', '0:0:0:0:0:0:0:1',
  'fc00::1', 'FD12:3456::1', 'fc00:0:0:0:0:0:0:1',
  'fe80::1', 'fe80:0:0:0:0:0:0:1', 'FE80::ABCD',
  'ff02::1', 'FF00::1',
  '2001:db8::1', '2001:0db8:0:0:0:0:0:1',
  '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::127.0.0.1',
  '[::1]',
]
for (const ip of V6_BLOCKED) eq(isPrivateV6(ip), true, `IPv6 内网判定：${ip}`)
// 解析不出来的串一律当可疑（宁可拒绝）
eq(isPrivateV6('not::a::valid:::addr'), true, '无法解析的 IPv6 串按可疑拒绝')

const V6_ALLOWED = ['2606:4700:4700::1111', '2400:3200::1', '2001:4860:4860::8888', '2a00:1450:4001:80e::200e']
for (const ip of V6_ALLOWED) eq(isPrivateV6(ip), false, `IPv6 公网放行：${ip}`)

/* IPv4 边界（test-guard 只测了典型值，这里补齐容易写错的区间端点） */
const V4_BLOCK = ['0.0.0.0', '0.1.2.3', '10.255.255.255', '100.64.0.0', '100.127.255.255', '127.0.0.1',
  '169.254.1.1', '172.16.0.0', '172.31.255.255', '192.0.0.1', '192.0.2.1', '192.168.0.1',
  '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '239.255.255.255', '255.255.255.255']
for (const ip of V4_BLOCK) eq(isPrivateV4(ip), true, `IPv4 内网判定：${ip}`)

// 区间外一格的邻居必须放行 —— 否则「相邻公网段被误伤」会被当成正常
const V4_ALLOW = ['1.1.1.1', '8.8.8.8', '9.255.255.255', '11.0.0.0', '100.63.255.255', '100.128.0.0',
  '172.15.255.255', '172.32.0.0', '192.167.255.255', '192.169.0.0', '223.255.255.255', '198.19.0.0']
for (const ip of V4_ALLOW) eq(isPrivateV4(ip), false, `IPv4 公网放行：${ip}`)

/* isBlockedIp 的空值与哑值 */
eq(isBlockedIp(''), true, '空 IP 视为可疑')
eq(isBlockedIp('   '), true, '空白 IP 视为可疑')
eq(isBlockedIp('8.8.8.8'), false, 'isBlockedIp 放行公网 v4')
eq(isBlockedIp('fe80::1'), true, 'isBlockedIp 拒绝链路本地')

/* ══════════ [2] createPinnedLookup 的单元语义 ══════════ */

/** 造一个「固定返回这些地址」的假解析器 */
const fakeLookup = addresses => (host, opts, cb) => cb(null, addresses)

/** 以 Promise 形式调用 pinned lookup，统一成 {err, value} */
function callPinned(pinned, hostname = 'evil.example', options = {}) {
  return new Promise(resolve => {
    pinned(hostname, options, (err, address, family) => resolve({ err, address, family }))
  })
}

// 2.1 解析到内网 → 必须报 BLOCKED_HOST（这条是「域名指向内网」的正解）
{
  const pinned = createPinnedLookup(fakeLookup([{ address: '169.254.169.254', family: 4 }]))
  const { err } = await callPinned(pinned)
  eq(err?.code, 'BLOCKED_HOST', '解析到云元数据地址 → BLOCKED_HOST')
}

// 2.2 解析到公网 → 放行，且**回给的地址就是被校验的那个**
{
  const pinned = createPinnedLookup(fakeLookup([{ address: '93.184.216.34', family: 4 }]))
  const { err, address, family } = await callPinned(pinned)
  eq(err ?? null, null, '解析到公网 → 无错误')
  eq(address, '93.184.216.34', '回给调用方的地址 = 被校验的地址')
  eq(family, 4, '回传 family')
}

// 2.3 all:true 时返回数组（http.request 在 autoSelectFamily 下会这么要）
{
  const pinned = createPinnedLookup(fakeLookup([
    { address: '93.184.216.34', family: 4 }, { address: '2606:4700::1111', family: 6 },
  ]))
  const { err, address } = await callPinned(pinned, 'ok.example', { all: true })
  eq(err ?? null, null, 'all:true 且全部公网 → 无错误')
  ok(Array.isArray(address) && address.length === 2, 'all:true 返回地址数组', JSON.stringify(address))
}

// 2.4 **任一地址非法即整条拒绝**：不做「挑一个合法的用」。
//     否则攻击者只需在同一次应答里塞一条内网 A 记录，就有机会被选中。
{
  const pinned = createPinnedLookup(fakeLookup([
    { address: '93.184.216.34', family: 4 }, { address: '10.0.0.7', family: 4 },
  ]))
  const { err } = await callPinned(pinned)
  eq(err?.code, 'BLOCKED_HOST', '公网+内网混合应答 → 整条拒绝（不挑合法的用）')
}
{
  const pinned = createPinnedLookup(fakeLookup([
    { address: '93.184.216.34', family: 4 }, { address: 'fe80::1', family: 6 },
  ]))
  const { err } = await callPinned(pinned)
  eq(err?.code, 'BLOCKED_HOST', '公网 v4 + 链路本地 v6 混合 → 拒绝')
}

// 2.5 解析为空 → ENOTFOUND（不能「没解析出来就当通过」）
{
  const pinned = createPinnedLookup(fakeLookup([]))
  const { err } = await callPinned(pinned)
  eq(err?.code, 'ENOTFOUND', '解析结果为空 → ENOTFOUND')
}

// 2.6 解析器自身的错误原样传递（DNS 故障不能被吞成「通过」）
{
  const boom = (host, opts, cb) => { const e = new Error('dns down'); e.code = 'ESERVFAIL'; cb(e) }
  const { err } = await callPinned(createPinnedLookup(boom))
  eq(err?.code, 'ESERVFAIL', '解析器报错 → 原样上抛')
}

// 2.7 兼容「(hostname, callback)」两参调用（Node 老式 lookup 签名）
{
  const pinned = createPinnedLookup(fakeLookup([{ address: '1.1.1.1', family: 4 }]))
  const got = await new Promise(resolve => pinned('x.example', (err, addr) => resolve({ err, addr })))
  eq(got.err ?? null, null, '两参调用可用')
  eq(got.addr, '1.1.1.1', '两参调用回传地址')
}

/* ══════════ [3] 反 DNS rebinding 的核心断言 ══════════ */

/**
 * 模拟攻击：同一个域名，第一次解析返回公网（骗过任何「预检」），
 * 第二次解析返回内网（真正连接时用到的那个）。
 *
 * 因为校验**发生在每次解析的回调里**，第二次解析的地址也必须过同一道关 ——
 * 于是「校验用 IP ≠ 连接用 IP」这个窗口在结构上不存在。
 */
{
  let call = 0
  const rebinding = (host, opts, cb) => {
    call++
    cb(null, call === 1
      ? [{ address: '93.184.216.34', family: 4 }]
      : [{ address: '127.0.0.1', family: 4 }])
  }
  const pinned = createPinnedLookup(rebinding)
  const first = await callPinned(pinned)
  const second = await callPinned(pinned)
  eq(first.err ?? null, null, 'rebinding：第一次（公网）放行')
  eq(second.err?.code, 'BLOCKED_HOST', 'rebinding：第二次（内网）被拦 —— 校验与连接是同一次解析')
  eq(call, 2, 'rebinding：两次解析都被真正走到（不是缓存一次结果）')
}

/* ══════════ [4] fetchCapped 真实传输层 ══════════ */

/* 起一个本地服务器，覆盖被测的几种响应形态 */
const server = createServer((req, res) => {
  if (req.url === '/ok') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<title>hello</title>')
    return
  }
  if (req.url === '/big') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('A'.repeat(300 * 1024))
    return
  }
  if (req.url === '/redirect') {
    res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' })
    res.end('<a href="http://169.254.169.254/">go</a>')
    return
  }
  if (req.url === '/gzip') {
    // 服务器**无视** accept-encoding: identity，照发 gzip —— 实现必须能兜住
    res.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/html' })
    res.end(gzipSync(Buffer.from('<title>压缩过的标题</title>')))
    return
  }
  res.writeHead(404); res.end('nope')
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const PORT = server.address().port
const ORIGIN = `http://127.0.0.1:${PORT}`

/** 测试专用解析器：把任意主机名都解析到本机（从而绕开内置校验去测传输行为） */
const toLocalhost = (host, opts, cb) => {
  const done = typeof opts === 'function' ? opts : cb
  const o = typeof opts === 'function' ? {} : (opts || {})
  return o.all ? done(null, [{ address: '127.0.0.1', family: 4 }]) : done(null, '127.0.0.1', 4)
}

try {
  // 4.1 基本 GET：状态 / 头 / 正文
  {
    const r = await fetchCapped(`${ORIGIN}/ok`, { lookup: toLocalhost })
    eq(r.status, 200, 'fetchCapped GET 200')
    ok(r.body.toString().includes('hello'), 'fetchCapped 拿到正文', r.body.toString().slice(0, 40))
    eq(r.truncated, false, '未超限时 truncated=false')
    eq(r.headers['content-type'], 'text/html; charset=utf-8', '响应头保留')
  }

  // 4.2 字节上限：超限即截断（绝不能把几百 KB 读进内存）
  {
    const r = await fetchCapped(`${ORIGIN}/big`, { lookup: toLocalhost, maxBytes: 4096 })
    eq(r.status, 200, '超限响应仍返回 200')
    eq(r.truncated, true, '超限标记 truncated=true')
    ok(r.body.length <= 4096, `截断后正文不超过上限（实得 ${r.body.length}）`)
  }

  // 4.3 重定向**不跟随**：正文不读、location 原样交回调用方去逐跳校验。
  //     这是防「302 到 169.254.169.254」的关键 —— 跟了就绕过了目标校验。
  {
    const r = await fetchCapped(`${ORIGIN}/redirect`, { lookup: toLocalhost })
    eq(r.status, 302, '重定向状态码原样返回')
    eq(r.headers.location, 'http://169.254.169.254/latest/meta-data/', 'location 交回调用方')
    eq(r.body.length, 0, '重定向不读正文')
  }

  // 4.4 服务器无视 identity 照发 gzip 时能正确解压
  {
    const r = await fetchCapped(`${ORIGIN}/gzip`, { lookup: toLocalhost })
    eq(r.status, 200, 'gzip 响应 200')
    ok(r.body.toString().includes('压缩过的标题'), 'gzip 正文被正确解压', r.body.toString().slice(0, 40))
  }

  // 4.5 协议白名单
  {
    let code = ''
    try { await fetchCapped('ftp://example.com/x') } catch (e) { code = e.code }
    eq(code, 'BAD_PROTOCOL', '非 http(s) 协议 → BAD_PROTOCOL')
  }

  // 4.6 **字面内网地址**（不注入 lookup = 走生产路径）。
  //     这一层必须在 fetchCapped 内部挡：对字面 IP，Node 的 net.connect 不做 DNS，
  //     pinned lookup 根本不会被执行 —— 实测不挡的话会真去连、报 ECONNREFUSED。
  for (const host of ['http://169.254.169.254/x', 'http://127.0.0.1/x', 'http://10.0.0.1/x', 'http://[::1]/x']) {
    let code = ''
    try { await fetchCapped(host) } catch (e) { code = e.code }
    eq(code, 'BLOCKED_HOST', `生产路径拒绝字面内网地址 ${host}`)
  }

  // 4.7 **端到端 DNS 层**：`createPinnedLookup(dnsLookup)` 接真实解析器解析 `localhost`，
  //     解析结果必然含 127.0.0.1，须被拦下。这是「域名解析到内网」这条防线唯一能
  //     在本机实测的证据（字面规则对 localhost 也成立，但那条走不到这里）。
  {
    const pinned = createPinnedLookup(dnsLookup)
    const { err } = await callPinned(pinned, 'localhost')
    eq(err?.code, 'BLOCKED_HOST', '真实 DNS 解析 localhost → 连接层拦下')
  }

  // 4.8 同一目标的完整链路：默认 lookup + 本地服务器端口 → 仍被拦（因为主机名解析到回环）
  {
    let code = ''
    try { await fetchCapped(`http://localhost:${PORT}/ok`) } catch (e) { code = e.code }
    eq(code, 'BLOCKED_HOST', 'fetchCapped 默认路径拒绝解析到回环的域名')  }
} finally {
  await new Promise(r => server.close(r))
}

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 连接层 SSRF 防护 ${failures.length} 条断言失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 连接层 SSRF 防护全部通过：${pass} 条断言`)
