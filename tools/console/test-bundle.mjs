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
// 2026-10-15：600 → 604。搜索框「网址预览卡片」功能有意带入 +5.6 KiB raw
// （utils/urlPreview.js + composables/useUrlPreview.js + OmniResults 卡片渲染），
// 基线 596.1 KiB 的余量本就只剩 3.9。抓取链路已按第 7 节的规矩走动态 import，
// 没把 services/meta 拖回首屏 —— 这里抬的是功能增量，不是给悄悄变胖开口子。
// 2026-10-15（第二次）：604 → 608。两处有意增量合计 +2.4 KiB raw：
// ① 站点「重新获取信息」的 UI 接线（OmniIcon refresh 形状 + EditSiteModal 按钮区，
//    后者本身在懒加载 chunk 里，进首屏的只有图标图元）；
// ② 关联图谱的**入口**接线（commands.js 条目 + phraseAliases 别名 + graph 图标图元 +
//    App.vue 的 scope 映射与异步声明）。
// 图谱本体没有进首屏：GraphView 15.4 KiB / affinity / graphLayout 各自独立成 chunk，
// 已在 index chunk 里按符号名逐个 grep 验证为 0 命中（layoutGraph、buildAffinityGraph、
// mulberry32、CONCEPT_WORDS 等）。抬的都是入口成本，不是功能体积。
// 2026-10-16：608 → 610。管理后台改为**三栏套壳**（Admin 从 STANDALONE_ROUTES 移出，
// 走 App.vue 的 scope 分支）。增量只有「入口成本」：App.vue 的 scope 映射与异步声明、
// RightSidebar 的 admin 分支判断。
// 实测：初版把 AdminAside 静态引入 RightSidebar，首屏涨到 613.8 KiB —— 已改成
// defineAsyncComponent，回落到 608.1。AdminView 与 AdminAside 都独立成 chunk，
// 已在 index chunk 里按符号名 grep 验证为 0 命中（TAB_META / admin-aside / aa-link /
// 「站点库与分类体系的总览」等）。抬的是入口，不是功能体积。
// 2026-10-16：610 → 612。#16 自然语言运维给命令面板加了「归档所有失效站点 / 恢复全部归档」
// 两条命令，且 useOmniBox 为此引入 health store（判断哪些站「需处理」）—— 命令面板（Ctrl+K）
// 是首屏组件，这部分必然计入。新增的 0.7 KiB 全部来自这里；后台专属模块（快捷键表 /
// 全局搜索索引 / 告警规则接口 / 事件历史接口）已逐一 grep 确认为 0 命中首屏。
// 2026-10-16：612 → 614。筛选条从 5–6 行压到固定两行（「更多」面板收纳其余标签与用途）。
// 实测增量：暂存本次改动前后各构建一次，610.7 → 612.6 KiB，净增 1.9 KiB。
// 全部落在首屏组件自身：筛选条的取数模块（src/utils/filterChips.js，纯函数、有 20 条断言）、
// 面板的渲染分支、以及挂载期生效的外部点击 / Esc 收起监听 —— 筛选条就在首屏，懒不掉。
// 2026-10-17：614 → 616。工具栏加「背景音乐」一键开关（`MainToolbar.vue`，首屏组件）。
// 为什么要为它付这 0.6 KiB：插件默认是关的，而它原本只能从「设置」里打开 ——
// 设置面板里排第 3 个分区、要往下滚才看得见，结果是「线上没有显示这个插件」这条反馈。
// 实测：613.8 → 614.4 KiB，净增 0.6 KiB，全部落在工具栏那个按钮上（图标是内联 SVG）。
// 播放器本体仍然懒加载：`BgmPlayer` 独立成 5.3 KiB chunk，音频代码在首屏 0 命中。
const BUDGET_RAW = 616 * 1024
const BUDGET_GZ = 216 * 1024
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
  ['已按域名秒填草稿', '添加站点弹窗'],
  // 编辑站点弹窗：同样只在右键点「编辑」时出现，却拖着 PurposePicker。
  // 它一旦回到首屏静态图，首屏会直接从 598 顶到 604 KiB（实测越预算），
  // 而报错只会说「体积超了」、指不回是哪个 import —— 所以在这里点名。
  // 标记取弹窗里**独有**的一句说明（AddSiteModal 有相似但不同的措辞）。
  ['两条都与「删除」不同', '编辑站点弹窗'],
  ['反爬挑战页', 'site-infer 推断引擎'],
  // 中文别名表：纯数据（2.5 KiB 中文串），只在用户打中文时才用得上。
  // 标记取一条**只在这里出现**的说法（「深浅色」在 commandPhrases/commands 里都没有）。
  ['深浅色', '中文别名表'],
  // 新版本提示：只在真有新版本时才被调用，首访者一次都用不到
  ['有新版本可用', 'PWA 更新提示'],
  // 秒加后的真实信息补全（services/metaUpgrade.js，由 services/autoAdd.js 动态 import）。
  // 它连带拖着 services/meta.js（抓取容错与文案表），而这条链路只在「粘网址并加成功」之后
  // 才走得到 —— 一旦有人把它改回静态 import，两者会一起回到首屏。
  // 标记取模块里**独有**的一句告警文案（「升级过程抛错」在别处没有）。
  ['升级过程抛错', '秒加后的真实信息补全'],
  // 翻译编排（services/translateFields.js）+ 离线词表（shared/glossary.mjs）+
  // 浏览器本地模型适配器（services/browserTranslate.js）。
  // 这三样是「实时免费」的三层，主体是**数据表**（词表 500+ 条）而不是逻辑 ——
  // 首屏只剩 ~2KiB 余量，它们进首屏就会立刻越预算。
  // 标记取各自独有的字符串：词表用一条长短语，编排用一句独有的说明文案。
  ['虚拟专用网络', '离线词表'],
  ['在线引擎翻译', '翻译编排'],
  ['downloadprogress', '浏览器本地翻译适配器'],
  // 管线日志（utils/pipelineTrace.js + components/PipelineLogPanel.vue）：排查多跳链路用的
  // 观测层，普通人一次都不会打开 —— 它一旦被静态 import 拉回入口图，会连同 `services/autoAdd`
  // 那条链路一起胖回超标（实测首屏 595.2 → 602.8 KiB 的那次就是这样）。
  // 标记取各自**独有**的字面量：总线是它挂在全局上的探针出口名，面板取一个只在该模板里的类名。
  ['__navPipeline__', '管线追踪总线'],
  ['pipeline-pill-text', '管线日志面板'],
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

/* ══════════ 9. PWA 更新必须是「提示 + 用户决定」，不许自动刷新 ══════════
   registerType 只有 `prompt` 才会调用 `onNeedRefresh`；`autoUpdate` 下 registerSW 模板
   直接挂 `activated` 监听器 reload（插件源码写死），提示代码变成**死代码** ——
   而这件事在浏览器里几乎测不出来（只有真发一次新版才触发），首屏预算也照样绿。
   所以在产物上钉住两头：
   ① 提示文案得**存在于产物**（证明 onNeedRefresh 那条路没被 dead-code 掉）
   ② 首屏包里不许有 autoUpdate 的那条自动刷新监听（证明走的是 prompt 分支）
   摘掉任一头都会红：registerType 改回 autoUpdate 时，① 的文案随之消失、② 的监听同时出现。
   注意 ① 查的是全量产物而不是首屏清单 —— 提示模块本身是懒加载的（见 LAZY_PARTS）。 */

const swPromptOwners = allJs.filter(f => readAsset(f).includes('有新版本可用'))
ok(swPromptOwners.length > 0, '「有新版本可用」提示路径存在于产物中（onNeedRefresh 没被 dead-code 掉）')

const swAutoReloadOwners = initialJs.filter(f => readAsset(f).includes('addEventListener("activated"'))
ok(swAutoReloadOwners.length === 0,
  '首屏包内没有 autoUpdate 的自动刷新监听（registerType 必须是 prompt）',
  `出现在 ${swAutoReloadOwners.join(' ')} —— 说明被切回 autoUpdate，用户填表单时会被无提示刷新`)

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 首屏分包产物断言 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 首屏分包产物断言全部通过：${pass} 条断言`)
