/**
 * 云端轮询的**节奏语义**用例：零依赖、不联网（假时钟 + 打桩 fetch）。
 *
 * 这里守三条容易被改坏的规则，它们都来自真实事故或真实风险：
 *
 *   1. **402（平台暂停部署）必须停排期**。Vercel Hobby 额度打满后会暂停整个部署，
 *      全站返回 `402 DEPLOYMENT_DISABLED`。这种状态重试一万次也不会恢复，
 *      而继续按退避节奏每 5 分钟打一次，烧的正是已经被烧光的那份额度。
 *   2. **后台标签页不轮询**。浏览器只把后台定时器压到 ~1 次/分钟，不会停掉它，
 *      挂后台一整天就是白烧额度（额度打满 → 部署被暂停 → 整站下线）。
 *   3. **ETag 条件请求与退避封顶不能被破坏**：前者把每轮 ~34KB 压成 0 字节，
 *      后者是断网时不「每 30 秒打一个必然失败的请求」的兜底。
 *
 * 用假时钟（接管 setTimeout/clearTimeout/setInterval/clearInterval）而不是真的等，
 * 否则只能靠 sleep 撞运气，测不稳也测不快。
 *
 * 运行：node tools/console/test-cloud-poll.mjs
 */
import { createServer } from 'vite'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

/* ══════════ 浏览器与时钟替身 ══════════ */

const docListeners = new Map()
const documentStub = {
  visibilityState: 'visible',
  addEventListener(type, fn) { if (!docListeners.has(type)) docListeners.set(type, new Set()); docListeners.get(type).add(fn) },
  removeEventListener(type, fn) { docListeners.get(type)?.delete(fn) },
}
function setVisibility(state) {
  documentStub.visibilityState = state
  for (const fn of docListeners.get('visibilitychange') || []) fn()
}

const mem = new Map()
const localStorageStub = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)) },
  removeItem: k => { mem.delete(k) },
  clear: () => mem.clear(),
}
const windowStub = {
  addEventListener() {}, removeEventListener() {},
  localStorage: localStorageStub,
}
// clicks store 在切后台时会走 sendBeacon 把增量发出去；Node 有只读的 navigator，
// 只能往上补方法，不能整体替换
try { Object.defineProperty(globalThis.navigator, 'sendBeacon', { value: () => true, configurable: true }) } catch {}

/* 假时钟：只有被 advance() 推进时时间才走 */
let clock = 0
let timerSeq = 0
const timeouts = new Map()
const intervals = new Map()
const setTimeoutStub = (fn, ms = 0) => { const id = ++timerSeq; timeouts.set(id, { fn, at: clock + (Number(ms) || 0) }); return id }
const clearTimeoutStub = id => { timeouts.delete(id) }
const setIntervalStub = (fn, ms) => { const id = ++timerSeq; const step = Number(ms) || 1; intervals.set(id, { fn, at: clock + step, step }); return id }
const clearIntervalStub = id => { intervals.delete(id) }

const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

/** 推进假时钟，按时间顺序触发到期的定时器；每触发一次就把微任务排空 */
async function advance(ms) {
  const target = clock + ms
  for (;;) {
    const dueTo = [...timeouts.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
    const dueIv = [...intervals.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
    let pick = null
    if (dueTo && dueIv) pick = dueTo[1].at <= dueIv[1].at ? { kind: 'to', e: dueTo } : { kind: 'iv', e: dueIv }
    else if (dueTo) pick = { kind: 'to', e: dueTo }
    else if (dueIv) pick = { kind: 'iv', e: dueIv }
    if (!pick) break
    const [id, t] = pick.e
    if (pick.kind === 'to') {
      timeouts.delete(id)
      clock = Math.max(clock, t.at)
    } else {
      // 周期性定时器：时钟推到它该触发的时刻，再排下一次（不能在这里重算相对时间，否则永远追不上）
      clock = Math.max(clock, t.at)
      t.at = clock + t.step
    }
    t.fn()
    await drain()
  }
  clock = target
  await drain()
}

/** 下一个到期的 setTimeout 距离当前时钟还有多久 */
const nextTimeoutDelay = () => {
  const at = Math.min(...[...timeouts.values()].map(t => t.at))
  return Number.isFinite(at) ? Math.max(0, at - clock) : Infinity
}

/* ---------- fetch 打桩 ---------- */

const requests = []
let queue = []
/**
 * 默认补上 `content-type: application/json` —— 真实的 `/api/sites` 就是这么回的。
 * 少了它会与「静态托管返回 HTML 兜底页」混为一谈：store 现在会先看 Content-Type
 * 再解析，桩不带这个头就会被判成 `invalid-payload`（曾经因此误报 10 条失败）。
 */
function reply(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: k => (headers[k.toLowerCase()] ?? (k.toLowerCase() === 'content-type' && status < 300 && status !== 204 ? 'application/json' : null)) },
    json: async () => JSON.parse(body),
    text: async () => body,
  }
}
const sitesJson = (version, sites) => reply(200, JSON.stringify({ version, sites }), { etag: `W/"v${version}"` })
const SITE = (id, name) => ({ id, name, url: `https://${id}.example.com`, desc: '', categoryId: 'misc', purposes: [] })
/** 平台暂停部署时的真实响应体 */
const PAUSED = reply(402, 'Payment required\n\nDEPLOYMENT_DISABLED\n\nhnd1::x-y-z\n', { 'content-type': 'text/plain' })
/** 静态托管下的 SPA 兜底页：200 + HTML，接口根本不存在 */
const HTML_FALLBACK = reply(200, '<!doctype html><html><body>app</body></html>', { 'content-type': 'text/html' })

/* ══════════ 起 Vite（必须早于挂 DOM 替身）══════════ */

const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
  customLogger: { info() {}, warn() {}, warnOnce() {}, clearScreen() {}, hasWarned: false, error(m) { if (!/WebSocket server error/.test(String(m))) console.error(m) } },
})

globalThis.document = documentStub
globalThis.window = windowStub
globalThis.localStorage = localStorageStub
globalThis.setTimeout = setTimeoutStub
globalThis.clearTimeout = clearTimeoutStub
globalThis.setInterval = setIntervalStub
globalThis.clearInterval = clearIntervalStub
globalThis.fetch = async (url, init = {}) => {
  const u = String(url)
  if (!u.includes('/api/sites')) return reply(200, '{}')   // 点击量 / 判定等旁路接口：给个空响应，别混进断言
  requests.push({ url: u, ifNoneMatch: init.headers?.['If-None-Match'] ?? null, at: clock })
  const r = queue.shift()
  if (!r) throw new Error('测试未准备响应：' + u)
  return r
}

const { createPinia, setActivePinia } = await import('pinia')
const { createApp } = await import('vue')
setActivePinia(createPinia())
const { useSitesStore } = await server.ssrLoadModule('/src/stores/sites.js')

try {
  const store = useSitesStore()
  const sitesRequests = () => requests.length
  /**
   * 每个小节之间的复位。**必须连虚拟时钟与定时器一起清**：
   * 只清请求与响应队列的话，上一节 `advance(20 分钟)` 推出去的 clock 会留下来，
   * 后面测「到下一次排期还有多久」就全变成相对错位基准的差值 ——
   * 曾经因此得到「期望 30000，实得 5」这种看着像产品坏了、其实是用例自己串味的失败。
   * 定时器清了之后各节都必须显式 `startPolling`，语义也更清楚。
   */
  const reset = () => {
    requests.length = 0
    queue = []
    timeouts.clear()
    intervals.clear()
    clock = 0
    store.stopPolling()
  }

  /* ══════════ 1. 首拉 + ETag 条件请求 + 304 ══════════ */

  reset()
  queue.push(sitesJson(2, [SITE('a', '甲'), SITE('b', '乙')]), reply(304, ''))
  await store.initCloudSites()
  eq(store.cloudVersion, 2, '首拉应用云端版本')
  eq(store.cloudError, '', '首拉成功，无错误码')
  eq(sitesRequests(), 1, '只发一次请求')

  store.startPolling(30000)
  eq(nextTimeoutDelay(), 30000, 'startPolling 按给定间隔排期')
  await advance(30000)
  eq(sitesRequests(), 2, '到点后发出第二轮')
  eq(requests[1].ifNoneMatch, 'W/"v2"', '第二轮带上第一轮拿到的 ETag（条件请求）')
  eq(store.cloudError, '', '304 不算失败')
  eq(store.cloudVersion, 2, '304 不改版本（内容未变）')

  /* ══════════ 2. 失败退避：翻倍、且封顶在 5 分钟 ══════════
     断言的是**相邻两次请求的间隔**，而不是「此刻离下一次还有多久」——
     后者取决于测量时落在区间的哪个位置，是量错了对象。 */

  reset()
  for (let i = 0; i < 12; i++) queue.push(reply(500, 'boom'))
  store.startPolling(30000)
  await advance(30 * 60 * 1000)
  eq(store.cloudError, 'http-500', '500 记成机器可读的 http-500')
  const gaps = requests.slice(1).map((r, i) => r.at - requests[i].at)
  ok(gaps.length >= 5, '退避期间仍在重试（不是放弃）', JSON.stringify(gaps))
  // 既有语义：第 n 次失败后间隔 = 30s × 2^min(n,4)，超过 5 分钟就按 5 分钟
  eq(gaps[0], 60000, '第一次失败即翻倍到 60s')
  eq(gaps[1], 120000, '第二次失败 → 120s')
  eq(gaps[2], 240000, '第三次失败 → 240s')
  eq(gaps[gaps.length - 1], 300000, '封顶在 5 分钟（不会无限翻倍）', JSON.stringify(gaps))
  ok(gaps[gaps.length - 2] === 300000, '封顶后保持匀速', JSON.stringify(gaps))

  /* ══════════ 3. 402（平台暂停部署）→ 停掉排期 ══════════ */

  reset()
  queue.push(PAUSED)
  store.startPolling(30000)
  await advance(30000)
  eq(store.cloudError, 'http-402', '402 记成 http-402')
  eq(sitesRequests(), 1, '402 那一次确实打了')

  // 关键断言：不再排期。推进 20 分钟，一个站点请求都不该再发出去
  ok(timeouts.size === 0, '402 之后没有留下任何待触发的定时器', `剩 ${timeouts.size} 个`)
  await advance(20 * 60 * 1000)
  eq(sitesRequests(), 1, '402 之后不再轮询（推进 20 分钟仍无新请求）')

  /* ══════════ 4. 手动重试可以把它救回来 ══════════ */

  reset()
  queue.push(sitesJson(3, [SITE('a', '甲'), SITE('b', '乙'), SITE('c', '丙')]))
  store.startPolling(30000)
  await store.retryCloudNow()
  eq(store.cloudVersion, 3, '手动重试后拿到新版本')
  eq(store.cloudError, '', '重试成功，错误码被清掉')
  ok(nextTimeoutDelay() === 30000, '恢复正常节奏（重新按 30s 排期）', `${nextTimeoutDelay()}`)

  /* ══════════ 5. 后台标签页不轮询；回到前台立刻补一次 ══════════ */

  reset()
  queue.push(sitesJson(4, [SITE('a', '甲')]))
  store.startPolling(30000)
  setVisibility('hidden')
  eq(timeouts.size, 0, '切到后台后排期被清掉')
  await advance(20 * 60 * 1000)
  eq(sitesRequests(), 0, '后台 20 分钟一个请求都不发（否则白烧云端额度）')

  setVisibility('visible')
  await drain()
  eq(sitesRequests(), 1, '回到前台立刻补一次（用户看到的不是后台里的旧数据）')
  eq(store.cloudVersion, 4, '补的那一次正常应用新数据')
  ok(nextTimeoutDelay() === 30000, '并把常规节奏接回去', `${nextTimeoutDelay()}`)

  /* ══════════ 6. 静态托管的 HTML 兜底页：判成 invalid-payload 并停止轮询 ══════════
   *
   * 这条守卫的是「把接口不存在说成网络离线」那个缺陷：SPA 兜底 / 登录页 / 代理拦截
   * 都会回 200 + HTML，而 `res.ok` 为真。旧实现直接 `res.json()` 抛异常，落进 catch
   * 被算作 `offline` → 界面显示「已离线，联网后会自动更新」，但用户网络好得很，
   * 那个「自动更新」永远不会发生，而且每 30s 还在下载整份 index.html。
   */

  reset()
  queue.push(HTML_FALLBACK)
  store.startPolling(30000)
  await store.retryCloudNow()
  eq(store.cloudError, 'invalid-payload', 'HTML 兜底页判成 invalid-payload（不是 offline）')
  ok(timeouts.size === 0, 'invalid-payload 之后不再排期（接口不存在，重试无意义）', `剩 ${timeouts.size} 个`)
  await advance(20 * 60 * 1000)
  eq(sitesRequests(), 1, 'invalid-payload 之后不再轮询（推进 20 分钟仍无新请求）')

  // 仍然可以被手动重试救回来：一旦后端上线（或换成真接口），立刻恢复正常节奏
  reset()
  queue.push(sitesJson(5, [SITE('a', '甲')]))
  store.startPolling(30000)
  await store.retryCloudNow()
  eq(store.cloudError, '', '静态兜底之后，手动重试仍能恢复')
  eq(store.cloudVersion, 5, '恢复后正常应用云端版本')
  ok(nextTimeoutDelay() === 30000, '并接回常规节奏', `${nextTimeoutDelay()}`)

  /* ══════════ 7. 404（这个部署根本没有 /api/sites）→ 同样停掉排期 ══════════
   *
   * 纯静态托管就是这个样子：接口不存在，回宿主自己的 404 页。
   * 与 402 同性质 —— 再轮询一万次也还是 404，只会白白打请求。
   */

  reset()
  queue.push(reply(404, '<!DOCTYPE HTML><html><body><h1>Error response</h1><p>Error code: 404</p></body></html>', { 'content-type': 'text/html' }))
  store.startPolling(30000)
  await advance(30000)
  eq(store.cloudError, 'http-404', '404 记成 http-404')
  ok(timeouts.size === 0, '404 之后不再排期（接口不存在）', `剩 ${timeouts.size} 个`)
  await advance(20 * 60 * 1000)
  eq(sitesRequests(), 1, '404 之后不再轮询（推进 20 分钟仍无新请求）')

  /* ══════════ 8. stopPolling 之后彻底安静 ══════════ */

  reset()
  queue.push(sitesJson(6, [SITE('a', '甲')]))
  store.startPolling(30000)
  store.stopPolling()
  await advance(20 * 60 * 1000)
  eq(sitesRequests(), 0, 'stopPolling 后不再有任何请求')
} finally {
  await server.close()
}

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 云端轮询节奏 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 云端轮询节奏全部通过：${pass} 条断言`)
process.exit(0)
