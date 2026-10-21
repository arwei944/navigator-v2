#!/usr/bin/env node
/**
 * 数据管理插件自测：不联网、不碰数据库。
 *
 * 覆盖：
 *   ① 真实种子数据的体检基线（300 条 / 7 条缺 icon / 93 条空 aliases / 71 条低置信度）
 *   ② URL 归一化的各类输入（协议 / www / 尾斜杠 / 路径 / 非法域名）
 *   ③ 修复计划：条数不变、未命中条目保持对象身份、命中条目刷新 updatedAt
 *   ④ 排序重排只在必要时触发（本来就连续时不能产生 300 条假 diff）
 *   ⑤ 孤儿分类重指派与人工校正标记
 *   ⑥ CSV 转义与切片
 *
 * 为什么基线要写死数字：体检报告的价值在于「数字可复现」。如果某次改动让
 * 「93 条空 aliases」变成 94，这里必须立刻失败 —— 否则面板上的数字就成了猜的。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  auditSites, buildFixPlan, normalizeUrl, urlKey,
  categoryIndex, AUDIT_FIELDS, LOW_CONFIDENCE,
} from '../../shared/data-audit.mjs'
import { sitesToCsv, sliceSites } from '../../shared/data-report.mjs'
import { CATEGORY_GROUPS } from '../../shared/categories.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')

let pass = 0
let fail = 0
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass += 1 } catch (e) { console.log('  ✖ ' + name + ' — ' + e.message); fail += 1 }
}

/* ---------------- 真实数据夹具 ---------------- */

const seedSites = JSON.parse(readFileSync(join(ROOT, 'api', 'sites-data.json'), 'utf-8'))
const iconFiles = readdirSync(join(ROOT, 'public', 'icons'))
const iconSet = new Set(iconFiles)
const iconExists = p => iconSet.has(String(p).replace(/^icons\//, ''))
const iconFileList = iconFiles.map(f => `icons/${f}`)

const baseline = auditSites(seedSites, {
  categories: CATEGORY_GROUPS,
  iconExists,
  iconFiles: iconFileList,
  now: Date.now(),
  staleDays: 3650,
})

console.log('\n[1] 真实种子数据体检基线')
check('站点总数 300', () => assert.equal(baseline.total, 300))
check('id / name / url 全覆盖', () => {
  for (const k of ['id', 'name', 'url']) {
    assert.equal(baseline.fields.find(f => f.key === k).missingCount, 0, k)
  }
})
check('缺 icon 7 条', () => assert.equal(baseline.fields.find(f => f.key === 'icon').missingCount, 7))
check('空 aliases 93 条', () => assert.equal(baseline.fields.find(f => f.key === 'aliases').missingCount, 93))
check('低置信度 71 条（含 0.6 档）', () => assert.equal(baseline.inference.lowConfidence.length, 71))
check('重复 url / name / id 均为 0', () => {
  assert.equal(baseline.duplicates.urls.length, 0)
  assert.equal(baseline.duplicates.names.length, 0)
  assert.equal(baseline.duplicates.ids.length, 0)
})
check('无孤儿分类', () => assert.equal(baseline.orphanCategories.length, 0))
check('带路径 URL 22 条（只标记不修改）', () => assert.equal(baseline.urlIssues.hasPath.length, 22))
check('无协议 / 无 www / 无非法域名', () => {
  assert.equal(baseline.urlIssues.hasProtocol.length, 0)
  assert.equal(baseline.urlIssues.hasWww.length, 0)
  assert.equal(baseline.urlIssues.invalid.length, 0)
})
check('图标引用零缺失、零孤儿文件', () => {
  assert.equal(baseline.resources.iconMissing.length, 0)
  assert.equal(baseline.resources.orphanFiles.length, 0)
})
check('分类表 30 个，空分类 1 个', () => {
  assert.equal(baseline.categoriesDefined, 30)
  assert.equal(baseline.emptyCategories.length, 1)
})
check('字段目录覆盖 15 个字段', () => assert.equal(AUDIT_FIELDS.length, 15))

console.log('\n[2] URL 归一化')
check('协议 + www + 尾斜杠一起剥离', () => {
  const n = normalizeUrl('https://www.Example.com/')
  assert.equal(n.value, 'Example.com')
  assert.equal(n.changed, true)
  assert.equal(n.valid, true)
  assert.deepEqual(n.flags, { hasProtocol: true, hasWww: true, hasTrailingSlash: true, hasPath: false })
})
check('已是规范形态不产生变更', () => {
  const n = normalizeUrl('chat.openai.com')
  assert.equal(n.changed, false)
  assert.equal(n.value, 'chat.openai.com')
})
check('路径保留、只标记', () => {
  const n = normalizeUrl('zapper.fi/app/dashboard')
  assert.equal(n.value, 'zapper.fi/app/dashboard')
  assert.equal(n.changed, false)
  assert.equal(n.flags.hasPath, true)
})
check('带端口的域名合法', () => {
  const n = normalizeUrl('localhost:3000')
  assert.equal(n.valid, false, '单段主机名不算合法域名')
  const m = normalizeUrl('example.com:8080')
  assert.equal(m.valid, true)
})
check('无效输入不抛错', () => {
  for (const v of [null, undefined, '', '   ', 'not a domain']) {
    assert.doesNotThrow(() => normalizeUrl(v))
  }
})
check('urlKey 抹平大小写差异', () => {
  assert.equal(urlKey('HTTPS://WWW.Example.com/'), urlKey('example.com'))
})

console.log('\n[3] 修复计划的基本不变量')
const planAll = buildFixPlan(seedSites, {
  actions: { normalizeUrl: true, fillAliases: true, dropMissingIcons: true },
  iconExists,
  now: 1_700_000_000_000,
})
check('站点条数不变', () => assert.equal(planAll.nextSites.length, seedSites.length))
check('补别名命中 93 条', () => assert.equal(planAll.stats.byAction.fillAliases, 93))
check('changedSites 等于去重后的变更站点数', () => {
  const ids = new Set(planAll.changes.map(c => c.id))
  assert.equal(planAll.stats.changedSites, ids.size)
})
check('未命中的条目保持对象身份', () => {
  const changedIds = new Set(planAll.changes.map(c => c.id))
  for (let i = 0; i < seedSites.length; i += 1) {
    if (!changedIds.has(seedSites[i].id)) {
      assert.equal(planAll.nextSites[i], seedSites[i], `站点 ${seedSites[i].id} 被无谓复制`)
    }
  }
})
check('命中的条目刷新 updatedAt', () => {
  const changedIds = new Set(planAll.changes.map(c => c.id))
  for (let i = 0; i < seedSites.length; i += 1) {
    if (changedIds.has(seedSites[i].id)) assert.equal(planAll.nextSites[i].updatedAt, 1_700_000_000_000)
  }
})
check('计划不会改动 id / name', () => {
  for (let i = 0; i < seedSites.length; i += 1) {
    assert.equal(planAll.nextSites[i].id, seedSites[i].id)
    assert.equal(planAll.nextSites[i].name, seedSites[i].name)
  }
})
check('补的别名等于名称本身', () => {
  const c = planAll.changes.find(x => x.action === 'fillAliases')
  assert.deepEqual(c.to, [c.name])
})

console.log('\n[4] 排序重排的触发条件')
const ordered = [
  { id: 'a', name: 'A', url: 'a.com', sortOrder: 1, aliases: [], position: {} },
  { id: 'b', name: 'B', url: 'b.com', sortOrder: 2, aliases: [], position: {} },
]
const p1 = buildFixPlan(ordered, { actions: { renumberSortOrder: true } })
check('本来连续 → 零变更并说明原因', () => {
  assert.equal(p1.changes.length, 0)
  assert.equal(p1.skipped.some(s => s.action === 'renumberSortOrder'), true)
})
const dupOrder = [
  { id: 'a', name: 'A', url: 'a.com', sortOrder: 5 },
  { id: 'b', name: 'B', url: 'b.com', sortOrder: 5 },
  { id: 'c', name: 'C', url: 'c.com', sortOrder: 0 },
]
const p2 = buildFixPlan(dupOrder, { actions: { renumberSortOrder: true } })
check('重复 / 非法排序值 → 重排为 1..n', () => {
  assert.deepEqual(p2.nextSites.map(s => s.sortOrder), [1, 2, 3])
  assert.equal(p2.changes.length, 3)
})

console.log('\n[5] 孤儿分类重指派与人工校正')
const broken = [
  { id: 'x', name: 'X', url: 'x.com', categoryId: 'ghost', aliases: [], position: { source: 'auto', confidence: 0.5 } },
]
const p3 = buildFixPlan(broken, { reassign: { x: 'starter' } })
check('重指派写入目标分类', () => assert.equal(p3.nextSites[0].categoryId, 'starter'))
check('保留 position 其它字段', () => {
  assert.equal(p3.nextSites[0].position.confidence, 0.5)
})
const p4 = buildFixPlan(broken, { markManual: ['x'], now: 123 })
check('标记 manual 且保留 confidence', () => {
  assert.equal(p4.nextSites[0].position.source, 'manual')
  assert.equal(p4.nextSites[0].position.confidence, 0.5)
  assert.equal(p4.nextSites[0].updatedAt, 123)
})
check('已是 manual 时不重复产生 diff', () => {
  const again = buildFixPlan(p4.nextSites, { markManual: ['x'] })
  assert.equal(again.changes.length, 0)
})

console.log('\n[6] 图标清理')
const iconBroken = [
  { id: 'i1', name: 'I1', url: 'i1.com', icon: 'icons/missing.webp' },
  { id: 'i2', name: 'I2', url: 'i2.com', icon: 'icons/exists.webp' },
  { id: 'i3', name: 'I3', url: 'i3.com', icon: 'https://cdn.example.com/a.png' },
]
const p5 = buildFixPlan(iconBroken, {
  actions: { dropMissingIcons: true },
  iconExists: p => p === 'icons/exists.webp',
})
check('只清掉本地缺失的那个', () => {
  assert.equal(p5.changes.length, 1)
  assert.equal(p5.changes[0].id, 'i1')
  assert.equal(p5.nextSites[0].icon, '')
})
check('远程图标不参与本地文件检查', () => {
  assert.equal(p5.nextSites[2].icon, 'https://cdn.example.com/a.png')
})

console.log('\n[7] CSV 与切片')
check('CSV 表头列数正确', () => {
  const csv = sitesToCsv(seedSites.slice(0, 2))
  assert.equal(csv.split('\r\n').length, 3)
})
check('逗号 / 引号 / 换行被正确转义', () => {
  const csv = sitesToCsv([{ id: 'q', name: 'a,b', url: 'q.com', desc: '他说"你好"\n第二行', aliases: ['x', 'y'] }])
  assert.ok(csv.includes('"a,b"'))
  assert.ok(csv.includes('"他说""你好""\n第二行"'))
  assert.ok(csv.includes('x;y'))
})
check('空值输出空串而不是 undefined', () => {
  const csv = sitesToCsv([{ id: 'e' }], ['id', 'missing'])
  assert.equal(csv.split('\r\n')[1], 'e,')
})
check('按分类切片', () => {
  const out = sliceSites(seedSites, { categoryId: 'dex' })
  assert.equal(out.length, 14)
  assert.ok(out.every(s => s.categoryId === 'dex'))
})
check('按 domain 切片', () => {
  const out = sliceSites(seedSites, { domain: 'onchain' })
  assert.equal(out.length, 73)
})
check('无参数返回原数组', () => {
  assert.equal(sliceSites(seedSites).length, seedSites.length)
})

console.log('\n[8] 分类索引')
check('摊平分组并保留分组信息', () => {
  const idx = categoryIndex(CATEGORY_GROUPS)
  assert.equal(idx.get('starter').group, 'ai')
  assert.equal(idx.get('starter').label, '入门对话')
})
check('脏输入不抛错', () => {
  assert.equal(categoryIndex(null).size, 0)
  assert.equal(categoryIndex([{ id: 'x' }]).size, 0)
})

console.log('\n[9] 空库与异常输入')
check('空数组返回零值报告而不是抛错', () => {
  const r = auditSites([])
  assert.equal(r.total, 0)
  assert.equal(r.inference.lowConfidence.length, 0)
  assert.equal(r.fields.length, AUDIT_FIELDS.length)
})
check('非数组输入同样降级为零', () => {
  assert.equal(auditSites(null).total, 0)
  assert.equal(auditSites(undefined).total, 0)
})
check('计划对空数组返回空结果', () => {
  const p = buildFixPlan([], { actions: { fillAliases: true } })
  assert.equal(p.nextSites.length, 0)
  assert.equal(p.changes.length, 0)
})
check('阈值常量可被面板读取', () => assert.equal(LOW_CONFIDENCE, 0.6))

console.log('\n[10] 修复作用范围（E4）')
const scopeSites = [
  { id: 'a', name: 'A', url: 'a.com/', categoryId: 'starter', aliases: [], position: { domain: 'ai-work' } },
  { id: 'b', name: 'B', url: 'b.com/', categoryId: 'dex', aliases: [], position: { domain: 'onchain' } },
  { id: 'c', name: 'C', url: 'c.com/', categoryId: 'starter', aliases: [], position: { domain: 'onchain' } },
]
check('按分类限定：只改该分类的条目', () => {
  const p = buildFixPlan(scopeSites, {
    actions: { normalizeUrl: true, fillAliases: true },
    scope: { categoryId: 'starter' },
    now: 1,
  })
  // changes 是字段级条目：一个站点可能同时被 URL 归一化和补别名各改一次，按 id 去重再比
  const ids = [...new Set(p.changes.map(c => c.id))].sort()
  assert.deepEqual(ids, ['a', 'c'])
  assert.equal(p.stats.scopedSites, 2)
})
check('按方向限定：只改该方向的条目', () => {
  const p = buildFixPlan(scopeSites, {
    actions: { normalizeUrl: true },
    scope: { domain: 'onchain' },
    now: 1,
  })
  assert.deepEqual(p.changes.map(c => c.id).sort(), ['b', 'c'])
  assert.equal(p.stats.scopedSites, 2)
})
check('分类与方向同时给出时取交集', () => {
  const p = buildFixPlan(scopeSites, {
    actions: { normalizeUrl: true },
    scope: { categoryId: 'onchain-bad', domain: 'onchain' },
    now: 1,
  })
  // 分类不存在于数据里 → 交集为空
  assert.equal(p.changes.length, 0)
})
check('无范围时 scopedSites 等于总数', () => {
  const p = buildFixPlan(scopeSites, { actions: { normalizeUrl: true }, now: 1 })
  assert.equal(p.stats.scopedSites, 3)
  assert.equal(p.stats.scope, null)
})
check('范围外的条目保持对象身份', () => {
  const p = buildFixPlan(scopeSites, {
    actions: { normalizeUrl: true },
    scope: { categoryId: 'starter' },
    now: 1,
  })
  assert.equal(p.nextSites[1], scopeSites[1], '范围外条目被无谓复制')
})
check('排序重排不受范围限制（只改一部分会让序号重复）', () => {
  const dupOrder = [
    { id: 'a', name: 'A', url: 'a.com', sortOrder: 5 },
    { id: 'b', name: 'B', url: 'b.com', sortOrder: 5 },
  ]
  const p = buildFixPlan(dupOrder, {
    actions: { renumberSortOrder: true },
    scope: { categoryId: 'starter' },
    now: 1,
  })
  assert.deepEqual(p.nextSites.map(s => s.sortOrder), [1, 2])
})
check('空范围对象视为全量', () => {
  const p = buildFixPlan(scopeSites, { actions: { normalizeUrl: true }, scope: {}, now: 1 })
  assert.equal(p.changes.length, 3)
  assert.equal(p.stats.scope, null)
})

console.log(`\n结果：${pass} 通过，${fail} 失败`)
if (fail) process.exitCode = 1
