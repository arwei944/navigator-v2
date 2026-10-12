/**
 * A1 守卫：PWA 新版本提示不许自动刷新。
 *
 * 原实现的全部问题就是「检测到就 reload」，用户正在填表单会被无提示刷新丢掉现场。
 * 这里把四条口径钉死：提示出现了 / 有可点的按钮 / 点了才刷新 / 不会自己刷新。
 *
 * 运行：node tools/console/test-sw-refresh.mjs
 */
import { showRefreshPrompt } from '../../src/utils/swRefresh.mjs'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? ` → ${extra}` : ''}`) }
  else { failures.push(`${label}${extra ? ` — ${extra}` : ''}`); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`) }
}
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

/** 造一个记录调用的 toast stub */
function makeToast() {
  const pushed = []
  return {
    pushed,
    push(t) { pushed.push(t); return pushed.length }
  }
}
/** 造一个计数 reload */
function makeReload() {
  const s = { n: 0 }
  return { spy: s, reload: () => { s.n++ } }
}

console.log('\n▶ A1 PWA 新版本提示\n')

/* ── 1. 提示出现了，且是一条带按钮的提示 ── */
{
  const toast = makeToast()
  const r = makeReload()
  showRefreshPrompt({ push: toast.push, reload: r.reload })
  eq(toast.pushed.length, 1, '检测到新版本时弹出一条提示')
  const t = toast.pushed[0]
  ok(String(t.message || '').length > 0, '提示有文案', t.message)
  eq(t.actionLabel, '刷新', '提示带「刷新」按钮')
  eq(t.tone, 'info', '提示是中性的 info 语气（不是 error）')
  eq(r.spy.n, 0, '**弹提示的这一刻没有刷新**（原实现的 bug）')
}

/* ── 2. 点按钮才刷新，且只刷新一次 ── */
{
  const toast = makeToast()
  const r = makeReload()
  const { refresh } = showRefreshPrompt({ push: toast.push, reload: r.reload })
  eq(r.spy.n, 0, '提示出现时不刷新')
  refresh()
  eq(r.spy.n, 1, '用户点「刷新」后刷新一次')
  refresh()
  eq(r.spy.n, 1, '连点按钮不重复刷新（reload 之后再点没有意义）')
}

/* ── 2b. toast 上的按钮本身就是有效路径（不依赖调用方另调 refresh） ── */
{
  const toast = makeToast()
  const r = makeReload()
  showRefreshPrompt({ push: toast.push, reload: r.reload })
  eq(r.spy.n, 0, '新实例：提示出现时不刷新')
  // 只走 toast 按钮 —— 证明按钮本身连着刷新，不是个装饰
  toast.pushed[0].onAction()
  eq(r.spy.n, 1, '点 toast 上的「刷新」即触发刷新')
  toast.pushed[0].onAction()
  eq(r.spy.n, 1, 'toast 按钮连点也不重复刷新')
}

/* ── 3. 不许自动消失 ── */
{
  const toast = makeToast()
  const { reload } = makeReload()
  showRefreshPrompt({ push: toast.push, reload })
  eq(toast.pushed[0].duration, 0, 'duration 为 0：不自动消失')
  // 倒计时替用户决定「不刷新」与强制刷新一样粗暴，所以这里必须没有正数时长
  ok(!(toast.pushed[0].duration > 0), '没有设置正数倒计时（不让计时器替用户决定）')
}

/* ── 4. 参数缺失要显式报错，而不是静默不提示 ── */
{
  let threw = ''
  try { showRefreshPrompt({ push: () => {} }) } catch (e) { threw = e.message }
  ok(/reload/.test(threw), '缺 reload 时抛错（而不是静默成一个死按钮）', threw)
  let threw2 = ''
  try { showRefreshPrompt({ reload: () => {} }) } catch (e) { threw2 = e.message }
  ok(/push/.test(threw2), '缺 push 时抛错', threw2)
}

/* ── 5. 默认文案可用，也可覆盖 ── */
{
  const toast = makeToast()
  const { reload } = makeReload()
  showRefreshPrompt({ push: toast.push, reload })
  ok(/新版本/.test(toast.pushed[0].message), '默认文案说明「有新版本」', toast.pushed[0].message)
  const toast2 = makeToast()
  showRefreshPrompt({ push: toast2.push, reload, message: '代码已更新' })
  eq(toast2.pushed[0].message, '代码已更新', '文案可覆盖')
}

console.log('')
if (failures.length) {
  console.error(`❌ A1 守卫 ${failures.length} 项失败（通过 ${pass} 项）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`✅ A1 守卫全部通过：${pass} 条断言`)
process.exit(0)
