/**
 * 产物体积门禁（NAV-v8 · 任务 4pnj9g）
 *
 * 为什么需要它：现有 `test-bundle.mjs` 守的是**首屏要下载的 JS**（入口 + modulepreload），
 * 它管不到两样东西：
 *   ① 「应用外壳」gzip 总量 —— 全部 assets/*.js + *.css 的 gzip 之和。
 *      首屏预算只盯入口图，而懒加载 chunk（AdminView / GraphView / BgmPlayer …）
 *      可以无限长胖却不触发任何断言。
 *   ② SW 预缓存清单的规模 —— SW 安装期要在后台把这些文件全下完，
 *      条目数 ×3.8 那次（16 → 61 条）就是在这里涨起来的，没人拦。
 *
 * 依据（2026-10-17 盘点，探针实测）：一周 83 次提交把外壳 gzip 推高 62%（386 → 624 KB），
 * 而 51 个发布门禁全部绿灯通过 —— 缺口正是「总量」这一层。
 *
 * 基线存于同目录 `bundle-size-baseline.json`（带备注与 M2 目标），超基线即失败。
 * 依赖 `dist/`，所以先 `npm run build`。运行：node tools/console/test-bundle-size.mjs
 * 加 `--strict`：没有 dist 视为失败（发布/验收流程用，那时必定构建过）。
 *
 * @ci-flags --strict
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const DIST = join(ROOT, 'dist')
const ASSETS = join(DIST, 'assets')

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }

/* ---------------- 读基线 ---------------- */

const baselineRaw = readFileSync(join(HERE, 'bundle-size-baseline.json'), 'utf-8')
const config = JSON.parse(baselineRaw)
const B = config.baseline
const T = config.target || {}
if (!B || typeof B.shellGzBytes !== 'number' || typeof B.swPrecacheItems !== 'number' || typeof B.swPrecacheBytes !== 'number') {
  console.error('\n❌ bundle-size-baseline.json 缺少 baseline 字段（shellGzBytes / swPrecacheItems / swPrecacheBytes）')
  process.exit(1)
}

/* ---------------- 读产物 ---------------- */

if (!existsSync(join(DIST, 'index.html')) || !existsSync(join(DIST, 'sw.js'))) {
  const strict = process.argv.includes('--strict')
  const msg = '⚠️  找不到 dist/index.html 或 dist/sw.js —— 产物体积门禁已跳过（先跑 `npm run build`）'
  if (strict) { console.error(`\n❌ ${msg} [--strict 下视为失败]`); process.exit(1) }
  console.warn(`\n${msg}`)
  process.exit(0)
}

// ① 应用外壳 gzip 总量：全部 assets/*.js + *.css（与 probe/_sw-stats.mjs 的「assets gz 合计」同口径）
let shellRaw = 0
let shellGz = 0
let shellFiles = 0
for (const f of readdirSync(ASSETS)) {
  const p = join(ASSETS, f)
  if (!statSync(p).isFile()) continue
  if (!/\.(js|css)$/.test(f)) continue
  const buf = readFileSync(p)
  shellRaw += buf.length
  shellGz += gzipSync(buf).length
  shellFiles++
}

// ② SW 预缓存清单：条目数 + 清单内文件的实际字节（SW 安装期要下载的量）
const swCode = readFileSync(join(DIST, 'sw.js'), 'utf-8')
// 清单形如 precacheAndRoute([{url:"assets/x.js",revision:null},...]) —— 只取顶层 url 字段
const swUrls = [...swCode.matchAll(/url:\s*"([^"]+)"/g)].map(m => m[1])
let swBytes = 0
const swMissing = []
for (const u of swUrls) {
  try { swBytes += statSync(join(DIST, u.replace(/^\//, ''))).size } catch { swMissing.push(u) }
}

/* ---------------- 断言 ---------------- */

const kib = n => (n / 1024).toFixed(1)

ok(shellGz <= B.shellGzBytes,
  `应用外壳 gzip 总量 ${kib(shellGz)} KiB ≤ 基线 ${kib(B.shellGzBytes)} KiB`,
  `超 ${kib(shellGz - B.shellGzBytes)} KiB（${shellFiles} 个 js/css 文件，raw ${kib(shellRaw)} KiB）`)

ok(swUrls.length <= B.swPrecacheItems,
  `SW 预缓存条目数 ${swUrls.length} ≤ 基线 ${B.swPrecacheItems}`,
  `超 ${swUrls.length - B.swPrecacheItems} 条`)

ok(swBytes <= B.swPrecacheBytes,
  `SW 预缓存字节 ${(swBytes / 1024 / 1024).toFixed(2)} MB ≤ 基线 ${(B.swPrecacheBytes / 1024 / 1024).toFixed(2)} MB`,
  `超 ${((swBytes - B.swPrecacheBytes) / 1024 / 1024).toFixed(2)} MB`)

ok(swMissing.length === 0,
  '预缓存清单里的文件都真实存在（清单挂 404 会让 SW 安装失败）',
  `缺 ${swMissing.join(' ')}`)

/*
 * ③ SW 自身的路由自洽性（2026-10-21 真实故障）。
 *
 * `createHandlerBoundToURL(url)` 要求 url **在预缓存清单里**，否则 SW 启动时抛
 * `non-precached-url`，整段注册逻辑中断 —— 后面所有 registerRoute 都不会执行。
 * 症状是 PWA 离线能力静默失效：不白屏、不报错给用户，只有控制台一条 Uncaught。
 *
 * 本项目实测踩过：vite-plugin-pwa 默认 `navigateFallback: 'index.html'` 会注入这条路由，
 * 而 `globIgnores` 里的 html 排除规则又把 index.html 从清单里过滤掉了。
 * 两条规则各自看都合理，叠在一起就是崩溃。
 */
const boundUrls = [...swCode.matchAll(/createHandlerBoundToURL\(\s*["']([^"']+)["']\s*\)/g)].map(m => m[1])
const boundMissing = boundUrls.filter(u => !swUrls.includes(u) && !swUrls.includes(u.replace(/^\//, '')))
ok(boundMissing.length === 0,
  'createHandlerBoundToURL 引用的 URL 都在预缓存清单里（否则 SW 注册中断）',
  `缺 ${boundMissing.join(' ')} —— 加进 globIgnores 或把 navigateFallback 设为 null`)

// 导航请求必须有承接：要么插件的 navigateFallback 路由，要么自己的 navigate 规则
const hasNavRoute = swCode.includes('navigate') || swCode.includes('NavigationRoute')
ok(hasNavRoute,
  'SW 有导航请求的承接路由（否则离线打不开任何页面）',
  '既无 navigateFallback 也无 navigate 规则')

/* ---------------- 台账（让人一眼看到离 M2 目标还有多远） ---------------- */

console.log('\n应用外壳体积台账（磁盘字节 / gzip）：')
console.log(`  js+css ${shellFiles} 个：${kib(shellRaw)} KiB raw / ${kib(shellGz)} KiB gz`)
console.log(`  基线 ${kib(B.shellGzBytes)} KiB gz｜M2 目标 ${T.shellGzBytes ? kib(T.shellGzBytes) + ' KiB gz' : '(未设)'}`)
console.log(`SW 预缓存：${swUrls.length} 条 / ${(swBytes / 1024 / 1024).toFixed(2)} MB`)
console.log(`  基线 ${B.swPrecacheItems} 条 / ${(B.swPrecacheBytes / 1024 / 1024).toFixed(2)} MB｜M2 目标 ${T.swPrecacheItems ?? '(未设)'} 条`)

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 产物体积门禁 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  console.error('\n  体积回涨是「无声的」——它不会让任何测试变红，只让用户变慢。')
  console.error('  若这次增量是有意的（新功能），请更新 tools/console/bundle-size-baseline.json 并补一句备注。')
  process.exit(1)
}
console.log(`\n✅ 产物体积门禁通过：${pass} 条断言`)
