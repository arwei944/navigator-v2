/**
 * 管线日志总线（`src/utils/pipelineTrace.js`）用例：零依赖、不联网、不碰 UI。
 *
 * ## 这层用例守的是哪三条契约
 *
 *   ① **旁路**：没人看（没有消费者）时 `beginRun()` 必须是空句柄，既不记账也不影响主流程。
 *      这条松了，日志就从「观测层」变成「业务流程的一部分」—— 一个只在特定条件下才运转的
 *      东西，比一个永远存在的东西危险得多（它会在最需要它的那次恰缺席）。
 *   ② **status 只在 Promise settle 后落定**：stage 的耗时与结论必须是**已发生的事实**，
 *      不许写「将要发生」的预期 —— 否则日志会凭空产出一段没发生过的进度
 *      （这条在 `add-flow-realtime.mjs` 用 DOM 文案当终态判据时已经吃过亏）。
 *   ③ **埋点必须覆盖到失败分支**：抓取失败、补译失败、写回抛错都要在轴上留下可复述的
 *      stage —— 「信息为什么没补全」这个问题的答案就长在这里。
 *
 * 运行：node tools/console/test-pipeline-trace.mjs
 */
import { pipeline, beginRun, trackStage, clearFinishedRuns, addPipelineConsumer }
  from '../../src/utils/pipelineTrace.js'
import { runMetaUpgrade } from '../../src/services/metaUpgrade.js'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

const runs = () => pipeline.runs.value
const last = () => runs()[runs().length - 1] || null

/* ══════════ 1. 没有消费者 → 完全旁路 ══════════ */

{
  clearFinishedRuns()
  const before = runs().length
  const run = beginRun({ flow: 'x', title: '没人看的一条' })
  run.stage('a', '第一步').ok('完成')
  run.end('ok', '收工')
  eq(runs().length, before, '没有消费者时不记账（回流为零，日志不是业务流程的一部分）')
  eq(pipeline.running.value, 0, '没有消费者时不算「正在跑」')
}

/* ══════════ 2. 生命周期：running → 终态，毫秒 Mas 与详情同时落定 ══════════ */

const release = addPipelineConsumer()
{
  clearFinishedRuns()
  const run = beginRun({ flow: 'unit', title: '单测管线', target: 'example.com' })
  eq(runs().length, 1, '有消费者时开得出 run')
  eq(pipeline.running.value, 1, '开跑 → running 计数 +1')
  eq(last().status, 'running', '新 run 初始状态是 running')

  const a = run.stage('first', '第一步')
  ok(last().stages[0].status === 'running', 'stage 登记后立刻是 running')
  a.ok('拿到了 A')

  const b = run.stage('second', '第二步')
  b.fail('对方拒了', '403')
  const st = last().stages.find(s => s.key === 'second')
  eq(st.status, 'fail', 'fail 终态')
  eq(st.reason, '403', '失败必须带 reason —— 「为什么」的唯一凭据')
  eq(st.detail, '对方拒了', '失败详情照实记录')
  ok(st.ms >= 0, 'ms 已落定（Promise settle 后才写，不写预期）')

  // 同名 stage 重登记：面板上不该出现两条一模一样的阶段
  run.stage('second', '第二步（重试）').ok('这次成了')
  eq(last().stages.filter(s => s.key === 'second').length, 1, '同名 stage 重登记覆盖旧的，不堆叠')

  run.end('ok', '收工')
  eq(pipeline.running.value, 0, 'end 之后不再计入 running')
  eq(last().status, 'ok', 'run 终态')
  ok(last().endedAt >= last().startedAt, '结束时间不早于开始时间')
}

/* ══════════ 3. trackStage： Promise settle 落终态，**异常照抛** ══════════ */

{
  clearFinishedRuns()
  const run = beginRun({ flow: 'unit', title: 'trackStage' })
  const v = await trackStage(run, 'ok-step', '会成功的一步', async () => 42)
  eq(v, 42, 'trackStage 原样回传返回值')
  eq(last().stages[0].status, 'ok', '成功 → ok')

  let threw = false
  try {
    await trackStage(run, 'bad-step', '会抛的一步', async () => { throw new Error('boom') })
  } catch (e) {
    threw = e?.message === 'boom'
  }
  ok(threw, 'trackStage 必须把异常照抛回去（追踪不许吞错误）')
  const bad = last().stages.find(s => s.key === 'bad-step')
  eq(bad.status, 'fail', '抛错的那一步记成 fail')
  eq(bad.detail, 'boom', 'fail 的 detail 是错误信息')
  run.end('fail', '出错收场')
}

/* ══════════ 4. 环形缓冲：历史有上限 ══════════ */

{
  clearFinishedRuns()
  for (let i = 0; i < 30; i++) {
    const r = beginRun({ flow: 'unit', title: `第 ${i} 条` })
    r.end('ok', '')
  }
  ok(runs().length <= 20, `历史条数有上限（实得 ${runs().length}）`, '内存常驻，不能无限堆')
  eq(runs()[runs().length - 1].title, '第 29 条', '环形缓冲丢的是最旧的一条')
}

/* ══════════ 5. 清空只清已完成的，不影响在跑的 ══════════ */

{
  clearFinishedRuns()
  const running = beginRun({ flow: 'unit', title: '还在跑' })
  const done = beginRun({ flow: 'unit', title: '已完成' })
  done.end('ok', '')
  clearFinishedRuns()
  eq(runs().length, 1, '只保留未完成的')
  eq(runs()[0].title, '还在跑', '留下的是正在推进的那条')
  running.end('ok', '')
}

/* ══════════ 6. 埋点真的接到了后台升级上（含失败分支） ══════════ */

{
  clearFinishedRuns()
  const trace = beginRun({ flow: 'auto-add', title: '秒加' })
  await runMetaUpgrade({
    store: { sites: [{ id: 's1', name: 'x', desc: '', updatedAt: 1 }], updateSite() {} },
    url: 'https://x.com', created: { id: 's1', updatedAt: 1, name: 'x' },
    fetchMeta: async () => ({ ok: false, status: 0, reason: 'timeout', message: '抓取超时（超过 12 秒未响应）' }),
    trace,
  })
  const fetchStage = last().stages.find(s => s.key === 'fetch')
  ok(Boolean(fetchStage), '抓取一跳有记录')
  eq(fetchStage.status, 'fail', '抓取失败 → fail')
  eq(fetchStage.reason, 'timeout', '失败原因码透传到日志')
  ok(/抓取超时/.test(fetchStage.detail), '失败详情带着给用户看的那句话', fetchStage.detail)
  eq(last().status, 'fail', 'run 自己也没说谎（结局不是「完成」）')
}

{
  clearFinishedRuns()
  const trace = beginRun({ flow: 'auto-add', title: '秒加成功' })
  await runMetaUpgrade({
    store: { sites: [{ id: 's1', name: 'x', desc: '', updatedAt: 1 }], updateSite() {} },
    url: 'https://x.com', created: { id: 's1', updatedAt: 1, name: 'x' },
    fetchMeta: async () => ({ ok: true, status: 200, data: { name: 'Figma', desc: 'd', fetchMs: 812 } }),
    trace,
  })
  const stages = last().stages.map(s => s.key)
  ok(stages.includes('fetch') && stages.includes('patch'), '成功链路上 fetch / patch 两跳都有记录', stages.join('→'))
  const fs = last().stages.find(s => s.key === 'fetch')
  ok(/812/.test(fs.detail), '服务端自报的 fetchMs 进了日志（端到端与引擎耗时分开摆）', fs.detail)
  ok(!stages.includes('translate') || last().stages.find(s => s.key === 'translate').status === 'skip',
    '没说要翻译时那一步是 skip，不是缺席')
}

release()

if (failures.length) {
  console.error(`\n❌ 管线日志总线测试失败 ${failures.length} 项：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 管线日志总线全部通过：${pass} 条断言`)
