/**
 * 升级数据保护的门禁。
 *
 * 守护的是「版本升级后历史数据还在」这条产品承诺：
 *   - 站点条数与 version 不得回退；
 *   - 升级前存在的每一个站点 id 都必须还在（新增允许）；
 *   - 审计记录不得减少；
 *   - 正常编辑内容不应被误判成数据丢失（只比身份与数量）。
 */
import assert from 'node:assert/strict'
import { summarize, compareData, auditCount } from '../../scripts/upgrade-guard.mjs'

let pass = 0
let fail = 0
function ok(name, fn) {
  try {
    fn()
    pass += 1
    console.log(`  ✓ ${name}`)
  } catch (e) {
    fail += 1
    console.log(`  ✗ ${name}\n    ${e.message}`)
  }
}

const site = (id, extra = {}) => ({ id, name: `站点${id}`, url: `${id}.example.com`, createdAt: 1700000000000, ...extra })
const backup = (sites, version = 1, categories = []) => ({
  kind: 'navigator-backup',
  sites: { version, sites, categories },
})

function snap(sites, version = 1, audit = 0) {
  return summarize(backup(sites, version), JSON.stringify(Array.from({ length: audit }, (_, i) => ({ i }))), '')
}

console.log('升级数据保护')

ok('auditCount 兼容数组 / entries / 普通对象', () => {
  assert.equal(auditCount('[1,2,3]'), 3)
  assert.equal(auditCount('{"entries":[1,2]}'), 2)
  assert.equal(auditCount('{"a":1,"b":2}'), 2)
  assert.equal(auditCount('line1\nline2\n'), 2)
  assert.equal(auditCount(''), 0)
})

ok('summarize 提取条数、version、id 与最早创建时间', () => {
  const s = snap([site('s1'), site('s2', { createdAt: 1600000000000 })], 7, 4)
  assert.equal(s.sites, 2)
  assert.equal(s.version, 7)
  assert.deepEqual(s.ids, ['s1', 's2'])
  assert.equal(s.earliestCreatedAt, 1600000000000)
  assert.equal(s.auditEntries, 4)
})

ok('数据完整时判定通过', () => {
  const before = snap([site('s1'), site('s2')], 3, 5)
  const after = snap([site('s1'), site('s2')], 4, 5)
  assert.equal(compareData(before, after).ok, true)
})

ok('允许升级期间新增站点与审计', () => {
  const before = snap([site('s1')], 3, 5)
  const after = snap([site('s1'), site('s9')], 6, 8)
  assert.equal(compareData(before, after).ok, true)
})

ok('站点内容编辑不算数据丢失', () => {
  const before = snap([site('s1', { name: '旧名' })], 3, 5)
  const after = snap([site('s1', { name: '新名', visitCount: 99 })], 4, 5)
  assert.equal(compareData(before, after).ok, true)
})

ok('站点条数下降判失败', () => {
  const r = compareData(snap([site('s1'), site('s2')], 3), snap([site('s1')], 4))
  assert.equal(r.ok, false)
  assert.match(r.reasons.join(' '), /条数下降/)
})

ok('version 回退判失败', () => {
  const r = compareData(snap([site('s1')], 5), snap([site('s1')], 2))
  assert.equal(r.ok, false)
  assert.match(r.reasons.join(' '), /version 回退/)
})

ok('升级前的站点 id 丢失判失败并指名', () => {
  const r = compareData(snap([site('s1'), site('s2')], 3), snap([site('s2'), site('s3')], 4))
  assert.equal(r.ok, false)
  assert.match(r.reasons.join(' '), /丢失 1 条.*s1/)
})

ok('审计记录减少判失败', () => {
  const r = compareData(snap([site('s1')], 3, 10), snap([site('s1')], 4, 9))
  assert.equal(r.ok, false)
  assert.match(r.reasons.join(' '), /审计记录减少/)
})

ok('缺少任一侧快照判失败', () => {
  assert.equal(compareData(null, snap([site('s1')])).ok, false)
  assert.equal(compareData(snap([site('s1')]), null).ok, false)
})

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)