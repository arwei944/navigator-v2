/**
 * 构建后置：为每条**静态路由**生成一个目录入口（`<route>/index.html`）。
 *
 * ## 为什么需要
 *
 * 应用用的是 HTML5 history 路由（`createWebHistory`），而 WorkBuddy 云端的静态宿主
 * 是 Python 的 `http.server` —— 它**不做 SPA 兜底**：请求 `/archived` 直接回
 * 「Error code: 404 / Message: File not found.」，不会回 index.html。
 *
 * 于是「在某个子页面按一下刷新」或「把子页面链接发给别人」就 404 了。
 * 应用内的点击跳转是客户端路由，不受影响，所以这个问题只在刷新 / 直达时暴露 ——
 * 也正因如此容易漏测。
 *
 * ## 为什么用「生成目录」而不是换路由模式
 *
 * 改成 hash 路由（`/#/archived`）能解决，但会把所有既有 URL 改掉，属于行为变更。
 * 生成目录入口完全不动路由与 URL，只是让宿主的静态文件查找能找到东西：
 * 请求 `/archived` → Python 对目录发 301 → `/archived/` → 命中 `archived/index.html`。
 *
 * `index.html` 里的资源都是绝对路径（`/assets/...`），从任意层级访问都能解析，
 * 所以复制整份壳文件是安全的。
 *
 * 路由清单从 `src/router/index.js` 里**自动提取**，不手写 —— 否则以后加一条路由
 * 又会悄悄漏掉（这类「加了新东西忘了同步」正是本项目吃过亏的地方）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(root, 'dist')
const SHELL = join(DIST, 'index.html')
const ROUTER = join(root, 'src', 'router', 'index.js')

if (!existsSync(SHELL)) {
  console.error('❌ 找不到 dist/index.html —— 请先执行构建。')
  process.exit(1)
}

/**
 * 从路由表里提取**可静态化**的路径。
 * 排除动态段（`/c/:id`）与通配（`/:pathMatch(.*)*`）—— 它们无法预先生成目录，
 * 且都是「旧链接兼容 / 兜底」用途，跳过不影响主流程。
 */
const source = readFileSync(ROUTER, 'utf-8')
const paths = [...source.matchAll(/\{\s*path:\s*'([^']+)'/g)]
  .map(m => m[1])
  .filter(p => p !== '/' && !p.includes(':'))
  .filter((p, i, a) => a.indexOf(p) === i)          // 去重
  .filter(p => /^\/[a-z0-9-]+$/i.test(p))           // 只接受单段路径，避免拼出奇怪目录

if (!paths.length) {
  console.warn('⚠️ 未从路由表提取到任何静态路径，跳过（检查 src/router/index.js 的写法）')
  process.exit(0)
}

for (const p of paths) {
  const dir = join(DIST, p.slice(1))
  mkdirSync(dir, { recursive: true })
  copyFileSync(SHELL, join(dir, 'index.html'))
}

console.log(`✅ 已为 ${paths.length} 条静态路由生成入口：${paths.join(' ')}`)

/* ---------------- Node 服务化：带上 /api/metadata ----------------
 *
 * 部署形态从「纯静态」升级成「Node 服务」：server.js 在部署根目录时，
 * 发布工具会以 `node server.js` 启动（而不是内置静态服务），于是自动补全的
 * `/api/metadata` 得以回归 —— 它的实现链（api/metadata.js + shared/*.mjs）
 * 全是 Node 内置模块，零 npm 依赖，不需要装任何东西。
 *
 * 目录结构刻意镜像仓库里的相对关系（api/ 引 ../shared/…），
 * 这样 api/metadata.js 源码一行不用改。
 */
mkdirSync(join(DIST, 'api'), { recursive: true })
mkdirSync(join(DIST, 'shared'), { recursive: true })
copyFileSync(join(root, 'server', 'main.mjs'), join(DIST, 'server.js'))
copyFileSync(join(root, 'api', 'metadata.js'), join(DIST, 'api', 'metadata.js'))
copyFileSync(join(root, 'api', 'sites-data.json'), join(DIST, 'api', 'sites-data.json'))
const sharedSrc = join(root, 'shared')
let sharedCount = 0
for (const f of readdirSync(sharedSrc)) {
  if (!f.endsWith('.mjs')) continue
  copyFileSync(join(sharedSrc, f), join(DIST, 'shared', f))
  sharedCount++
}
// 发布工具识别 Node 项目的依据是 package.json 的 start 脚本（光有 server.js 不够）。
// type:module 必须有 —— server.js 与 api/ 都是 ESM。
writeFileSync(join(DIST, 'package.json'), JSON.stringify({
  name: 'nav-dist',
  private: true,
  type: 'module',
  scripts: { start: 'node server.js' },
}, null, 2) + '\n')
console.log(`✅ 已带上 Node 服务（server.js + api/metadata.js + shared ×${sharedCount}）—— 自动补全为真实抓取`)
