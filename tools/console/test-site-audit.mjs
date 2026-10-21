/**
 * 站点变更审计的门禁。
 *
 * 守护三件事：
 *   1. 只把「人可感知的内容变化」算作更新，访问计数 / 时间戳变化不产生噪音；
 *   2. 少量变更逐条可读（加了哪个站、删了哪个站）；
 *   3. 批量 / 同步不淹没审计（一条摘要 + 独立明细路径）。
 */
import assert from 'node:assert/strict'
import { diffSites, buildSiteAuditEntries } from '../../shared/site-change-audit.mjs'

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

const site = (id, extra = {}) => ({
  id, name: `站点${id}`, url: `${id}.example.com`, desc: '描述', categoryId: 'starter',
  color: '#3b82f6', initial: 'S', sortOrder: 1, createdAt: 1, updatedAt: 1,
  aliases: [], purposes: [], position: { domain: 'ai-work', stage: 'chat', source: 'auto' },
  visitCount: 0, archived: false, pinned: false,
  ...extra,
})

console.log('站点变更审计')

ok('识别新增 / 删除 / 更新', () => {
  const before = [site('s1', { desc: '旧' }), site('s2')]
  const after = [site('s1', { desc: '新' }), site('s3')]
  const d = diffSites(before, after)
  assert.deepEqual(d.added.map(x => x.id), ['s3'])
  assert.deepEqual(d.removed.map(x => x.id), ['s2'])
  assert.deepEqual(d.updated.map(x => x.id), ['s1'])
  assert.equal(d.total, 3)
})

ok('内容完全一致时没有变更', () => {
  const list = [site('s1'), site('s2')]
  assert.equal(diffSites(list, list.map(x => ({ ...x }))).total, 0)
})

ok('访问计数与 updatedAt 变化不算更新', () => {
  const before = [site('s1', { visitCount: 1, updatedAt: 1 })]
  const after = [site('s1', { visitCount: 99, updatedAt: 2 })]
  assert.equal(diffSites(before, after).total, 0)
})

ok('布尔缺省与 false 等价，不误报', () => {
  const before = [{ ...site('s1'), archived: undefined, pinned: undefined }]
  const after = [{ ...site('s1'), archived: false, pinned: false }]
  assert.equal(diffSites(before, after).total, 0)
})

ok('归档 / 置顶变化算更新', () => {
  const before = [site('s1')]
  const after = [site('s1', { archived: true, pinned: true })]
  assert.deepEqual(diffSites(before, after).updated.map(x => x.id), ['s1'])
})

ok('position 键顺序不同不误判', () => {
  const before = [site('s1')]
  const after = [site('s1', { position: { source: 'auto', stage: 'chat', domain: 'ai-work' } })]
  assert.equal(diffSites(before, after).total, 0)
})

ok('少量变更逐条记录', () => {
  const d = diffSites([site('s1')], [site('s1', { desc: '新' }), site('s2')])
  const entries = buildSiteAuditEntries(d, { actor: 'admin' })
  assert.equal(entries.length, 2)
  const add = entries.find(e => e.action === 'sites.add')
  const upd = entries.find(e => e.action === 'sites.update')
  assert.equal(add.target, 's2')
  assert.match(add.detail, /s2\.example\.com/)
  assert.equal(upd.target, 's1')
  assert.equal(entries[0].actor, 'admin')
})

ok('批量变更合并成 sites.batch 并带明细路径', () => {
  const before = Array.from({ length: 40 }, (_, i) => site(`a${i}`))
  const after = before.map(x => ({ ...x, desc: '改过' }))
  const d = diffSites(before, after)
  const entries = buildSiteAuditEntries(d, { detailPath: 'ops/site-changes/x.json' })
  assert.equal(entries.length, 1)
  assert.equal(entries[0].action, 'sites.batch')
  assert.match(entries[0].detail, /修改 40/)
  assert.match(entries[0].detail, /ops\/site-changes\/x\.json/)
})

ok('同步写入只记一条 sites.sync', () => {
  const d = diffSites([site('s1')], [site('s1'), site('s2')])
  const entries = buildSiteAuditEntries(d, { source: 'sync', detailPath: 'ops/site-changes/y.json' })
  assert.equal(entries.length, 1)
  assert.equal(entries[0].action, 'sites.sync')
  assert.match(entries[0].detail, /新增 1/)
})

ok('没有变更时不产生记录', () => {
  assert.deepEqual(buildSiteAuditEntries({ added: [], removed: [], updated: [], total: 0 }), [])
})

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)