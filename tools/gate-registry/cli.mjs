#!/usr/bin/env node
/**
 * gate-registry —— 门禁台账（量具清单 + 检定状态）。
 *
 * 为什么需要它：项目有 80+ 道门禁脚本，此前没有任何一处能回答
 * 「有哪些门禁、每道守什么、哪些还没接入 console:test:all」。
 * doc-manager 管文档，但没人管门禁自己 —— 这是「量具没有检定记录」。
 *
 * 用法：
 *   node tools/gate-registry/cli.mjs index [--json]   # 生成 gate-index.json + GATE-INDEX.md
 *   node tools/gate-registry/cli.mjs check            # 校验台账与现状一致（接入 console:test:all）
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { extractFromTestAll, purposeOf, linesOf } from './lib/extract.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const INDEX_JSON = join(HERE, 'gate-index.json')
const INDEX_MD = join(HERE, 'GATE-INDEX.md')

/** 采集当前全部门禁脚本（tools/console/test-*.mjs + tools/mcp/test-*.mjs） */
function collect() {
  const pkgText = readFileSync(join(ROOT, 'package.json'), 'utf-8')
  const included = extractFromTestAll(pkgText)
  const includedSet = new Set(included)

  const files = []
  for (const [dir, re] of [
    ['tools/console', /^test-.*\.mjs$/],
    ['tools/mcp', /^test-.*\.mjs$/],
  ]) {
    const abs = join(ROOT, dir)
    if (!existsSync(abs)) continue
    for (const name of readdirSync(abs)) {
      if (re.test(name)) files.push(`${dir}/${name}`)
    }
  }
  files.sort()

  const gates = files.map((file) => ({
    file,
    name: file.split('/').pop().replace(/\.mjs$/, ''),
    purpose: purposeOf(join(ROOT, file)),
    lines: linesOf(join(ROOT, file)),
    included: includedSet.has(file),
  }))
  return { gates, included }
}

function buildIndex() {
  const { gates, included } = collect()
  return {
    total: gates.length,
    registered: gates.filter((g) => g.included).length,
    unregistered: gates.filter((g) => !g.included).map((g) => g.file),
    order: included,
    gates,
  }
}

function buildMarkdown(idx) {
  const L = []
  L.push('# 门禁台账（自动生成）')
  L.push('')
  L.push('> 生成命令：`npm run gate:index` ｜ 校验：`npm run console:test:gate-registry`')
  L.push(`> 共 **${idx.total}** 道门禁，其中已接入 \`console:test:all\` 的 **${idx.registered}** 道。`)
  L.push('')
  if (idx.unregistered.length) {
    L.push(`## ⚠️ 未接入 console:test:all（${idx.unregistered.length} 道）`)
    L.push('')
    for (const f of idx.unregistered) L.push(`- ${f}`)
    L.push('')
  } else {
    L.push('✅ 所有门禁脚本均已接入 `console:test:all`。')
    L.push('')
  }
  L.push('## 清单')
  L.push('')
  L.push('| # | 门禁 | 守护什么 | 行数 |')
  L.push('|---|---|---|---|')
  idx.gates.forEach((g, i) => {
    const mark = g.included ? '' : ' ⚠️'
    L.push(`| ${i + 1} | \`${g.name}\`${mark} | ${g.purpose || '（缺少头注释）'} | ${g.lines} |`)
  })
  L.push('')
  return L.join('\n')
}

function runIndex(args) {
  const idx = buildIndex()
  if (args.json) {
    console.log(JSON.stringify(idx, null, 2))
    return 0
  }
  writeFileSync(INDEX_JSON, JSON.stringify(idx, null, 2) + '\n', 'utf-8')
  writeFileSync(INDEX_MD, buildMarkdown(idx), 'utf-8')
  console.log(`🛡  门禁台账已生成：${idx.total} 道（已接入 ${idx.registered}）`)
  if (idx.unregistered.length) {
    console.log(`   ⚠️ 未接入 console:test:all：`)
    for (const f of idx.unregistered) console.log(`      - ${f}`)
  } else {
    console.log('   ✅ 全部已接入 console:test:all')
  }
  return 0
}

function runCheck() {
  let pass = 0
  const failures = []
  const ok = (cond, msg) => {
    if (cond) pass++
    else failures.push(msg)
  }

  const idx = buildIndex()

  for (const g of idx.gates) {
    ok(g.included, `${g.file} 存在但未接入 console:test:all`)
    ok(!!g.purpose, `${g.file} 缺少头注释（无法说明它守护什么）`)
  }

  // 台账文件必须与现状一致（防「改了门禁却忘了重新生成台账」）
  const onDisk = existsSync(INDEX_JSON) ? readFileSync(INDEX_JSON, 'utf-8') : ''
  ok(onDisk === JSON.stringify(idx, null, 2) + '\n', 'gate-index.json 与现状不一致（跑 npm run gate:index）')
  const md = existsSync(INDEX_MD) ? readFileSync(INDEX_MD, 'utf-8') : ''
  ok(md === buildMarkdown(idx), 'GATE-INDEX.md 与现状不一致（跑 npm run gate:index）')

  console.log(`\n🛡  门禁台账校验：${pass} 通过 / ${failures.length} 失败`)
  console.log(`   共 ${idx.total} 道门禁｜已接入 ${idx.registered}`)
  if (failures.length) {
    for (const f of failures) console.log(`   ❌ ${f}`)
    process.exit(1)
  }
  console.log('   ✅ 清单完整｜每道门禁都有用途说明｜台账与现状一致')
  return 0
}

const [cmd, ...rest] = process.argv.slice(2)
const args = { json: rest.includes('--json') }
let code = 0
if (cmd === 'index') code = runIndex(args)
else if (cmd === 'check') code = runCheck()
else {
  console.log('用法：')
  console.log('  node tools/gate-registry/cli.mjs index [--json]')
  console.log('  node tools/gate-registry/cli.mjs check')
  code = cmd ? 2 : 0
}
process.exit(code)
