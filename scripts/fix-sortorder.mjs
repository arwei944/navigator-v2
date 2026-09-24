/**
 * 一次性修复：将 sites-data.json 的 sortOrder 重排为全局连续序列。
 * 前端渲染使用数组顺序而非 sortOrder，故此重排不改变任何展示顺序，
 * 仅消除 sortOrder 重复/空洞，满足校验脚本"全局唯一"约束。
 * 执行前自动备份原文件到 backups/。
 * 用法: node scripts/fix-sortorder.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataFile = join(root, 'api', 'sites-data.json')
const backupDir = join(root, 'backups')

const sites = JSON.parse(readFileSync(dataFile, 'utf-8'))

// 统计修复前
const sortCount = new Map()
for (const s of sites) sortCount.set(s.sortOrder, (sortCount.get(s.sortOrder) || 0) + 1)
const dups = [...sortCount.entries()].filter(([, c]) => c > 1)
const vals = sites.map(s => s.sortOrder)
const min = Math.min(...vals)
const max = Math.max(...vals)

console.log('=== 修复前 ===')
console.log(`站点数: ${sites.length} | sortOrder 唯一值 ${sortCount.size} 个 | 范围 ${min}..${max}`)
console.log(`重复 sortOrder: ${dups.length} 处`)
for (const [v, c] of dups) {
  const ids = sites.filter(s => s.sortOrder === v).map(s => s.id).join(',')
  console.log(`  - ${v} (x${c}): ${ids}`)
}

// 备份
mkdirSync(backupDir, { recursive: true })
const ts = new Date().toISOString().replace(/[:.]/g, '-')
const backupFile = join(backupDir, `sites-data-sortorder-${ts}.json`)
copyFileSync(dataFile, backupFile)
console.log(`\n已备份: ${backupFile}`)

// 按数组顺序重排为 1 起连续序列（不改变元素先后）
const fixed = sites.map((s, i) => ({ ...s, sortOrder: i + 1 }))

writeFileSync(dataFile, JSON.stringify(fixed, null, 2), 'utf-8')

// 验证修复后
const sortCount2 = new Map()
for (const s of fixed) sortCount2.set(s.sortOrder, (sortCount2.get(s.sortOrder) || 0) + 1)
const dups2 = [...sortCount2.entries()].filter(([, c]) => c > 1)
console.log(`\n=== 修复后 ===`)
console.log(`sortOrder 唯一值 ${sortCount2.size} 个 | 重复 ${dups2.length} 处 (应为 0)`)
if (dups2.length) { console.error('仍存在重复!'); process.exit(1) }
console.log('✅ 修复完成')