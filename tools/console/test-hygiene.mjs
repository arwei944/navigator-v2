#!/usr/bin/env node
/**
 * test-hygiene —— 工作区 5S 门禁（防废料失控回涨）。
 *
 * 守护两件事：
 *   1) 各类废料（CDP 临时 profile / probe 草稿 / 图标备份 / 根目录报告 / 快照仓）
 *      的体积与条数在阈值内 —— 超了说明「清运」这道工序没人跑。
 *   2) probe/ 里被 git 跟踪的文件不得含截图/数据草稿（.png/.json/.txt/.log）
 *      —— 那是验收过程产物，误提交会让仓库持续膨胀。
 *
 * 阈值刻意留 2-3 倍余量：只拦「失控暴涨」，不拦正常开发期间的自然累积。
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { scanAll, gitTrackedSet, fmtBytes } from '../workspace-doctor/lib/doctor.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
let pass = 0
const failures = []
const ok = (cond, msg) => {
  if (cond) pass++
  else failures.push(msg)
}
const MB = 1024 * 1024

const rows = scanAll(ROOT)
const byId = Object.fromEntries(rows.map((r) => [r.id, r]))

const LIMITS = {
  'chrome-profiles': { count: 24, bytes: 512 * MB },
  'api-icon-baks': { count: 60, bytes: 8 * MB },
  'root-reports': { count: 8, bytes: 1 * MB },
  'probe-drafts': { cleanableCount: 250, bytes: 32 * MB },
  backups: { bytes: 128 * MB },
}

for (const [id, lim] of Object.entries(LIMITS)) {
  const r = byId[id]
  ok(!!r, `目标 ${id} 存在于 targets 定义中`)
  if (!r) continue
  for (const [key, max] of Object.entries(lim)) {
    const v = r[key]
    const show = key.includes('bytes') ? fmtBytes(v) : v
    const showMax = key.includes('bytes') ? fmtBytes(max) : max
    ok(v <= max, `${id}.${key} = ${show} 超过阈值 ${showMax}`)
  }
}

// 保留策略不变量：快照仓必须有上限（防无限累积），且「超出份数」口径自洽
const bk = byId.backups
ok(bk && bk.retain > 0, 'backups 必须设保留策略（retain > 0），否则快照会无限累积')
if (bk && bk.retain) {
  ok(
    bk.count - bk.retain === bk.excessCount,
    `backups: 命中(${bk.count}) - 保留(${bk.retain}) 应等于超出(${bk.excessCount})`,
  )
  ok(bk.excessCount >= 0, `backups 超出份数应为非负，实为 ${bk.excessCount}`)
}

// probe/ 里只有脚本可以入库，草稿（截图 / json / txt / log）一律不行
const tracked = gitTrackedSet(ROOT)
const badTracked = [...tracked].filter((p) => /^probe\//.test(p) && /\.(png|json|txt|log)$/i.test(p))
ok(
  badTracked.length === 0,
  `probe/ 里有 ${badTracked.length} 个草稿被 git 跟踪（应只跟踪脚本）：${badTracked.slice(0, 3).join(', ')}`,
)

// 护栏自检：可清运 + 受保护 = 命中总数（防统计口径漂移）
// 带保留策略的目标多出「有意保留」这一档，等式相应扩为三项
for (const r of rows) {
  if (r.retain) {
    const kept = r.count - r.excessCount
    ok(
      r.cleanableCount + r.trackedCount + kept === r.count,
      `${r.id}: 可清运(${r.cleanableCount}) + 受保护(${r.trackedCount}) + 保留(${kept}) 应等于命中总数(${r.count})`,
    )
    continue
  }
  ok(
    r.cleanableCount + r.trackedCount === r.count,
    `${r.id}: 可清运(${r.cleanableCount}) + 受保护(${r.trackedCount}) 应等于命中总数(${r.count})`,
  )
}

console.log(`\n🧹 工作区卫生门禁：${pass} 通过 / ${failures.length} 失败`)
if (failures.length) {
  for (const f of failures) console.log(`   ❌ ${f}`)
  console.log('   → 运行 node tools/workspace-doctor/cli.mjs clean --yes 清运后再试')
  process.exit(1)
}
console.log('   ✅ 废料规模在阈值内｜probe 无草稿入库｜清运护栏自检通过')
