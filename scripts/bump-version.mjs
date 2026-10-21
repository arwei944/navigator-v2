#!/usr/bin/env node
/**
 * 把 `package.json` 的 version 递增一段。
 *
 * 供发布脚本在构建前调用；也可以单独执行：
 *   node scripts/bump-version.mjs            # patch +1
 *   node scripts/bump-version.mjs --minor
 *   node scripts/bump-version.mjs --dry-run
 *
 * 只改 version 一个字段，保留原有键顺序与两空格缩进。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bumpVersion } from '../shared/version-bump.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = join(ROOT, 'package.json')

/**
 * @param {{part?: 'patch'|'minor'|'major', dryRun?: boolean}} [opts]
 * @returns {{from:string, to:string, changed:boolean}}
 */
export function bumpPackageVersion({ part = 'patch', dryRun = false } = {}) {
  const raw = readFileSync(PKG, 'utf8')
  const pkg = JSON.parse(raw)
  const from = String(pkg.version || '0.0.0')
  const to = bumpVersion(from, part)
  if (!to) throw new Error(`package.json 的 version 无法解析：${from}（需要 x.y.z）`)
  if (!dryRun) {
    pkg.version = to
    writeFileSync(PKG, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  }
  return { from, to, changed: from !== to }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  const part = args.includes('--major') ? 'major' : args.includes('--minor') ? 'minor' : 'patch'
  const dryRun = args.includes('--dry-run')
  const r = bumpPackageVersion({ part, dryRun })
  process.stdout.write(`${dryRun ? '[dry-run] ' : ''}${r.from} → ${r.to}\n`)
}