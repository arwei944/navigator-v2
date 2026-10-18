#!/usr/bin/env node
/**
 * workspace-doctor —— 工作区 5S（清扫 / 清运）专用工具。
 *
 * 只读体检：  node tools/workspace-doctor/cli.mjs scan  [--json]
 * 清运演练：  node tools/workspace-doctor/cli.mjs clean              （默认 dry-run，不删任何东西）
 * 真正清运：  node tools/workspace-doctor/cli.mjs clean --yes [--only chrome-profiles,api-icon-baks]
 *
 * 安全底线：只删**未被 git 跟踪**的文件；被跟踪的资产即使命中也跳过。
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { scanAll, clean, fmtBytes } from './lib/doctor.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function parseArgs(argv) {
  const out = { json: false, apply: false, only: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') out.json = true
    else if (a === '--yes' || a === '-y') out.apply = true
    else if (a === '--only') out.only = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean)
  }
  return out
}

function runScan(args) {
  const rows = scanAll(ROOT)
  if (args.json) {
    console.log(JSON.stringify({ root: ROOT, targets: rows }, null, 2))
    return 0
  }
  const totalClean = rows.reduce((s, r) => s + r.cleanableBytes, 0)
  const totalAll = rows.reduce((s, r) => s + r.bytes, 0)
  console.log(`🧹 工作区体检 — ${rows.length} 类目标`)
  console.log(`   全部占用 ${fmtBytes(totalAll)}｜其中可清运（未被 git 跟踪）${fmtBytes(totalClean)}`)
  console.log()
  for (const r of rows) {
    const tag = r.retain ? `保留${r.retain}份` : r.autoClean ? '可清运' : '只体检'
    console.log(`  [${tag}] ${r.id} — ${r.label}`)
    console.log(
      `     命中 ${r.count} 项 / ${fmtBytes(r.bytes)}` +
        (r.trackedCount ? `（其中 ${r.trackedCount} 项被 git 跟踪，受保护）` : ''),
    )
    if (r.retain) {
      console.log(
        `     ${r.policy}：超出 ${r.excessCount} 项 / ${fmtBytes(r.excessBytes)} 可清运` +
          (r.trackedCount ? `，${r.trackedCount} 项受 git 保护` : ''),
      )
    }
    console.log(`     依据：${r.reason}`)
  }
  return 0
}

function runClean(args) {
  const r = clean(ROOT, { apply: args.apply, only: args.only })
  if (args.json) {
    console.log(JSON.stringify(r, null, 2))
    return 0
  }
  if (!r.count) {
    console.log('✅ 没有可清运的废料（或全部受 git 保护）')
    return 0
  }
  console.log(`${r.applied ? '🧹 已清运' : '🔍 清运演练（未删除）'} — ${r.count} 项 / ${fmtBytes(r.bytes)}`)
  for (const p of r.plan.slice(0, 20)) console.log(`   - ${p.rel}（${fmtBytes(p.bytes)}）`)
  if (r.plan.length > 20) console.log(`   … 其余 ${r.plan.length - 20} 项`)
  if (!r.applied) console.log('\n   加 --yes 才真正删除；被 git 跟踪的文件永不删除。')
  return 0
}

const [cmd, ...rest] = process.argv.slice(2)
const args = parseArgs(rest)
let code = 0
if (cmd === 'scan') code = runScan(args)
else if (cmd === 'clean') code = runClean(args)
else {
  console.log('用法：')
  console.log('  node tools/workspace-doctor/cli.mjs scan  [--json]')
  console.log('  node tools/workspace-doctor/cli.mjs clean [--yes] [--only id1,id2] [--json]')
  code = cmd ? 2 : 0
}
process.exit(code)
