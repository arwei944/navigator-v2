#!/usr/bin/env node
/**
 * 由 shared/env-registry.mjs 生成 / 校验 .env.example。
 *
 * 台账是唯一上游：想加一个变量，先登记进台账，再跑本脚本 —— 不再手改 .env.example。
 *
 * 用法：
 *   node scripts/gen-env-example.mjs           # 写入 .env.example
 *   node scripts/gen-env-example.mjs --check    # 只校验是否一致（不一致 exit 1）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { toExampleFile } from '../shared/env-registry.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = join(ROOT, '.env.example')
const check = process.argv.includes('--check')
const expected = toExampleFile()

if (check) {
  const actual = existsSync(FILE) ? readFileSync(FILE, 'utf-8') : ''
  if (actual === expected) {
    console.log('✅ .env.example 与台账一致')
    process.exit(0)
  }
  console.log('❌ .env.example 与 shared/env-registry.mjs 不一致 —— 跑 `npm run env:example` 重新生成')
  process.exit(1)
}

writeFileSync(FILE, expected, 'utf-8')
console.log(`✅ 已由台账生成 .env.example（${expected.split('\n').length} 行）`)
