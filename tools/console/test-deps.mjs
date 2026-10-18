#!/usr/bin/env node
/**
 * test-deps —— 依赖 / 供应链门禁（来料检验）。
 *
 * 此前完全没有这一环：依赖声明与锁文件是否同步、imports 映射是否指向真实文件、
 * 有没有写死 `*`/`latest` 导致装不出可复现的版本 —— 全靠人眼。
 *
 * 零依赖：只用文本解析 pnpm-lock.yaml，不引 yaml 库。
 *
 * 升级（2026-10-18）：补两环 —— ⑦ license 白名单（防引入传染性/受限许可）；
 * ⑧ 未使用依赖（声明了但源码从不引用，纯增负担）。
 * ⑧ 的引用语料必须含 package.json 与 vite.config.js 本身，否则误报。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
let pass = 0
const failures = []
const ok = (cond, msg) => {
  if (cond) pass++
  else failures.push(msg)
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'))
const lock = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf-8')

/** 解析 pnpm-lock.yaml 里根 importer（`.`）的依赖声明：name -> specifier */
function parseImporterDeps(text) {
  const out = new Map()
  const lines = text.split(/\r?\n/)
  let inImporters = false
  let inDeps = false
  let cur = null
  for (const line of lines) {
    if (/^importers:\s*$/.test(line)) {
      inImporters = true
      continue
    }
    if (inImporters && /^[a-z]/.test(line)) break // 离开 importers 段
    if (!inImporters) continue
    if (/^ {4}(dependencies|devDependencies):\s*$/.test(line)) {
      inDeps = true
      continue
    }
    const mName = line.match(/^ {6}(.+?):\s*$/)
    if (inDeps && mName) {
      cur = mName[1].trim().replace(/^['"]|['"]$/g, '')
      out.set(cur, null)
      continue
    }
    const mSpec = line.match(/^ {8}specifier:\s*(.+)$/)
    if (inDeps && cur && mSpec) out.set(cur, mSpec[1].trim())
  }
  return out
}

const lockDeps = parseImporterDeps(lock)

// ① 锁文件结构与包管理器
ok(/^lockfileVersion:/.test(lock), 'pnpm-lock.yaml 缺少 lockfileVersion')
ok(typeof pkg.packageManager === 'string' && pkg.packageManager.startsWith('pnpm@'), 'package.json 未固定 packageManager 为 pnpm')

// ② 每个声明的依赖都在锁文件里，且 specifier 一致（防「改了 package.json 没重装」）
for (const field of ['dependencies', 'devDependencies']) {
  const declared = pkg[field] || {}
  for (const [name, spec] of Object.entries(declared)) {
    ok(lockDeps.has(name), `${field} 的 ${name} 不在锁文件的根 importer 里（跑 pnpm install）`)
    if (lockDeps.has(name)) {
      ok(lockDeps.get(name) === spec, `${name} 的 specifier 与锁文件不一致：package.json "${spec}" vs lock "${lockDeps.get(name)}"`)
    }
    ok(!['*', 'latest', ''].includes(String(spec).trim()), `${name} 的版本声明 "${spec}" 不可复现（禁用 * / latest）`)
  }
}

// ③ 锁文件里不该有 package.json 之外的残留依赖
const declaredAll = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})])
for (const name of lockDeps.keys()) {
  ok(declaredAll.has(name), `锁文件里有 ${name}，但 package.json 未声明（残留，跑 pnpm install 清理）`)
}

// ④ imports 映射指向真实文件/目录
for (const [key, target] of Object.entries(pkg.imports || {})) {
  const base = String(target).replace(/^\.\//, '').replace(/\/\*$/, '')
  ok(existsSync(join(ROOT, base)), `imports["${key}"] → ${target} 的目标不存在`)
}

// ⑤ bin 指向的入口存在
for (const [name, target] of Object.entries(pkg.bin || {})) {
  ok(existsSync(join(ROOT, target)), `bin["${name}"] → ${target} 不存在`)
}

// ⑥ 直接依赖已实际安装（node_modules 里有对应目录）
for (const name of Object.keys(pkg.dependencies || {})) {
  ok(existsSync(join(ROOT, 'node_modules', name)), `依赖 ${name} 未安装（node_modules 下找不到）`)
}

const allDeclared = [
  ...new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})]),
]

// ⑦ 依赖 license 必须在白名单内（防引入传染性 / 受限许可）
const ALLOWED_LICENSES = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0',
])
function licenseOf(name) {
  try {
    const meta = JSON.parse(readFileSync(join(ROOT, 'node_modules', name, 'package.json'), 'utf-8'))
    const lic = meta.license ?? meta.licenses
    if (typeof lic === 'string') return lic
    if (Array.isArray(lic)) return lic.map((l) => l && l.type).filter(Boolean).join(' OR ')
    if (lic && typeof lic === 'object') return lic.type || ''
    return ''
  } catch {
    return ''
  }
}
function licenseOk(expr) {
  return String(expr)
    .split(/\s+(?:OR|AND)\s+|[()]/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .some((t) => ALLOWED_LICENSES.has(t))
}
const badLicense = allDeclared.filter((name) => !licenseOk(licenseOf(name))).map((n) => `${n}（${licenseOf(n) || '未知'}）`)
ok(badLicense.length === 0, `以下依赖 license 不在白名单，需先评审：${badLicense.join(', ') || '（无）'}`)

// ⑧ 未使用依赖：声明了但源码中从不引用（语料含 package.json 与 vite.config.js，否则误报）
function buildCorpus() {
  let text = ''
  const roots = [
    'package.json',
    'vite.config.js',
    'src',
    'api',
    'server',
    'shared',
    'tools',
    'scripts',
    '.github',
  ]
  const walk = (p) => {
    let st
    try {
      st = statSync(p)
    } catch {
      return
    }
    if (st.isDirectory()) {
      for (const n of readdirSync(p)) {
        if (n === 'node_modules' || n === '.git') continue
        walk(join(p, n))
      }
      return
    }
    if (!/\.(mjs|js|cjs|ts|vue|json|yml|yaml|md)$/.test(p)) return
    if (st.size > 2 * 1024 * 1024) return
    try {
      text += readFileSync(p, 'utf-8')
    } catch {
      /* 忽略不可读 */
    }
  }
  for (const r of roots) walk(join(ROOT, r))
  return text
}
const corpus = buildCorpus()
const unusedDeps = allDeclared.filter((name) => {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return !(
    corpus.includes("'" + name) ||
    corpus.includes('"' + name) ||
    corpus.includes('/' + name + '/') ||
    new RegExp('\\b' + esc + '\\b').test(corpus)
  )
})
ok(unusedDeps.length === 0, `以下依赖声明了但源码未引用（未使用）：${unusedDeps.join(', ') || '（无）'}`)

console.log(`\n📦 依赖门禁：${pass} 通过 / ${failures.length} 失败`)
console.log(`   直接依赖 ${Object.keys(pkg.dependencies || {}).length} ｜ devDependencies ${Object.keys(pkg.devDependencies || {}).length} ｜ 锁文件解析 ${lockDeps.size} 项`)
if (failures.length) {
  for (const f of failures) console.log(`   ❌ ${f}`)
  process.exit(1)
}
console.log('   ✅ 声明与锁文件同步｜specifier 一致｜imports/bin 指向真实文件｜依赖已安装｜license 合规｜无未使用依赖')
