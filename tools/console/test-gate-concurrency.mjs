/**
 * 门禁：真机门禁的并发安全约定。
 *
 * ## 守什么
 *
 * 门禁是 **4 路并发**执行的。真机门禁（启动服务 + 开 Chrome）如果写法不当，
 * 会表现成「偶发失败」—— 单独跑通过、并发跑失败，且失败形态像功能坏了：
 *
 *   · 断言全「实得 0」（页面没渲染完）
 *   · `Runtime.evaluate` 抛 `Uncaught`（元素不存在）
 *   · 元素存在但点击无效（事件尚未绑定）
 *
 * 这些坑实测都踩过，而且每踩一次都要花一轮排查才能确认「不是功能坏了」。
 * 这道门禁把结论钉住，防止新增门禁时又写回旧模式。
 *
 * ## 三条硬约定
 *
 * 1. **CDP 端口传 `0`**：系统分配。随机区间（`9800 + Math.random()*100`）
 *    各门禁互相重叠，撞端口时浏览器起不来。
 * 2. **SQLite 走 `NAV_STORE_DIR`**（进程独立）：共用 `dist/data/store.db`
 *    会让并发门禁互相污染数据。
 * 3. **不用固定 sleep 等渲染**：改用 `wait-for.mjs` 的 `waitFor` / `clickUntil`。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const GATE_DIR = join(ROOT, 'tools', 'console')

let pass = 0
let fail = 0
const failures = []

function ok(cond, label, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; failures.push(`${label}${extra ? ` — ${extra}` : ''}`); console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`) }
}

function section(t) { console.log(`\n${t}`) }

const gates = readdirSync(GATE_DIR)
  .filter(f => /^test-.*\.mjs$/.test(f))
  .map(f => ({ name: f, src: readFileSync(join(GATE_DIR, f), 'utf-8') }))

/* 只有真的开了浏览器的门禁才受这些约定约束 */
const browserGates = gates.filter(g => /from '\.\/lib\/cdp-driver\.mjs'/.test(g.src))

try {
  section('① CDP 端口必须由系统分配')

  const randomPort = browserGates.filter(g => /port:\s*\d+\s*\+\s*Math\.floor\(Math\.random/.test(g.src))
  ok(randomPort.length === 0,
    '没有门禁用「基准 + 随机」的 CDP 端口（区间重叠会撞端口）',
    randomPort.map(g => g.name).join(', '))

  // 显式固定端口同样有风险：多实例/其它服务可能占用
  const fixedPort = browserGates.filter(g => /launch\(\{[^}]*port:\s*(?!0\b)\d+/.test(g.src))
  ok(fixedPort.length === 0,
    '没有门禁用固定 CDP 端口（应为 port: 0）',
    fixedPort.map(g => g.name).join(', '))

  const usesZero = browserGates.filter(g => /launch\(\{[^}]*port:\s*0/.test(g.src))
  ok(usesZero.length === browserGates.length,
    `所有真机门禁都传 port: 0（${usesZero.length}/${browserGates.length}）`,
    browserGates.filter(g => !/launch\(\{[^}]*port:\s*0/.test(g.src)).map(g => g.name).join(', '))

  section('② 启动服务的门禁必须隔离 SQLite')

  // 判据要精确：只有 **dist/server.js**（SQLite 存储 + cron 巡检）需要隔离。
  // 控制台服务（tools/console/server.mjs）用的是 tools/console/.data，不碰 SQLite，
  // 强加 NAV_STORE_DIR 反而是噪音 —— 第一版门禁就把它误判了。
  const distServers = gates.filter(g =>
    /spawn\(process\.execPath/.test(g.src) && /'server\.js'/.test(g.src))

  const isolated = distServers.filter(g => /NAV_STORE_DIR/.test(g.src))
  ok(distServers.length === isolated.length,
    `启动 dist 服务的门禁都设了 NAV_STORE_DIR（${isolated.length}/${distServers.length}）`,
    distServers.filter(g => !/NAV_STORE_DIR/.test(g.src)).map(g => g.name).join(', '))

  // 还应关掉 cron：每个实例跑 300 站探活会拖慢整个并发池
  const cronOff = distServers.filter(g => /NAV_CRON:\s*'0'/.test(g.src))
  ok(distServers.length === cronOff.length,
    `启动 dist 服务的门禁都关了 cron（${cronOff.length}/${distServers.length}）`,
    distServers.filter(g => !/NAV_CRON:\s*'0'/.test(g.src)).map(g => g.name).join(', '))

  section('③ 不用固定 sleep 等渲染结果')

  // 只看「真机渲染段」：有 launch(...) 之后到文件末尾的那部分
  const sleepBeforeAssert = []
  for (const g of browserGates) {
    const idx = g.src.indexOf('cdp-driver')
    const body = idx >= 0 ? g.src.slice(idx) : g.src
    // 允许：sleep 出现在「重试循环」里（间隔），不允许：紧跟 sleep 就断言
    // 简化判据：真机段里若只用 sleep 而没有 waitFor/clickUntil，就告警
    const hasPolling = /makeWaitFor|makeClickUntil|waitFor\(|clickUntil\(/.test(body)
    // 只看「长等待」（≥1000ms）：短 sleep 是按键/动画间隔，属于合理用法，
    // 把它也算进来只会逼人写无意义的轮询。
    const hasBareSleep = /await (c\.)?sleep\((?:[1-9]\d{3,}|\d{5,})\)/.test(body)
    if (hasBareSleep && !hasPolling) sleepBeforeAssert.push(g.name)
  }
  ok(sleepBeforeAssert.length === 0,
    '真机门禁都有轮询等待（不能只靠固定 sleep）',
    sleepBeforeAssert.join(', '))

  section('③b 路由跳转必须用 goto，不能用 pushState')

  // pushState 只改 URL，不触发 Vue Router 重新解析。首屏还没渲染完时
  // （并发下常见）页面会停在空白 —— 实测 app 内容长度为 0、断言全「实得 0」。
  // goto 是真正的导航，必然触发路由。
  const pushStateGates = browserGates.filter(g => /history\.pushState\([^)]*\)\s*;?\s*window\.dispatchEvent\(new PopStateEvent/.test(g.src))
  ok(pushStateGates.length === 0,
    '没有门禁用 pushState 模拟路由跳转（首屏未就绪时会停在空白）',
    pushStateGates.map(g => g.name).join(', '))

  section('③c 等就绪要落在应用 DOM 上，不能只看 readyState')

  // `document.readyState === 'complete'` 在 about:blank 阶段就成立，
  // 此时页面还没导航到目标地址，紧接着的 eval 会抛
  // 「Execution context was destroyed」。实测在并发下稳定复现。
  const readyStateGates = browserGates.filter(g =>
    /waitFor\(`document\.readyState === 'complete'`\)/.test(g.src))
  ok(readyStateGates.length === 0,
    '没有门禁只用 readyState 判就绪（about:blank 也满足，会撞上下文销毁）',
    readyStateGates.map(g => g.name).join(', '))

  section('④ 共享等待工具存在且可用')

  const waitForSrc = readFileSync(join(GATE_DIR, 'lib', 'wait-for.mjs'), 'utf-8')
  ok(/export function makeWaitFor/.test(waitForSrc), 'wait-for.mjs 导出 makeWaitFor')
  ok(/export function makeClickUntil/.test(waitForSrc), 'wait-for.mjs 导出 makeClickUntil')
  ok(/catch\s*\{/.test(waitForSrc), 'waitFor 内部吞掉「页面未就绪」异常（否则脚本直接崩）')

  section('⑤ 驱动器支持系统分配端口')

  const driverSrc = readFileSync(join(GATE_DIR, 'lib', 'cdp-driver.mjs'), 'utf-8')
  ok(/DevToolsActivePort/.test(driverSrc),
    'cdp-driver 读 DevToolsActivePort（port=0 时靠它拿实际端口）')
  ok(/port === 0 \? await readActivePort/.test(driverSrc),
    'cdp-driver 在 port=0 时走 readActivePort')
  ok(/return \{ client, close, pid: proc\.pid, port: actualPort \}/.test(driverSrc),
    'launch 返回实际端口（便于排障时确认连的是哪个）')
} catch (e) {
  fail++
  failures.push(`执行异常：${e.message}`)
  console.log(`\n✗ 执行异常：${e.message}`)
}

console.log(`\n${fail === 0 ? '⏱' : '❌'} 门禁并发约定：${pass} 通过 / ${fail} 失败`)
if (fail > 0) {
  console.log('失败项：')
  for (const f of failures) console.log(`  ✗ ${f}`)
}
process.exit(fail === 0 ? 0 : 1)
