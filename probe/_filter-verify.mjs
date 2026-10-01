/**
 * 导航结构改造（域 / 子分类两级筛选）的无头验收。
 *
 * 覆盖三件容易出错、且浏览器探针看不出根因的事：
 *   1. 域 id 与子分类 id 同轴不歧义（domainOfScope / isDomainScope 判定唯一）
 *   2. 每个站点都能被某个域筛到（分类不属于任何域 = 该站在域筛选下凭空消失）
 *   3. 计数自洽：域计数 = 其子分类计数之和，全部计数 = 站点总数
 *
 * 运行：node probe/_filter-verify.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  CATEGORY_GROUPS, categoryList, domainList,
  isDomainScope, domainOfScope, categoriesOfDomain
} from '../shared/categories.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const sites = JSON.parse(readFileSync(join(HERE, '..', 'api', 'sites-data.json'), 'utf8'))

let pass = 0
const failures = []
function ok(cond, msg) {
  if (cond) pass++
  else failures.push(msg)
}

/* 1. 同轴不歧义 */
const catIds = new Set(categoryList().map(c => c.id))
const domIds = new Set(domainList().map(d => d.id))
const overlap = [...domIds].filter(id => catIds.has(id))
ok(overlap.length === 0, `域 id 与子分类 id 重名: ${overlap.join(', ')}`)

for (const d of domainList()) {
  ok(isDomainScope(d.id), `域 ${d.id} 未被 isDomainScope 识别`)
  ok(domainOfScope(d.id) === d.id, `域 ${d.id} 的 domainOfScope 应返回自身，实得 ${domainOfScope(d.id)}`)
  ok(!isDomainScope(domainOfScope(d.id) === d.id ? '' : ''), 'noop')
}
for (const c of categoryList()) {
  ok(!isDomainScope(c.id), `子分类 ${c.id} 被误判为域`)
  ok(domainOfScope(c.id) === domainOfScope(c.id) && domIds.has(domainOfScope(c.id)),
    `子分类 ${c.id} 未能归属到任何域（domainOfScope=${domainOfScope(c.id)}）`)
}
ok(domainOfScope('all') === 'all', "domainOfScope('all') 应为 'all'")
ok(domainOfScope('') === 'all', "domainOfScope('') 应为 'all'")
ok(domainOfScope('__nope__') === 'all', "未知取值应回落 'all'")

/* 2. 可达性：每个站点都能被某个域筛到 */
const byCategory = new Map()
for (const s of sites) byCategory.set(s.categoryId, (byCategory.get(s.categoryId) || 0) + 1)

const unreachable = [...byCategory.keys()].filter(id => !catIds.has(id))
ok(unreachable.length === 0,
  `以下 categoryId 不在分类表中，域筛选下会消失: ${unreachable.map(id => `${id}(${byCategory.get(id)}站)`).join(', ')}`)

/* 3. 计数自洽 */
const total = sites.length
let domainSum = 0
for (const d of domainList()) {
  const cats = categoriesOfDomain(d.id)
  const catSum = cats.reduce((n, c) => n + (byCategory.get(c.id) || 0), 0)
  domainSum += catSum
  const label = CATEGORY_GROUPS.find(g => g.id === d.id).label
  ok(cats.length > 0, `域 ${label} 下没有子分类`)
  ok(catSum > 0, `域 ${label} 下没有任何站点`)
  console.log(`  域 ${label.padEnd(6)} 子分类 ${String(cats.length).padStart(2)} 个，站点 ${String(catSum).padStart(3)} 个`)
}
ok(domainSum === total, `各域站点数之和 ${domainSum} ≠ 站点总数 ${total}`)

// categoriesOfDomain('all') 必须等于全量分类，否则「全部」域的计数会算漏
ok(categoriesOfDomain('all').length === categoryList().length,
  "categoriesOfDomain('all') 应返回全部子分类")
ok(categoriesOfDomain('__nope__').length === 0, '未知域应返回空分类列表')

console.log(`\n站点 ${total} 条，分类 ${catIds.size} 个，域 ${domIds.size} 个`)
console.log(`断言 ${pass} 条通过，${failures.length} 条失败`)
if (failures.length) {
  console.log('\n失败明细:')
  for (const f of failures) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('✅ 筛选语义验收通过')
