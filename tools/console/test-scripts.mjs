#!/usr/bin/env node
/**
 * test-scripts —— 仓库脚本台账门禁（`scripts/` 的生命周期管理）。
 *
 * 此前 `scripts/` 里三类脚本（产品级 / 运维级 / 历史一次性迁移）混装一层、无标注，
 * 无从分辨哪个能删、哪个是链路一环。现在由 scripts/README.md 作分类台账，本门禁守：
 *
 *   1) 目录里每个 .mjs 都在 README 清单里登记（防新增脚本「黑户」上线）
 *   2) README 清单里每个文件都真实存在（防清单过时）
 *   3) package.json 中引用的每个 scripts/*.mjs 都存在（防误移 / 误删把流水线打断）
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DIR = join(ROOT, 'scripts')
let pass = 0
const failures = []
const ok = (cond, msg) => {
  if (cond) pass++
  else failures.push(msg)
}

const readme = readFileSync(join(DIR, 'README.md'), 'utf-8')
const listed = new Set([...readme.matchAll(/`([a-zA-Z0-9_-]+\.mjs)`/g)].map((m) => m[1]))
const files = readdirSync(DIR).filter((n) => n.endsWith('.mjs'))
const fileSet = new Set(files)

// ① 目录里的每个脚本都已登记
for (const f of files) ok(listed.has(f), `scripts/${f} 未在 scripts/README.md 清单里登记`)

// ② 清单里的每个文件都存在
for (const n of listed) ok(fileSet.has(n), `scripts/README.md 列了 ${n}，但 scripts/ 下不存在（清单过时）`)

// ③ package.json 引用的脚本都在
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'))
const referenced = new Set()
for (const cmd of Object.values(pkg.scripts || {})) {
  for (const m of String(cmd).matchAll(/scripts\/([a-zA-Z0-9_-]+\.mjs)/g)) referenced.add(m[1])
}
for (const n of referenced) ok(fileSet.has(n), `package.json 引用了 scripts/${n}，但文件不存在`)

console.log(`\n📜 脚本台账门禁：${pass} 通过 / ${failures.length} 失败`)
console.log(`   scripts/ 下 ${files.length} 个脚本｜README 登记 ${listed.size}｜package.json 引用 ${referenced.size}`)
if (failures.length) {
  for (const f of failures) console.log(`   ❌ ${f}`)
  process.exit(1)
}
console.log('   ✅ 每个脚本都已分类登记｜清单无过时项｜流水线引用完好')
