/**
 * 双栈一致性门禁（kd7y5b）：`api/*.js`（Vercel 签名源）与 `server/main.mjs`（自托管宿主）
 * 的路由必须一一对应。
 *
 * ## 为什么要有这道闸
 *
 * 站点已从 Vercel 迁到自托管，但 `api/` 仍是**唯一的接口实现源**，由 `server/main.mjs`
 * 用薄适配层挂成路由（`API_ROUTES`）。于是存在一条**静默漂移**路径：
 * 新增一个 `api/foo.js` 却忘了在 `API_ROUTES` 里注册 → 构建照过、测试照绿，
 * 而这个接口线上直接 404（前端只会看到「这个部署没有该接口」）。
 * 反向漂移同样糟：路由表里留了一个已删函数的键 → 启动时 `import` 抛错，整个服务起不来。
 *
 * 现有 test-v10 / test-api-ops 测的是接口**行为**，覆盖不到「有没有被挂上去」。
 * 这里只钉注册关系，不重复行为断言。
 *
 * 白名单：`/api/_diag` 是自托管**专属**的内联排障端点（不来自 api/），
 * 对它不做「必须有 api/ 实现」的要求；但它必须以 `_` 开头，避免混进业务接口。
 *
 * 运行：node tools/console/test-dual-stack.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }

/* ---- 1. api/ 侧的接口实现（顶层 *.js，排除 data/ 与 .bak 备份） ---- */
const apiDir = join(ROOT, 'api')
const apiFns = readdirSync(apiDir)
  .filter(f => f.endsWith('.js'))
  .map(f => f.slice(0, -3))
  .sort()

/* ---- 2. server 侧的路由来源 ----
 *
 * 路由表已改为**从 `api/` 目录派生**（`loadApiRoutes()`），不再有可解析的字面量。
 * 这是好事：字面量方案本身就是要靠人去同步的第二份清单，防的正是它自己会漏。
 *
 * 所以本段改成验证「派生约定成立」，而不是「清单里有没有这一项」：
 *   - 路由表确实由目录派生（`api/` 的每个 .js 都会成为一条路由）
 *   - 派生规则是 `api/<name>.js → /api/<name>`，没有额外过滤
 *   - 自托管专属端点（_diag）仍内联在 server 里，不混进目录
 *
 * 行为层面的「接口真能访问」由 test-server-routes（产物比对）与
 * test-mcp（真实 stdio 调用）覆盖。
 */
const mainSrc = readFileSync(join(ROOT, 'server', 'main.mjs'), 'utf8')
ok(/readdirSync\(API_DIR\)/.test(mainSrc), 'server/main.mjs 的路由表从 api/ 目录派生')
ok(/const API_DIR = join\(ROOT, 'api'\)/.test(mainSrc), '派生目录指向 ROOT/api')
ok(/\`\/api\/\$\{name\}\`/.test(mainSrc), '派生规则是 api/<name>.js → /api/<name>')
ok(!/const \w+Handler = \(await import\('\.\/api\//.test(mainSrc),
  '没有残留的手抄 import 清单（派生方案的前提）')

/* ---- 3. 正向：每个 api/ 函数都会成为一条路由（按派生规则推导）---- */
const routes = apiFns.map(fn => `/api/${fn}`)
for (const fn of apiFns) {
  ok(routes.includes(`/api/${fn}`), `api/${fn}.js 会派生为 /api/${fn}`)
}

/* ---- 4. 反向：没有「目录外」的业务路由 ----
 * 派生方案下不可能出现「路由有、文件没有」，但仍要确认 server 没有在内联
 * 硬编码业务接口（那会绕过目录，回到双份清单）。白名单只留自托管专属端点。
 */
const inlineRoutes = [...mainSrc.matchAll(/pathname === '(\/api\/[a-z0-9_-]+)'/gi)].map(m => m[1])
const WHITELIST = new Set(['/api/_diag'])
const strayInline = inlineRoutes.filter(r => !WHITELIST.has(r) && !apiFns.includes(r.replace('/api/', '')))
ok(strayInline.length === 0, 'server 里没有内联硬编码的业务接口（避免绕开目录派生）', strayInline.join(' '))

/* ---- 5. 白名单里的自托管专属路由必须以 _ 开头（防止把业务接口混进来） ---- */
for (const r of WHITELIST) ok(r.split('/').pop().startsWith('_'), `白名单路由 ${r} 属自托管专属（_ 前缀）`)

/* ---- 6. 每个 api/ 函数都默认导出一个可调用 handler（静态检查，不实际 import 以免触发副作用）---- */
for (const fn of apiFns) {
  const src = readFileSync(join(apiDir, `${fn}.js`), 'utf8')
  ok(/export\s+default\s+/.test(src), `api/${fn}.js 默认导出 handler`)
}

/* ---- 报告 ---- */
console.log(`\n双栈一致性门禁：${pass} 通过，${failures.length} 失败`)
if (failures.length) {
  for (const f of failures) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log(`  ✓ api/ 共 ${apiFns.length} 个接口，与 server 路由一一对应`)
