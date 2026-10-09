/**
 * 一次性修复：把站点 url 的 www. 前缀去掉，统一到「只存主域名」的约定。
 *
 * 为什么这么改：卡片与详情面板直接显示 url，带 www 的会显得口径不一；而
 * 前端去重（`utils/url.js#hostOf`）本就剥 www，所以带前缀既不产生功能差异，
 * 又让同一批数据出现两种写法。
 *
 * 安全前提：改前已逐个实测 20 个带 www 站点的**裸域可访问性**（curl -L 跟随跳转），
 * 19 个返回 200，第 20 个（acc2 / idpifa.net）两种形态都不可达 —— 属站点本身问题，
 * 与 www 无关（同一 Cloudflare IP）。因此全部可以安全去掉前缀。
 *
 * 刻意**不动 updatedAt**：这是机械式改写，不是内容更新；改了会让详情面板的
 * 「更新时间」骗人。显示顺序也不受影响（前端渲染用数组顺序，非 sortOrder）。
 *
 * 执行前自动备份原文件到 backups/。
 * 用法: node scripts/normalize-www.mjs [--dry-run]
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataFile = join(root, 'api', 'sites-data.json')
const backupDir = join(root, 'backups')

const args = parseArgs({
  args: process.argv.slice(2),
  options: { 'dry-run': { type: 'boolean', default: false } },
  allowPositionals: false
})
const dryRun = args.values['dry-run']

const sites = JSON.parse(readFileSync(dataFile, 'utf-8'))

const hits = sites.filter(s => /^www\./i.test(String(s.url || '')))

if (hits.length === 0) {
  console.log('✅ 没有带 www. 前缀的站点，无需处理')
  process.exit(0)
}

console.log(`发现 ${hits.length} 条带 www. 前缀：`)
for (const s of hits) {
  const next = String(s.url).replace(/^www\./i, '')
  console.log(`  [${s.id}] ${s.url}  ->  ${next}`)
}

if (dryRun) {
  console.log('\n（--dry-run，未写入）')
  process.exit(0)
}

const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
mkdirSync(backupDir, { recursive: true })
copyFileSync(dataFile, join(backupDir, `sites-data-${ts}.json`))
console.log(`\n已备份 -> backups/sites-data-${ts}.json`)

for (const s of hits) s.url = String(s.url).replace(/^www\./i, '')

writeFileSync(dataFile, JSON.stringify(sites, null, 2) + '\n', 'utf-8')
console.log(`✅ 已归一 ${hits.length} 条；建议随后运行 npm run validate 与 npm run publish 同步到云端`)
