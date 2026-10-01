/**
 * 发布 / 管理内核用例：站点数据、发布流水线、发布历史、通知、审计。
 *
 * 为什么单独一套：这五个内核是「双端等价」的地基 —— 本地控制台与线上后台共用它们。
 * 一旦某个纯函数的行为漂移，两端会同时错，而且错得一致（更难发现）。
 * 因此用零依赖的断言把关键契约钉死：批量预演必须等于实写、云端执行端必须显式跳过跑不了的步骤、
 * 通知必须按聚合键折叠、发布记录必须能从快照推导出回退目标。
 *
 * 运行：npm run console:test:ops
 */
import assert from 'node:assert/strict'
import {
  SITE_FIELDS, normalizeUrl, hostOf, normalizeAliases, diffSites, checkIntegrity,
  validateSite, nextId, nextSortOrder, BATCH_OPS, applyBatch, batchSummary, matchSite,
} from '../../shared/ops/site-ops.mjs'
import {
  STEP_CATALOG, FULL_PIPELINE, CLOUD_PIPELINE, RUNNER_CAPS, planPipeline, createSteps,
  markStep, settlePending, settleRunning, stepFromMarker, advanceTo, stepsSummary,
  pipelineVerdict, formatStepLine,
} from '../../shared/ops/pipeline.mjs'
import {
  HISTORY_KEEP, TRIGGERS, normalizeRecord, sortRecords, filterRecords,
  summarizeRecords, prunableRecords, rollbackTarget,
} from '../../shared/ops/publish-history.mjs'
import {
  NOTIFY_KINDS, buildNotification, collapseNotifications, sortNotifications,
  filterNotifications, summarizeNotifications, webhookPayload, notificationText,
} from '../../shared/ops/notify-core.mjs'
import { AUDIT_ACTIONS, normalizeEntry, filterEntries, summarizeEntries, actionLabel } from '../../shared/ops/audit-core.mjs'

let pass = 0
let fail = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    pass += 1
  } catch (e) {
    fail += 1
    failures.push({ name, message: e.message })
  }
}

const CATS = { cex: { label: '交易所', color: '#f0b90b' }, dex: { label: 'DEX', color: '#7c3aed' } }

const sample = () => ([
  { id: 'cex1', name: 'Binance', url: 'binance.com', desc: '交易所', categoryId: 'cex', color: '#f0b90b', icon: 'icons/cex1.svg', sortOrder: 1, aliases: ['币安'] },
  { id: 'cex2', name: 'OKX', url: 'okx.com', desc: '交易所', categoryId: 'cex', color: '#f0b90b', sortOrder: 2 },
  { id: 'dex1', name: 'Uniswap', url: 'uniswap.org', desc: 'DEX', categoryId: 'dex', color: '#7c3aed', sortOrder: 3 },
])

/* ---------------- site-ops ---------------- */

test('normalizeUrl 只保留域名（去协议/路径/查询/尾斜杠）', () => {
  assert.equal(normalizeUrl('https://www.binance.com/zh-CN/trade?ref=1'), 'www.binance.com')
  assert.equal(normalizeUrl('binance.com'), 'binance.com')
  assert.equal(normalizeUrl('  http://okx.com/  '), 'okx.com')
})

test('normalizeUrl 拒绝空值与非法协议', () => {
  assert.throws(() => normalizeUrl(''), /请填写站点地址/)
  assert.throws(() => normalizeUrl('ftp://a.com'), /仅支持 http\/https/)
})

test('hostOf 剥离 www 并小写，用于去重比较', () => {
  assert.equal(hostOf('https://WWW.Binance.com/x'), 'binance.com')
  assert.equal(hostOf('binance.com'), 'binance.com')
  assert.equal(hostOf(''), '')
})

test('normalizeAliases 去重且剔除与站名/域名同形的项', () => {
  const out = normalizeAliases('币安, Binance, 币安、binance.com, 小狐狸', { name: 'Binance', url: 'binance.com' })
  assert.deepEqual(out, ['币安', '小狐狸'])
})

test('normalizeAliases 接受数组入参', () => {
  assert.deepEqual(normalizeAliases(['a', 'A', 'b'], {}), ['a', 'b'])
})

test('diffSites 识别新增 / 移除 / 字段级修改', () => {
  const before = sample()
  const after = [
    { ...before[0], name: 'Binance 币安' },
    before[1],
    { id: 'dex2', name: 'Curve', url: 'curve.fi', desc: 'DEX', categoryId: 'dex', sortOrder: 4 },
  ]
  const d = diffSites(before, after)
  assert.deepEqual(d.added.map(s => s.id), ['dex2'])
  assert.deepEqual(d.removed.map(s => s.id), ['dex1'])
  assert.deepEqual(d.modified.map(m => m.id), ['cex1'])
  assert.deepEqual(d.modified[0].fields, ['name'])
  assert.deepEqual(d.modified[0].labels, ['名称'])
  assert.equal(d.total, 3)
})

test('diffSites 忽略 visitCount / updatedAt 这类本地噪音', () => {
  const before = sample()
  const after = before.map(s => ({ ...s, visitCount: 99, updatedAt: 123 }))
  const d = diffSites(before, after)
  assert.equal(d.modified.length, 0)
})

test('checkIntegrity 报告缺图标与重复 sortOrder', () => {
  const r = checkIntegrity([
    { id: 'a', sortOrder: 1 },
    { id: 'b', sortOrder: 1, icon: 'x' },
    { id: 'c', sortOrder: 2 },
  ])
  assert.equal(r.total, 3)
  assert.deepEqual(r.missingIcon, ['a', 'c'])
  assert.deepEqual(r.dupSortOrder, [1])
  assert.equal(r.categories, 1)
})

test('validateSite 拦住重复域名与未登记分类', () => {
  const sites = sample()
  assert.deepEqual(validateSite({ name: 'X', desc: 'd', categoryId: 'cex', url: 'binance.com' }, { sites, categoryMeta: CATS }), ['该域名已收录：cex1 Binance'])
  assert.deepEqual(validateSite({ name: 'X', desc: 'd', categoryId: 'nope', url: 'x.com' }, { sites, categoryMeta: CATS }), ['未登记的分类：nope'])
  assert.deepEqual(validateSite({ name: 'X', desc: 'd', categoryId: 'cex', url: 'new.com' }, { sites, categoryMeta: CATS }), [])
  // excludeId 让「编辑自身」不与自己冲突
  assert.deepEqual(validateSite({ name: 'X', desc: 'd', categoryId: 'cex', url: 'binance.com' }, { sites, categoryMeta: CATS, excludeId: 'cex1' }), [])
})

test('nextId 沿用分类既有前缀并递增', () => {
  assert.equal(nextId('cex', sample()), 'cex3')
  assert.equal(nextId('dex', sample()), 'dex2')
})

test('nextSortOrder 跨分类全局递增', () => {
  assert.equal(nextSortOrder(sample()), 4)
  assert.equal(nextSortOrder([]), 1)
})

test('applyBatch 改分类：跟随新分类配色并记 updatedAt', () => {
  const r = applyBatch(sample(), { ids: ['cex1'], op: 'category', patch: { categoryId: 'dex' }, categoryMeta: CATS })
  assert.equal(r.ok, true)
  const moved = r.next.find(s => s.id === 'cex1')
  assert.equal(moved.categoryId, 'dex')
  assert.equal(moved.color, '#7c3aed')
  assert.ok(Number.isFinite(moved.updatedAt))
  assert.deepEqual(r.changes[0].labels, ['分类', '配色'])
})

test('applyBatch 改分类：显式给配色时不覆盖为分类主题色', () => {
  const r = applyBatch(sample(), { ids: ['cex1'], op: 'category', patch: { categoryId: 'dex', color: '#000000' }, categoryMeta: CATS })
  assert.equal(r.next.find(s => s.id === 'cex1').color, '#000000')
})

test('applyBatch 拒绝未登记分类与空选择', () => {
  assert.equal(applyBatch(sample(), { ids: ['cex1'], op: 'category', patch: { categoryId: 'nope' }, categoryMeta: CATS }).ok, false)
  assert.equal(applyBatch(sample(), { ids: [], op: 'color', patch: { color: '#fff' } }).ok, false)
  assert.equal(applyBatch(sample(), { ids: ['cex1'], op: 'nope' }).ok, false)
})

test('applyBatch 追加别名不覆盖既有，替换别名则整体换掉', () => {
  const add = applyBatch(sample(), { ids: ['cex1'], op: 'aliasAdd', patch: { aliases: '安币, 小狐狸' } })
  assert.deepEqual(add.next.find(s => s.id === 'cex1').aliases, ['币安', '安币', '小狐狸'])
  const set = applyBatch(sample(), { ids: ['cex1'], op: 'aliasSet', patch: { aliases: '安币' } })
  assert.deepEqual(set.next.find(s => s.id === 'cex1').aliases, ['安币'])
})

test('applyBatch 清空图标后该键被移除', () => {
  const r = applyBatch(sample(), { ids: ['cex1'], op: 'icon' })
  assert.equal('icon' in r.next.find(s => s.id === 'cex1'), false)
})

test('applyBatch 删除站点从数组中移除', () => {
  const r = applyBatch(sample(), { ids: ['cex1', 'dex1'], op: 'remove' })
  assert.deepEqual(r.next.map(s => s.id), ['cex2'])
  assert.deepEqual(r.removed.map(s => s.id), ['cex1', 'dex1'])
})

test('applyBatch 无变化的站点进 skipped 而非 changes', () => {
  const r = applyBatch(sample(), { ids: ['cex1', 'cex2'], op: 'color', patch: { color: '#f0b90b' } })
  assert.deepEqual(r.changes.map(c => c.id), [])
  assert.deepEqual(r.skipped.map(s => s.id), ['cex1', 'cex2'])
})

test('applyBatch 不改动未选中的站点（数组顺序保持不变）', () => {
  const r = applyBatch(sample(), { ids: ['dex1'], op: 'color', patch: { color: '#111111' } })
  assert.deepEqual(r.next.map(s => s.id), ['cex1', 'cex2', 'dex1'])
  assert.equal(r.next[0].color, '#f0b90b')
})

test('BATCH_OPS 只暴露已声明的操作，删除被标记为破坏性', () => {
  assert.equal(BATCH_OPS.remove.destructive, true)
  assert.equal(BATCH_OPS.category.destructive, undefined)
  assert.deepEqual(BATCH_OPS.aliasAdd.patchKeys, ['aliases'])
})

test('batchSummary 汇总更新/删除/跳过数量', () => {
  const r = applyBatch(sample(), { ids: ['cex1', 'cex2'], op: 'color', patch: { color: '#123456' } })
  assert.equal(batchSummary(r, { op: 'color' }), '改配色：更新 2 个')
})

test('matchSite 命中别名与 id，且大小写无关', () => {
  const s = sample()[0]
  assert.equal(matchSite(s, '币安'), true)
  assert.equal(matchSite(s, 'CEX1'), true)
  assert.equal(matchSite(s, 'binance'), true)
  assert.equal(matchSite(s, '不存在的词'), false)
})

test('SITE_FIELDS 不包含本地噪音字段', () => {
  for (const k of ['visitCount', 'updatedAt', 'createdAt']) assert.equal(SITE_FIELDS.includes(k), false)
})

/* ---------------- pipeline ---------------- */

test('planPipeline：本地控制台可跑全链路', () => {
  const p = planPipeline({ pipeline: FULL_PIPELINE, runner: 'console' })
  assert.equal(p.runnable, FULL_PIPELINE.length)
  assert.equal(p.skipped, 0)
})

test('planPipeline：线上后台跑不了的步骤保留并标 skipped，且给出原因', () => {
  const p = planPipeline({ pipeline: FULL_PIPELINE, runner: 'cloud' })
  assert.equal(p.steps.length, FULL_PIPELINE.length)
  const check = p.steps.find(s => s.key === 'check')
  assert.equal(check.status, 'skipped')
  assert.match(check.skipReason, /缺少能力/)
  assert.equal(p.steps.find(s => s.key === 'hotupdate').status, 'pending')
})

test('planPipeline：用户选项导致的跳过优先于执行', () => {
  const p = planPipeline({ pipeline: FULL_PIPELINE, runner: 'console', options: { push: false, skipBuild: true } })
  assert.equal(p.steps.find(s => s.key === 'push').status, 'skipped')
  assert.equal(p.steps.find(s => s.key === 'build').status, 'skipped')
  assert.equal(p.steps.find(s => s.key === 'deploy').status, 'pending')
})

test('planPipeline：dryRun 跳过所有有副作用的步骤', () => {
  const p = planPipeline({ pipeline: FULL_PIPELINE, runner: 'console', options: { dryRun: true } })
  for (const k of ['commit', 'push', 'backup', 'build', 'deploy', 'hotupdate']) {
    assert.equal(p.steps.find(s => s.key === k).status, 'skipped', `${k} 应跳过`)
  }
  assert.equal(p.steps.find(s => s.key === 'check').status, 'pending')
})

test('RUNNER_CAPS 声明云端只有 cloud 能力', () => {
  assert.deepEqual(RUNNER_CAPS.cloud, ['cloud'])
})

test('markStep 记录耗时，同状态重复标记不覆盖已有耗时', () => {
  const step = { status: 'pending', startedAt: null, endedAt: null, duration: null }
  markStep(step, { status: 'running' })
  assert.ok(Number.isFinite(step.startedAt))
  markStep(step, { status: 'success', detail: 'ok' })
  assert.equal(step.status, 'success')
  const d = step.duration
  assert.ok(Number.isFinite(d))
  markStep(step, { status: 'success' })
  assert.equal(step.duration, d)
})

test('settlePending 只收尾 pending，settleRunning 只收尾 running', () => {
  const steps = [
    { key: 'a', status: 'success' },
    { key: 'b', status: 'running', startedAt: Date.now() },
    { key: 'c', status: 'pending' },
  ]
  settlePending(steps, { status: 'skipped', detail: '未执行' })
  assert.equal(steps[2].status, 'skipped')
  assert.equal(steps[1].status, 'running')
  settleRunning(steps, { status: 'failed', detail: '退出码 1' })
  assert.equal(steps[1].status, 'failed')
  assert.equal(steps[0].status, 'success')
})

test('advanceTo 把前序 running 收尾并把目标标为 running', () => {
  const steps = createSteps(FULL_PIPELINE, 'console')
  advanceTo(steps, 'backup')
  assert.equal(steps.find(s => s.key === 'backup').status, 'running')
  advanceTo(steps, 'build')
  assert.equal(steps.find(s => s.key === 'backup').status, 'success')
  assert.equal(steps.find(s => s.key === 'build').status, 'running')
  assert.equal(steps.find(s => s.key === 'check').status, 'pending')
})

test('stepFromMarker 由 publish.mjs 的中文标记反查步骤 key', () => {
  assert.equal(stepFromMarker('备份数据'), 'backup')
  assert.equal(stepFromMarker('热更新'), 'hotupdate')
  assert.equal(stepFromMarker('轮询验证'), 'verify')
  assert.equal(stepFromMarker('无关文本'), null)
})

test('STEP_CATALOG 中每一步都声明了 requires', () => {
  for (const [key, def] of Object.entries(STEP_CATALOG)) {
    assert.ok(Array.isArray(def.requires), `${key} 缺少 requires`)
    assert.ok(def.label, `${key} 缺少 label`)
  }
})

test('pipelineVerdict：有失败即失败，全部落终态才算成功', () => {
  assert.equal(pipelineVerdict([{ label: 'a', status: 'success' }, { label: 'b', status: 'skipped' }]).ok, true)
  const bad = pipelineVerdict([{ label: '构建', status: 'failed' }])
  assert.equal(bad.ok, false)
  assert.match(bad.reason, /构建/)
  assert.equal(pipelineVerdict([{ label: 'a', status: 'pending' }]).ok, false)
})

test('stepsSummary 汇总各状态与总耗时', () => {
  const s = stepsSummary([
    { status: 'success', duration: 100 },
    { status: 'success', duration: 200 },
    { status: 'skipped', duration: 0 },
  ])
  assert.equal(s.success, 2)
  assert.equal(s.skipped, 1)
  assert.equal(s.total, 3)
  assert.equal(s.totalMs, 300)
})

test('formatStepLine 带图标、详情与耗时', () => {
  const line = formatStepLine({ label: '构建', status: 'success', detail: 'vite build', duration: 1500 })
  assert.match(line, /✓ 构建/)
  assert.match(line, /vite build/)
  assert.match(line, /1\.5s/)
})

test('CLOUD_PIPELINE 是云端能力的子集', () => {
  for (const k of CLOUD_PIPELINE) assert.ok(RUNNER_CAPS.cloud.includes('cloud'))
  assert.deepEqual(CLOUD_PIPELINE, ['validate', 'hotupdate', 'verify'])
})

/* ---------------- publish-history ---------------- */

const rec = (over = {}) => normalizeRecord({
  id: 'pub-1', ts: '2026-09-25T10:00:00.000Z', runner: 'console', trigger: 'manual',
  ok: true, duration: 12000, steps: [{ key: 'check', label: '本地改动检查', status: 'success', duration: 100, detail: '' }],
  cloud: { version: 96, count: 298 }, snapshot: { pathname: 'snapshots/sites-96.json', ok: true },
  ...over,
})

test('normalizeRecord 补齐缺省字段并规范化嵌套结构', () => {
  const r = normalizeRecord({})
  assert.ok(r.id.startsWith('pub-'))
  assert.equal(r.runner, 'console')
  assert.equal(r.trigger, 'manual')
  assert.equal(r.ok, false)
  assert.deepEqual(r.steps, [])
  assert.equal(r.commit, null)
  assert.equal(r.snapshot, null)
})

test('normalizeRecord 过滤步骤里的多余字段', () => {
  const r = rec({ steps: [{ key: 'a', label: 'A', status: 'success', duration: 5, detail: 'd', extra: 'x' }] })
  assert.deepEqual(Object.keys(r.steps[0]).sort(), ['detail', 'duration', 'key', 'label', 'status'])
})

test('sortRecords 按时间新 → 旧', () => {
  const items = [rec({ id: 'a', ts: '2026-01-01T00:00:00.000Z' }), rec({ id: 'b', ts: '2026-03-01T00:00:00.000Z' })]
  assert.deepEqual(sortRecords(items).map(r => r.id), ['b', 'a'])
})

test('filterRecords 按结果 / 触发来源 / 关键词筛选', () => {
  const items = [
    rec({ id: 'a', ok: true, trigger: 'manual', note: '常规发布' }),
    rec({ id: 'b', ok: false, trigger: 'schedule', note: '定时失败' }),
  ]
  assert.deepEqual(filterRecords(items, { ok: 'fail' }).map(r => r.id), ['b'])
  assert.deepEqual(filterRecords(items, { trigger: 'manual' }).map(r => r.id), ['a'])
  assert.deepEqual(filterRecords(items, { q: '定时' }).map(r => r.id), ['b'])
})

test('summarizeRecords 统计成功/失败与最近一次', () => {
  const s = summarizeRecords([rec({ id: 'a', ok: true }), rec({ id: 'b', ok: false, ts: '2026-09-26T10:00:00.000Z' })])
  assert.equal(s.total, 2)
  assert.equal(s.ok, 1)
  assert.equal(s.failed, 1)
})

test('prunableRecords 超出保留上限时淘汰最旧', () => {
  const items = Array.from({ length: HISTORY_KEEP + 3 }, (_, i) =>
    rec({ id: `r${i}`, ts: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }))
  const drop = prunableRecords(items, HISTORY_KEEP)
  assert.equal(drop.length, 3)
  assert.deepEqual(drop, ['r0', 'r1', 'r2'])
})

test('rollbackTarget：有快照即可回退数据；云端执行端不给代码回退', () => {
  const r = rec()
  const local = rollbackTarget(r, { runner: 'console' })
  assert.equal(local.available, true)
  assert.equal(local.data, 'snapshots/sites-96.json')
  const cloud = rollbackTarget(r, { runner: 'cloud' })
  assert.equal(cloud.code, null)
  assert.equal(cloud.available, true)
})

test('rollbackTarget：无快照且不支持代码回退时显式不可用并说明原因', () => {
  const r = rec({ snapshot: null, deployment: null })
  const t = rollbackTarget(r, { runner: 'cloud' })
  assert.equal(t.available, false)
  assert.match(t.reason, /没有可用快照/)
})

test('rollbackTarget：控制台可用部署 URL 作为代码回退目标', () => {
  const r = rec({ snapshot: null, deployment: { url: 'https://x.vercel.app', state: 'READY' } })
  const t = rollbackTarget(r, { runner: 'console' })
  assert.equal(t.available, true)
  assert.equal(t.code, 'https://x.vercel.app')
})

test('TRIGGERS 覆盖手动/定时/命令行/线上后台', () => {
  assert.deepEqual(Object.keys(TRIGGERS).sort(), ['admin', 'cli', 'manual', 'schedule'])
})

/* ---------------- notify-core ---------------- */

test('buildNotification 套用类型目录的级别与建议动作', () => {
  const n = buildNotification({ kind: 'health.down', target: 'cex1', title: 'Binance 不可达' })
  assert.equal(n.severity, 'error')
  assert.equal(n.action, '查看可用性看板')
  assert.equal(n.read, undefined)
  assert.ok(n.id.startsWith('health.down:cex1:'))
})

test('buildNotification 未知类型回落为 info 且不抛', () => {
  const n = buildNotification({ kind: 'unknown.kind' })
  assert.equal(n.severity, 'info')
  assert.equal(n.title, 'unknown.kind')
})

test('collapseNotifications 折叠冷却期内同 kind + target 的重复事件', () => {
  const t0 = '2026-09-25T10:00:00.000Z'
  const t1 = '2026-09-25T11:00:00.000Z'
  const items = [
    buildNotification({ kind: 'health.down', target: 'cex1', ts: t1 }),
    buildNotification({ kind: 'health.down', target: 'cex1', ts: t0 }),
    buildNotification({ kind: 'health.down', target: 'dex1', ts: t0 }),
  ]
  const out = collapseNotifications(items)
  assert.equal(out.length, 2)
  assert.equal(out[0].ts, t1)
})

test('collapseNotifications 不折叠 cooldown 为 0 的类型', () => {
  const items = [
    buildNotification({ kind: 'publish.done', target: '', ts: '2026-09-25T10:00:00.000Z' }),
    buildNotification({ kind: 'publish.done', target: '', ts: '2026-09-25T11:00:00.000Z' }),
  ]
  assert.equal(collapseNotifications(items).length, 2)
})

test('sortNotifications 严重级别优先，其次时间新 → 旧', () => {
  const items = [
    buildNotification({ kind: 'publish.done', ts: '2026-09-25T12:00:00.000Z' }),
    buildNotification({ kind: 'health.down', ts: '2026-09-25T09:00:00.000Z' }),
    buildNotification({ kind: 'rollback.done', ts: '2026-09-25T11:00:00.000Z' }),
  ]
  assert.deepEqual(sortNotifications(items).map(n => n.severity), ['error', 'warn', 'info'])
})

test('filterNotifications 按级别 / 类型 / 关键词筛选', () => {
  const items = [
    buildNotification({ kind: 'health.down', target: 'cex1', title: 'Binance 不可达' }),
    buildNotification({ kind: 'publish.done', title: '发布完成' }),
  ]
  assert.equal(filterNotifications(items, { severity: 'error' }).length, 1)
  assert.equal(filterNotifications(items, { kind: 'publish.done' }).length, 1)
  assert.equal(filterNotifications(items, { q: 'binance' }).length, 1)
})

test('summarizeNotifications 统计各级别与未读', () => {
  const items = [
    { severity: 'error', read: false },
    { severity: 'warn', read: true },
    { severity: 'info', read: false },
  ]
  const s = summarizeNotifications(items)
  assert.equal(s.total, 3)
  assert.equal(s.error, 1)
  assert.equal(s.unread, 2)
})

test('webhookPayload 字段扁平且稳定', () => {
  const n = buildNotification({ kind: 'publish.fail', title: '发布失败', body: '退出码 1', target: 'prod' })
  const p = webhookPayload(n)
  assert.deepEqual(Object.keys(p).sort(), ['body', 'event', 'severity', 'target', 'time', 'title'])
  assert.equal(p.event, 'publish.fail')
  assert.equal(p.severity, 'error')
})

test('notificationText 生成带级别图标的文本', () => {
  const n = buildNotification({ kind: 'health.down', title: 'Binance 不可达', body: 'HTTP 000' })
  assert.match(notificationText(n), /🔴 Binance 不可达/)
  assert.match(notificationText(n), /HTTP 000/)
})

test('NOTIFY_KINDS 覆盖发布 / 巡检 / 批量 / 回滚 / 快照', () => {
  for (const k of ['publish.done', 'publish.fail', 'health.down', 'health.recovered', 'sites.batch', 'rollback.done', 'snapshot.fail', 'schedule.summary']) {
    assert.ok(NOTIFY_KINDS[k], `缺少通知类型 ${k}`)
  }
})

/* ---------------- audit-core ---------------- */

test('normalizeEntry 裁剪超长 detail 并补默认值', () => {
  const e = normalizeEntry({ action: 'commit', detail: 'x'.repeat(900) })
  assert.equal(e.detail.length, 500)
  assert.equal(e.actor, 'console')
  assert.equal(e.result, 'ok')
  assert.ok(e.ts)
})

test('actionLabel 命中目录，未知动作回落原值', () => {
  assert.equal(actionLabel('sites.batch'), '批量站点操作')
  assert.equal(actionLabel('weird.thing'), 'weird.thing')
})

test('filterEntries 按动作 / 结果 / 关键词筛选（含中文名）', () => {
  const items = [
    normalizeEntry({ action: 'publish.done', target: '一键发布', result: 'ok', detail: 'v96' }),
    normalizeEntry({ action: 'publish.fail', target: '一键发布', result: 'fail', detail: '退出码 1' }),
  ]
  assert.equal(filterEntries(items, { result: 'fail' }).length, 1)
  assert.equal(filterEntries(items, { action: 'publish.done' }).length, 1)
  assert.equal(filterEntries(items, { q: '发布完成' }).length, 1)
  assert.equal(filterEntries(items, { q: 'v96' }).length, 1)
})

test('summarizeEntries 统计失败数与最近一次放行', () => {
  const items = [
    normalizeEntry({ action: 'gate.approve', target: 'g1', result: 'ok' }),
    normalizeEntry({ action: 'publish.fail', result: 'fail' }),
  ]
  const s = summarizeEntries(items)
  assert.equal(s.total, 2)
  assert.equal(s.failures, 1)
  assert.equal(s.lastApprove.target, 'g1')
})

test('AUDIT_ACTIONS 含定时巡检与通知相关动作', () => {
  for (const k of ['schedule.run', 'schedule.config', 'notify.push', 'notify.webhook']) assert.ok(AUDIT_ACTIONS[k], `缺少审计动作 ${k}`)
})

/* ---------------- 汇总 ---------------- */

console.log(`\n内核用例：${pass} 通过 / ${fail} 失败\n`)
if (fail) {
  for (const f of failures) console.log(`  ✖ ${f.name}\n    ${f.message}`)
  console.log('')
  process.exit(1)
}
console.log('全部通过 ✓\n')