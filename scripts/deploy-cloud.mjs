/**
 * WorkBuddy 云端发布通道的「部署」步骤：**产物门禁**，不是上传。
 *
 * ## 为什么不在这里上传
 *
 * 云端发布工具是外部工具（`.genie` 里的 appId），本进程没有它的凭据也没有它的协议。
 * 与其写一条假命令假装部署成功，不如把这一步做成**唯一能挡住事故的检查**：
 *
 * ## 它挡住什么
 *
 * 2026-10-14 的事故：线上跑的是当天 02:44 的构建产物，而秒加补全的修复 05:13 才提交。
 * 于是用户看到「抓取失败、信息没补全就入库」，而代码里**修复已经在了** ——
 * 缺陷在仓库里是好的，在用户面前是坏的。中间差的只是「忘了重新构建就发」。
 *
 * 所以这里校验两件事：
 *   1. **完整性** —— Node 服务的零件（server.js / store.mjs / api / shared）都在，
 *      少一个就是半残部署（本环境 vite 清空 dist 会被 safe-delete shim 打断成半残，
 *      真发生过：index.html 指向已不存在的 assets）。
 *   2. **新鲜度** —— 产物必须不早于源码。源码比产物新就是「发了旧代码」，直接失败。
 *
 * 退出码：0 = 产物可发（随后由云端发布工具上传）；1 = 不许发。
 */
import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(root, 'dist')

const MUST_HAVE = [
  'index.html',
  'server.js',
  'store.mjs',
  'cron.mjs',
  'package.json',
  'api/sites.js',
  'api/metadata.js',
  'shared/auth.mjs',
]

/** 源码目录：产物必须由它们构建而来 */
const SRC_DIRS = ['src', 'api', 'server', 'shared']
/** 只看会被打包进产物的扩展名（避免 .md / 截图把时间顶新） */
const SRC_EXT = /\.(vue|js|mjs|json|css)$/
/** 源码里不参与构建的（种子数据改动不要求重新构建） */
const SRC_SKIP = [/[/\\]sites-data\.json$/, /[/\\]node_modules[/\\]/]

const problems = []
const warnings = []

function newestSourceMtime() {
  let newest = 0
  let newestFile = ''
  const walk = (dir) => {
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!SRC_EXT.test(e.name)) continue
      if (SRC_SKIP.some(re => re.test(p))) continue
      try {
        const m = statSync(p).mtimeMs
        if (m > newest) { newest = m; newestFile = relative(root, p) }
      } catch { /* 读不到就跳过 */ }
    }
  }
  for (const d of SRC_DIRS) walk(join(root, d))
  return { newest, newestFile }
}

console.log('=== 发布前产物门禁（WorkBuddy 云端）===')

/* ---------- 1. 完整性 ---------- */
const missing = MUST_HAVE.filter(f => !existsSync(join(DIST, f)))
if (missing.length) {
  problems.push(`产物缺失：${missing.join(', ')}（先跑 npm run build；若构建被中断，用 git clean -fdx -- dist 后重跑）`)
}
// 静态路由入口由 postbuild 生成，少一个就说明 postbuild 没跑完
if (existsSync(join(DIST, 'index.html')) && !existsSync(join(DIST, 'archived', 'index.html'))) {
  warnings.push('未生成静态路由入口（archived/index.html 缺失）—— 子页刷新会 404')
}

/* ---------- 2. 新鲜度 ---------- */
if (!missing.length) {
  const { newest, newestFile } = newestSourceMtime()
  /**
   * 只看**本次构建必然重写**的文件 —— 别拿 `server.js` / `store.mjs` / `api/*` 当时间基准：
   * 它们是 `copyFileSync` 从仓库拷过去的，**保留源文件的 mtime**，于是「源文件上次改动
   * 是三天前」会被误判成「产物是三天前的」。踩过：门禁因此对本就新鲜的产物也报 4756 分钟。
   *
   * `index.html` 与 `assets/index-*.js` 每次 `vite build` 都会重新写出，才是真正的构建时刻。
   */
  const freshProbe = ['index.html']
  const assetsDir = join(DIST, 'assets')
  try {
    const entry = readdirSync(assetsDir).find(n => /^index-.*\.js$/.test(n))
    if (entry) freshProbe.push('assets/' + entry)
  } catch { /* 没有 assets 就算了，完整性检查已经管到别处 */ }
  let oldest = Infinity
  let oldestFile = ''
  for (const f of freshProbe) {
    const p = join(DIST, f)
    if (!existsSync(p)) continue
    const m = statSync(p).mtimeMs
    if (m < oldest) { oldest = m; oldestFile = f }
  }
  const fmt = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
  console.log(`源码最新: ${newestFile || '（无）'} @ ${fmt(newest)}`)
  console.log(`产物最旧: ${oldestFile || '（无）'} @ ${fmt(oldest)}`)
  if (Number.isFinite(oldest) && newest > oldest) {
    const lagMin = Math.round((newest - oldest) / 60000)
    problems.push(
      `产物落后源码 ${lagMin} 分钟（源码 ${newestFile} 比产物 ${oldestFile} 新）—— ` +
      '发出去等于发布旧代码，请先 npm run build'
    )
  }
}

/* ---------- 3. 部署目标提示 ---------- */
let appId = ''
try {
  for (const f of readdirSync(root)) {
    if (f.endsWith('.genie')) { appId = readFileSync(join(root, f), 'utf8').match(/appId:\s*(\S+)/)?.[1] || ''; break }
  }
} catch { /* 没有 .genie 就算了 */ }

for (const w of warnings) console.warn('⚠️ ' + w)

if (problems.length) {
  for (const p of problems) console.error('❌ ' + p)
  console.error('\n发布已中止：产物不可发。')
  process.exit(1)
}

console.log('✅ 产物完整且新于源码 —— 可以发布')
console.log(appId
  ? `上传步骤由云端发布工具执行：appId=${appId} · localDir=${DIST}（同目录重发即覆盖同一链接）`
  : `上传步骤由云端发布工具执行：localDir=${DIST}`)
console.log('   发布完成后，本脚本之后的热更新 / 收敛验证会打到该站点地址。')
