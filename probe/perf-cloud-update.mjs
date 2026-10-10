/**
 * 测量「云端数据更新 → 列表重建 → 全量卡片重渲染」的真实代价。
 *
 * 这是本项目唯一**周期性自动发生**的重渲染路径（30s 轮询 / 标签页重新可见），
 * 而且是用户完全不感知的。预览环境里 `/api/sites` 没有接口，云端路径根本不会跑，
 * 所以必须打桩 fetch 才能测到。
 *
 * 三种变体：
 *   A. 纯版本推进（内容零改动）—— 最坏的无用功：什么都没变，却重建了整个列表
 *   B. 只改 1 个站点的 desc   —— 真实的「云端改了 1 条」
 *   C. 改 1 个站点的 url      —— 同 B，但会让图标 / 链接也变
 *
 * 用法: node probe/perf-cloud-update.mjs <cdp-port> [base-url] [轮次]
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PORT = process.argv[2] || '9345'
const BASE = process.argv[3] || 'http://localhost:4173'
const ROUNDS = Number(process.argv[4] || 5)

const payload = JSON.parse(readFileSync(fileURLToPath(new URL('./_live-sites.json', import.meta.url)), 'utf8'))
const BASE_VERSION = Number(payload.version) || 100

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const t = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl)
if (!t) throw new Error('没有可用的 Chrome 页面')

const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const pending = new Map()
ws.onmessage = e => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
}
const send = (method, params = {}) => {
  const i = ++id
  ws.send(JSON.stringify({ id: i, method, params }))
  return new Promise(r => pending.set(i, r))
}
const evaluate = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result?.value
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

await send('Performance.enable')
await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

async function metrics() {
  const m = await send('Performance.getMetrics')
  const get = n => (m.metrics || []).find(x => x.name === n)?.value ?? 0
  return { script: get('ScriptDuration'), layout: get('LayoutDuration'), recalc: get('RecalcStyleDuration') }
}

const median = arr => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)]
const FLUSH = `new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))`

/** 打桩 fetch：/api/sites 返回 window.__cloud（内容由测试随时改写） */
const stub = `(() => {
  const REAL = ${JSON.stringify(payload)};
  window.__cloud = { version: ${BASE_VERSION}, sites: REAL.sites, updatedAt: REAL.updatedAt };
  const orig = window.fetch
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    if (url.includes('/api/sites')) {
      return Promise.resolve(new Response(JSON.stringify(window.__cloud), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      }))
    }
    if (url.includes('/api/clicks')) {
      return Promise.resolve(new Response('{"counts":{}}', {
        status: 200, headers: { 'Content-Type': 'application/json' }
      }))
    }
    return orig.apply(this, arguments)
  }
})()`

await send('Page.addScriptToEvaluateOnNewDocument', { source: stub })
await send('Page.navigate', { url: BASE + '/' })
await sleep(2800)

const cards = await evaluate(`document.querySelectorAll('.card').length`)
const ver = await evaluate(`window.__cloud.version`)
console.log(`\n=== 云端更新代价测量（${BASE}，${cards} 张卡，云端 version=${ver}，${ROUNDS} 轮取中位）===\n`)

/**
 * 一个「探测点」：改数据 → 推进版本 → 触发轮询 → 等渲染落定 → 收指标。
 *
 * ⚠️ 改数据必须**整体替换数组元素**（`sites[0] = { ...sites[0], x }`），不能就地改字段。
 * 生产里每次轮询都是 `res.json()` 重新解析，src 对象身份必然换新；若这里就地改，
 * 身份不变 → rebuild 的复用判据认定「没变」→ 视图不更新，测出来的就是假象。
 */
async function probe(label, mutateExpr, rounds = ROUNDS) {
  const s = [], l = [], r = []
  for (let i = 0; i < rounds; i++) {
    await sleep(400)
    const before = await metrics()
    await evaluate(`(() => {
      // 模拟服务端重新序列化：整份 sites 换成新对象（身份全变，内容可能相同）
      window.__cloud.version = window.__cloud.version + 1
      const fresh = window.__cloud.sites.map(s => ({ ...s }))
      ${mutateExpr}
      window.__cloud.sites = fresh
      document.dispatchEvent(new Event('visibilitychange'))
      return window.__cloud.version
    })()`)
    // 轮询是 async：fetch 打桩同步 resolve，但要等 microtask + Vue flush + 渲染
    await sleep(60)
    await evaluate(FLUSH)
    const after = await metrics()
    s.push((after.script - before.script) * 1000)
    l.push((after.layout - before.layout) * 1000)
    r.push((after.recalc - before.recalc) * 1000)
  }
  console.log(`  ${label.padEnd(26)} 脚本 ${median(s).toFixed(1).padStart(6)} ms ／ 布局 ${median(l).toFixed(2).padStart(5)} ms ／ 样式重算 ${median(r).toFixed(2).padStart(5)} ms`)
  return { script: median(s), layout: median(l), recalc: median(r) }
}

const results = {}
// 说明：这里模拟的是「数据真的变了」那一类轮询（每次都重新解析出新对象）。
// 内容未变的轮询在带上 If-None-Match 之后根本不会走到 rebuild —— 见 test-etag-poll.mjs。
results['版本推进（内容不变，仅换对象）'] = await probe('版本推进（内容不变）', `/* 内容不动，只换对象 */`)
results['改 1 条 desc'] = await probe('改 1 条 desc', `fresh[0].desc = '云端改动的描述 ' + window.__cloud.version`)
results['改 1 条 url'] = await probe('改 1 条 url', `fresh[0].url = 'chat.openai.com/?v=' + window.__cloud.version`)

/* 对照组：切分类（原本就该重渲染，用户主动触发的） */
const cats = await evaluate(`document.querySelectorAll('.chip').length`)
const catS = [], catL = []
for (let i = 0; i < ROUNDS; i++) {
  await sleep(400)
  const before = await metrics()
  await evaluate(`(() => {
    const els = [...document.querySelectorAll('.chip')]
    const el = els[${i + 1} % Math.max(1, els.length)]
    el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return 1
  })()`)
  await evaluate(FLUSH)
  const after = await metrics()
  catS.push((after.script - before.script) * 1000)
  catL.push((after.layout - before.layout) * 1000)
}
console.log(`  ${'〔对照〕用户切分类'.padEnd(24)} 脚本 ${median(catS).toFixed(1).padStart(6)} ms ／ 布局 ${median(catL).toFixed(2).padStart(5)} ms  （${cats} 个筛选项）`)

console.log('\n=== 汇总（毫秒）===')
console.log(JSON.stringify(results, null, 2))
ws.close()
process.exit(0)
