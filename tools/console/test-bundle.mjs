/**
 * 第三批 · 序 23 的守卫：首屏分包**产物**断言（不是源码断言）。
 *
 * 为什么必须测产物：这一项在源码层面「看起来做对了」太容易了 —— 只要写 `import()` 就行。
 * 但真正决定浏览器行为的是一串连锁环节，任何一环漏掉都会让 226 KB 照旧压在首屏：
 *
 *   1. 「懒加载的那个模块」自己不能又被别的**静态 import** 拉回首屏图 —— 这正是本次实际踩到的坑：
 *      `services/autoAdd.js → shared/auto-category.mjs` 顶层静态 import 了 pinyin-pro，
 *      于是即便 `utils/search.js` 已改成 `import()`，入口 chunk 里仍会多出一条
 *      `import{pinyin}from"./pinyin-xxx.js"`，浏览器照旧在首屏下载它。
 *   2. 独立 chunk 不能出现在首屏 HTML 的 `modulepreload` 里（Vite 会为入口的静态依赖注入）。
 *   3. 入口里对它的引用形态必须是 `import("./pinyin-xxx.js")`（动态），不能是 `from"./pinyin-xxx.js"`。
 *
 * 所以这里直接读 `dist/` 的产物：判定「首屏要下载哪些 JS」用的是浏览器自己的规则
 * （`<script type="module">` + `<link rel="modulepreload">`），再断言那批文件里没有拼音引擎。
 *
 * 依赖 `dist/`，所以先 `npm run build`。运行：node tools/console/test-bundle.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const DIST = join(ROOT, 'dist')
const ASSETS = join(DIST, 'assets')

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(a === b, label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

/* ---------------- 读产物 ---------------- */

let html
try {
  html = readFileSync(join(DIST, 'index.html'), 'utf-8')
} catch {
  /**
   * 没有构建产物：默认**跳过**（不把「还没 build」当成回归），但必须显眼 ——
   * 一个永远静默跳过的守卫等于没有守卫。
   * 加 `--strict` 则视为失败，供发布/验收流程使用（那时 dist 必定存在）。
   */
  const strict = process.argv.includes('--strict')
  const msg = '⚠️  找不到 dist/index.html —— 首屏分包产物断言已跳过（先跑 `npm run build`）'
  if (strict) {
    console.error(`\n❌ ${msg} [--strict 下视为失败]`)
    process.exit(1)
  }
  console.warn(`\n${msg}`)
  process.exit(0)
}

const assetPath = href => href.replace(/^\/?assets\//, '')
const readAsset = p => readFileSync(join(ASSETS, p), 'utf-8')
const sizeOf = p => statSync(join(ASSETS, p)).size
const gzOf = p => gzipSync(readFileSync(join(ASSETS, p))).length

// 浏览器在首屏真正会下载的 JS：入口 module 脚本 + 所有 modulepreload。
// （样式表不参与本项判断，只用来核对总量。）
const entryHref = (html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/) || [])[1]
ok(Boolean(entryHref), 'index.html 里有入口 module 脚本')
const entry = assetPath(entryHref)

const preloadHrefs = [...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)].map(m => m[1])
const initialJs = [entry, ...preloadHrefs.map(assetPath)]

// 「拼音引擎的指纹」：pinyin-pro 的导出名，在入口与 vue chunk 里都是 0 次出现
const PINYIN_MARK = 'Pinyin'
// 「Vue 运行时的指纹」：用来核对 vendor 分包确实生效
const VUE_MARK = '__v_isRef'

const allJs = readdirSync(ASSETS).filter(f => f.endsWith('.js'))

/* ══════════ 1. 首屏不含拼音引擎 ══════════ */

for (const f of initialJs) {
  ok(!readAsset(f).includes(PINYIN_MARK), `首屏 JS 不含拼音引擎：${f}`)
}
ok(!html.includes(PINYIN_MARK), 'index.html 本身不含拼音引擎', '')

/* ══════════ 2. 拼音引擎确实被切成了独立 chunk（不是被 tree-shake 掉了） ══════════ */

const pinyinChunks = allJs.filter(f => readAsset(f).includes(PINYIN_MARK))
eq(pinyinChunks.length, 1, `拼音引擎恰好在一个独立 chunk 里（实得 ${pinyinChunks.join(', ')}）`)
const pinyinChunk = pinyinChunks[0]
ok(!initialJs.includes(pinyinChunk), '该 chunk 不在首屏下载清单里')
ok(sizeOf(pinyinChunk) > 150 * 1024, `该 chunk 体量符合预期（${(sizeOf(pinyinChunk) / 1024).toFixed(1)} KiB）`)

/* ══════════ 3. 入口对它的引用必须是动态 import ══════════ */

const entryCode = readAsset(entry)

// 用真正的 chunk 文件名断言，避免「恰好有另一个同名文件」的假阳性
ok(entryCode.includes(`import("./${pinyinChunk}")`) || entryCode.includes(`import('./${pinyinChunk}')`),
  '入口用动态 import 引用拼音 chunk')
ok(!entryCode.includes(`from"./${pinyinChunk}"`) && !entryCode.includes(`from'./${pinyinChunk}'`),
  '入口**没有**静态 import 拼音 chunk（静态会把首屏重新绑上）')

/* ══════════ 4. index.html 不能给它加 modulepreload ══════════ */

ok(!preloadHrefs.some(h => assetPath(h) === pinyinChunk),
  'index.html 没有为拼音 chunk 注入 modulepreload')

/* ══════════ 5. vendor 分包确实生效 ══════════ */

const vendorChunk = allJs.find(f => /^vendor-vue-/.test(f))
ok(Boolean(vendorChunk), '存在独立的 vendor-vue chunk')
if (vendorChunk) {
  ok(readAsset(vendorChunk).includes(VUE_MARK), 'vendor chunk 内确有 Vue 运行时')
  ok(!readAsset(entry).includes(VUE_MARK), 'Vue 运行时不在业务入口里（改业务代码不会让用户重下 Vue）')
}

/* ══════════ 6. 首屏预算（回归绊线） ══════════ */

const initRaw = initialJs.reduce((n, f) => n + sizeOf(f), 0)
const initGz = initialJs.reduce((n, f) => n + gzOf(f), 0)
const BUDGET_RAW = 600 * 1024
const BUDGET_GZ = 230 * 1024
ok(initRaw <= BUDGET_RAW, `首屏 JS 原始体积 ${(initRaw / 1024).toFixed(1)} KiB ≤ ${BUDGET_RAW / 1024} KiB`)
ok(initGz <= BUDGET_GZ, `首屏 JS gzip 体积 ${(initGz / 1024).toFixed(1)} KiB ≤ ${BUDGET_GZ / 1024} KiB`)

// 台账（不是断言，是让人一眼看到「省在哪」）。
// 注意这里是**磁盘字节数**，与 Vite 日志里的 kB 不同口径（Vite 报的是字符数，
// 而拼音词典里全是多字节 CJK，两者相差约 38%）。
const totalRaw = allJs.reduce((n, f) => n + sizeOf(f), 0)
console.log('\n首屏 JS 清单（KiB，磁盘字节）：')
for (const f of initialJs) console.log(`  ${(sizeOf(f) / 1024).toFixed(1).padStart(7)} KiB  ${f}`)
console.log(`  合计 ${(initRaw / 1024).toFixed(1)} KiB raw / ${(initGz / 1024).toFixed(1)} KiB gz`)
console.log(`懒加载 chunk：${pinyinChunk} — ${(sizeOf(pinyinChunk) / 1024).toFixed(1)} KiB raw / ${(gzOf(pinyinChunk) / 1024).toFixed(1)} KiB gz`)
console.log(`全部 JS 合计 ${(totalRaw / 1024).toFixed(1)} KiB raw（分包不减少总量，只挪动「什么时候下载」）`)

/* ══════════ 7. 「点开才用」的重组件不许回到首屏 ══════════
   预算那条线是总量绊线，管不住「谁的代码」。这里按内容标记点名：
   便签卡片、主题编辑器都是 `v-if` 控制、用户点一下才出现的界面，
   它们的渲染代码一旦被某个静态 import 拉回入口图，首屏就会悄悄胖一圈 —— 而预算还有余量时不会报警。
   标记取的是组件里独有的一句 UI 文案（改名即失败，提醒同步改这里）。 */

const LAZY_PARTS = [
  ['主题编辑器', 'ThemeEditor'],
  ['钉在桌面上', 'StickyNote'],
  // 本地推断引擎：`/api/metadata` 不可用时的自动补全兜底（services/localMeta.js 动态 import）。
  // 它有 700+ 行，而 siteDraft.js 只用它的 hashColor —— 标记串必须取 site-infer **独有**的
  // 一句（「地址无法解析」在 shared/ops/site-ops.mjs 里也出现，会把判定带偏）。
  // AddSiteModal 改成异步组件后整条链路才真正离开首屏（591.6 → 608.4 → 回落，实测踩过）。
  ['正在抓取站点信息', '添加站点弹窗'],
  ['反爬挑战页', 'site-infer 推断引擎'],
]
for (const [mark, name] of LAZY_PARTS) {
  const owners = allJs.filter(f => readAsset(f).includes(mark))
  ok(owners.length > 0, `${name} 的产物存在（可按「${mark}」定位）`)
  ok(!initialJs.some(f => readAsset(f).includes(mark)), `${name} 不在首屏下载清单里`)
}

/* ══════════ 8. 静态路由入口必须生成 ══════════
   WorkBuddy 云端（以及任何 Python `http.server` 这类静态宿主）**没有 SPA 兜底**：
   请求 `/archived` 直接回它自己的 404 页。构建后置脚本会为每条静态路由生成
   `<route>/index.html`，让「在子页面按刷新」不至于 404。
   丢了这一步的表现很隐蔽 —— 应用内点击跳转一切正常，只有刷新才出事，
   所以必须在产物层面点名。 */

const ROUTER_SRC = readFileSync(join(ROOT, 'src', 'router', 'index.js'), 'utf-8')
const staticRoutes = [...ROUTER_SRC.matchAll(/\{\s*path:\s*'([^']+)'/g)]
  .map(m => m[1])
  .filter(p => p !== '/' && !p.includes(':') && /^\/[a-z0-9-]+$/i.test(p))
const missingRoutes = staticRoutes.filter(p => !existsSync(join(DIST, p.slice(1), 'index.html')))
ok(staticRoutes.length > 0, '从路由表里能提取到静态路由', `${staticRoutes.length} 条`)
ok(missingRoutes.length === 0,
  `${staticRoutes.length} 条静态路由都有目录入口（刷新子页面不 404）`,
  `缺 ${missingRoutes.join(' ')}（检查 package.json 的 build 是否带上 postbuild-spa-fallbacks）`)

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 首屏分包产物断言 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 首屏分包产物断言全部通过：${pass} 条断言`)
