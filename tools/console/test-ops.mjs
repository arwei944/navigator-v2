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
import net from 'node:net'
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
import { CATEGORY_GROUPS, cloneGroups, sanitizeGroups, diffGroups } from '../../shared/categories.mjs'
import { preflightPublish, summarizePreflight } from '../../shared/ops/preflight.mjs'
import {
  hashPassword, verifyPassword, safeEqual, issueSession, verifySession,
  checkAuthHeader, authConfig, loginLockState, registerFail,
  LOGIN_MAX_FAILS, LOGIN_WINDOW_MS, SESSION_TTL_MS, SESSION_TTL_LONG_MS,
} from '../../shared/auth.mjs'
import { resolveProxyUrl, portOf } from '../../shared/proxy.mjs'
import {
  normalizeIncrements, mergeClicks, tallyClicks, countOf, rankByClicks,
  MAX_BATCH, MAX_STEP,
} from '../../shared/clicks-core.mjs'

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

async function testAsync(name, fn) {
  try {
    await fn()
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

test('AUDIT_ACTIONS 含分类体系管理动作', () => {
  for (const k of ['category.add', 'category.update', 'category.remove', 'category.reorder']) assert.ok(AUDIT_ACTIONS[k], `缺少审计动作 ${k}`)
})

test('AUDIT_ACTIONS 含登录认证动作（服务端登录事件可入账）', () => {
  for (const k of ['auth.login', 'auth.loginFail', 'auth.lockout']) assert.ok(AUDIT_ACTIONS[k], `缺少审计动作 ${k}`)
  const e = normalizeEntry({ action: 'auth.login', target: 'admin', result: 'ok', detail: '来源 1.2.3.4', actor: 'admin' })
  assert.equal(e.actor, 'admin')
  assert.equal(actionLabel(e.action), '登录成功')
})

/* ---------------- categories（云端分类表体检） ---------------- */

test('默认分类表可通过 sanitizeGroups', () => {
  const next = sanitizeGroups(cloneGroups(CATEGORY_GROUPS))
  assert.ok(Array.isArray(next))
  assert.equal(next.length, CATEGORY_GROUPS.length)
})

test('sanitizeGroups 整体拒绝非法结构', () => {
  assert.equal(sanitizeGroups([]), null)
  assert.equal(sanitizeGroups({}), null)
  assert.equal(sanitizeGroups([{ id: 'a', label: 'A', categories: [] }]), null)
  assert.equal(sanitizeGroups([{ id: 'a', label: 'A', categories: [{ id: 'x', label: '' }] }]), null)
  assert.equal(sanitizeGroups([{ id: 'a', label: 'A', categories: [{ id: 'x', label: 'X' }, { id: 'x', label: 'Y' }] }]), null)
  // 域 id 与子分类 id 同轴，重名必须整体拒绝
  assert.equal(sanitizeGroups([{ id: 'a', label: 'A', categories: [{ id: 'a', label: 'X' }] }]), null)
})

test('sanitizeGroups 补齐缺省配色并归一 collapsed', () => {
  const [g] = sanitizeGroups([{ id: 'a', label: 'A', categories: [{ id: 'x', label: 'X' }] }])
  assert.equal(g.categories[0].dotColor, '#64748b')
  assert.equal(g.collapsed, false)
})

test('cloneGroups 是深拷贝，不会污染默认表', () => {
  const copy = cloneGroups(CATEGORY_GROUPS)
  assert.notEqual(copy[0].categories, CATEGORY_GROUPS[0].categories)
  copy[0].categories[0].label = '改名'
  assert.notEqual(CATEGORY_GROUPS[0].categories[0].label, '改名')
})

/* ---------------- auth（登录认证内核） ---------------- */

test('hashPassword / verifyPassword 往返，且拒绝错口令与坏格式', () => {
  const stored = hashPassword('correct horse battery')
  assert.ok(stored.startsWith('scrypt$'))
  assert.equal(verifyPassword('correct horse battery', stored), true)
  assert.equal(verifyPassword('wrong', stored), false)
  assert.equal(verifyPassword('correct horse battery', ''), false)
  assert.equal(verifyPassword('correct horse battery', 'plaintext'), false)
  assert.equal(verifyPassword('correct horse battery', 'scrypt$0$aa$bb'), false)
})

test('相同口令两次哈希不同（加盐），比对结果仍为真', () => {
  const a = hashPassword('same-password')
  const b = hashPassword('same-password')
  assert.notEqual(a, b)
  assert.equal(verifyPassword('same-password', a), true)
  assert.equal(verifyPassword('same-password', b), true)
})

test('safeEqual 长度不同直接判否，不抛错', () => {
  assert.equal(safeEqual('abc', 'abc'), true)
  assert.equal(safeEqual('abc', 'abcd'), false)
  assert.equal(safeEqual('', 'x'), false)
})

test('issueSession / verifySession 往返，并带出用户名与过期时间', () => {
  const now = 1_700_000_000_000
  const { token, expiresAt } = issueSession({ username: 'admin', secret: 'k', ttl: 1000, now })
  assert.equal(expiresAt, now + 1000)
  const r = verifySession(token, 'k', now + 500)
  assert.equal(r.ok, true)
  assert.equal(r.username, 'admin')
})

test('SESSION_TTL_LONG_MS 为 90 天，且签发的会话按该时长过期', () => {
  assert.equal(SESSION_TTL_LONG_MS, 90 * 24 * 60 * 60 * 1000)
  assert.ok(SESSION_TTL_LONG_MS > SESSION_TTL_MS)
  const now = 1_700_000_000_000
  const { token, expiresAt } = issueSession({ username: 'admin', secret: 'k', ttl: SESSION_TTL_LONG_MS, now })
  assert.equal(expiresAt - now, SESSION_TTL_LONG_MS)
  assert.equal(verifySession(token, 'k', now + SESSION_TTL_MS + 1).ok, true) // 7 天后仍有效
  assert.equal(verifySession(token, 'k', now + SESSION_TTL_LONG_MS + 1).reason, 'expired')
})

test('verifySession 拒绝过期、篡改签名与错误密钥', () => {
  const now = 1_700_000_000_000
  const { token } = issueSession({ username: 'admin', secret: 'k', ttl: 1000, now })
  assert.equal(verifySession(token, 'k', now + 1001).reason, 'expired')
  assert.equal(verifySession(token, 'other-secret', now).reason, 'bad-signature')
  const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')
  assert.equal(verifySession(tampered, 'k', now).ok, false)
  assert.equal(verifySession('not-a-token', 'k', now).reason, 'malformed')
  assert.equal(verifySession(token, '').reason, 'no-secret')
})

test('checkAuthHeader 先认会话 token，再回落共享密钥', () => {
  const env = { AUTH_SECRET: 'sig', SITES_ADMIN_KEY: 'key-123', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD_HASH: hashPassword('pw') }
  const { token } = issueSession({ username: 'admin', secret: 'sig' })
  const viaSession = checkAuthHeader({ headers: { authorization: `Bearer ${token}` } }, env)
  assert.equal(viaSession.ok, true)
  assert.equal(viaSession.via, 'session')
  assert.equal(viaSession.username, 'admin')

  const viaKey = checkAuthHeader({ headers: { authorization: 'Bearer key-123' } }, env)
  assert.equal(viaKey.ok, true)
  assert.equal(viaKey.via, 'key')

  assert.equal(checkAuthHeader({ headers: { authorization: 'Bearer nope' } }, env).code, 401)
  assert.equal(checkAuthHeader({ headers: {} }, env).code, 401)
})

test('checkAuthHeader 未配置签名密钥时返回 500 而非放行', () => {
  const r = checkAuthHeader({ headers: { authorization: 'Bearer anything' } }, {})
  assert.equal(r.ok, false)
  assert.equal(r.code, 500)
})

test('authConfig 区分「可登录」与「可密钥直连」', () => {
  const onlyKey = authConfig({ SITES_ADMIN_KEY: 'k' })
  assert.equal(onlyKey.loginReady, false)
  assert.equal(onlyKey.keyReady, true)
  // 签名密钥缺省回退到共享密钥：既有部署零配置即可用上会话能力
  assert.equal(onlyKey.secret, 'k')

  const full = authConfig({ SITES_ADMIN_KEY: 'k', ADMIN_PASSWORD_HASH: 'h', ADMIN_USERNAME: 'root' })
  assert.equal(full.loginReady, true)
  assert.equal(full.username, 'root')
})

test('登录失败累加达阈值即锁定，窗口过后自动解锁', () => {
  const now = 1_700_000_000_000
  let entry
  for (let i = 0; i < LOGIN_MAX_FAILS; i++) entry = registerFail(entry, now)
  assert.equal(entry.fails, LOGIN_MAX_FAILS)
  const locked = loginLockState(entry, now + 1000)
  assert.equal(locked.locked, true)
  assert.ok(locked.retryAfterMs > 0)
  assert.equal(loginLockState(entry, now + LOGIN_WINDOW_MS + 1).locked, false)
})

/* ---------------- diffGroups（分类表对比） ---------------- */

const GROUPS_BEFORE = [
  { id: 'ai', label: 'AI 学习', categories: [{ id: 'starter', label: '入门', dotColor: '#111' }, { id: 'prompt', label: '提示词', dotColor: '#222' }] },
  { id: 'tools', label: '工具', categories: [{ id: 'sms', label: '接码', dotColor: '#333' }] },
]

test('diffGroups 识别域重命名 / 分类新增 / 分类编辑 / 顺序调整', () => {
  const after = [
    { id: 'ai', label: 'AI 学堂', categories: [{ id: 'prompt', label: '提示词', dotColor: '#222' }, { id: 'starter', label: '入门对话', dotColor: '#111' }] },
    { id: 'tools', label: '工具', categories: [{ id: 'sms', label: '接码', dotColor: '#333' }, { id: 'extra', label: '新分类', dotColor: '#444' }] },
  ]
  const d = diffGroups(GROUPS_BEFORE, after)
  assert.deepEqual(d.groupsRenamed.map(g => g.id), ['ai'])
  assert.deepEqual(d.catsAdded.map(c => c.id), ['extra'])
  assert.deepEqual(d.catsUpdated.map(c => c.id), ['starter'])
  assert.deepEqual(d.catsUpdated[0].fields, ['label'])
  assert.equal(d.reordered, true)
  assert.ok(d.total > 0 && d.changed)
})

test('diffGroups 识别域增删与分类跨域迁移', () => {
  const d = diffGroups(
    [{ id: 'a', label: 'A', categories: [{ id: 'x', label: 'X', dotColor: '#1' }] }],
    [{ id: 'b', label: 'B', categories: [{ id: 'x', label: 'X', dotColor: '#1' }] }],
  )
  assert.deepEqual(d.groupsAdded.map(g => g.id), ['b'])
  assert.deepEqual(d.groupsRemoved.map(g => g.id), ['a'])
  assert.deepEqual(d.catsMoved.map(c => c.id), ['x'])
  assert.equal(d.catsMoved[0].from, 'a')
  assert.equal(d.catsMoved[0].to, 'b')
})

test('diffGroups 无改动时 total 为 0', () => {
  const d = diffGroups(GROUPS_BEFORE, GROUPS_BEFORE)
  assert.equal(d.total, 0)
  assert.equal(d.changed, false)
})

/* ---------------- preflight（发布预检） ---------------- */

const PF_GROUPS = [{ id: 'ai', label: 'AI', categories: [{ id: 'starter', label: '入门', dotColor: '#111' }] }]
const pfSites = () => ([
  { id: 's1', name: 'A', url: 'a.com', desc: 'd', categoryId: 'starter', sortOrder: 1 },
])

test('preflight 识别新增站点并给出摘要与线上步骤计划', () => {
  const r = preflightPublish({ cloudSites: [], sites: pfSites(), cloudGroups: [], groups: PF_GROUPS, hasKey: true })
  assert.equal(r.ok, true)
  assert.equal(r.sites.added.length, 1)
  assert.equal(r.changed, true)
  assert.match(r.summary, /新增 1/)
  // 线上后台只能跑「校验 → 热更新 → 验证」三步
  assert.equal(r.plan.length, 3)
})

test('preflight 对会立刻弄坏前台的四种情况一律阻断', () => {
  assert.ok(preflightPublish({ sites: [], groups: PF_GROUPS }).blockers.some(b => b.code === 'emptySites'))

  const orphan = preflightPublish({
    sites: [{ id: 's1', name: 'A', url: 'a.com', categoryId: 'nope', sortOrder: 1 }],
    groups: PF_GROUPS,
  })
  assert.ok(orphan.blockers.some(b => b.code === 'orphanCategory'))
  assert.equal(orphan.ok, false)

  const badTable = preflightPublish({ sites: pfSites(), groups: [{ id: 'a', label: 'A', categories: [] }] })
  assert.ok(badTable.blockers.some(b => b.code === 'invalidCategories'))

  const noKey = preflightPublish({ sites: pfSites(), groups: PF_GROUPS, hasKey: false })
  assert.ok(noKey.blockers.some(b => b.code === 'noKey'))
  assert.equal(noKey.ok, false)
})

test('preflight 把「不理想」降级为警告，不阻断发布', () => {
  const dup = [
    { id: 's1', name: 'A', url: 'a.com', desc: 'd', categoryId: 'starter', sortOrder: 1 },
    { id: 's2', name: 'B', url: 'www.a.com', desc: 'd', categoryId: 'starter', sortOrder: 1 },
  ]
  const r = preflightPublish({ cloudSites: [], sites: dup, groups: PF_GROUPS, hasKey: true })
  assert.equal(r.ok, true)
  assert.ok(r.warnings.some(w => w.code === 'dupHost'))
  assert.ok(r.warnings.some(w => w.code === 'dupSortOrder'))
})

test('preflight 提示空分类，并在无改动时给出 noChanges', () => {
  const groups = [
    { id: 'ai', label: 'AI', categories: [{ id: 'starter', label: '入门', dotColor: '#111' }, { id: 'idle', label: '空分类', dotColor: '#222' }] },
  ]
  const r = preflightPublish({ cloudSites: [], sites: pfSites(), groups, hasKey: true })
  assert.ok(r.warnings.some(w => w.code === 'emptyCategory'))

  const same = preflightPublish({ cloudSites: pfSites(), sites: pfSites(), cloudGroups: PF_GROUPS, groups: PF_GROUPS, hasKey: true })
  assert.equal(same.ok, true)
  assert.equal(same.changed, false)
  assert.ok(same.warnings.some(w => w.code === 'noChanges'))
})

test('summarizePreflight 有阻断时把阻断数写进摘要', () => {
  const s = summarizePreflight({
    siteDiff: { added: [], removed: [], modified: [] },
    catDiff: { total: 0 },
    blockers: [{ code: 'noKey' }],
  })
  assert.match(s, /1 项阻断/)
})

/* ---------------- proxy（本机代理端口自动探测） ---------------- */

test('portOf 从代理 URL 提取端口，非端口结尾返回 null', () => {
  assert.equal(portOf('http://127.0.0.1:7900'), 7900)
  assert.equal(portOf('http://127.0.0.1:7897/'), 7897)
  assert.equal(portOf('socks5://127.0.0.1:1080'), 1080)
  assert.equal(portOf('http://127.0.0.1'), null)
  assert.equal(portOf(''), null)
})

/** 起一个临时监听端口（拿系统分配的端口，避免与真实代理冲突） */
async function listenEphemeral() {
  const server = net.createServer()
  await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res) })
  return { port: server.address().port, close: () => new Promise(res => server.close(res)) }
}

/** 端口是否真的在监听 */
function canConnect(port) {
  return new Promise(resolve => {
    const sock = net.connect({ host: '127.0.0.1', port })
    const done = ok => { sock.destroy(); resolve(ok) }
    sock.setTimeout(300)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
  })
}

/** 临时改写代理环境变量，返回还原函数 */
function withProxyEnv(value) {
  const keys = ['https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY']
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]))
  for (const k of keys) process.env[k] = value
  return () => {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

await testAsync('环境变量端口确实在监听时，原样采用（尊重显式配置）', async () => {
  const { port, close } = await listenEphemeral()
  const restore = withProxyEnv(`http://127.0.0.1:${port}`)
  try {
    assert.equal(await resolveProxyUrl({ force: true }), `http://127.0.0.1:${port}`)
  } finally {
    restore()
    await close()
    await resolveProxyUrl({ force: true })
  }
})

await testAsync('环境变量端口失效时不再沿用该失效端口（免疫端口漂移）', async () => {
  // 借一个「刚释放、必然无人监听」的端口充当滞后的环境变量配置
  const { port: deadPort, close } = await listenEphemeral()
  await close()
  const restore = withProxyEnv(`http://127.0.0.1:${deadPort}`)
  try {
    const url = await resolveProxyUrl({ force: true })
    assert.notEqual(url, `http://127.0.0.1:${deadPort}`)
    if (url) assert.ok(await canConnect(portOf(url)), `返回的代理 ${url} 并未在监听`)
  } finally {
    restore()
    await resolveProxyUrl({ force: true })
  }
})

/* ---------------- clicks-core（点击统计纯规则） ---------------- */

test('normalizeIncrements 丢弃非法项、累加重复 id 并钳制单站点增量', () => {
  const r = normalizeIncrements([
    { id: 'a', n: 1 },
    { id: 'a', n: 2 },
    { id: 'b', count: 3 },     // 兼容 count 字段
    { id: '', n: 5 },          // 空 id 丢弃
    { id: 'c', n: 0 },         // 非正数丢弃
    { id: 'd', n: -4 },        // 负数丢弃
    { id: 'e', n: MAX_STEP + 100 }, // 钳到 MAX_STEP
    null, 'junk', 42,          // 非对象丢弃
  ])
  assert.deepEqual(r.entries, { a: 3, b: 3, e: MAX_STEP })
  assert.equal(r.sites, 3)
  assert.equal(r.total, 3 + 3 + MAX_STEP)
})

test('normalizeIncrements 同 id 累加仍受单站点上限约束', () => {
  const r = normalizeIncrements([{ id: 'a', n: 40 }, { id: 'a', n: 40 }])
  assert.equal(r.entries.a, MAX_STEP)
})

test('normalizeIncrements 空 / 非数组入参返回空结果而非抛错', () => {
  assert.deepEqual(normalizeIncrements(undefined).entries, {})
  assert.deepEqual(normalizeIncrements({}).entries, {})
})

test('normalizeIncrements 受站点数上限约束（截断而非报错）', () => {
  const many = Array.from({ length: MAX_BATCH + 20 }, (_, i) => ({ id: `s${i}`, n: 1 }))
  const r = normalizeIncrements(many)
  assert.equal(r.sites, MAX_BATCH)
})

test('mergeClicks 逐站点累加 prev 与 incoming', () => {
  const merged = mergeClicks({ a: 5, b: 2 }, { a: 3, c: 7 })
  assert.deepEqual(merged, { a: 8, b: 2, c: 7 })
})

test('mergeClicks 传入 known 时剔除已删除站点（含 prev 中的残留）', () => {
  const merged = mergeClicks({ a: 5, gone: 9 }, { b: 1, gone: 4 }, { known: new Set(['a', 'b']) })
  assert.deepEqual(merged, { a: 5, b: 1 })
})

test('mergeClicks 未提供 known 时跳过剔除（读不到站点表宁可多留）', () => {
  assert.deepEqual(mergeClicks({ a: 1 }, { b: 2 }, { known: null }), { a: 1, b: 2 })
})

test('mergeClicks 忽略非正增量，不产生 0 值脏键', () => {
  assert.deepEqual(mergeClicks({ a: 1 }, { a: 0, b: -3 }), { a: 1 })
})

test('tallyClicks 汇总有点击的站点数与总点击量', () => {
  assert.deepEqual(tallyClicks({ a: 3, b: 0, c: 7 }), { sites: 2, total: 10 })
  assert.deepEqual(tallyClicks({}), { sites: 0, total: 0 })
})

test('countOf 缺失 / 非法一律按 0（前端角标不必各写兜底）', () => {
  assert.equal(countOf({ a: 4 }, 'a'), 4)
  assert.equal(countOf({ a: 4 }, 'b'), 0)
  assert.equal(countOf({ a: 'x' }, 'a'), 0)
  assert.equal(countOf(null, 'a'), 0)
})

test('rankByClicks 按点击量降序、同分按名称升序，且不改动入参', () => {
  const sites = [
    { id: 'a', name: 'Beta' },
    { id: 'b', name: 'Alpha' },
    { id: 'c', name: 'Gamma' },
  ]
  const ranked = rankByClicks(sites, { a: 1, b: 1, c: 9 })
  assert.deepEqual(ranked.map(s => s.id), ['c', 'b', 'a'])
  assert.deepEqual(sites.map(s => s.id), ['a', 'b', 'c']) // 原数组顺序不变
})

test('rankByClicks 支持 limit 且缺失点击按 0 参与排序', () => {
  const sites = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]
  assert.deepEqual(rankByClicks(sites, { b: 5 }, { limit: 2 }).map(s => s.id), ['b', 'a'])
})

/* ---------------- 汇总 ---------------- */

console.log(`\n内核用例：${pass} 通过 / ${fail} 失败\n`)
if (fail) {
  for (const f of failures) console.log(`  ✖ ${f.name}\n    ${f.message}`)
  console.log('')
  process.exit(1)
}
console.log('全部通过 ✓\n')