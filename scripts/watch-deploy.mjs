#!/usr/bin/env node
/**
 * 保存即部署：常驻监听本地源码 / 数据变更，停止编辑后防抖数秒，自动构建并发布到
 * Vercel **生产环境**。
 *
 * 用法:
 *   node scripts/watch-deploy.mjs [--debounce=8000] [--no-data] [--dry-run]
 *     --debounce=ms   停止编辑后等待多久再部署（默认 8000，攒掉连续保存）
 *     --no-data       只同步代码，不推送 api/sites-data.json
 *     --dry-run       只打印将要执行的命令，不真正构建 / 部署（用来核对触发范围）
 *
 * 与 publish.mjs 的关系：
 *   publish.mjs 是「一次性完整发布」（备份 → 校验 → 构建 → 部署 → 数据热更新 → 轮询验证）。
 *   本脚本是它的常驻版本，但**按内容类型分流**，避免误伤云端数据：
 *
 *     · 只有代码变了  → 构建 + `vercel deploy --prod`（完全不碰云端 Blob 数据）
 *     · 数据变了      → 先构建（若同时有代码改动），再走 `publish.mjs --skip-build`，
 *                       复用其备份 / schema 校验 / 快照 / 热更新 / 收敛验证的完整口径
 *     · 两者都变了    → 构建一次，然后走 `publish.mjs --skip-build`
 *
 *   为什么要分流：本地 api/sites-data.json 只是种子与备份，云端 Blob 才是运行时真相源；
 *   管理后台的编辑只写云端。若无条件把本地数据推上去，一次纯代码改动就会用**过期的本地
 *   数据**覆盖云端。因此数据只在它自己真的变过时才推送。
 *
 * 代理：复用 shared/proxy.mjs 的端口探测（免疫 Clash 端口漂移），与 publish.mjs 同口径。
 */
import { execSync } from 'node:child_process'
import { readFileSync, watch, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { applyProxyEnv } from '../shared/proxy.mjs'
import { record } from '../tools/console/lib/audit.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(root, 'api', 'sites-data.json')

const args = parseArgs({
  args: process.argv.slice(2),
  options: {
    debounce: { type: 'string', default: '8000' },
    'no-data': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
  allowPositionals: false,
})
const DEBOUNCE_MS = Math.max(1000, Number(args.values.debounce) || 8000)
const SYNC_DATA = !args.values['no-data']
const DRY_RUN = args.values['dry-run']

/** 监听的应用内容目录 / 文件（工具链与产物不监听：改脚本不该触发线上部署） */
const WATCH_DIRS = ['src', 'shared', 'api', 'public']
  .map(d => join(root, d))
  .filter(existsSync)
const WATCH_FILES = ['index.html', 'vite.config.js', 'vercel.json', 'package.json']
  .map(f => join(root, f))
  .filter(existsSync)

/** 不触发部署的目录（产物 / 工具 / 文档 / 探针，改了与线上无关） */
const IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'backups', '.git', '.vercel', '.workbuddy',
  'tools', 'probe', 'docs', 'perf-report',
])

/** 不触发部署的文件（编辑器临时文件 / 备份 / 日志 / 报告） */
const IGNORE_FILE_RE = /(~|\.swp|\.swx|\.tmp|\.log|\.bak)$|^\.#|^\.DS_Store$|^_.*\.(json|txt|png|html)$/

function isIgnored(absPath) {
  const rel = relative(root, absPath)
  if (!rel || rel.startsWith('..')) return true
  const parts = rel.split(sep)
  if (parts.some(p => IGNORE_DIRS.has(p))) return true
  return IGNORE_FILE_RE.test(parts[parts.length - 1])
}

/* ---------------- 日志 ---------------- */

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${msg}`)
}

/* ---------------- 部署状态机 ---------------- */

// 累积「本次待部署」的变更类型；部署进行中再来的改动会在结束后补跑一次
let dirty = { code: false, data: false }
let debounceTimer = null
let deploying = false
// 部署**进行中**到来的新变更：决定结束后要不要补跑一次。
// 必须与「失败后把标记放回 dirty」区分开 —— 若只看 dirty，构建持续失败时
// 会每次失败都立刻重排，变成无限自动重试（曾把构建每 50s 空跑一次持续 49 分钟）。
let arrivedDuringDeploy = false

function schedule() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    if (deploying) return // 结束后会自动补跑
    runDeploy()
  }, DEBOUNCE_MS)
}

function sh(cmd, label) {
  log(label)
  if (DRY_RUN) {
    console.log('   [dry-run] $ ' + cmd)
    return
  }
  execSync(cmd, { cwd: root, stdio: 'inherit' })
}

function runDeploy() {
  const task = { ...dirty }
  dirty = { code: false, data: false }
  arrivedDuringDeploy = false
  deploying = true
  const t0 = Date.now()
  const what = [task.code && '代码', task.data && '数据'].filter(Boolean).join(' + ')
  log(`——— 检测到${what}变更，开始部署 ———`)

  try {
    // 数据要走进 publish 的受控流程（备份 / 校验 / 快照 / 热更新 / 收敛验证），
    // 它内部会自己重新部署一次当前 dist；因此先把最新代码构建好。
    if (task.code) sh('npm run build', '① 构建')

    if (task.data) {
      sh('node scripts/publish.mjs --skip-build', '② 发布（含构建产物部署 + 数据热更新 + 校验）')
    } else {
      sh('npx --yes vercel deploy --prod --yes', '② 部署到 Vercel 生产')
    }

    const secs = ((Date.now() - t0) / 1000).toFixed(1)
    log(`✅ 部署完成（${secs}s）`)
    record({ action: 'watch.deploy.done', actor: 'watch-deploy', target: what, detail: `${secs}s` })
  } catch (e) {
    log(`❌ 部署失败：${String(e.message).split('\n')[0]}`)
    log('   已保留待部署标记：下次改动会连同一起重试；也可直接重跑 npm run publish')
    // 只把本次的类型放回 dirty，**不**在此重排 —— 构建持续失败时若立刻重排就是死循环。
    // 真需要立即重来，改一下任意被监听文件即可再次触发。
    dirty = { code: dirty.code || task.code, data: dirty.data || task.data }
    record({ action: 'watch.deploy.fail', actor: 'watch-deploy', result: 'fail', target: what, detail: String(e.message).slice(0, 300) })
  } finally {
    deploying = false
    // 只有「部署期间又来了新改动」才补跑一次（排空编辑期间积压的变更）
    if (arrivedDuringDeploy) schedule()
  }
}

/* ---------------- 监听 ---------------- */

function onEvent(absPath) {
  if (isIgnored(absPath)) return
  const isData = absPath === DATA
  if (isData) {
    if (!SYNC_DATA) return
    dirty.data = true
  } else {
    dirty.code = true
  }
  if (deploying) arrivedDuringDeploy = true
  schedule()
}

// applyProxyEnv 会把探测到的本机代理写回 process.env，子进程（npm / npx / curl）
// 一并继承，与 publish.mjs 同一口径
const proxy = await applyProxyEnv()

console.log('=== 保存即部署（watch → Vercel 生产）===')
console.log(`代理环境: ${proxy || '未探测到（直连）'}`)
console.log(`防抖: ${DEBOUNCE_MS}ms   数据同步: ${SYNC_DATA ? '开' : '关'}${DRY_RUN ? '   模式: DRY-RUN（不真正执行）' : ''}`)
console.log('监听:')
for (const d of WATCH_DIRS) console.log('  · ' + relative(root, d) + sep)
for (const f of WATCH_FILES) console.log('  · ' + relative(root, f))
console.log('忽略: dist / node_modules / backups / tools / probe / docs 及编辑器临时文件')
console.log('Ctrl+C 退出\n')

for (const dir of WATCH_DIRS) {
  watch(dir, { recursive: true }, (_evt, filename) => {
    if (!filename) return
    onEvent(join(dir, filename))
  })
}
for (const file of WATCH_FILES) {
  watch(file, () => onEvent(file))
}

record({ action: 'watch.start', actor: 'watch-deploy', target: `debounce=${DEBOUNCE_MS}ms`, detail: '开始监听本地变更' })

process.on('SIGINT', () => {
  log('已停止监听')
  process.exit(0)
})
