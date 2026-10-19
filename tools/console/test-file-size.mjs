#!/usr/bin/env node
/**
 * test-file-size —— 单文件体量守卫（防「拆完又长回去」）。
 *
 * ## 为什么需要一道尺寸门禁
 *
 * 2026-10 把三个最大的文件拆了（AdminView 1175→739、App 804→609、sites.js 1096→787）。
 * 但拆分本身不会阻止下一次增长：功能继续加，文件自然回涨，两年后又是一个 1200 行组件。
 * 尺寸不是目的，它只是「这个文件是否还能一眼读懂」的可观察代理指标。
 *
 * ## 阈值怎么定
 *
 * 按**文件类型分别设限**，而不是一刀切：
 *   - Vue 单文件：模板 + 脚本 + 样式三段通常都长，900 行是「还读得下去」的上限；
 *   - store / 组合式：纯逻辑，600 行已接近「职能混杂」的信号；
 *   - 纯前端脚本：400 行。
 *
 * 超限的**唯一合法出路是拆**，不是把阈值调高。要调阈值，先在 PR 里说清
 * 「为什么这个文件就应该这么长」—— 这道门禁的价值就在于让那次讨论必须发生。
 *
 * ## 白名单
 *
 * 白名单只允许**有明确理由的例外**，并且每次新增都要写明原因。
 * 空着是最好的状态。
 *
 * 运行：node tools/console/test-file-size.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, extname } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

let pass = 0
const failures = []
const ok = (cond, label) => {
  if (cond) pass++
  else failures.push(label)
}

/** 按类型与目录设阈值 */
const RULES = [
  { name: 'Vue 组件（views）', dir: 'src/views', ext: '.vue', max: 900 },
  { name: 'Vue 组件（components）', dir: 'src/components', ext: '.vue', max: 900 },
  { name: 'store', dir: 'src/stores', ext: '.js', max: 600 },
  { name: 'composable', dir: 'src/composables', ext: '.js', max: 500 },
  { name: '前端 utils', dir: 'src/utils', ext: '.js', max: 500 },
  { name: 'shared 引擎', dir: 'shared', ext: '.mjs', max: 700 },
  { name: 'API 接口', dir: 'api', ext: '.js', max: 700 },
]

/**
 * 有明确理由的例外。新增时必须在 note 里写清「为什么它就该这么长」。
 * 之前那三个超限文件（AdminView / App / sites.js）已经真拆过了，所以这里是空的。
 */
const ALLOW = new Map([
  // 示例（目前没有豁免）：
  // ['src/foo.js', { max: 800, note: '为什么……' }],
])

function walk(dir) {
  const out = []
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const n of names) {
    const abs = join(dir, n)
    let st
    try {
      st = statSync(abs)
    } catch {
      continue
    }
    if (st.isDirectory()) out.push(...walk(abs))
    else out.push(abs)
  }
  return out
}

let scanned = 0
for (const rule of RULES) {
  const base = join(ROOT, rule.dir)
  for (const abs of walk(base)) {
    if (extname(abs) !== rule.ext) continue
    // 测试与构建产物不算
    if (/\.test\.|\.spec\./.test(abs)) continue
    scanned++
    const rel = relative(ROOT, abs).replace(/\\/g, '/')
    const lines = readFileSync(abs, 'utf-8').split(/\r?\n/).length
    const allow = ALLOW.get(rel)
    const max = allow ? allow.max : rule.max
    ok(lines <= max, `${rel}：${lines} 行，超过 ${rule.name} 上限 ${max}${allow ? `（豁免：${allow.note}）` : ''} —— 请拆分`)
  }
}

/*
 * 结构不变量：拆分后的三块不能再被「合回去」。
 * 如果哪天有人把 fetchCloud 又写回 sites.js，尺寸可能还没超限，但边界已经破了。
 */
const sitesSrc = readFileSync(join(ROOT, 'src/stores/sites.js'), 'utf-8')
ok(!/function fetchCloud\s*\(/.test(sitesSrc), 'sites.js 不应重新内联 fetchCloud（实际实现在 sitesCloud.js）')

const appSrc = readFileSync(join(ROOT, 'src/App.vue'), 'utf-8')
ok(!/const SCOPE_BY_ROUTE\s*=/.test(appSrc), 'App.vue 不应重新内联路由表（实际实现在 useRouteSync.js）')
ok(!/function onKeydown\s*\(/.test(appSrc), 'App.vue 不应重新内联全局快捷键（实际实现在 useAppLifecycle.js）')

const adminSrc = readFileSync(join(ROOT, 'src/views/AdminView.vue'), 'utf-8')
ok(!/const RAIL_GROUPS\s*=/.test(adminSrc), 'AdminView.vue 不应重新内联导航表（实际实现在 adminNav.js）')
ok(!/async function runAction\s*\(/.test(adminSrc), 'AdminView.vue 不应重新内联动作执行（实际实现在 useAdminActions.js）')

/* ---------------- 报告 ---------------- */

if (failures.length) {
  console.log(`\n📏 文件体量门禁：${pass} 通过 / ${failures.length} 失败（扫描 ${scanned} 个文件）`)
  for (const f of failures) console.log(`   ❌ ${f}`)
  console.log('   → 拆分文件，或（有充分理由时）在 ALLOW 里登记豁免并写明原因')
  process.exit(1)
}

console.log(`\n📏 文件体量门禁：${pass} 通过 / 0 失败（扫描 ${scanned} 个文件）`)
console.log('   ✅ 全部在阈值内｜拆分边界未被合回')
