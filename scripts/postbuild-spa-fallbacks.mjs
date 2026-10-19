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
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync, rmSync, cpSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execSync } from 'node:child_process'

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
copyFileSync(join(root, 'server', 'store.mjs'), join(DIST, 'store.mjs'))
copyFileSync(join(root, 'server', 'cron.mjs'), join(DIST, 'cron.mjs'))
// 复制 `api/` 下**全部** .js —— 与 server/main.mjs 的路由表同源（那边也是按目录派生）。
//
// 此处原先是逐个列文件名的白名单，与路由表构成两份必须同步的手工清单：
// 新增接口时只加文件、忘了在这里登记，产物里就少一个 handler，而部署包的
// `containerLooksHealthy()` 只查 `/api` 目录存在与否 —— 于是「构建成功、部署成功、
// 线上那个接口 404」。改成目录派生后，加文件即生效，不存在第二个地方要记。
const apiJs = readdirSync(join(root, 'api')).filter(f => f.endsWith('.js')).sort()
for (const f of apiJs) {
  copyFileSync(join(root, 'api', f), join(DIST, 'api', f))
}
copyFileSync(join(root, 'api', 'sites-data.json'), join(DIST, 'api', 'sites-data.json'))
copyFileSync(join(root, 'shared', 'auth.mjs'), join(DIST, 'shared', 'auth.mjs'))
const sharedSrc = join(root, 'shared')
let sharedCount = 0
/**
 * **递归**复制 shared/** —— v10 教训：原先只 copyDirSync 顶层 .mjs，漏掉
 * `shared/ops/`（audit-core / snapshot-core），ops.js 与 auth.js 在沙箱里
 * 会直接加载失败（后台与登录整块死掉，且报错发生在 import 期而非请求期，很难联想到构建）。
 * 用 cpSync(recursive) 一劳永逸，以后再加子目录也不会漏。
 */
cpSync(sharedSrc, join(DIST, 'shared'), { recursive: true })
for (const f of readdirSync(sharedSrc, { recursive: true })) {
  if (String(f).endsWith('.mjs')) sharedCount++
}
// 发布工具识别 Node 项目的依据是 package.json 的 start 脚本（光有 server.js 不够）。
// type:module 必须有 —— server.js 与 api/ 都是 ESM；imports 映射让 api/*.js 的
// `import ... from '#store'` 在沙箱里解析到 dist/store.mjs（仓库里则指向 server/store.mjs）。
writeFileSync(join(DIST, 'package.json'), JSON.stringify({
  name: 'nav-dist',
  private: true,
  type: 'module',
  // `#cron` 与 `#store` 同理：api/*.js 在仓库里位于 api/、在部署包里位于 api/，
  // 而 cron.mjs 在仓库里位于 server/、在部署包里位于根 —— 相对路径两边对不上，
  // 所以统一走映射，让同一个源码文件在两处都能解析到同一个模块。
  imports: { '#store': './store.mjs', '#shared/*': './shared/*', '#cron': './cron.mjs' },
  scripts: { start: 'node server.js' },
}, null, 2) + '\n')
// data/（SQLite + 管理密钥）绝不能随发布包上传：一是会把本机测试数据盖到线上，
// 二是每次发布等于清库。服务端首启自建目录并做首启迁移。
rmSync(join(DIST, 'data'), { recursive: true, force: true })
mkdirSync(join(DIST, 'data'), { recursive: true })
// 管理凭据：沙箱没有环境变量注入，构建时把 .env.local 的两项配置带进 data/（服务端启动时
// 读回 process.env，静态服务对 /data/* 一律 403，git 也不收 dist）。口径与共享密钥完全一致：
// 只是换个运输通道，不新增暴露面。
//   SITES_ADMIN_KEY      → admin-key.txt           共享密钥直连（CLI / 脚本 / 旧客户端）
//   ADMIN_PASSWORD_HASH  → admin-password-hash.txt scrypt 口令哈希（后台登录；未配置时登录接口
//                                                     明确回 500，密钥直连照常可用）
for (const [file, key] of [['admin-key.txt', 'SITES_ADMIN_KEY'], ['admin-password-hash.txt', 'ADMIN_PASSWORD_HASH']]) {
  try {
    const envFile = readFileSync(join(root, '.env.local'), 'utf-8')
    const m = envFile.match(new RegExp('^' + key + '=?([^\\n]*)$', 'm'))
    if (m) {
      const value = m[1].trim().replace(/^"(.*)"$/, '$1').trim()
      if (value) writeFileSync(join(DIST, 'data', file), value)
    }
  } catch { /* 没有 .env.local 就不带该配置 */ }
}
// AI 配置（v10-P4）：baseURL / model / apiKey 随包进 data/ —— key 绝不进前端，
// 静态服务对 /data/* 一律 403，git 也不收 dist。
try {
  const envFile = readFileSync(join(root, '.env.local'), 'utf-8')
  const pick = (k) => {
    const m = envFile.match(new RegExp('^' + k + '=?([^\\n]*)$', 'm'))
    if (!m) return ''
    return m[1].trim().replace(/^"(.*)"$/, '$1').trim()
  }
  const baseURL = pick('AI_BASE_URL'), apiKey = pick('AI_API_KEY'), model = pick('AI_MODEL')
  if (baseURL && apiKey) {
    writeFileSync(join(DIST, 'data', 'ai-config.json'), JSON.stringify({ baseURL, apiKey, model: model || 'gpt-4o-mini' }, null, 2))
  }
} catch { /* 没配 AI 就没有这个文件，接口回 501、前端隐藏入口 */ }
/* ---------------- 构建信息（线上「部署」面板的版本依据） ----------------
 *
 * 刻意**不写进前端产物**，而是作为部署包根目录的一个数据文件由服务端读。
 * 原因：它描述的是「这次构建」，而面板要回答的是「线上正在跑的是哪次构建」。
 * 构建了新包但还没部署时，这两个是不同的**事实**；混在 JS 里会给出误导的结论
 * （用户刚构建完，前端就说「已是最新」，而线上还是旧的那份）。
 */
function gitInfo() {
  const run = (cmd) => execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  try {
    const sha = run('git rev-parse HEAD')
    return {
      sha,
      branch: run('git rev-parse --abbrev-ref HEAD'),
      // 工作区有未提交改动时必须显式标出来：否则「版本号」会指向一个根本
      // 不存在于历史里的状态（改了没提交，sha 却与提交一致）
      dirty: run('git status --porcelain').length > 0,
      subject: run('git log -1 --pretty=%s'),
    }
  } catch {
    return { sha: '', branch: '', dirty: false, subject: '' }
  }
}

const g = gitInfo()
const buildInfo = {
  schema: 1,
  builtAt: new Date().toISOString(),
  sha: g.sha,
  shortSha: g.sha ? g.sha.slice(0, 7) : '',
  branch: g.branch,
  dirty: g.dirty,
  subject: g.subject,
}
writeFileSync(join(DIST, 'build-info.json'), JSON.stringify(buildInfo, null, 2) + '\n')

// 数量从产物**实际**数出来，不写死 —— 写死的那个数已经错过一次（加了接口没改它）
const apiCount = readdirSync(join(DIST, 'api')).filter(f => f.endsWith('.js')).length
console.log(`✅ 已带上 Node 服务（server.js + store.mjs + cron.mjs + api ×${apiCount} + shared ×${sharedCount}）—— 后台/统计/巡检/备份/封面/AI/翻译/部署状态 齐备`)
console.log(`✅ 构建信息：${buildInfo.shortSha || '(无 git)'}${buildInfo.dirty ? ' + 未提交改动' : ''} @ ${buildInfo.builtAt}`)
