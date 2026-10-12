/**
 * E4b 守卫：撤销栈内核。
 *
 * 最关键的一条是**反向补丁按当前值快照**：批量置顶时有些站本来就 pinned，
 * 一律取反会让撤销反而制造新错误。这条必须单独钉死。
 *
 * 运行：node tools/console/test-undo.mjs
 */
import {
  UNDO_MAX, UNDO_TTL, makeStep, pushUndo, dropExpired, topStep, undoPatches, applyUndo
} from '../../src/utils/undoCore.mjs'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? ` → ${extra}` : ''}`) }
  else { failures.push(`${label}${extra ? ` — ${extra}` : ''}`); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`) }
}
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

const T0 = 1_000_000

/** 站点样本：故意做成混合状态（2 个已 pinned、1 个已归档、1 个干净） */
const SITES = [
  { id: 'a', name: 'A', pinned: true, archived: false, categoryId: 'ai' },
  { id: 'b', name: 'B', pinned: false, archived: false, categoryId: 'ai' },
  { id: 'c', name: 'C', pinned: true, archived: false, categoryId: 'tools' },
  { id: 'd', name: 'D', pinned: false, archived: true, categoryId: 'tools' },
  { id: 'e', name: 'E', pinned: false, archived: false, categoryId: 'dev' }
]

console.log('\n▶ E4b 撤销栈内核\n')

/* ── 1. 常量合理性 ── */
ok(UNDO_MAX >= 5 && UNDO_MAX <= 20, 'UNDO_MAX 在 5~20 之间（太短不够用，太长指不清）', String(UNDO_MAX))
ok(UNDO_TTL >= 3000 && UNDO_TTL <= 15000, 'UNDO_TTL 在 3~15 秒之间', String(UNDO_TTL))

/* ── 2. 入栈与上限 ── */
{
  let steps = []
  for (let i = 0; i < 12; i++) {
    steps = pushUndo(steps, makeStep({ label: `第 ${i + 1} 步`, ops: [{ id: 'a', patch: { pinned: true } }], now: T0 + i }))
  }
  eq(steps.length, UNDO_MAX, `连续入 12 步后只留 ${UNDO_MAX} 步`)
  eq(steps[0].label, '第 3 步', '丢的是最旧的（留下第 3~12 步）')
  eq(steps[steps.length - 1].label, '第 12 步', '最新一步在栈顶')
}

/* ── 3. pushUndo 不改原数组（Vue 响应式依赖身份） ── */
{
  const orig = [makeStep({ label: '旧', ops: [], now: T0 })]
  const next = pushUndo(orig, makeStep({ label: '新', ops: [], now: T0 + 1 }))
  eq(orig.length, 1, '原数组长度不变')
  eq(next.length, 2, '返回的新数组多了一步')
  ok(next !== orig, '返回的是新数组（不是原地改）')
}

/* ── 4. 过期清理 ── */
{
  const steps = [
    makeStep({ label: '刚发生', ops: [], now: T0, ttl: 5000 }),
    makeStep({ label: '已过期', ops: [], now: T0 - 9000, ttl: 5000 }),
    makeStep({ label: '边界内', ops: [], now: T0 - 4000, ttl: 5000 })
  ]
  const kept = dropExpired(steps, T0)
  eq(kept.length, 2, '只清掉超过 TTL 的那一步')
  ok(kept.some(s => s.label === '刚发生'), '未过期的不动')
  ok(kept.some(s => s.label === '边界内'), 'TTL 边界内的保留')
  eq(dropExpired([], T0).length, 0, '空栈清完还是空')
  eq(dropExpired(null, T0).length, 0, 'null 不炸')
}

/* ── 5. topStep ── */
{
  eq(topStep([]), null, '空栈顶为 null')
  eq(topStep(null), null, 'null 栈顶为 null')
  const steps = pushUndo([], makeStep({ label: '唯一', ops: [], now: T0 }))
  eq(topStep(steps).label, '唯一', '单步栈顶就是那一步')
}

/* ── 6. 反向补丁按当前值快照（本套件的核心） ── */
{
  // 批量置顶 a/b/e：a 本来就是 pinned，b/e 不是
  const ops = undoPatches(SITES, ['a', 'b', 'e'], { pinned: true, archived: false })
  eq(ops.length, 3, '三个 id 各得一份补丁')
  const byId = Object.fromEntries(ops.map(o => [o.id, o.patch]))
  eq(byId.a.pinned, true, 'a 原本就 pinned → 撤销后仍是 pinned（不是一律取反）')
  eq(byId.b.pinned, false, 'b 原本未置顶 → 撤销后回到未置顶')
  eq(byId.e.pinned, false, 'e 原本未置顶 → 撤销后回到未置顶')
  // 撤销后真的回到原状
  const restored = applyUndo(SITES, ops)
  eq(restored.find(s => s.id === 'a').pinned, true, '撤销后 a 仍是 pinned')
  eq(restored.find(s => s.id === 'b').pinned, false, '撤销后 b 回到未置顶')
  eq(restored.find(s => s.id === 'e').pinned, false, '撤销后 e 回到未置顶')
}

/* ── 7. 归档与置顶互斥的快照 ── */
{
  // d 原本 archived=true：批量置顶它时补丁是 {pinned:true, archived:false}，
  // 反向补丁必须把 archived 恢复成 true
  const ops = undoPatches(SITES, ['d'], { pinned: true, archived: false })
  eq(ops[0].patch.archived, true, 'd 原本已归档 → 撤销后回到已归档')
  eq(ops[0].patch.pinned, false, 'd 原本未置顶 → 撤销后仍未置顶')
  const restored = applyUndo(SITES, ops)
  eq(restored.find(s => s.id === 'd').archived, true, '撤销后 d 仍是归档态')
}

/* ── 8. 不存在的 id 与重复 id ── */
{
  const ops = undoPatches(SITES, ['a', 'nope', 'a', 'b'], { pinned: true })
  eq(ops.length, 2, '不存在的 id 静默忽略，重复 id 只算一次')
  eq(ops.map(o => o.id).join(','), 'a,b', '按传入顺序且去重')
  eq(undoPatches(SITES, [], { pinned: true }).length, 0, '空 id 列表 → 空补丁')
  eq(undoPatches(null, ['a'], { pinned: true }).length, 0, '站点表为 null 不炸')
}

/* ── 9. 站点没有的字段 → 补丁记 undefined（恢复时删字段，不与 false 混淆） ── */
{
  const ops = undoPatches([{ id: 'x' }], ['x'], { pinned: true })
  ok('pinned' in ops[0].patch, '补丁里有 pinned 键')
  eq(ops[0].patch.pinned, undefined, '站点原本没有 pinned → 反向值为 undefined')
}

/* ── 10. applyUndo 只补出现的键，不顺手动其它字段 ── */
{
  const sites = [
    { id: 'a', pinned: true, categoryId: 'ai' },
    { id: 'b', pinned: true, categoryId: 'dev' }
  ]
  // 撤销只带 pinned，不碰 categoryId
  const back = applyUndo(sites, [{ id: 'a', patch: { pinned: false } }])
  eq(back[0].pinned, false, '目标字段被恢复')
  eq(back[0].categoryId, 'ai', '未提到的字段原样保留（不覆盖期间的其它改动）')
  eq(back[1].pinned, true, '不在 ops 里的站点不动')
  ok(back[0] !== sites[0], '被改的站点是新对象（不是原地改）')
  ok(back[1] === sites[1], '未改的站点复用原引用（300 卡 memo 不失效）')
}

/* ── 11. makeStep 的形状 ── */
{
  const s = makeStep({ label: '批量置顶 3 个', ops: [{ id: 'a', patch: { pinned: true } }], now: T0 })
  ok(typeof s.id === 'string' && s.id.length > 0, '步骤有 id')
  eq(s.label, '批量置顶 3 个', 'label 原样保留')
  eq(s.ops.length, 1, 'ops 保留')
  eq(s.expiresAt, T0 + UNDO_TTL, 'expiresAt = now + ttl')
  // ttl 非法时回落到默认
  const s2 = makeStep({ label: 'x', ops: [], now: T0, ttl: -5 })
  eq(s2.expiresAt, T0 + UNDO_TTL, 'ttl 非法时回落到 UNDO_TTL')
  const s3 = makeStep({ label: 'x', ops: [{ id: '' }, null, { id: 'b' }], now: T0 })
  eq(s3.ops.length, 1, 'ops 里的脏项被滤掉')
  // kind 决定撤销时「写回补丁」还是「从回收站还原」，默认必须是 patch
  eq(s.kind, 'patch', 'kind 默认是 patch')
  eq(makeStep({ label: 'x', ops: [], kind: 'restore', now: T0 }).kind, 'restore', 'kind=restore 原样保留')
  eq(makeStep({ label: 'x', ops: [], kind: '乱写', now: T0 }).kind, 'patch', 'kind 非法时回落到 patch')
}

/* ── 12. 穷举：任意组合下撤销都能回到原状 ── */
{
  // 对全部 2^5 种 pinned 组合 × 全部 2^5 种 archived 组合，
  // 批量置顶全部 5 站 → 撤销 → 必须逐站回到原值
  let bad = []
  for (let pm = 0; pm < 32; pm++) {
    for (let am = 0; am < 32; am++) {
      const sites = SITES.map((s, i) => ({
        ...s,
        pinned: Boolean(pm & (1 << i)),
        archived: Boolean(am & (1 << i))
      }))
      const ids = sites.map(s => s.id)
      const ops = undoPatches(sites, ids, { pinned: true, archived: false })
      // 模拟执行：全部置顶、全部退出归档
      const after = sites.map(s => ({ ...s, pinned: true, archived: false }))
      const back = applyUndo(after, ops)
      for (let i = 0; i < sites.length; i++) {
        if (back[i].pinned !== sites[i].pinned || back[i].archived !== sites[i].archived) {
          bad.push(`pm=${pm} am=${am} idx=${i}`)
        }
      }
    }
  }
  eq(bad.length, 0, `穷举 32×32 种初始组合，撤销后全部回到原值`, bad.slice(0, 3).join(' '))
}

console.log('')
if (failures.length) {
  console.error(`❌ E4b 守卫 ${failures.length} 项失败（通过 ${pass} 项）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`✅ E4b 守卫全部通过：${pass} 条断言`)
process.exit(0)
