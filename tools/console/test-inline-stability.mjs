#!/usr/bin/env node
/**
 * test-inline-stability —— 「输入态不许驱动父级 v-if」的结构守卫。
 *
 * ## 背景（含一次误诊的更正）
 *
 * 2026-10 排查「顶部搜索框输入 `github` 只有 `g` 进得去」时，第一版结论把原因归到
 * App.vue 里的 `<SmartBar v-if="... && !sitesStore.searchQuery" />`：怀疑输入态翻转
 * 让同层子树重建、连带卸载了工具栏。后来用真实键盘 + CDP 逐层取证，**对照实验推翻了这个结论**：
 * 把 SmartBar 换回 v-if 后输入依然稳定；真正原因是 `useOmniBox` 的 `commandScore(c, q)`
 * 漏传评分上下文，render 期间抛异常导致整棵子树被 Vue 卸掉重挂
 * （详见 `test-split-wiring.mjs` 的 [D] 段与 `test-input-focus-real.mjs`）。
 *
 * 所以这条门禁保留的**不是**「SmartBar 导致的」这个因果，而是一条仍然成立的预防性约束：
 * **「输入时隐藏某块 UI」不要写成父级的 `v-if`，用 prop / v-show 让组件自己决定**。
 * 理由是同层条件渲染会改变兄弟节点数量，diff 的复用行为不该拿来赌 —— 这次不是它，
 * 下次未必不是。`test-input-focus-real.mjs` 负责「真的还在跑」的行为验证，
 * 这里只负责结构不被写回去。
 *
 * 运行：node tools/console/test-inline-stability.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf-8')

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) pass++
  else failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}

/* ══════════ 1. App.vue：搜索框同级不得被 searchQuery 条件卸载 ══════════ */

const app = read('src/App.vue')

/*
 * 找出所有带 v-if 且条件里引用「输入态」的行。
 * 输入态白名单：搜索词 / 输入框绑定值。这些都是用户每敲一个字就会变的状态。
 */
const INPUT_STATE = /\b(searchQuery|trimmed|rawQuery)\b/
const offending = []
for (const line of app.split(/\r?\n/)) {
  if (!/v-if\s*=/.test(line)) continue
  if (!INPUT_STATE.test(line)) continue
  // 只关心「与工具栏同级的整块 UI」；输入框内部自己的 v-if（清空按钮等）不算
  if (/admin-|toast|context-menu/.test(line)) continue
  offending.push(line.trim())
}
ok(
  offending.length === 0,
  'App.vue 不得用输入态（searchQuery/trimmed）做 v-if 条件卸载同级 UI',
  offending.slice(0, 3).join(' | '),
)

/* SmartBar：常驻挂载 + prop 控制 */
ok(/<SmartBar[\s\S]{0,200}:enabled=/.test(app), 'SmartBar 通过 :enabled 控制可见性（常驻挂载）')
ok(!/<SmartBar[^>]*v-if/.test(app), 'SmartBar 不得用 v-if 卸载（输入态不该驱动父级条件渲染）')

const smartBar = read('src/components/SmartBar.vue')
ok(/defineProps\(\{[\s\S]*enabled/.test(smartBar), 'SmartBar 声明 enabled prop')
ok(/v-if="items\.length && enabled"/.test(smartBar), 'SmartBar 用 items.length && enabled 决定自身是否渲染')

/* ══════════ 2. 工具栏本身不得依赖输入态 ══════════ */

const toolbar = read('src/components/MainToolbar.vue')
ok(!/v-if="[^"]*searchQuery/.test(toolbar), 'MainToolbar 不得按 searchQuery 卸载自身内容')

/* ══════════ 3. 搜索框的持久化契约 ══════════ */

const search = read('src/components/UnifiedSearchBox.vue')
ok(
  /watch\(\(\) => sitesStore\.searchQuery/.test(search),
  '搜索框从 store 回填输入值（路由 / 命令改词时能同步）',
)
ok(
  /searchQuery !== val\) sitesStore\.setSearchQuery\(val\)/.test(search),
  '搜索框写 store 前做等值判断（避免回环抖动）',
)

/* ══════════ 4. 结构性提示：同级条件块总数 ══════════ */

/*
 * 不是硬性阈值，只是把「这个不变量依赖多少同级 v-if」记录下来。
 * 数量突然暴涨说明有人在往这个切片里继续塞条件块，值得在 review 时看一眼。
 */
const appTemplateEnd = app.indexOf('<script setup>')
const template = app.slice(0, appTemplateEnd)
const siblings = (template.match(/^\s{8}<[A-Z][\w]*[^>]*v-if=/gm) || []).length
ok(siblings <= 8, `常规视图切片内的条件块数量受控（当前 ${siblings} 个）`)

/* ---------------- 报告 ---------------- */

if (failures.length) {
  console.log(`\n⌨️  输入稳定性门禁：${pass} 通过 / ${failures.length} 失败`)
  for (const f of failures) console.log(`   ❌ ${f}`)
  console.log('   → 「输入时隐藏某块 UI」请用 :prop 或 v-show，不要用 v-if 卸载同级节点')
  process.exit(1)
}

console.log(`\n⌨️  输入稳定性门禁：${pass} 通过 / 0 失败`)
console.log('   ✅ 搜索框同级无输入态 v-if｜SmartBar 常驻挂载｜搜索词回填与写回有等值判断')
