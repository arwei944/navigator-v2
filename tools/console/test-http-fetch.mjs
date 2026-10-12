/**
 * `shared/http-fetch.mjs` 的**传输层**用例：零依赖，起本地服务器实测。
 *
 * 本套件盯的是「抓取引擎提速」这件事的底层契约 —— 改错了会让所有出网功能（元信息抓取、
 * 封面抓取、健康巡检）一起坏，但坏得很难看：
 *
 *   [1] **早断（`stopAt`）**：读到 `</head>` 就断开。实测只读 32KB 比读满 256KB 快 1.5~6 倍，
 *       而 title/描述/图标/主题色/manifest 全在 head 里。三个必须成立的性质：
 *         · 标记本身**完整保留**（否则 inferSite 的正则会拿到半截标签）
 *         · **跨 chunk** 也能命中（标记被 TCP 切成两段是最常见的情况）
 *         · 标记**不出现**时退化为 maxBytes 截断（畸形页不能把流读到天荒地老）
 *   [2] **压缩**：默认请求 gzip/br，且 gzip / brotli / deflate / 未知编码四条分支都要对。
 *       （这条曾经主动要 `identity`，白白多传 5~10 倍字节。）
 *   [3] **上限语义**：`maxBytes` 作用在**解压后**的字节上，超限即断且不超上限。
 *
 * 运行：node tools/console/test-http-fetch.mjs
 */
import { createServer } from 'node:http'
import { gzipSync, brotliCompressSync, deflateSync } from 'node:zlib'
import { fetchCapped, DEFAULT_MAX_BYTES } from '../../shared/http-fetch.mjs'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)
const sleep = ms => new Promise(s => setTimeout(s, ms))

const HEAD_DOC = '<!DOCTYPE html><html><head><title>真实标题</title>'
  + '<meta name="description" content="一句真实描述">'
  + '<link rel="icon" href="/favicon.ico"></head>'

/* ---------------- 本地服务器：覆盖被测的各种响应形态 ---------------- */

let seenAcceptEncoding = ''
const server = createServer((req, res) => {
  seenAcceptEncoding = String(req.headers['accept-encoding'] || '')

  // 正常小页面
  if (req.url === '/ok') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<title>hello</title>')
    return
  }

  // 大响应：用于验证 maxBytes 上限
  if (req.url === '/big') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('A'.repeat(300 * 1024))
    return
  }

  // 重定向（正文无用）
  if (req.url === '/redirect') {
    res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' })
    res.end('<a href="http://169.254.169.254/">go</a>')
    return
  }

  // 三种压缩编码
  if (req.url === '/gzip') {
    res.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/html' })
    res.end(gzipSync(Buffer.from('<title>gzip 标题</title>')))
    return
  }
  if (req.url === '/br') {
    res.writeHead(200, { 'content-encoding': 'br', 'content-type': 'text/html' })
    res.end(brotliCompressSync(Buffer.from('<title>brotli 标题</title>')))
    return
  }
  if (req.url === '/deflate') {
    res.writeHead(200, { 'content-encoding': 'deflate', 'content-type': 'text/html' })
    res.end(deflateSync(Buffer.from('<title>deflate 标题</title>')))
    return
  }
  // 未知编码：不处理，按原字节返回（不能抛错）
  if (req.url === '/zstd') {
    res.writeHead(200, { 'content-encoding': 'zstd', 'content-type': 'text/html' })
    res.end('RAW-BYTES')
    return
  }

  // ★ 早断的时序证明：head 立刻发完，正文慢速滴 200KB。
  //   有 stopAt 应当在 ~10ms 内返回；没有就会等到 ~2s。
  if (req.url === '/slowbody') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.write(HEAD_DOC)
    let sent = 0
    const timer = setInterval(() => {
      sent += 1
      res.write('B'.repeat(4096))
      if (sent >= 50) { clearInterval(timer); res.end() }
    }, 40)
    req.on('close', () => clearInterval(timer))
    return
  }

  // ★ 标记跨 chunk：`</head>` 被切成 `</he` + `ad>`，中间还插了延迟
  if (req.url === '/head-split') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.write('<!DOCTYPE html><html><head><title>跨块标题</title></he')
    setTimeout(() => { res.write('ad>'); setTimeout(() => res.end('<body>正文</body></html>'), 30) }, 30)
    return
  }

  // ★ 标记不出现（畸形页）：只有开标签没有闭标签，且正文很长
  if (req.url === '/no-marker') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<html><head><title>没有闭合</title>' + 'C'.repeat(200 * 1024))
    return
  }

  // 压缩 + 早断组合：标记只在解压后才出现
  if (req.url === '/gzip-head') {
    res.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/html' })
    res.end(gzipSync(Buffer.from(HEAD_DOC + '<body>' + 'D'.repeat(100 * 1024) + '</body></html>')))
    return
  }

  res.writeHead(404); res.end('nope')
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const ORIGIN = `http://127.0.0.1:${server.address().port}`

/** 测试专用解析器：把任意主机名都解析到本机（绕开内置校验去测传输行为） */
const toLocalhost = (host, opts, cb) => {
  const done = typeof opts === 'function' ? opts : cb
  const o = typeof opts === 'function' ? {} : (opts || {})
  return o.all ? done(null, [{ address: '127.0.0.1', family: 4 }]) : done(null, '127.0.0.1', 4)
}

try {
  /* ══════════ 1. 基本行为：不能因为改了传输层就改坏 ══════════ */

  {
    const r = await fetchCapped(`${ORIGIN}/ok`, { lookup: toLocalhost })
    eq(r.status, 200, 'GET 200')
    ok(r.body.toString().includes('hello'), '拿到正文', r.body.toString().slice(0, 40))
    eq(r.truncated, false, '未截断时 truncated=false')
    eq(r.stoppedAt, '', '未截断时 stoppedAt 为空')
    eq(r.headers['content-type'], 'text/html; charset=utf-8', '响应头保留')
  }

  /* ══════════ 2. 默认请求压缩（曾经是 identity，白传 5~10 倍） ══════════ */

  {
    await fetchCapped(`${ORIGIN}/ok`, { lookup: toLocalhost })
    ok(/gzip/.test(seenAcceptEncoding), '★ 默认 accept-encoding 含 gzip（不再主动要 identity）', seenAcceptEncoding)
    ok(!/identity/.test(seenAcceptEncoding), '默认不再要 identity', seenAcceptEncoding)
    ok(/br/.test(seenAcceptEncoding), '默认也接受 brotli', seenAcceptEncoding)
  }

  {
    await fetchCapped(`${ORIGIN}/ok`, { lookup: toLocalhost, headers: { 'accept-encoding': 'identity' } })
    eq(seenAcceptEncoding, 'identity', '调用方显式传的 accept-encoding 覆盖默认值')
  }

  /* ══════════ 3. 三种压缩编码都要能解 ══════════ */

  {
    const g = await fetchCapped(`${ORIGIN}/gzip`, { lookup: toLocalhost })
    ok(g.body.toString().includes('gzip 标题'), 'gzip 正文被正确解压', g.body.toString().slice(0, 40))

    const b = await fetchCapped(`${ORIGIN}/br`, { lookup: toLocalhost })
    ok(b.body.toString().includes('brotli 标题'), 'brotli 正文被正确解压', b.body.toString().slice(0, 40))

    const d = await fetchCapped(`${ORIGIN}/deflate`, { lookup: toLocalhost })
    ok(d.body.toString().includes('deflate 标题'), 'deflate 正文被正确解压', d.body.toString().slice(0, 40))

    // 未知编码不能抛错，按原字节交回
    const z = await fetchCapped(`${ORIGIN}/zstd`, { lookup: toLocalhost })
    eq(z.status, 200, '未知 content-encoding 不抛错')
    ok(z.body.toString().includes('RAW-BYTES'), '未知编码按原字节返回', z.body.toString().slice(0, 40))
  }

  /* ══════════ 4. 字节上限语义（作用在解压后） ══════════ */

  {
    const r = await fetchCapped(`${ORIGIN}/big`, { lookup: toLocalhost, maxBytes: 4096 })
    eq(r.status, 200, '超限响应仍返回 200')
    eq(r.truncated, true, '超限标记 truncated=true')
    eq(r.stoppedAt, 'maxBytes', "超限时 stoppedAt='maxBytes'")
    ok(r.body.length <= 4096, `截断后正文不超过上限（实得 ${r.body.length}）`)
  }

  {
    // 压缩 + 上限：上限算的是**解压后**的字节，不然压缩早就把上限绕过去了
    const r = await fetchCapped(`${ORIGIN}/gzip-head`, { lookup: toLocalhost, maxBytes: 2048, stopAt: '</head>' })
    ok(r.body.length <= 2048, `解压后才算上限（实得 ${r.body.length}）`)
  }

  /* ══════════ 5. ★ 早断：标记命中即返回 ══════════ */

  {
    const r = await fetchCapped(`${ORIGIN}/slowbody`, { lookup: toLocalhost, maxBytes: 64 * 1024, stopAt: '</head>' })
    eq(r.status, 200, '早断路径拿到 200')
    eq(r.truncated, true, '早断标记 truncated=true')
    eq(r.stoppedAt, 'marker', "早断时 stoppedAt='marker'")
    const s = r.body.toString()
    ok(s.includes('<title>真实标题</title>'), '标题被完整读到', s.slice(0, 80))
    ok(s.includes('name="description"'), '描述被完整读到')
    ok(s.includes('rel="icon"'), '图标链接被完整读到')
    ok(/<\/head>$/.test(s), '★ 标记本身完整保留（正则会拿到完整闭合标签）', JSON.stringify(s.slice(-30)))
    ok(!s.includes('BBBB'), '正文没有被读进来')
  }

  {
    // 时序证明：正文要滴 ~2s，早断必须在远小于它的时间内返回
    const t0 = Date.now()
    await fetchCapped(`${ORIGIN}/slowbody`, { lookup: toLocalhost, maxBytes: 64 * 1024, stopAt: '</head>' })
    const fast = Date.now() - t0

    const t1 = Date.now()
    await fetchCapped(`${ORIGIN}/slowbody`, { lookup: toLocalhost, maxBytes: 64 * 1024 })
    const slow = Date.now() - t1

    ok(fast < 500, `★ 早断确实提前返回（${fast}ms）`)
    ok(slow > fast * 2, `★ 不早断时必须等正文（${slow}ms vs ${fast}ms）`)
  }

  {
    // 跨 chunk：`</head>` 被 TCP 切成 `</he` + `ad>`
    const r = await fetchCapped(`${ORIGIN}/head-split`, { lookup: toLocalhost, stopAt: '</head>' })
    eq(r.stoppedAt, 'marker', '★ 标记跨 chunk 也能命中')
    const s = r.body.toString()
    ok(s.includes('<title>跨块标题</title>'), '跨块时标题完整', s.slice(0, 80))
    ok(/<\/head>$/.test(s), '跨块时标记仍完整保留', JSON.stringify(s.slice(-30)))
  }

  {
    // 标记不出现 → 退化为 maxBytes 截断，不能一直读到流结束
    const t0 = Date.now()
    const r = await fetchCapped(`${ORIGIN}/no-marker`, { lookup: toLocalhost, maxBytes: 8192, stopAt: '</head>' })
    eq(r.truncated, true, '标记缺失时仍截断')
    eq(r.stoppedAt, 'maxBytes', '标记缺失时退化为 maxBytes（不会挂到流结束）')
    ok(r.body.length <= 8192, `标记缺失时正文不超上限（实得 ${r.body.length}）`)
    ok(Date.now() - t0 < 3000, `标记缺失时也会及时返回（${Date.now() - t0}ms）`)
  }

  {
    // 多标记：取**最早**出现的那个
    const r = await fetchCapped(`${ORIGIN}/slowbody`, { lookup: toLocalhost, stopAt: ['</body>', '</head>'] })
    eq(r.stoppedAt, 'marker', '多标记时命中')
    ok(/<\/head>$/.test(r.body.toString()), '多标记取最早出现的（这里是 </head>）', JSON.stringify(r.body.toString().slice(-20)))
  }

  {
    // stopAt 为空 / 非法 → 等同不传，行为与从前一致
    for (const bad of [undefined, '', [], null, 0]) {
      const r = await fetchCapped(`${ORIGIN}/ok`, { lookup: toLocalhost, stopAt: bad })
      eq(r.stoppedAt, '', `stopAt=${JSON.stringify(bad)} 时不做早断`)
      ok(r.body.toString().includes('hello'), `stopAt=${JSON.stringify(bad)} 时正文正常`)
    }
  }

  {
    // 压缩 + 早断：标记只在解压后才可见（在压缩字节里找是找不到的）
    const r = await fetchCapped(`${ORIGIN}/gzip-head`, { lookup: toLocalhost, maxBytes: 64 * 1024, stopAt: '</head>' })
    eq(r.stoppedAt, 'marker', '★ 早断作用在解压后的字节上')
    ok(/<\/head>$/.test(r.body.toString()), '压缩响应也能在标记处切断', JSON.stringify(r.body.toString().slice(-20)))
  }

  /* ══════════ 6. 安全与协议行为不能被改动波及 ══════════ */

  {
    const r = await fetchCapped(`${ORIGIN}/redirect`, { lookup: toLocalhost })
    eq(r.status, 302, '重定向状态码原样返回')
    eq(r.headers.location, 'http://169.254.169.254/latest/meta-data/', 'location 交回调用方')
    eq(r.body.length, 0, '重定向不读正文')
    eq(r.stoppedAt, '', '重定向路径不带 stoppedAt 标记')
  }

  {
    let code = ''
    try { await fetchCapped('ftp://example.com/x', { lookup: toLocalhost }) } catch (e) { code = e.code }
    eq(code, 'BAD_PROTOCOL', '非 http(s) 协议被拒')
  }

  {
    let code = ''
    try { await fetchCapped(`http://localhost:${server.address().port}/ok`) } catch (e) { code = e.code }
    eq(code, 'BLOCKED_HOST', '★ 早断参数不影响字面主机名拦截（默认 lookup 仍拒本机）')
  }

  eq(DEFAULT_MAX_BYTES, 256 * 1024, '默认上限保持不变（收紧是调用方的事，不是传输层的事）')
} catch (e) {
  // 任何未预期的抛错都要变成一条**可读的失败**，而不是把整个进程炸掉
  // （顶层 await 没有 catch 时，一次 rejection 会让后面的断言全部消失）
  ok(false, '用例过程未抛错', `${e?.name}: ${e?.message}`)
} finally {
  server.close()
}

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 传输层（http-fetch）${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 传输层（http-fetch）全部通过：${pass} 条断言`)
process.exit(0)
