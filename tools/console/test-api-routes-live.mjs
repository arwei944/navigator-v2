/**
 * 控制台路由覆盖用例：真实启动控制台，逐条打全部路由，确认每条都**被路由识别**。
 *
 * ## 守的是什么
 *
 * `api.mjs` 已按域拆成 6 个文件（分发起 + 5 个域）。拆分是纯搬运，
 * 但搬运的错误方式恰好是**静默**的：某条路由漏接，`handleApi` 返回 false，
 * 服务会把它当静态资源处理 —— 前端拿到 404 或 HTML，表现成「某个面板不工作」，
 * 而门禁全绿。所以必须有一条**真正发 HTTP 请求**的用例，逐条确认路由还在。
 *
 * ## 判定口径
 *
 * 不看状态码（很多接口需要参数、凭据或真实数据，合法会回 4xx），
 * 只看**是否被路由层认领**：路由不认识会走到静态兜底，返回
 * `{"error":"接口不存在：..."}` 或 HTML。只要不是这两种，就说明路由存在。
 *
 * 运行：node tools/console/test-api-routes-live.mjs
 */
import { spawn } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { EXPECTED_ROUTES } from './lib/routes/api-routes.expected.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PORT = 5299

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }

/**
 * 从实现里抽出实际存在的路由（方法取自所在函数名 `handleXxxGet/Post`）。
 *
 * 注意：这个抽取结果**不能**当作期望值用 —— 它就是被测对象本身。
 * 期望值来自 `api-routes.expected.mjs`，两者双向比对。
 */
const ROUTES_DIR = join(ROOT, 'tools/console/lib/routes')
const routeFiles = readdirSync(ROUTES_DIR).filter((f) => /^api(-[a-z]+)?\.mjs$/.test(f))
const actual = []
for (const f of routeFiles) {
  const text = readFileSync(join(ROUTES_DIR, f), 'utf8')
  const marks = [...text.matchAll(/export async function (handle\w+(Get|Post))/g)]
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length
    const body = text.slice(start, end)
    const method = marks[i][2] === 'Post' ? 'POST' : 'GET'
    for (const m of body.matchAll(/path === '(\/api\/[^']+)'/g)) actual.push(`${method} ${m[1]}`)
  }
}
const actualSet = new Set(actual)
const expectedSet = new Set(EXPECTED_ROUTES)

/* 双向比对：少了是「路由丢了」，多了是「新增路由没进清单」 */
const missing = EXPECTED_ROUTES.filter((r) => !actualSet.has(r))
const extra = [...actualSet].filter((r) => !expectedSet.has(r))
ok(missing.length === 0, '期望清单里的路由全部存在', missing.length ? `缺失：${missing.join('、')}` : '')
ok(extra.length === 0, '实现里没有清单外的路由', extra.length ? `多出：${extra.join('、')}（新增路由请同步 api-routes.expected.mjs）` : '')
ok(EXPECTED_ROUTES.length >= 50, `期望清单规模正常（${EXPECTED_ROUTES.length} 条）`, EXPECTED_ROUTES.length < 50 ? '清单可能被误删' : '')

const routeList = EXPECTED_ROUTES.map((r) => {
  const [method, route] = r.split(' ')
  return { method, route }
}).sort((a, b) => a.route.localeCompare(b.route))

/* 启动控制台（非严格端口，避免与现有实例冲突） */
const child = spawn(process.execPath, ['tools/console/server.mjs', '--port', String(PORT)], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let ready = false
const startedAt = Date.now()
const waitReady = new Promise((resolve) => {
  const onData = (buf) => {
    if (String(buf).includes(String(PORT))) { ready = true; resolve(true) }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  setTimeout(() => resolve(false), 20000)
})

/**
 * 「路由层没认领」的三种表现：
 *   · 控制台自身的兜底 404 —— `{"error":"Not found"}`（server.mjs:78/145）
 *   · 线上服务的兜底 404 —— `{"error":"接口不存在：..."}`（server/main.mjs）
 *   · 静态兜底把路径回成 HTML
 * 三者任一命中即视为「这条路由不存在」。只认其中一种会放过另外两种。
 */
const UNCLAIMED = /"error"\s*:\s*"(Not found|接口不存在)|<!doctype html>/i

/**
 * 请求一条路由，返回 { status, body }。
 *
 * 方法必须与路由的真实归属一致：GET 路由用 GET，写路由用 POST。
 * 拿 GET 去打 POST 路由会命中兜底 404，看起来像「路由丢了」——
 * 那是测试方法错误，不是拆分缺陷。
 */
async function probe(route, method = 'GET') {
  // 带参数的路由补上占位参数，确保走到底而不是在参数校验处提前返回
  const url = `http://127.0.0.1:${PORT}${route}?id=probe&url=https%3A%2F%2Fexample.com&limit=1`
  const res = await fetch(url, {
    method,
    headers: { 'X-Nav-Console': '1', 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify({ id: 'probe', dryRun: true }) : undefined,
  })
  return { status: res.status, body: await res.text() }
}

try {
  await waitReady
  ok(ready, '控制台已启动', ready ? '' : `${Date.now() - startedAt}ms 内未见端口输出`)

  if (ready) {
    /*
     * 只发 **GET** 请求来验证真实路由认领。
     *
     * 为什么不对写路由发 POST：实测发现那会真的执行写操作 ——
     * 一次跑下来生成了站点数据备份、改了 `.env.local`、写了排程与通知配置。
     * 一条门禁绝不该改动真实数据，哪怕结果「看起来没坏」。
     *
     * 写路由改由下方的静态断言覆盖：确认它出现在某个 POST 分发表的函数里。
     */
    const getRoutes = routeList.filter((r) => r.method === 'GET')
    for (const { route } of getRoutes) {
      let r
      try {
        r = await probe(route, 'GET')
      } catch (e) {
        failures.push(`路由已认领 GET ${route} — 请求失败：${e.message}`)
        continue
      }
      const unclaimed = UNCLAIMED.test(r.body)
      ok(!unclaimed, `路由已认领 GET ${route}`, unclaimed ? `状态 ${r.status}，返回静态兜底` : '')
    }

    /* 对照组：不存在的路由必须被判为「未认领」—— 证明上面的判定口径有效 */
    const ctrl = await probe('/api/__definitely_not_a_route__')
    ok(UNCLAIMED.test(ctrl.body), '对照组：未知路由确实被判为未认领（判定口径有效）', ctrl.body.slice(0, 80))
  }
} finally {
  child.kill()
}

/*
 * 写路由：静态确认它落在 `handleXxxPost` 函数体内（即被 POST 分发表收录）。
 *
 * 这比「发一次 POST 看有没有报错」弱一点，但**不会改真实数据**。
 * 拆分前这里是 40 多个 `if (method === 'POST')` 里的分支，属于同一个函数；
 * 拆开后每个域一个 `handleXxxPost`，只要路由字面量出现在其中任一函数体内即可。
 */
{
  const postRoutes = routeList.filter((r) => r.method === 'POST')
  ok(postRoutes.length > 20, `识别到写路由（${postRoutes.length} 条）`, postRoutes.length <= 20 ? '写路由抽取可能失效' : '')

  const postBodies = []
  for (const f of routeFiles) {
    const text = readFileSync(join(ROUTES_DIR, f), 'utf8')
    const marks = [...text.matchAll(/export async function (handle\w+Post)/g)]
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].index
      const end = i + 1 < marks.length ? marks[i + 1].index : text.length
      postBodies.push(text.slice(start, end))
    }
  }
  const postSrc = postBodies.join('\n')
  for (const { route } of postRoutes) {
    ok(postSrc.includes(`path === '${route}'`), `写路由已接进 POST 分发 ${route}`)
  }
}

console.log(`\n🧭 控制台路由覆盖：${pass} 通过 / ${failures.length} 失败`)
if (failures.length) {
  console.log('\n失败明细：')
  for (const f of failures) console.log(`- ${f}`)
  process.exit(1)
}
console.log(`  ✓ 全部 ${routeList.length} 条路由都被路由层认领，拆分未漏接`)
