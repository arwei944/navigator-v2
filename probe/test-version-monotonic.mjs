/**
 * 端到端验证「云端 version 单调递增」：乱序的慢响应不能把整站回滚到旧版本。
 *
 * 做法：用 Page.addScriptToEvaluateOnNewDocument 在文档创建前替换 window.fetch，
 * 让 /api/sites 返回受控的 version + 站点数；再用 visibilitychange 触发一次轮询
 * （App.vue 里有该监听 → pollCloudSites），观察是否按规则接受/忽略。
 */
const PORT = process.argv[2] || '9342'
const BASE = process.argv[3] || 'http://localhost:4173'   // vite preview 只绑 [::1]

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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
  return r.result?.value
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

const results = []
const check = (label, ok, extra = '') => {
  results.push({ label, ok })
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

// 文档创建前替换 fetch：/api/sites 返回受控数据，其余请求放行
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__mockVersion = 10;
    window.__mockCount = 5;
    window.__sitesCalls = 0;
    const __origFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      if (String(url).includes('/api/sites')) {
        window.__sitesCalls++;
        const n = window.__mockCount;
        const sites = Array.from({ length: n }, (_, i) => ({
          id: 'mock' + i, name: 'Mock站' + i, url: 'mock' + i + '.com', desc: '测试用站点',
          categoryId: 'starter', color: '#2563eb', initial: 'M', sortOrder: i,
          visitCount: 0, createdAt: 1700000000000 + i, updatedAt: 1700000000000 + i, purposes: []
        }));
        return new Response(JSON.stringify({ version: window.__mockVersion, sites }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        });
      }
      return __origFetch(url, opts);
    };
  `
})

await send('Page.navigate', { url: BASE + '/' })
await sleep(3500)

const cardCount = `document.querySelectorAll('.card').length`
const c0 = await evaluate(cardCount)
console.log(`\n[1] 首屏：mock version=10 / 5 条站点 → 实际渲染 ${c0} 张卡`)
check('首次同步接受云端数据', c0 === 5, `期望 5，实得 ${c0}`)

console.log('\n[2] 收到更旧的 version=3（模拟慢响应后到）/ 99 条')
await evaluate(`window.__mockVersion = 3; window.__mockCount = 99; document.dispatchEvent(new Event('visibilitychange')); 1`)
await sleep(1500)
const c1 = await evaluate(cardCount)
console.log(`  渲染 ${c1} 张卡`)
check('旧版本被丢弃，列表未被回滚', c1 === 5, `期望仍为 5，实得 ${c1}`)

console.log('\n[3] 收到更新的 version=20 / 7 条')
await evaluate(`window.__mockVersion = 20; window.__mockCount = 7; document.dispatchEvent(new Event('visibilitychange')); 1`)
await sleep(1500)
const c2 = await evaluate(cardCount)
console.log(`  渲染 ${c2} 张卡`)
check('新版本正常应用', c2 === 7, `期望 7，实得 ${c2}`)

console.log('\n[4] 并发去重：连续触发多次 visibilitychange')
await evaluate(`window.__sitesCalls = 0; for (let i = 0; i < 5; i++) document.dispatchEvent(new Event('visibilitychange')); 1`)
await sleep(1200)
const calls = await evaluate(`window.__sitesCalls`)
console.log(`  5 次触发实际发出 ${calls} 个 /api/sites 请求`)
check('in-flight 去重生效（远少于 5 次）', calls <= 2, `实发 ${calls}`)

const failed = results.filter(r => !r.ok)
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
ws.close()
process.exit(failed.length ? 1 : 0)
