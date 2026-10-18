#!/usr/bin/env node
/**
 * test-env —— 环境变量台账门禁（防「三套账」漂移回潮）。
 *
 * 守护三件事：
 *   1) 代码里出现的每一个 process.env.X 都在 shared/env-registry.mjs 里登记过
 *      —— 新增变量却忘了登记，这里立刻红。
 *   2) .env.example 与台账一致（不再手改）。
 *   3) 台账每项都有 scope（且是已知分组）与一句话说明。
 *
 * 扫描时跳过注释行：`process.env.X` 出现在注释里（讲 Node 行为）不算使用。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'
import { ENV_VARS, SCOPE_LABELS, toExampleFile } from '../../shared/env-registry.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
let pass = 0
const failures = []
const ok = (cond, msg) => {
  if (cond) pass++
  else failures.push(msg)
}

const SCAN_DIRS = ['src', 'api', 'server', 'shared', 'tools', 'scripts']
const EXTS = /\.(mjs|js|cjs|vue)$/
const VAR_RE = /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g

function walk(dir, out = []) {
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === '.git') continue
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) walk(abs, out)
    else if (EXTS.test(name)) out.push(abs)
  }
  return out
}

const used = new Map() // name -> Set(相对路径)
for (const d of SCAN_DIRS) {
  for (const file of walk(join(ROOT, d))) {
    const rel = relative(ROOT, file).split(sep).join('/')
    for (const line of readFileSync(file, 'utf-8').split(/\r?\n/)) {
      const t = line.trim()
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue // 注释不算使用
      for (const m of line.matchAll(VAR_RE)) {
        if (!used.has(m[1])) used.set(m[1], new Set())
        used.get(m[1]).add(rel)
      }
    }
  }
}

const registered = new Set(ENV_VARS.map((v) => v.name))

// ① 代码用到的必须都已登记
const unregistered = [...used.keys()].filter((n) => !registered.has(n)).sort()
ok(
  unregistered.length === 0,
  `代码里用到但未登记的变量 ${unregistered.length} 个：${unregistered.join(', ')}`,
)

// ② 台账登记了但代码里没用到的（提示级：允许存在，如平台注入或历史保留）
const unusedInCode = ENV_VARS.filter((v) => !used.has(v.name)).map((v) => v.name)
ok(
  unusedInCode.every((n) => ENV_VARS.find((v) => v.name === n).scope === 'legacy'),
  `台账里以下变量在代码中未被引用且非 legacy，请确认是否应移除：${unusedInCode.join(', ') || '（无）'}`,
)

// ③ .env.example 与台账一致
const example = readFileSync(join(ROOT, '.env.example'), 'utf-8')
ok(example === toExampleFile(), '.env.example 与台账不一致（跑 npm run env:example 重新生成）')

// ④ 每项都有合法 scope 与说明
for (const v of ENV_VARS) {
  ok(!!SCOPE_LABELS[v.scope], `${v.name} 的 scope「${v.scope}」不是已知分组`)
  ok(typeof v.desc === 'string' && v.desc.length >= 6, `${v.name} 缺少一句话说明（desc）`)
}

console.log(`\n🔧 环境变量台账门禁：${pass} 通过 / ${failures.length} 失败`)
console.log(`   台账 ${ENV_VARS.length} 项｜代码引用 ${used.size} 个变量`)
if (failures.length) {
  for (const f of failures) console.log(`   ❌ ${f}`)
  process.exit(1)
}
console.log('   ✅ 代码变量已全部登记｜.env.example 与台账一致｜scope 与说明齐备')
