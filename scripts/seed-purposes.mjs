/**
 * 一次性用途回填：给 api/sites-data.json 的存量站点补 `purposes: string[]`。
 *
 * 为什么需要回填：用途字段是后加的，存量 300 个站点都没有。前台筛选条、检索、
 * 卡片标签都依赖这个字段 —— 不回填的话，筛选条只剩「全部用途」、卡片一片空白，
 * 新功能等于没上线。回填口径必须与新增站点入口同源，否则同一网址「新收录的」与
 * 「回填的」会拿到不同用途，用户会以为功能坏了。因此这里直接调用
 * shared/purposes.mjs 的 inferPurposes，不另写一套规则。
 *
 * 幂等：只补「尚无用途」的站点，已有用途（人工确认过的）原样保留。
 * 用法：node scripts/seed-purposes.mjs [--dry-run]
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inferPurposes, normalizePurposes, tallyPurposes } from '../shared/purposes.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = join(root, 'api', 'sites-data.json')
const dryRun = process.argv.includes('--dry-run')

const sites = JSON.parse(readFileSync(FILE, 'utf-8'))

let filled = 0
let skipped = 0
let empty = 0

for (const site of sites) {
  // 已有合法用途的站点视为人工确认过，回填不得覆盖
  const existing = normalizePurposes(site.purposes)
  if (existing.length) { skipped++; continue }

  const purposes = inferPurposes({
    categoryId: site.categoryId,
    name: site.name,
    desc: site.desc,
    url: site.url,
  })
  if (!purposes.length) { empty++; continue }

  filled++
  if (!dryRun) site.purposes = purposes
}

console.log(`${dryRun ? '[dry-run] ' : ''}回填 ${filled} 个，跳过（已有用途）${skipped} 个，无从推断 ${empty} 个`)

// 分布报告：一眼看出词表里哪些用途没被任何站点用到，便于后续调整规则
const dist = tallyPurposes(dryRun ? sites.map(s => ({ ...s, purposes: s.purposes || inferPurposes({ categoryId: s.categoryId, name: s.name, desc: s.desc, url: s.url }) })) : sites)
console.log('\n用途分布：')
for (const t of dist) console.log(`  ${String(t.count).padStart(3)}  ${t.label} (${t.id})`)

if (dryRun) {
  console.log('\n未写入（--dry-run）')
  process.exit(0)
}

const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
const dir = join(root, 'backups')
mkdirSync(dir, { recursive: true })
copyFileSync(FILE, join(dir, `sites-data-${ts}.json`))

const tmp = FILE + '.tmp'
writeFileSync(tmp, JSON.stringify(sites, null, 2) + '\n', 'utf-8')
renameSync(tmp, FILE)
console.log(`\n✅ 已写入 ${FILE}\n   备份：backups/sites-data-${ts}.json`)