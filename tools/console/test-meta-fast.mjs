/**
 * `/api/metadata` 的**快路径**用例：抓取早断、预算收紧、默认不翻译、同域缓存。
 *
 * 为什么单独一套：这一轮把「添加站点」的耗时结构改了 ——
 *
 *   · 抓取只读 64KB 且读到 `</head>` 就断开（实测 1.5~6×）；
 *   · 预算 6s → 3s（用户早已看到本地草稿，不该为一次可能的升级干等）；
 *   · **翻译默认不再内联**（它曾让每次添加多等最多 3.5s）；
 *   · 同域短 TTL 缓存 + 并流去重（同一 URL 并发只真抓一次）。
 *
 * 这几条都改在「响应结构」和「出网次数」上，而它们恰恰是探针与前端依赖的契约。
 * 用模块 mock 顶掉传输层（`shared/http-fetch.mjs`），把 handler 当普通函数调，
 * 不联网、不起服务。
 *
 * 运行：node --experimental-test-module-mocks tools/console/test-meta-fast.mjs
 *
 * @node-flags --experimental-test-module-mocks
 */
import { mock } from 'node:test'
import { createRequire } from 'node:module'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

/* ---------------- 打桩传输层 ---------------- */

const calls = []
let script = () => ({ status: 200, headers: {}, body: Buffer.from('') })

mock.module('../../shared/http-fetch.mjs', {
  namedExports: {
    DEFAULT_MAX_BYTES: 256 * 1024,
    fetchCapped: async (href, opts = {}) => {
      calls.push({ href, opts })
      // `await` 是必要的：有几个用例要模拟「主抓耗时很久」，异步 script 才表达得出来
      const r = (await script(href, opts)) || {}
      return {
        status: r.status ?? 200,
        headers: r.headers || {},
        body: Buffer.isBuffer(r.body) ? r.body : Buffer.from(String(r.body ?? '')),
        truncated: false,
        stoppedAt: '',
      }
    },
  },
})

const { default: handler, withBudget } = await import('../../api/metadata.js')

/* ---------------- 请求 / 响应桩 ---------------- */

let ipSeq = 0
function makeReq({ query = {}, headers = {} } = {}) {
  ipSeq++
  return {
    method: 'GET',
    query,
    headers: { 'x-forwarded-for': `10.0.0.${ipSeq % 250}`, ...headers },
    socket: { remoteAddress: `10.0.0.${ipSeq % 250}` },
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
async function call(query, headers) {
  const res = makeRes()
  await handler(makeReq({ query, headers }), res)
  return res
}

/** 一份「有 head、有 theme-color」的页面：不会触发 manifest 补抓，一次请求即完成 */
const PAGE = '<!DOCTYPE html><html><head><title>Example Site</title>'
  + '<meta name="description" content="A place for examples and demos">'
  + '<meta name="theme-color" content="#123456">'
  + '<link rel="icon" href="/favicon.ico"></head><body>' + 'x'.repeat(2000) + '</body></html>'

const realFetch = globalThis.fetch
let fetchCalls = 0
globalThis.fetch = async (url) => {
  fetchCalls++
  // 翻译引擎的打桩：MyMemory 形状
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ responseData: { translatedText: '示例站点描述' } }),
    json: async () => ({}),
  }
}

try {
  /* ══════════ 1. 抓取参数：早断 + 收紧的上限 + 不主动写 accept-encoding ══════════ */
  {
    calls.length = 0
    script = () => ({ status: 200, body: PAGE })
    const res = await call({ url: 'https://example.com' })
    eq(res.statusCode, 200, '正常抓取返回 200')
    /**
     * 服务端自报的抓取耗时：调用方测到的端到端里叠着网络 RTT 与宿主冷启动，
     * 线上实测能差出 400~1300ms。没有这个字段，就无法区分「服务端超了预算」与「宿主慢」。
     */
    ok(Number.isFinite(res.payload.fetchMs) && res.payload.fetchMs >= 0,
      '★ 响应带回服务端抓取耗时 fetchMs（与端到端耗时区分）', String(res.payload.fetchMs))
    eq(calls.length, 1, '一次请求只抓一次（有 theme-color 就不补抓 manifest）')

    const o = calls[0].opts
    eq(o.maxBytes, 64 * 1024, '★ 只读 64KB（原为 256KB）')
    eq(o.stopAt, '</head>', '★ 读到 </head> 就断开')
    ok(o.headers && o.headers['user-agent'], '带上 UA')
    ok(!('accept-encoding' in (o.headers || {})),
      '★ 不覆写 accept-encoding —— 让传输层默认的 gzip,br 生效（曾经主动要 identity）')
  }

  /* ══════════ 2. 默认不翻译：响应结构要如实交代「还没译」 ══════════ */
  {
    calls.length = 0
    fetchCalls = 0
    script = () => ({ status: 200, body: PAGE })
    const res = await call({ url: 'https://example.com' })
    const d = res.payload
    eq(d.translateMode, 'deferred', "★ 默认 translateMode='deferred'（翻译不再内联）")
    eq(d.translated.name, false, '默认未翻译名称')
    eq(d.translated.desc, false, '默认未翻译描述')
    ok(d.needsTranslate && typeof d.needsTranslate.desc === 'boolean',
      '★ 交代了「还需不需要译」（否则前端分不清「不用译」与「还没译」）', JSON.stringify(d.needsTranslate))
    eq(fetchCalls, 0, '★ 默认路径一次翻译出网都没有')
    eq(d.nameOriginal, d.name, '默认路径下原文与 name 一致（没有就地替换）')
    eq(res.headers['Cache-Control'], 'no-store', '响应不缓存')
  }

  /* ══════════ 3. ?translate=1 仍是旧行为（既有调用方与探针不必改） ══════════ */
  {
    calls.length = 0
    fetchCalls = 0
    script = () => ({ status: 200, body: PAGE })
    const res = await call({ url: 'https://example.com', translate: '1' })
    const d = res.payload
    eq(d.translateMode, 'inline', "★ 带 translate=1 时走内联翻译")
    eq(d.translated.desc, true, '内联路径把描述译成了中文')
    eq(d.desc, '示例站点描述', '描述被替换为译文')
    eq(d.needsTranslate.desc, false, '内联已译，不再标记需要翻译')
    ok(fetchCalls > 0, '内联路径确实发起了翻译出网')

    // 兼容写法
    calls.length = 0
    const res2 = await call({ url: 'https://example.com', translate: 'true' })
    eq(res2.payload.translateMode, 'inline', 'translate=true 也认')
  }

  /* ══════════ 4. 同域缓存 + 并行补抓根页 + 并流去重 ══════════ */
  {
    // 4a. 根路径：不触发补抓，一次请求只出一次网
    calls.length = 0
    script = () => ({ status: 200, body: PAGE })
    const a = await call({ url: 'https://cached.example.com/' })
    const b = await call({ url: 'https://cached.example.com/' })
    eq(a.payload.cached, false, '首次不是缓存命中')
    eq(a.payload.name, b.payload.name, '命中缓存与首次结果一致')
    eq(b.payload.cached, true, '★ 第二次命中缓存')
    eq(calls.length, 1, '★ 同域同路只真抓一次')

    // 4b. 子页必须并行补抓一次根页（落库口径永远以主域名为准），且补的是另一个地址
    calls.length = 0
    const sub = await call({ url: 'https://sub.example.com/some/page' })
    eq(calls.length, 2, '子页会同时抓子页与根页')
    eq(new Set(calls.map(c => c.href)).size, 2, '两次抓取是两个不同地址')
    ok(calls.some(c => /sub\.example\.com\/some\/page$/.test(c.href)), '抓了子页本身')
    ok(calls.some(c => /sub\.example\.com\/$/.test(c.href)), '也抓了主域名首页')
    eq(sub.payload.cached, false, '首次请求不算缓存命中')

    // 4c. 并流去重：两个请求同时在飞 → 只真抓一次
    calls.length = 0
    const [c, d] = await Promise.all([
      call({ url: 'https://inflight.example.com/' }),
      call({ url: 'https://inflight.example.com/' }),
    ])
    ok(c.payload && d.payload, '并发请求都拿到响应')
    eq(c.payload.name, d.payload.name, '并发两个响应内容一致（共用同一次抓取）')
    eq(calls.length, 1, '★ 并流去重：并发时也只真抓一次')

    // 4d. **只缓存成功结果**：把一次网络抖动缓存 5 分钟比不缓存更坏
    calls.length = 0
    let down = true
    script = () => {
      if (down) { down = false; return { status: 503, body: '' } }
      return { status: 200, body: PAGE }
    }
    const f1 = await call({ url: 'https://flaky.example.com/' })
    ok(/503/.test(f1.payload.warning || ''), '第一次抓失败并如实告警', f1.payload.warning)
    const f2 = await call({ url: 'https://flaky.example.com/' })
    eq(f2.payload.cached, false, '★ 空结果不进缓存（第二次不是「命中缓存」）')
    eq(calls.length, 2, '★ 第二次仍然真抓了一次，而不是复用失败结果')
    ok(!f2.payload.warning, '第二次抓到了，就不再带失败告警')
  }

  /* ══════════ 4e. manifest 补抓也要缓存/去重（它排在关键路径上，产出的只是品牌色） ══════════ */
  {
    // 页面：没有可用的 theme-color，但声明了 manifest → 会触发补抓
    const NO_THEME = '<!DOCTYPE html><html><head><title>No Theme</title>'
      + '<meta name="description" content="A site without a theme color">'
      + '<link rel="icon" href="/favicon.ico">'
      + '<link rel="manifest" href="/site.webmanifest"></head><body>x</body></html>'
    const MANIFEST = JSON.stringify({ name: 'No Theme', theme_color: '#abcdef' })

    calls.length = 0
    script = (href) => (/webmanifest|manifest\.json/.test(href)
      ? { status: 200, body: MANIFEST }
      // 注意返回的 content-type 无所谓：manifestThemeColor 是纯文本解析
      : { status: 200, body: NO_THEME })
    const m1 = await call({ url: 'https://manifest.example.com/' })
    const manifestCalls1 = calls.filter(c => /webmanifest/.test(c.href))
    eq(manifestCalls1.length, 1, '没有可用 theme-color 时会补抓 manifest')
    eq(manifestCalls1[0].opts.stopAt, null, '★ manifest 不套早断（JSON 里没有 </head>）')
    eq(m1.payload.color, '#abcdef', '从 manifest 里取到了品牌色', m1.payload.color)

    const before = calls.length
    const m2 = await call({ url: 'https://manifest.example.com/' })
    eq(calls.length - before, 0, '★ 第二次连 manifest 都不用再抓（同 origin 缓存）')
    eq(m2.payload.cached, true, '第二次整体命中缓存')
    eq(m2.payload.color, '#abcdef', '缓存里的颜色一致')

    // 并流：同一 origin 的 manifest 被同时请求 → 只真抓一次
    calls.length = 0
    await Promise.all([
      call({ url: 'https://manifest2.example.com/' }),
      call({ url: 'https://manifest2.example.com/' }),
    ])
    eq(calls.filter(c => /webmanifest/.test(c.href)).length, 1, '★ 并发时 manifest 也只真抓一次')

    // 空结果不缓存：manifest 拿不到 → 下次仍然会去试（但也不该把错误固化）
    calls.length = 0
    let manDown = true
    script = (href) => {
      if (/webmanifest/.test(href)) {
        if (manDown) { manDown = false; return { status: 404, body: '' } }
        return { status: 200, body: MANIFEST }
      }
      return { status: 200, body: NO_THEME }
    }
    const e1 = await call({ url: 'https://manifest3.example.com/' })
    eq(e1.payload.color === '#abcdef', false, '第一次 manifest 404 → 没有品牌色')
    const e2 = await call({ url: 'https://manifest3.example.com/' })
    eq(e2.payload.color, '#abcdef', '★ 空结果不进缓存，第二次仍然去试并拿到了颜色')
  }

  /* ══════════ 4f. manifest 补抓的预算必须被**总预算**夹住 ══════════
   *
   * 线上实测（部署沙箱出口比本机慢）：figma 3372ms、github 3317ms，都越过了
   * 「3s 预算 + 400ms 余量」的硬上限。数字能对上根因 —— 3372 ≈ 2472 主抓 + 900 manifest：
   * manifest 有**独立**预算，却不受总预算约束，于是硬生生叠在 3s 之上。
   */
  {
    const NO_THEME = '<!DOCTYPE html><html><head><title>No Theme</title>'
      + '<meta name="description" content="A site without a theme color">'
      + '<link rel="icon" href="/favicon.ico">'
      + '<link rel="manifest" href="/site.webmanifest"></head><body>x</body></html>'
    const MANIFEST = JSON.stringify({ name: 'No Theme', theme_color: '#abcdef' })

    // ① 主抓吃满预算 → 剩余不足 → **整个跳过**补抓，不让它把请求顶出预算
    calls.length = 0
    let t0 = Date.now()
    script = async (href) => {
      if (/webmanifest/.test(href)) return { status: 200, body: MANIFEST }
      await new Promise(r => setTimeout(r, 2900))
      return { status: 200, body: NO_THEME }
    }
    const g1 = await call({ url: 'https://budgetfull.example.com/' })
    eq(calls.filter(c => /webmanifest/.test(c.href)).length, 0,
      '★ 主抓吃完预算时整个跳过 manifest 补抓（不让 900ms 叠在 3s 之上）')
    eq(g1.payload.color === '#abcdef', false, '跳过补抓 → 拿不到 manifest 里的品牌色（可接受的代价）')
    ok(Date.now() - t0 <= 3400, '整次请求仍在硬上限内', `${Date.now() - t0}ms`)

    // ② 主抓只用了一半 → 剩余够 → 照常补抓（不能矫枉过正地一律跳过）
    calls.length = 0
    t0 = Date.now()
    script = async (href) => {
      if (/webmanifest/.test(href)) return { status: 200, body: MANIFEST }
      await new Promise(r => setTimeout(r, 1200))
      return { status: 200, body: NO_THEME }
    }
    const g2 = await call({ url: 'https://budgetleft.example.com/' })
    eq(calls.filter(c => /webmanifest/.test(c.href)).length, 1, '预算还有余量时仍会补抓 manifest')
    eq(g2.payload.color, '#abcdef', '拿到了品牌色')
    ok(Date.now() - t0 <= 3400, '仍在上限内', `${Date.now() - t0}ms`)
  }

  /* ══════════ 5. 失败路径的文案与状态码（口径不能回退） ══════════ */
  {
    // 超时 → 域名推断 + warning，仍然是 200（抓不到不算失败）
    calls.length = 0
    script = () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e }
    const res = await call({ url: 'https://slow.example.com' })
    eq(res.statusCode, 200, '抓取超时仍返回 200（照常给域名推断草稿）')
    ok(/超时/.test(res.payload.warning || ''), 'warning 说明是超时', res.payload.warning)
    ok(res.payload.name, '仍然产出了名称（域名推断）', res.payload.name)
    ok(res.payload.needsTranslate, '超时路径也带 needsTranslate')
    /**
     * ★ 超时**不再**回退 http 重抓。
     *
     * 回退存在的理由是「少数站点只在 http 上响应」，而超时与协议无关；
     * 且此时预算已耗尽，再发一次请求只可能把整次调用顶过硬上限。
     * 曾经这里漏判 AbortError，于是超时会多出一次出网（实得 2 次）。
     */
    eq(calls.length, 1, '★ 超时后不再发起 http 回退重抓（预算已耗尽，重试会突破上限）')

    // 目标站点非 2xx 且没有根页可用
    calls.length = 0
    script = () => ({ status: 503, body: '' })
    const r2 = await call({ url: 'https://down.example.com' })
    eq(r2.statusCode, 200, '目标 503 仍返回 200')
    ok(/503/.test(r2.payload.warning || ''), 'warning 里带上目标状态码', r2.payload.warning)

    // 内网地址 → 400，不能变成 200 的「域名推断」
    calls.length = 0
    script = () => { const e = new Error('该地址指向内网或本机'); e.code = 'BLOCKED_HOST'; throw e }
    const r3 = await call({ url: 'https://internal.example.com' })
    eq(r3.statusCode, 400, '★ 内网地址被拒时返回 400（不是静默降级）')
    ok(/内网|本机/.test(r3.payload.error || ''), '给出可读原因', r3.payload.error)
  }

  /* ══════════ 6. 滥用防护仍生效 ══════════ */
  {
    calls.length = 0
    script = () => ({ status: 200, body: PAGE })
    const cross = await call({ url: 'https://example.com' }, { 'sec-fetch-site': 'cross-site' })
    eq(cross.statusCode, 403, '★ 跨站调用被拒')
    eq(calls.length, 0, '★ 被拒的请求一次网都没出')
  }

  /* ══════════ 7. 参数校验 ══════════ */
  {
    calls.length = 0
    eq((await call({})).statusCode, 400, '缺 url → 400')
    eq((await call({ url: '   ' })).statusCode, 400, '只有空白 → 400')
    eq((await call({ url: ['a', 'b'] })).statusCode, 400, '数组参数 → 400（不抛类型错）')

    // ★ 带 `://` 的非 http scheme 必须被明确拒掉。
    //   曾经的写法 `startsWith('http') ? raw : 'https://'+raw` 会把 ftp://x.com
    //   拼成 https://ftp//x.com（host=ftp），protocol 是 https: → 一路走到 200 的域名推断。
    eq((await call({ url: 'ftp://x.com' })).statusCode, 400, '★ ftp:// → 400')
    eq((await call({ url: 'file:///c:/x' })).statusCode, 400, '★ file:// → 400')
    eq((await call({ url: 'gopher://x/y' })).statusCode, 400, 'gopher:// → 400')
    eq((await call({ url: 'javascript:alert(1)' })).statusCode, 400, 'javascript: → 400')
    eq((await call({ url: 'data:text/html,<b>hi' })).statusCode, 400, 'data: → 400')
    eq(calls.length, 0, '非法参数不发起任何出网')

    // 但裸主机名（含端口）不能误伤：它们没有 `://`，仍走 https:// 前缀
    calls.length = 0
    script = () => ({ status: 200, body: PAGE })
    eq((await call({ url: 'example.com:8080' })).statusCode, 200, '裸主机名带端口仍可解析')
    eq(calls[0].href, 'https://example.com:8080/', '补的是 https:// 前缀')
    eq((await call({ url: 'https://example.com/' })).statusCode, 200, '完整 https 地址照常')
  }

  /* ══════════ 8. withBudget：独立小上限的语义 ══════════ */
  {
    const outer = new AbortController()
    const b = withBudget(outer.signal, 30)
    eq(b.signal.aborted, false, '初始未 abort')
    await new Promise(r => setTimeout(r, 60))
    eq(b.signal.aborted, true, '★ 到点自行 abort')
    b.done()

    const outer2 = new AbortController()
    const b2 = withBudget(outer2.signal, 10000)
    outer2.abort()
    eq(b2.signal.aborted, true, '★ 外层信号能传导进来')
    b2.done()

    // 外层已经 aborted 时立刻生效
    const outer3 = new AbortController()
    outer3.abort()
    const b3 = withBudget(outer3.signal, 10000)
    eq(b3.signal.aborted, true, '外层已 abort 时立即生效')
    b3.done()

    // done 之后到点不应再 abort（否则会误伤后续用法）
    const outer4 = new AbortController()
    const b4 = withBudget(outer4.signal, 20)
    b4.done()
    await new Promise(r => setTimeout(r, 50))
    eq(b4.signal.aborted, false, 'done() 之后不再触发超时 abort')
  }
} finally {
  globalThis.fetch = realFetch
}

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 元信息快路径 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 元信息快路径全部通过：${pass} 条断言`)
process.exit(0)
