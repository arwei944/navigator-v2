#!/usr/bin/env node
/**
 * env:doctor —— 本机环境变量体检（只读）。
 *
 * 与 test-env 的分工：
 *   - test-env：校验「代码里用到的变量都已登记进台账」（环境无关，可入门禁）
 *   - env:doctor：校验「本机 .env.local 与台账的差距」（环境相关，不入 console:test:all）
 *
 * 补的缺口：台账此前只能生成 .env.example，无法回答「我这台机器还缺什么、多什么」。
 * 输出三段：主链路必需缺失（❌）/ 可选未配置（⚠️）/ 本机有但台账未登记（ℹ️）。
 *
 * 退出码：主链路必需缺失 → 1，否则 0。
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ENV_VARS, SCOPE_LABELS } from '../shared/env-registry.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 已知的平台 / 工具链注入前缀：出现在本机环境里属正常，不算「未登记」。
 * 实测本机 .env.local 里有 VERCEL_* / TURBO_* / NX_DAEMON / GLOBAL_CONFIG 等，
 * 它们是宿主注入，不归本项目配置。
 */
const KNOWN_INJECTED = [
  /^VERCEL/,
  /^TURBO_/,
  /^NX_/,
  /^npm_/,
  /^GIT/,
  /^CI$/,
  /^PATH$/,
  /^HOME$/,
  /^USER/,
  /^SHELL$/,
  /^PWD$/,
]

function readEnvLocal(p) {
  if (!existsSync(p)) return null
  const map = new Map()
  for (const line of readFileSync(p, 'utf-8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    map.set(k, v)
  }
  return map
}

const local = readEnvLocal(join(ROOT, '.env.local'))
if (!local) {
  console.log('🩺 本机环境体检：未找到 .env.local')
  console.log('   → 先运行 `npm run env:example` 生成 .env.example，复制为 .env.local 后按需填写')
  process.exit(0)
}

const errors = []
const warns = []

/** 判断 .env.local 中该项是否算「已配置」（存在且非空、非空串占位） */
const isSet = (name) => {
  if (!local.has(name)) return false
  const v = local.get(name)
  return v !== '' && v !== '""' && v !== "''"
}

// 需用户配置的条目（有 example）；external 是系统注入，不应由本项目配
const needConfig = ENV_VARS.filter(
  (v) => typeof v.example === 'string' && v.scope !== 'external',
)

for (const v of needConfig) {
  if (isSet(v.name)) continue
  const line = `${v.name}（${SCOPE_LABELS[v.scope]}）：${v.desc}`
  if (v.required) errors.push(line)
  else warns.push(line)
}

// 反向：本机有、但台账没登记
const declared = new Set(ENV_VARS.map((v) => v.name))
const unknown = [...local.keys()].filter((k) => !declared.has(k))
const injected = unknown.filter((k) => KNOWN_INJECTED.some((re) => re.test(k)))
const trulyUnknown = unknown.filter((k) => !injected.includes(k))

console.log(`\n🩺 本机环境体检 —— .env.local（${local.size} 项）`)
console.log(`   台账需配置 ${needConfig.length} 项｜已配 ${needConfig.filter((v) => isSet(v.name)).length} 项`)

if (errors.length) {
  console.log(`\n❌ 主链路必需但未配置（${errors.length}）`)
  for (const e of errors) console.log(`   - ${e}`)
}
if (warns.length) {
  console.log(`\n⚠️  可选未配置（${warns.length}）`)
  for (const w of warns) console.log(`   - ${w}`)
}
if (trulyUnknown.length) {
  console.log(`\nℹ️  本机有但台账未登记（${trulyUnknown.length}）`)
  for (const u of trulyUnknown) console.log(`   - ${u}`)
}
if (injected.length) {
  console.log(`\nℹ️  平台/工具链注入（${injected.length}，正常，无需登记）`)
  console.log(`   ${injected.slice(0, 8).join(', ')}${injected.length > 8 ? ' …' : ''}`)
}

if (!errors.length && !warns.length && !trulyUnknown.length) {
  console.log('\n✅ 本机环境与台账完全一致')
}
process.exit(errors.length ? 1 : 0)
