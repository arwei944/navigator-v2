#!/usr/bin/env node
/**
 * 重复站点合并自测：不联网、不碰数据库。
 *
 * 覆盖：
 *   ① 分组：同网址（含协议/www/尾斜杠差异）、同名、传递性（A同URL B、B同名 C → 三者一组）
 *   ② 默认保留项：信息更全 → 更新更近 → 访问更多 → id 稳定排序
 *   ③ 合并规则：别名/用途取并集、访问量相加、描述取最长、空字段借值、定位取高置信
 *   ④ 字段级指定：显式选来源时覆盖默认规则
 *   ⑤ 计划不变量：条数 = 原数 - 移除数；结果能过站点表门禁；不修改输入
 *   ⑥ 真实 300 条：无重复时零分组、计划等于原数据
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { findDuplicateGroups, mergeGroup, buildMergePlan, pickDefaultKeep, MERGE_FIELDS } from '../../shared/data-merge.mjs'
import { sanitizeSites } from '../../shared/sanitize.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const seedSites = JSON.parse(readFileSync(join(ROOT, 'api', 'sites-data.json'), 'utf-8'))

let pass = 0
let fail = 0
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass += 1 } catch (e) { console.log('  ✖ ' + name + ' — ' + e.message); fail += 1 }
}

function site(id, over = {}) {
  return {
    id,
    name: over.name ?? id,
    url: over.url ?? `${id}.com`,
    desc: over.desc ?? '',
    categoryId: over.categoryId ?? 'starter',
    color: over.color ?? '#22c55e',
    initial: over.initial ?? id.slice(0, 1).toUpperCase(),
    sortOrder: over.sortOrder ?? 1,
    visitCount: over.visitCount ?? 0,
    createdAt: over.createdAt ?? 1000,
    updatedAt: over.updatedAt ?? 1000,
    purposes: over.purposes ?? [],
    position: over.position ?? { domain: 'ai-work', stage: 'chat', source: 'auto', confidence: 0.9, reason: '' },
    icon: over.icon ?? '',
    aliases: over.aliases ?? [],
  }
}

console.log('\n[1] 重复分组')
check('同网址（协议 / www / 尾斜杠差异）归为一组', () => {
  const g = findDuplicateGroups([
    site('a', { url: 'example.com' }),
    site('b', { url: 'https://www.example.com/' }),
  ])
  assert.equal(g.length, 1)
  assert.deepEqual(g[0].ids.sort(), ['a', 'b'])
})
check('同名归为一组', () => {
  const g = findDuplicateGroups([
    site('a', { name: 'ChatGPT', url: 'a.com' }),
    site('b', { name: 'chatgpt', url: 'b.com' }),
  ])
  assert.equal(g.length, 1)
})
check('传递性：A 同网址 B、B 同名 C → 三者一组', () => {
  const g = findDuplicateGroups([
    site('a', { name: 'X', url: 'same.com' }),
    site('b', { name: 'Y', url: 'same.com' }),
    site('c', { name: 'Y', url: 'other.com' }),
  ])
  assert.equal(g.length, 1)
  assert.equal(g[0].ids.length, 3)
})
check('无重复返回空', () => {
  assert.deepEqual(findDuplicateGroups([site('a'), site('b')]), [])
})
check('空输入不抛错', () => {
  assert.deepEqual(findDuplicateGroups([]), [])
  assert.deepEqual(findDuplicateGroups(null), [])
})
check('分组带建议保留项与匹配原因', () => {
  const g = findDuplicateGroups([
    site('a', { url: 'same.com' }),
    site('b', { url: 'same.com' }),
  ])
  assert.ok(g[0].suggestedKeepId)
  assert.ok(g[0].matchReasons.includes('同网址'))
})

console.log('\n[2] 默认保留项')
check('信息更全的优先', () => {
  const rich = site('rich', { desc: '有描述', icon: 'icons/x.webp', aliases: ['a'] })
  const poor = site('poor')
  assert.equal(pickDefaultKeep([poor, rich]).id, 'rich')
})
check('信息量相同时更新更近的优先', () => {
  const oldOne = site('old', { updatedAt: 1000 })
  const newOne = site('new', { updatedAt: 2000 })
  assert.equal(pickDefaultKeep([oldOne, newOne]).id, 'new')
})
check('再相同时访问更多的优先', () => {
  const low = site('low', { visitCount: 1 })
  const high = site('high', { visitCount: 99 })
  assert.equal(pickDefaultKeep([low, high]).id, 'high')
})
check('完全相同时按 id 稳定排序', () => {
  const a = site('aaa')
  const b = site('bbb')
  assert.equal(pickDefaultKeep([b, a]).id, 'aaa')
  assert.equal(pickDefaultKeep([a, b]).id, 'aaa')
})

console.log('\n[3] 合并规则')
const group = [
  site('keep', { name: 'A', desc: '短描述', aliases: ['A1'], purposes: ['tool'], visitCount: 5, icon: '' }),
  site('other', { name: 'A', desc: '这是一段更长的描述内容', aliases: ['A1', 'A2'], purposes: ['data'], visitCount: 7, icon: 'icons/a.webp' }),
]
const merged = mergeGroup(group, { keepId: 'keep', now: 5000 })

check('别名取并集并去重', () => assert.deepEqual(merged.merged.aliases, ['A1', 'A2']))
check('用途取并集', () => assert.deepEqual(merged.merged.purposes, ['tool', 'data']))
check('访问量相加', () => assert.equal(merged.merged.visitCount, 12))
check('描述取更长的一条', () => assert.equal(merged.merged.desc, '这是一段更长的描述内容'))
check('空图标从其它条目借值', () => assert.equal(merged.merged.icon, 'icons/a.webp'))
check('保留原 id', () => assert.equal(merged.merged.id, 'keep'))
check('更新时间为本次操作时间', () => assert.equal(merged.merged.updatedAt, 5000))
check('移除列表不含保留项', () => {
  assert.deepEqual(merged.removedIds, ['other'])
  assert.equal(merged.keepId, 'keep')
})

check('创建时间取最早、排序取最小', () => {
  const r = mergeGroup([
    site('a', { createdAt: 2000, sortOrder: 9 }),
    site('b', { createdAt: 1000, sortOrder: 3 }),
  ], { keepId: 'a', now: 1 })
  assert.equal(r.merged.createdAt, 1000)
  assert.equal(r.merged.sortOrder, 3)
})

check('定位取置信度更高的那份', () => {
  const r = mergeGroup([
    site('a', { position: { domain: 'ai-work', stage: 'chat', source: 'auto', confidence: 0.5 } }),
    site('b', { position: { domain: 'research', stage: 'intel', source: 'auto', confidence: 0.9 } }),
  ], { keepId: 'a', now: 1 })
  assert.equal(r.merged.position.domain, 'research')
  assert.equal(r.fieldSources.position, 'b')
})

console.log('\n[4] 字段级指定')
check('显式指定描述来源时覆盖「取最长」', () => {
  const r = mergeGroup(group, { keepId: 'keep', fieldChoices: { desc: 'keep' }, now: 1 })
  assert.equal(r.merged.desc, '短描述')
  assert.equal(r.fieldSources.desc, 'keep')
})
check('指定不存在的来源被忽略', () => {
  const r = mergeGroup(group, { keepId: 'keep', fieldChoices: { desc: 'ghost' }, now: 1 })
  assert.equal(r.merged.desc, '这是一段更长的描述内容')
})
check('合并字段目录不包含自动合并的字段', () => {
  const keys = MERGE_FIELDS.map(f => f.key)
  assert.ok(!keys.includes('aliases'))
  assert.ok(!keys.includes('purposes'))
  assert.ok(!keys.includes('visitCount'))
})

console.log('\n[5] 计划不变量')
const dupSites = [
  site('a', { url: 'same.com', visitCount: 1 }),
  site('b', { url: 'same.com', visitCount: 2 }),
  site('c', { url: 'unique.com' }),
]
const plan = buildMergePlan(dupSites, { now: 1 })
check('条数 = 原数 - 移除数', () => {
  assert.equal(plan.stats.before, 3)
  assert.equal(plan.stats.removedSites, 1)
  assert.equal(plan.nextSites.length, 2)
  assert.equal(plan.stats.after, 2)
})
check('保留项在结果里、被移除项不在', () => {
  const ids = plan.nextSites.map(s => s.id)
  const keepId = plan.merges[0].keepId
  assert.ok(ids.includes(keepId))
  for (const id of plan.merges[0].removedIds) assert.ok(!ids.includes(id))
})
check('结果通过站点表门禁', () => assert.ok(sanitizeSites(plan.nextSites)))
check('不修改输入数组', () => {
  assert.equal(dupSites.length, 3)
  assert.equal(dupSites[0].visitCount, 1, '输入站点被就地修改了')
})
check('无重复时计划等于原数据条数', () => {
  const p = buildMergePlan([site('x'), site('y')], { now: 1 })
  assert.equal(p.stats.groups, 0)
  assert.equal(p.nextSites.length, 2)
})
check('choices 按组 key 生效', () => {
  const p = buildMergePlan(dupSites, {
    choices: { [plan.groups[0].key]: { keepId: 'b' } },
    now: 1,
  })
  assert.equal(p.merges[0].keepId, 'b')
  assert.deepEqual(p.merges[0].removedIds, ['a'])
})
check('空输入不抛错', () => {
  const p = buildMergePlan([], { now: 1 })
  assert.equal(p.nextSites.length, 0)
  assert.equal(p.stats.groups, 0)
})

console.log('\n[6] 真实 300 条')
check('当前库没有重复组', () => {
  const groups = findDuplicateGroups(seedSites)
  assert.equal(groups.length, 0)
})
check('合并计划对现有库是空操作', () => {
  const p = buildMergePlan(seedSites, { now: 1 })
  assert.equal(p.nextSites.length, seedSites.length)
  assert.equal(p.stats.removedSites, 0)
})

console.log(`\n结果：${pass} 通过，${fail} 失败`)
if (fail) process.exitCode = 1
