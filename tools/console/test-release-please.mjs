#!/usr/bin/env node
/**
 * test-release-please —— 版本号与发布配置门禁（生产记录的可验证部分）。
 *
 * 背景：release-please 的 workflow 与 config 都配好了、提交也规范，但 CHANGELOG
 * 一直不产出。根因最后定位在 GitHub 仓库设置（不允许 Actions 创建 PR），
 * **那不在本机可验证范围** —— 本门禁不假装能测它，只守住本机侧的不变量：
 *
 *   1) 三处版本号一致：package.json.version == .release-please-manifest.json["."]
 *      （曾经 manifest 停在 3.0.0 而 package.json 已 3.1.0，release-please 会算错基线）
 *   2) workflow / config 的关键约定没被改坏（触发分支、action、release-type）
 *   3) 提交信息保持约定式 —— release-please 靠它分类；不规范的只警告不判失败
 */
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
let pass = 0
const failures = []
const warnings = []
const ok = (cond, msg) => {
  if (cond) pass++
  else failures.push(msg)
}
const warn = (cond, msg) => {
  if (!cond) warnings.push(msg)
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'))
const manifestPath = join(ROOT, '.release-please-manifest.json')
const configPath = join(ROOT, 'release-please-config.json')
const workflowPath = join(ROOT, '.github', 'workflows', 'release-please.yml')

// ① 三处版本号一致
ok(existsSync(manifestPath), '.release-please-manifest.json 不存在')
let manifest = null
if (existsSync(manifestPath)) {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  ok(typeof manifest['.'] === 'string', 'manifest 缺少根包（"."）版本')
  ok(
    manifest['.'] === pkg.version,
    `版本号不一致：manifest "${manifest['.']}" vs package.json "${pkg.version}"（release-please 会算错基线）`,
  )
}

// ② config 约定
ok(existsSync(configPath), 'release-please-config.json 不存在')
if (existsSync(configPath)) {
  const cfg = JSON.parse(readFileSync(configPath, 'utf-8'))
  ok(cfg['release-type'] === 'node', `release-type 应为 node，实为 ${cfg['release-type']}`)
  ok(!!cfg.packages?.['.'], 'config 缺少根包配置')
  ok(!!cfg.packages?.['.']?.['changelog-path'], 'config 未指定 changelog-path')
}

// ③ workflow 约定
ok(existsSync(workflowPath), '.github/workflows/release-please.yml 不存在')
if (existsSync(workflowPath)) {
  const wf = readFileSync(workflowPath, 'utf-8')
  ok(/googleapis\/release-please-action@v\d+/.test(wf), 'workflow 未使用 release-please-action')
  ok(/contents:\s*write/.test(wf), 'workflow 缺少 contents: write 权限')
  ok(/pull-requests:\s*write/.test(wf), 'workflow 缺少 pull-requests: write 权限')
  // 触发分支必须覆盖当前分支，否则推上去也不会触发
  let branch = 'master'
  try {
    branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT, encoding: 'utf-8' }).trim()
  } catch {}
  ok(
    new RegExp(`branches:\\s*\\[?\\s*${branch}`).test(wf),
    `workflow 触发分支未覆盖当前分支 ${branch}`,
  )
}

// ④ 提交规范度（只警告：历史里允许有例外，不该因此卡住门禁）
let subjects = []
try {
  subjects = execFileSync('git', ['log', '--no-merges', '--format=%s', '-n', '30'], {
    cwd: ROOT,
    encoding: 'utf-8',
  }).trim().split('\n').filter(Boolean)
} catch {}
const CONV = /^[a-z]+(?:\([^)]*\))?!?:\s+.+/
const nonconv = subjects.filter((s) => !CONV.test(s))
warn(nonconv.length === 0, `最近 30 条提交有 ${nonconv.length} 条不符合约定式（release-please 会归为 other）：${nonconv.slice(0, 2).join(' | ')}`)

console.log(`\n🏷  版本与发布配置门禁：${pass} 通过 / ${failures.length} 失败${warnings.length ? ` / ${warnings.length} 警告` : ''}`)
console.log(`   当前版本 ${pkg.version}｜manifest ${manifest?.['.'] ?? '(缺失)'}｜约定式提交 ${subjects.length - nonconv.length}/${subjects.length}`)
for (const w of warnings) console.log(`   ⚠️  ${w}`)
if (failures.length) {
  for (const f of failures) console.log(`   ❌ ${f}`)
  process.exit(1)
}
console.log('   ✅ 版本号三处一致｜workflow 与 config 约定完好')
console.log('   ℹ️  workflow 能否在 GitHub 上成功开 PR 取决于仓库设置，不在本机可验证范围')
