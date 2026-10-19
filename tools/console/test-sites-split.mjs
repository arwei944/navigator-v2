#!/usr/bin/env node
/**
 * sites store 拆分后的纯函数守卫：覆盖层净化 / 回收站三道闸 / 云端错误分类。
 *
 * ## 为什么必须补这道门禁
 *
 * `stores/sites.js` 从 1096 行拆成 787 行 + 三个模块（sitesOverlay / sitesTrash / sitesCloud）。
 * 拆分本身是行为保持的重构，但「行为保持」不能只靠构建通过来证明 ——
 * 构建只检查语法，而这几个函数守的是**数据安全**：
 *
 *   - 覆盖层读盘净化失效 → 一条坏记录让首屏 rebuild 抛错 → 永久白屏
 *   - 回收站字节闸失效   → localStorage 配额被打满 → 覆盖层也写不进去
 *   - 云端错误分类失效   → 把「这个部署没接口」说成「你离线了」，用户去查网络
 *
 * 这三条都曾经是真实缺陷。拆分后它们搬到了新文件里，门禁必须跟着搬，
 * 否则「重构没改行为」就只是一句自我声明。
 *
 * 运行：node tools/console/test-sites-split.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { isOverlaySite, loadOverlay } from '../../src/stores/sitesOverlay.js'
import { pruneTrash, validateTrashSite, oldestTrashIndex, TRASH_MAX_ITEMS, TRASH_MAX_BYTES } from '../../src/stores/sitesTrash.js'
import { CLOUD_FATAL } from '../../src/stores/sitesCloud.js'
import { filterByAxes } from '../../src/stores/sitesFilter.js'
import { rebuildSites } from '../../src/stores/sitesRebuild.js'
import { toggleBatchMode, toggleDragMode, toggleSelection, pruneSelectionSet } from '../../src/stores/sitesSelection.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) pass++
  else failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}

/* ══════════ 1. 覆盖层净化 ══════════ */

ok(isOverlaySite({ id: 's1' }), '合法站点记录被接受')
ok(!isOverlaySite(null), 'null 被拒绝')
ok(!isOverlaySite([]), '数组被拒绝')
ok(!isOverlaySite({ id: '' }), '空 id 被拒绝')
ok(!isOverlaySite({ id: 123 }), '非字符串 id 被拒绝')
ok(!isOverlaySite('s1'), '字符串被拒绝（不是对象）')

/*
 * 坏数据场景：localStorage 里存了被外部改坏的覆盖层。
 * 期望是「过滤坏条目、保住好条目」，而不是整体丢弃或抛错。
 */
const good = { id: 'ok-1', name: '好站点', url: 'example.com' }
globalThis.localStorage = {
  getItem: () =>
    JSON.stringify({
      v: 1,
      data: {
        adds: [good, null, { id: '' }, 'junk', { id: 'ok-2', name: '另一个', url: 'a.com' }],
        edits: { 'ok-1': { name: '改过' }, 'bad-key': null },
        deletes: ['ok-2', '', 42, null],
        order: ['ok-2', null, 7],
        visits: { 'ok-1': 3 },
      },
    }),
}
const ov = loadOverlay()
ok(ov.adds.length === 2, `覆盖层坏条目被过滤（实得 ${ov.adds.length}，期望 2）`)
ok(ov.adds.every(isOverlaySite), '过滤后每条都通过 isOverlaySite')
ok(Array.isArray(ov.deletes) && ov.deletes.length === 1 && ov.deletes[0] === 'ok-2', 'deletes 只保留合法字符串')
ok(Array.isArray(ov.order) && ov.order.length === 1, 'order 只保留合法字符串')
ok(ov.visits['ok-1'] === 3, 'visits 原样保留')

/* ══════════ 2. 回收站三道闸 ══════════ */

const DAY = 24 * 60 * 60 * 1000
const now = 1_700_000_000_000

{
  // 保留期：31 天前清掉，29 天前保留，无时间戳保留
  const list = [
    { id: 'old', deletedAt: now - 31 * DAY },
    { id: 'fresh', deletedAt: now - 29 * DAY },
    { id: 'unknown' },
  ]
  const r = pruneTrash(list, now)
  const ids = r.list.map((s) => s.id).sort()
  ok(r.changed === true, '保留期：确有清理时 changed = true')
  ok(!ids.includes('old'), '保留期：31 天前的条目被清掉')
  ok(ids.includes('fresh'), '保留期：29 天前的条目保留')
  ok(ids.includes('unknown'), '保留期：无时间戳的条目不清（无法判定年龄，宁可留着）')
}

{
  // 条数上限：超出时淘汰最旧的，但保持其余条目的原有顺序
  const list = Array.from({ length: TRASH_MAX_ITEMS + 10 }, (_, i) => ({
    id: `s${i}`,
    deletedAt: now - i * 1000,
  }))
  const r = pruneTrash(list, now)
  ok(r.list.length === TRASH_MAX_ITEMS, `条数闸：裁到 ${TRASH_MAX_ITEMS}（实得 ${r.list.length}）`)
  ok(r.list[0].id === 's0', '条数闸：最新的一条仍在最前')
  ok(!r.list.some((s) => s.id === `s${TRASH_MAX_ITEMS + 5}`), '条数闸：最旧的被淘汰')
  // 顺序保持：裁完的顺序应与原数组的子序列一致
  const origOrder = list.filter((s) => r.list.some((x) => x.id === s.id)).map((s) => s.id)
  ok(JSON.stringify(origOrder) === JSON.stringify(r.list.map((s) => s.id)), '条数闸：裁剪后保持原有先后顺序')
}

{
  // 空数组与全合法输入：不该报 changed
  ok(pruneTrash([], now).changed === false, '空回收站：changed = false')
  const same = [{ id: 'a', deletedAt: now - DAY }]
  ok(pruneTrash(same, now).changed === false, '未超阈值的回收站：changed = false（避免白写盘）')
}

{
  // oldestTrashIndex：无时间戳视为最「新」（Infinity），只有全无时间戳时才回落到 0
  const list = [{ id: 'a' }, { id: 'b', deletedAt: now - DAY }, { id: 'c', deletedAt: now - 2 * DAY }]
  ok(oldestTrashIndex(list) === 2, 'oldestTrashIndex 找到真正最旧的一条')
  ok(oldestTrashIndex([{ id: 'x' }, { id: 'y' }]) === 0, '全无时间戳时回落到 0')
}

/* ══════════ 3. 恢复前校验 ══════════ */

ok(validateTrashSite({ id: 'a', name: 'A', url: 'https://example.com' }) === '', '合法记录校验通过')
ok(validateTrashSite(null) === '记录已损坏', 'null → 记录已损坏')
ok(validateTrashSite({ name: 'A', url: 'example.com' }) === '缺少站点 id', '缺 id 报得出来')
ok(validateTrashSite({ id: 'a', url: 'example.com' }) === '缺少站点名称', '缺 name 报得出来')
ok(validateTrashSite({ id: 'a', name: 'A' }) === '缺少站点地址', '缺 url 报得出来')
ok(validateTrashSite({ id: 'a', name: 'A', url: '' }) === '缺少站点地址', '空 url 报得出来')
ok(
  validateTrashSite({ id: 'a', name: 'A', url: 'not a url' }).startsWith('站点地址无法解析出域名'),
  '解析不出域名的地址被拒绝（否则恢复后会污染去重/图谱）',
)

/* ══════════ 4. 云端错误分类 ══════════ */

ok(CLOUD_FATAL.has('http-402'), '402 被判定为不可恢复（重试只会继续消耗额度）')
ok(CLOUD_FATAL.has('http-404'), '404 被判定为不可恢复（这个部署没有接口）')
ok(CLOUD_FATAL.has('invalid-payload'), '非 JSON 响应被判定为不可恢复')
ok(!CLOUD_FATAL.has('offline'), 'offline 不属于不可恢复（联网后会自愈）')
ok(!CLOUD_FATAL.has('timeout'), 'timeout 不属于不可恢复（弱网会自愈）')
ok(!CLOUD_FATAL.has(''), '空错误码不属于不可恢复')

/* ══════════ 5. 拆分后的结构不变量 ══════════ */

const storeSrc = readFileSync(join(ROOT, 'src/stores/sites.js'), 'utf-8')
ok(!/function fetchCloud\s*\(/.test(storeSrc), 'sites.js 不再自带 fetchCloud（已搬到 sitesCloud.js）')
ok(!/TRASH_MAX_BYTES/.test(storeSrc), 'sites.js 不再自带回收站阈值（已搬到 sitesTrash.js）')
ok(!/function isOverlaySite/.test(storeSrc), 'sites.js 不再自带覆盖层判定（已搬到 sitesOverlay.js）')
ok(/createCloudSync\(/.test(storeSrc), 'sites.js 通过 createCloudSync 接线云端同步')
ok(/rebuildSites\(/.test(storeSrc), 'sites.js 通过 rebuildSites 拼装渲染列表')
ok(/createSiteMutations\(/.test(storeSrc), 'sites.js 通过 createSiteMutations 处理本地改动')
ok(!/function buildComparators/.test(storeSrc), 'sites.js 不再自带排序比较器（已搬到 sitesFilter.js）')

/* ══════════ 6. 拆分出的纯函数行为（sitesFilter / sitesRebuild / sitesSelection） ══════════ */

{
  const cats = {
    isDomainScope: (v) => v === 'ai',
    categoriesOfDomain: (v) => (v === 'ai' ? [{ id: 'starter' }, { id: 'coding' }] : []),
  }
  const list = [
    { id: 'a', categoryId: 'starter', purposes: ['learning'] },
    { id: 'b', categoryId: 'coding', purposes: ['coding'] },
    { id: 'c', categoryId: 'cex', purposes: [] },
    { id: 'd', categoryId: 'starter', purposes: [], archived: true },
  ]
  ok(filterByAxes(list, { archivedScope: false, category: 'all', purpose: 'all' }, cats).map((s) => s.id).join(',') === 'a,b,c',
    '归档站在非归档范围里一律不可见')
  ok(filterByAxes(list, { archivedScope: true, category: 'all', purpose: 'all' }, cats).map((s) => s.id).join(',') === 'd',
    '归档范围里只看得到归档站')
  ok(filterByAxes(list, { archivedScope: false, category: 'ai', purpose: 'all' }, cats).map((s) => s.id).join(',') === 'a,b',
    '整域筛选命中该域下全部子分类')
  ok(filterByAxes(list, { archivedScope: false, category: 'coding', purpose: 'all' }, cats).map((s) => s.id).join(',') === 'b',
    '单子分类筛选只命中该分类')
  ok(filterByAxes(list, { archivedScope: false, category: 'all', purpose: 'learning' }, cats).map((s) => s.id).join(',') === 'a',
    '用途筛选跨分类生效')
}

{
  const cloud = [{ id: 's1', name: 'A' }, { id: 's2', name: 'B' }]
  const first = rebuildSites({
    cloudSites: cloud, localAdds: [], localEdits: {}, localDeletes: [], localOrder: [], visits: {}, prevMemo: new Map(), prevList: [],
  })
  ok(first.list.length === 2, '重建：基底两条全部产出')

  // 输入完全没变 → 必须复用同一批对象、同一数组引用
  const second = rebuildSites({
    cloudSites: cloud, localAdds: [], localEdits: {}, localDeletes: [], localOrder: [], visits: {}, prevMemo: first.memo, prevList: first.list,
  })
  ok(second.list === first.list, '重建：无变化时数组引用不变（省掉整趟 300 卡 diff）')
  ok(second.list[0] === first.list[0], '重建：无变化时单条对象引用不变（子组件可跳过更新）')

  // 只有 s1 的补丁变了 → s2 必须复用，s1 必须换新
  const withEdit = rebuildSites({
    cloudSites: cloud, localAdds: [], localEdits: { s1: { name: 'A2' } }, localDeletes: [], localOrder: [], visits: {}, prevMemo: second.memo, prevList: second.list,
  })
  ok(withEdit.list[1] === second.list[1], '重建：未变的 s2 复用原对象')
  ok(withEdit.list[0] !== second.list[0], '重建：改过的 s1 产出新对象')
  ok(withEdit.list[0].name === 'A2', '重建：补丁生效')

  // 墓碑过滤
  const withDel = rebuildSites({
    cloudSites: cloud, localAdds: [], localEdits: {}, localDeletes: ['s1'], localOrder: [], visits: {}, prevMemo: new Map(), prevList: [],
  })
  ok(withDel.list.map((s) => s.id).join(',') === 's2', '重建：墓碑生效（删掉的站不出现）')
}

{
  const base = { batchMode: false, dragEnabled: true, selectedIds: new Set(['x']) }
  const r1 = toggleBatchMode(base)
  ok(r1.batchMode === true && r1.dragEnabled === false, '进入批量模式会关闭拖拽（两者互斥）')
  ok(r1.selectedIds.size === 1, '进入批量模式不清空已有选择')
  const r2 = toggleBatchMode({ ...r1, batchMode: true })
  ok(r2.batchMode === false && r2.selectedIds.size === 0, '退出批量模式清空选择')

  const r3 = toggleDragMode({ batchMode: true, dragEnabled: false, selectedIds: new Set(['x']) })
  ok(r3.dragEnabled === true && r3.batchMode === false && r3.selectedIds.size === 0, '进入拖拽模式关闭批量并清空选择')

  const s = toggleSelection(new Set(['a']), 'b')
  ok(s.has('a') && s.has('b'), '勾选追加')
  const s2 = toggleSelection(s, 'a')
  ok(!s2.has('a') && s2.has('b'), '再次勾选即取消')

  const sel = new Set(['a', 'b'])
  ok(pruneSelectionSet(sel, ['a']).size === 1, '选择集收敛到可见集')
  ok(pruneSelectionSet(sel, ['a', 'b']) === sel, '全部可见时返回同一引用（不白建 Set）')
  const emptySel = new Set()
  ok(pruneSelectionSet(emptySel, ['a']) === emptySel, '空选择集原引用返回（不白建 Set）')
}

const cloudSrc = readFileSync(join(ROOT, 'src/stores/sitesCloud.js'), 'utf-8')
ok(/If-None-Match/.test(cloudSrc), 'sitesCloud.js 保留条件请求（304 省流量）')
ok(/Content-Type/.test(cloudSrc), 'sitesCloud.js 保留 Content-Type 判定（防 SPA 兜底页被当成 JSON）')
ok(/v <= getVersion\(\)/.test(cloudSrc), 'sitesCloud.js 保留「版本必须单调递增」判据')

/* ══════════ 报告 ══════════ */

console.log(`\n🧩 sites 拆分守卫：${pass} 通过 / ${failures.length} 失败`)
if (failures.length) {
  for (const f of failures) console.log(`   ❌ ${f}`)
  process.exit(1)
}
console.log('   ✅ 覆盖层净化 / 回收站三闸 / 恢复校验 / 云端错误分类 / 拆分结构 全部符合预期')
