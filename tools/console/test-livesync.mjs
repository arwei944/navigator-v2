/**
 * 实时通道用例：零依赖、不联网。
 *
 * 这里测的是**真实的 BroadcastChannel 传输层**（Node 18+ 内置该全局），
 * 不是打桩：两个 bus 互发一条消息，验证消息格式、忽略自己、以及合并的幂等性。
 * 打桩就只能验证「我以为它怎么工作」，而这层坏掉的表现恰恰是「两端都以为发出去了」。
 *
 * 运行：node tools/console/test-livesync.mjs
 */
import { LIVE_CHANNEL, createLiveBus, mergeMaps } from '../../src/utils/noteSync.js'

let pass = 0
const failures = []

function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

eq(LIVE_CHANNEL, 'nav-live', '通道名固定（同名才能互通）')

const wait = (ms) => new Promise(r => setTimeout(r, ms))

/** 等到条件成立或超时，避免用固定 sleep 造成偶发失败 */
async function until(fn, timeout = 1500) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (fn()) return true
    await wait(20)
  }
  return false
}

async function main() {
  /* ---------- 两个 bus 互通 ---------- */

  const gotA = []
  const gotB = []
  const busA = createLiveBus((m) => gotA.push(m))
  const busB = createLiveBus((m) => gotB.push(m))

  ok(busA.supported, 'BroadcastChannel 可用时 supported 为真')

  busA.post({ type: 'siteNotes', entries: { s1: { text: 'hi', rev: 1, updatedAt: 1 } } })
  const arrived = await until(() => gotB.length > 0)
  ok(arrived, 'B 收到了 A 发出去的消息')
  eq(gotB[0]?.type, 'siteNotes', '消息类型被原样带过去')
  eq(gotB[0]?.entries?.s1?.text, 'hi', '消息体被原样带过去')
  ok(typeof gotB[0]?.origin === 'string' && gotB[0].origin.length > 0, '消息带发送方标识')
  eq(gotA.length, 0, '发送方不会收自己的消息')

  /* ---------- 合并幂等：重复投递 ---------- */

  const incoming = gotB[0].entries
  const first = mergeMaps({}, incoming)
  ok(first.changed, '首次收到远端条目时 changed')
  const second = mergeMaps(first.merged, incoming)
  ok(!second.changed, '同一条消息再来一次时 changed 为假（可安全重复投递）')

  /* ---------- 双向 ---------- */

  gotA.length = 0
  busB.post({ type: 'notes', entries: { n1: { text: 'x', rev: 1, updatedAt: 2 } } })
  ok(await until(() => gotA.length > 0), 'A 也能收到 B 的消息')

  /* ---------- 关闭后不再投递 ---------- */
  busB.close()
  gotB.length = 0
  busA.post({ type: 'siteNotes', entries: {} })
  await wait(120)
  eq(gotB.length, 0, '关闭后的 bus 不再收到消息')

  busA.close()

  if (failures.length) {
    console.error(`\n❌ 实时通道 ${failures.length} 条断言失败（通过 ${pass} 条）：`)
    failures.forEach(f => console.error('  - ' + f))
    process.exit(1)
  }
  console.log(`\n✅ 实时通道全部通过：${pass} 条断言`)
}

main().catch((e) => {
  console.error('❌ 实时通道用例异常：', e?.message || e)
  process.exit(1)
})
