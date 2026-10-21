/**
 * 三端同步核心规则的门禁。
 *
 * 重点不是「能不能跑通」，而是三条容易回归的语义：
 *   1. 本地状态（巡检归档 / 置顶 / 访问计数）不得进入一致性指纹 —— 否则三端永远对不齐；
 *   2. 已一致时选主必须稳定（按 id），否则面板上的「权威端」会无意义地漂移；
 *   3. 只推落后端；同时间不同内容必须记冲突，不能静默覆盖。
 */
import assert from 'node:assert/strict'
import { syncFingerprint, pickWinner, planSync } from '../../shared/sync-core.mjs'
import { withLocalState, resolveAuthority, diffRemoved } from '../../shared/tri-sync.mjs'

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

const baseSite = (id, extra = {}) => ({
  id,
  name: `站点${id}`,
  url: `${id}.example.com`,
  desc: '描述',
  categoryId: 'starter',
  color: '#3b82f6',
  initial: 'S',
  sortOrder: 1,
  createdAt: 1700000000000,
  aliases: [],
  purposes: [],
  position: { domain: 'ai-work', stage: 'chat', source: 'auto', confidence: 0.9 },
  ...extra,
})

const data = (sites, extra = {}) => ({ version: 1, updatedAt: '2026-10-20T00:00:00.000Z', sites, ...extra })

console.log('三端同步核心')

ok('指纹忽略巡检字段（archived/pinned/visitCount/updatedAt）', () => {
  const a = data([baseSite('s1', { visitCount: 0 }), baseSite('s2')])
  const b = data([
    baseSite('s1', { archived: true, pinned: false, visitCount: 99, updatedAt: 1790000000000 }),
    baseSite('s2', { archived: false, updatedAt: 1790000000001 }),
  ])
  assert.equal(syncFingerprint(a), syncFingerprint(b))
})

ok('指纹对对象键顺序稳定', () => {
  const a = data([baseSite('s1')])
  const b = data([{ ...baseSite('s1'), position: { confidence: 0.9, source: 'auto', stage: 'chat', domain: 'ai-work' } }])
  assert.equal(syncFingerprint(a), syncFingerprint(b))
})

ok('业务字段变化会改变指纹', () => {
  const a = data([baseSite('s1')])
  const b = data([baseSite('s1', { desc: '改过的描述' })])
  assert.notEqual(syncFingerprint(a), syncFingerprint(b))
})

ok('少一条站点会改变指纹', () => {
  assert.notEqual(syncFingerprint(data([baseSite('s1'), baseSite('s2')])), syncFingerprint(data([baseSite('s1')])))
})

ok('选主取 updatedAt 最新的一端', () => {
  const target = (id, at, version) => ({
    id, label: id, url: `https://${id}`, ok: true,
    data: { version, updatedAt: at, sites: [baseSite('s1', { desc: id })] },
  })
  const winner = pickWinner([
    target('local', '2026-10-15T00:00:00.000Z', 1),
    target('botkeep', '2026-10-20T00:00:00.000Z', 2),
    target('workbuddy', '2026-10-12T00:00:00.000Z', 1),
  ])
  assert.equal(winner.id, 'botkeep')
})

ok('已一致时按 id 选主（不随时间漂移）', () => {
  const same = data([baseSite('s1')])
  const winner = pickWinner([
    { id: 'workbuddy', label: 'WorkBuddy', ok: true, data: { ...same, updatedAt: '2026-10-21T00:00:00.000Z' } },
    { id: 'botkeep', label: 'BotKeep', ok: true, data: { ...same, updatedAt: '2026-10-20T00:00:00.000Z' } },
    { id: 'local', label: '本地库', ok: true, data: { ...same, updatedAt: '2026-10-19T00:00:00.000Z' } },
  ])
  assert.equal(winner.id, 'botkeep')
})

ok('计划只推落后端', () => {
  const winnerData = data([baseSite('s1', { desc: '新' })], { updatedAt: '2026-10-20T00:00:00.000Z' })
  const oldData = data([baseSite('s1', { desc: '旧' })], { updatedAt: '2026-10-10T00:00:00.000Z' })
  const plan = planSync([
    { id: 'botkeep', ok: true, data: winnerData },
    { id: 'local', ok: true, data: oldData },
    { id: 'workbuddy', ok: true, data: winnerData },
  ])
  assert.equal(plan.winner.id, 'botkeep')
  assert.deepEqual(plan.actions.map(a => a.id), ['local'])
  assert.equal(plan.consistent, false)
})

ok('全部一致时没有动作', () => {
  const same = data([baseSite('s1')])
  const plan = planSync([
    { id: 'local', ok: true, data: same },
    { id: 'botkeep', ok: true, data: same },
    { id: 'workbuddy', ok: true, data: same },
  ])
  assert.equal(plan.consistent, true)
  assert.equal(plan.actions.length, 0)
})

ok('同时间不同内容记冲突，不覆盖', () => {
  const at = '2026-10-20T00:00:00.000Z'
  const plan = planSync([
    { id: 'local', ok: true, data: { version: 1, updatedAt: at, sites: [baseSite('s1', { desc: 'A' })] } },
    { id: 'botkeep', ok: true, data: { version: 1, updatedAt: at, sites: [baseSite('s1', { desc: 'B' })] } },
  ])
  assert.equal(plan.actions.length, 0)
  assert.equal(plan.conflicts.length, 1)
})

ok('不可达端只记 unreachable，不参与选主', () => {
  const plan = planSync([
    { id: 'local', ok: false, error: '连接被拒绝' },
    { id: 'botkeep', ok: true, data: data([baseSite('s1')]) },
  ])
  assert.deepEqual(plan.unreachable, ['local'])
  assert.equal(plan.winner.id, 'botkeep')
})

ok('没有任何可用端时 winner 为 null', () => {
  const plan = planSync([{ id: 'local', ok: false }, { id: 'botkeep', ok: false }])
  assert.equal(plan.winner, null)
  assert.equal(plan.actions.length, 0)
})

ok('写入合并保留目标端的归档/置顶/访问计数', () => {
  const winner = data([baseSite('s1', { desc: '新' }), baseSite('s2')])
  const target = data([baseSite('s1', { archived: true, pinned: true, visitCount: 12, desc: '旧' })])
  const merged = withLocalState(winner, target)
  const s1 = merged.sites.find(s => s.id === 's1')
  assert.equal(s1.desc, '新')
  assert.equal(s1.archived, true)
  assert.equal(s1.pinned, true)
  assert.equal(s1.visitCount, 12)
  // 目标端没有的站点不凭空补状态
  const s2 = merged.sites.find(s => s.id === 's2')
  assert.equal(s2.archived, undefined)
})

ok('写入合并不改变业务字段指纹', () => {
  const winner = data([baseSite('s1', { desc: '新' })])
  const target = data([baseSite('s1', { archived: true, visitCount: 3 })])
  assert.equal(syncFingerprint(withLocalState(winner, target)), syncFingerprint(winner))
})

ok('权威模式：固定 BotKeep 胜出，即使本地更新', () => {
  const authority = data([baseSite('s1', { desc: '权威' })], { updatedAt: '2026-10-10T00:00:00.000Z' })
  const localNewer = data([baseSite('s1', { desc: '本地新' })], { updatedAt: '2026-10-21T00:00:00.000Z' })
  const plan = planSync([
    { id: 'botkeep', ok: true, data: authority },
    { id: 'local', ok: true, data: localNewer },
    { id: 'workbuddy', ok: true, data: authority },
  ], { authority: 'botkeep' })
  assert.equal(plan.winner.id, 'botkeep')
  assert.deepEqual(plan.actions.map(a => a.id), ['local'])
  assert.equal(plan.diverged.length, 1)
  assert.equal(plan.diverged[0].id, 'local')
})

ok('权威模式：权威端不可达时不下发任何写入', () => {
  const plan = planSync([
    { id: 'botkeep', ok: false, error: '连接超时' },
    { id: 'local', ok: true, data: data([baseSite('s1')]) },
  ], { authority: 'botkeep' })
  assert.equal(plan.authorityUnavailable, true)
  assert.equal(plan.winner, null)
  assert.equal(plan.actions.length, 0)
})

ok('权威模式：内容一致时无动作', () => {
  const same = data([baseSite('s1')])
  const plan = planSync([
    { id: 'botkeep', ok: true, data: same },
    { id: 'local', ok: true, data: same },
  ], { authority: 'botkeep' })
  assert.equal(plan.consistent, true)
  assert.equal(plan.actions.length, 0)
})

ok('diffRemoved 找出目标端独有站点', () => {
  const removed = diffRemoved([baseSite('s1'), baseSite('local-only')], [baseSite('s1')])
  assert.deepEqual(removed.map(s => s.id), ['local-only'])
})

ok('resolveAuthority 默认 botkeep，空字符串回到自动选主', () => {
  assert.equal(resolveAuthority({}), 'botkeep')
  assert.equal(resolveAuthority({ NAV_SYNC_AUTHORITY: '' }), '')
  assert.equal(resolveAuthority({ NAV_SYNC_AUTHORITY: 'workbuddy' }), 'workbuddy')
})

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)