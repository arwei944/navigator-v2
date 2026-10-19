#!/usr/bin/env node
/**
 * 批量推断站点的领域位置，并写回 `api/sites-data.json`。
 *
 * ## 用法
 *
 *   node scripts/infer-domains.mjs            # 预演，只打印统计与差异，不落盘
 *   node scripts/infer-domains.mjs --apply    # 真正写回
 *   node scripts/infer-domains.mjs --apply --force-auto  # 连人工覆写也重算（慎用）
 *
 * ## 默认不落盘
 *
 * 推断规则会随词表调整而变，重跑是常态。若默认就写文件，一次误改词表
 * 就会在没有任何确认的情况下重排 300 个站点的位置。所以默认只预演。
 *
 * ## 人工覆写保护
 *
 * `source: 'manual'` 的条目永远跳过（除非显式 --force-auto）。
 * 这是「自动推断 + 可覆写」这条需求里**唯一不可让渡**的部分：
 * 覆写后重跑不能把人的判断冲掉，否则没人愿意手工标。
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inferAllPositions, MIN_CONFIDENCE } from '../shared/domain-infer.mjs'
import { DOMAINS, STAGE_INDEX, describePosition } from '../shared/domain-flow.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'api', 'sites-data.json')

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const forceAuto = args.includes('--force-auto')

const raw = JSON.parse(readFileSync(DATA, 'utf-8'))
const sites = Array.isArray(raw) ? raw : raw.sites
if (!Array.isArray(sites)) {
  console.error('❌ api/sites-data.json 结构不可识别（既不是数组也没有 sites 数组）')
  process.exit(1)
}

console.log(`\n🔎 领域位置推断${apply ? '（写入）' : '（预演，不落盘）'}`)
console.log(`   站点 ${sites.length} · 领域 ${DOMAINS.length} · 环节 ${STAGE_INDEX.size} · 置信门槛 ${MIN_CONFIDENCE}\n`)

// 若 --force-auto，先把人工标记降级成自动，让它们参与重算
if (forceAuto) {
  for (const s of sites) {
    if (s?.position?.source === 'manual') s.position = { ...s.position, source: 'auto' }
  }
  console.log('⚠ --force-auto：人工覆写已被降级为自动，本轮会全部重算\n')
}

const { positions, changed, skippedManual, unresolved } = inferAllPositions(sites)

/* ---------------- 应用结果 ---------------- */
let written = 0
for (const s of sites) {
  const next = positions[s.id]
  if (!next) continue
  const prev = s.position
  if (!prev || prev.stage !== next.stage || prev.domain !== next.domain || prev.source !== next.source) {
    s.position = next
    written += 1
  }
}

/* ---------------- 统计 ---------------- */

console.log('📊 结果')
console.log(`   已定位并写回：${written}`)
console.log(`   保留人工覆写：${skippedManual}`)
console.log(`   无法判断：${unresolved}`)

console.log('\n📈 各领域覆盖')
for (const d of DOMAINS) {
  const inDomain = sites.filter((s) => s.position?.domain === d.id)
  const byStage = new Map(d.stages.map((st) => [st.id, 0]))
  for (const s of inDomain) byStage.set(s.position.stage, (byStage.get(s.position.stage) || 0) + 1)
  const empty = d.stages.filter((st) => !byStage.get(st.id))
  console.log(`\n   ${d.label}（${inDomain.length} 站）`)
  for (const st of d.stages) {
    const n = byStage.get(st.id) || 0
    const bar = '█'.repeat(Math.min(n, 30)) || '·'
    console.log(`     ${String(n).padStart(3)} ${st.label.padEnd(6, '　')} ${bar}`)
  }
  if (empty.length) console.log(`     ⚠ 空环节：${empty.map((s) => s.label).join('、')}`)
}

/* ---------------- 变更明细 ---------------- */
const diffs = sites.filter((s) => s.position && positions[s.id] && s.position.stage === positions[s.id].stage)
if (changed > 0) {
  console.log(`\n🔄 位置发生变化：${changed} 条（前 15 条）`)
  let shown = 0
  for (const s of sites) {
    const p = describePosition(s.position?.stage)
    if (!p) continue
    if (shown >= 15) break
    shown += 1
  }
}

/* ---------------- 落盘 ---------------- */
if (apply) {
  /*
   * 备份命名必须匹配 `.gitignore` 的 `api/*.bak-*.json`：
   * 用 `${DATA}.bak-...` 会得到 `sites-data.json.bak-...`，与规则不符，
   * 结果每跑一次就多一个未跟踪文件。备份是本机状态，不该入库。
   */
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = join(ROOT, 'api', `sites-data.bak-${stamp}.json`)
  copyFileSync(DATA, backup)
  writeFileSync(DATA, JSON.stringify(raw, null, 2) + '\n', 'utf-8')
  console.log(`\n💾 已写入 api/sites-data.json（备份：${backup.split(/[\\/]/).pop()}）`)
} else {
  console.log('\n💡 预演模式：未写入。加 --apply 才会落盘')
}

/* ---------------- 未判断样本 ---------------- */
const unresolvedSamples = sites.filter((s) => !s.position).slice(0, 10)
if (unresolvedSamples.length) {
  console.log(`\n❓ 未能定位的样本（共 ${sites.filter((s) => !s.position).length} 条，前 10）`)
  for (const s of unresolvedSamples) {
    console.log(`   ${String(s.name || '').slice(0, 12).padEnd(14, '　')} ${String(s.desc || '').slice(0, 40)}`)
  }
}
