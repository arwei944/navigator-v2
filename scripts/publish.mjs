/**
 * 一键发布脚本：备份 → 构建 → 部署 → 热更新数据 → 验证
 * 用法: node scripts/publish.mjs [--skip-build] [--key xxx]
 * 管理密钥来源（按优先级）：--key=<xxx> > 环境变量 SITES_ADMIN_KEY
 */
import { execSync, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(root, 'api', 'sites-data.json')
const SITE_URL = 'https://navigator-v2-two.vercel.app'

// 从 .env.local 加载环境变量（如存在），避免把密钥硬编码进脚本
try {
  const envFile = join(root, '.env.local')
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf-8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/)
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]
    }
  }
} catch { /* 无 .env.local 时忽略 */ }

const args = process.argv.slice(2)
const skipBuild = args.includes('--skip-build')
const key = args.find(a => a.startsWith('--key='))?.split('=')[1] || process.env.SITES_ADMIN_KEY || ''

if (!key) {
  console.error('❌ 缺少管理密钥：未找到 SITES_ADMIN_KEY（环境变量/.env.local/--key=）。')
  console.error('   请配置 .env.local 中的 SITES_ADMIN_KEY，或使用 --key=<key> 传入。')
  process.exit(1)
}

function step(msg) {
  console.log('\n=== ' + msg + ' ===')
}

function shell(cmd) {
  console.log('> ' + cmd)
  return execSync(cmd, { cwd: root, stdio: 'inherit', encoding: 'utf8' })
}

step('1/5 备份数据')
const sites = JSON.parse(readFileSync(DATA, 'utf-8'))
const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
const backupDir = join(root, 'backups')
mkdirSync(backupDir, { recursive: true })
const backupFile = join(backupDir, `sites-data-${ts}.json`)
copyFileSync(DATA, backupFile)
console.log(`已备份 ${sites.length} 条站点 -> backups/sites-data-${ts}.json`)

const noIcon = sites.filter(s => !s.icon)
if (noIcon.length > 0) {
  console.log(`[提醒] ${noIcon.length} 个站点缺少 favicon: ${noIcon.map(s => s.id).join(', ')}（可运行 node scripts/fetch-favicons.mjs 补抓）`)
}

step('1b 数据 schema 校验（发布门禁）')
try {
  // 用 execFileSync 避免含空格路径被 shell 拆分
  execFileSync(process.execPath, [join(root, 'scripts', 'validate-data.mjs')], { cwd: root, stdio: 'inherit', encoding: 'utf8' })
  console.log('✅ 数据校验通过，继续发布')
} catch (e) {
  console.error('❌ 数据校验失败，已中止发布。请先修复 sites-data.json 中列出的数据问题。')
  process.exit(1)
}

step('2/5 构建')
if (skipBuild) {
  console.log('跳过构建（--skip-build）')
} else {
  shell('npm run build')
}

step('3/5 部署到 Vercel')
shell('npx vercel deploy --prod --yes')

step('4/5 热更新云端数据')
const payload = join(root, 'tmp-payload.json')
writeFileSync(payload, JSON.stringify({ key, sites }))
try {
  const out = execFileSync('curl.exe', ['-s', '--max-time', '120', '-X', 'POST', `${SITE_URL}/api/sites`, '-H', 'Content-Type: application/json', '--data-binary', '@' + payload], { encoding: 'utf8' })
  const j = JSON.parse(out)
  console.log(`发布成功: version=${j.version} count=${j.sites.length} withIcons=${j.sites.filter(s => s.icon).length}`)
} catch (e) {
  console.error('发布失败: ' + e.message)
  if (existsSync(payload)) rmSync(payload, { force: true })
  process.exit(1)
} finally {
  if (existsSync(payload)) rmSync(payload, { force: true })
}

step('5/5 轮询验证云端一致性')
const expectedCount = sites.length
const sleep = ms => new Promise(r => setTimeout(r, ms))
let converged = false
for (let i = 1; i <= 5; i++) {
  await sleep(2000)
  try {
    const out = execFileSync('curl.exe', ['-s', '--max-time', '30', `${SITE_URL}/api/sites`], { encoding: 'utf8' })
    const j = JSON.parse(out)
    const ic = j.sites.filter(s => s.icon).length
    console.log(`poll ${i}: count=${j.sites.length} version=${j.version} withIcons=${ic}`)
    if (j.sites.length === expectedCount) {
      converged = true
      break
    }
  } catch { /* retry */ }
}
if (converged) {
  console.log('\n✅ 发布完成: ' + SITE_URL + `（${expectedCount} 站点已同步）`)
} else {
  console.error('\n⚠️ 云端数据未收敛，请检查')
  process.exit(1)
}
