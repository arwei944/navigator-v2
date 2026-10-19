#!/usr/bin/env node
/**
 * test-all —— `console:test:all` 的分组并行执行器。
 *
 * ## 为什么不再是一条 98 段的 `&&` 长链
 *
 * 旧形态有两个实际代价，都在 2026-10 真实发生过：
 *
 * 1. **单点中断**：`a && b && c` 里第 7 道失败，后面 91 道根本不跑。
 *    新增一道门禁忘了归类 / 写错路径，全链直接断在它那里（`fix(gate)` 提交就是这么来的），
 *    而真正想知道的是「其余门禁还绿不绿」。
 * 2. **串行等满**：总耗时 81 秒，其中 `test-mcp` 一道占 34.6 秒。它跑的时候其余 97 道在排队。
 *
 * ## 现在的形态
 *
 * 按 `gate-index.json` 的域分组，**域内串行、域间并行**：
 *
 *   - 域内串行：域是逻辑归属，同域脚本常有隐含顺序（数据 → 引擎 → 接口），不赌它们无依赖。
 *   - 域间并行：各域写各自临时目录、监听各自端口，互不共享状态。
 *   - 失败隔离：某域失败只终止该域，其余域照常跑完；最后统一汇总并以非 0 退出。
 *
 * ## 为什么仍然从 gate-index 取清单
 *
 * 命令清单的唯一真相源是 `tools/gate-registry`（台账校验「每道门禁都已接入」正是靠它）。
 * 执行器若自带一份数组，两处必然漂移。所以这里**只读台账**，不维护第二份。
 * 台账由 `node tools/gate-registry/cli.mjs index` 生成，`check` 会校验它与实际脚本一致。
 *
 * ## 用法
 *
 *   node tools/console/run-all-gates.mjs                 # 全部域，并行
 *   node tools/console/run-all-gates.mjs --domain 部署与发布,文档治理
 *   node tools/console/run-all-gates.mjs --only test-mcp,test-hygiene
 *   node tools/console/run-all-gates.mjs --jobs 4        # 同时跑几个域（默认 4）
 *   node tools/console/run-all-gates.mjs --serial        # 退回串行（排查顺序依赖时用）
 *   node tools/console/run-all-gates.mjs --list          # 只打印将要执行的清单
 *
 * 退出码：0 全绿 / 1 有门禁失败 / 2 台账或用法问题。
 *
 * ## 新增门禁时怎么接
 *
 * 1. 写 `tools/console/test-xxx.mjs`（或 `tools/mcp/test-xxx.mjs`）；
 * 2. 跑 `node tools/gate-registry/cli.mjs index` 更新台账；
 * 3. 跑 `node tools/gate-registry/cli.mjs check`，它会告诉你有没有漏接。
 *
 * 不需要再手改 package.json 里那条长链。
 */
import { spawn } from 'node:child_process'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const LEDGER = join(ROOT, 'tools/gate-registry/gate-index.json')

/* ---------------- 参数 ---------------- */

function parseArgs(argv) {
  const out = { jobs: 4, serial: false, list: false, domain: null, only: null, verbose: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--serial') out.serial = true
    else if (a === '--list') out.list = true
    else if (a === '--verbose' || a === '-v') out.verbose = true
    else if (a === '--jobs') out.jobs = Math.max(1, Number(argv[++i]) || 4)
    else if (a.startsWith('--jobs=')) out.jobs = Math.max(1, Number(a.slice(7)) || 4)
    else if (a === '--domain') out.domain = splitList(argv[++i])
    else if (a.startsWith('--domain=')) out.domain = splitList(a.slice(9))
    else if (a === '--only') out.only = splitList(argv[++i])
    else if (a.startsWith('--only=')) out.only = splitList(a.slice(7))
    else if (a === '--help' || a === '-h') out.help = true
    else {
      console.error(`未知参数：${a}`)
      out.help = true
    }
  }
  return out
}

const splitList = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean)

/* ---------------- 台账 ---------------- */

function loadGates() {
  if (!existsSync(LEDGER)) {
    console.error(`❌ 找不到门禁台账：${LEDGER}`)
    console.error('   → 先跑 node tools/gate-registry/cli.mjs index')
    process.exit(2)
  }
  const raw = JSON.parse(readFileSync(LEDGER, 'utf-8'))
  const gates = Array.isArray(raw) ? raw : raw.gates || []
  /*
   * 只跑**已接入**的门禁。台账里可能暂时存在未接入项（刚建还没索引），
   * 那属于台账 check 该报的问题，不该让执行器替它决定要不要跑。
   */
  return gates.filter((g) => g && g.file && g.included !== false)
}

/**
 * 台账覆盖性自检：磁盘上有、台账里没有的门禁脚本，必须报出来。
 *
 * 这一条是实测踩出来的：新写一个 `test-xxx.mjs` 后忘了跑 `gate:index`，
 * 执行器只读台账 —— 新门禁**根本没被执行**，却仍然打印「97 道全绿」。
 * 那是最坏的一种假绿：门禁存在、看起来在跑、其实没跑。
 *
 * 所以清单从「台账里有什么」扩成「目录里有什么 ∪ 台账里有什么」：
 * 有脚本没台账 → 立刻失败并提示重新索引，绝不静默跳过。
 */
function findUnindexed(gates) {
  const known = new Set(gates.map((g) => g.file))
  const found = []
  for (const [dir, re] of [
    ['tools/console', /^test-.*\.mjs$/],
    ['tools/mcp', /^test-.*\.mjs$/],
  ]) {
    const abs = join(ROOT, dir)
    if (!existsSync(abs)) continue
    for (const name of readdirSync(abs)) {
      if (!re.test(name)) continue
      const rel = `${dir}/${name}`
      if (!known.has(rel)) found.push(rel)
    }
  }
  return found
}

function groupByDomain(gates) {
  const map = new Map()
  for (const g of gates) {
    const key = g.category || '未分类'
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(g)
  }
  return map
}

/* ---------------- 执行 ---------------- */

/** 跑一个门禁脚本，返回 {gate, ok, ms, code, tail} */
function runGate(gate) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    /*
     * nodeFlags 来自台账（由 package.json 原链解析而来），不是执行器自己决定的。
     * 例：test-api-ops 需要 `--experimental-test-module-mocks` 才能在隔离环境里 mock 依赖；
     * 漏传会让它去碰真实模块 —— 门禁看似通过，实际测的是另一件事。
     */
    const child = spawn(process.execPath, [...(gate.nodeFlags || []), join(ROOT, gate.file)], {
      cwd: ROOT,
      windowsHide: true,
      env: { ...process.env, NAV_GATE_RUNNER: 'test-all' },
    })
    let out = ''
    const cap = (chunk) => {
      out += String(chunk)
      // 只保留尾部：失败时给上下文，成功时不占内存
      if (out.length > 64 * 1024) out = out.slice(-32 * 1024)
    }
    child.stdout.on('data', cap)
    child.stderr.on('data', cap)
    child.on('error', (e) => {
      resolve({ gate, ok: false, ms: Date.now() - t0, code: -1, tail: String(e.message) })
    })
    child.on('close', (code) => {
      resolve({ gate, ok: code === 0, ms: Date.now() - t0, code, tail: out })
    })
  })
}

/** 域内串行；某道失败后仍继续跑完本域，以便一次看到该域全部失败 */
async function runDomain(name, gates, { verbose }) {
  const results = []
  for (const g of gates) {
    const r = await runGate(g)
    results.push(r)
    const mark = r.ok ? '✅' : '❌'
    const secs = (r.ms / 1000).toFixed(2)
    if (!r.ok || verbose) {
      console.log(`  ${mark} ${g.name}（${secs}s）— ${name}`)
    }
    if (!r.ok) {
      const tail = r.tail.trim().split(/\r?\n/).slice(-12).join('\n')
      if (tail) console.log(`\n${tail.replace(/^/gm, '     ')}\n`)
    }
  }
  return results
}

/**
 * 组件级调度：按台账记录的耗时做「最长优先」装箱，把门禁尽量均匀地分到 N 个槽。
 *
 * ## 为什么不再「按域分组并行」
 *
 * 域内串行的假设是「同域脚本可能有隐含顺序」，但 97 道门禁里没有任何一道依赖另一道
 * 的执行结果（各自 mkdtemp、各自占端口）。按域分组的真实效果是**被最大的域拖住**：
 * 「前端与体验」28 道串行 ≈ 20s，而「文档治理」2 道 1s 就跑完了 —— 8 个域、4 个并发，
 * 总时长仍由最长的那个域决定（实测 61.9s，只比串行 80.9s 好一点）。
 *
 * 改成组件级装箱后，每个槽的累计耗时接近 total/jobs，实测降到 26s 量级。
 * 耗时取自台账（`gate-index.json` 的 `durationMs`）；没有记录的新门禁按中位数估，
 * 只会略微影响均衡度，不影响正确性。
 *
 * ## 依赖关系怎么表达
 *
 * 若将来真有门禁必须排在另一道之后，不要靠「同域串行」这种隐式约定 ——
 * 那样整个域都会被拖成串行。直接在台账里加显式依赖并在这里按拓扑执行，
 * 但那需要先有真实用例，现在不预造机制。
 */
function planSlots(gates, jobs) {
  const weights = gates.map((g) => (Number.isFinite(g.durationMs) && g.durationMs > 0 ? g.durationMs : 500))
  const order = gates.map((g, i) => ({ g, w: weights[i] })).sort((a, b) => b.w - a.w)
  const slots = Array.from({ length: Math.min(jobs, gates.length) }, () => ({ load: 0, gates: [] }))
  for (const item of order) {
    // 最长优先 + 放到当前最空的槽：经典 LPT 装箱，最差也在 4/3 × 下界内
    const target = slots.reduce((min, s) => (s.load < min.load ? s : min), slots[0])
    target.gates.push(item.g)
    target.load += item.w
  }
  return slots
}

/** 每个槽串行执行（同一槽内的脚本仍逐道等待，避免并发写同一台账/端口池） */
async function runSlots(slots, { verbose }) {
  const results = []
  await Promise.all(
    slots.map(async (slot, i) => {
      if (verbose) console.log(`  槽 ${i + 1}：${slot.gates.length} 道，预估 ${(slot.load / 1000).toFixed(1)}s`)
      for (const g of slot.gates) {
        const r = await runGate(g)
        results.push(r)
        const mark = r.ok ? '✅' : '❌'
        const secs = (r.ms / 1000).toFixed(2)
        if (!r.ok || verbose) {
          console.log(`  ${mark} ${g.name}（${secs}s）`)
        }
        if (!r.ok) {
          const tail = r.tail.trim().split(/\r?\n/).slice(-12).join('\n')
          if (tail) console.log(`\n${tail.replace(/^/gm, '     ')}\n`)
        }
      }
    }),
  )
  return results
}

/* ---------------- 入口 ---------------- */

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  console.log(`console:test:all 分组并行执行器

用法：node tools/console/run-all-gates.mjs [选项]

  --domain <a,b>   只跑指定域（名称取自 gate-index.json）
  --only <a,b>     只跑指定脚本名（不含 .mjs）
  --jobs <n>       域间并发数，默认 4
  --serial         串行执行全部域
  --list           只打印清单，不执行
  --verbose        成功项也逐条打印
`)
  process.exit(0)
}

let gates = loadGates()

/*
 * 覆盖性自检放在筛选之前：新脚本没进台账，是清单本身出了问题，
 * 不该因为本次只跑某个域就放过去。
 */
const unindexed = findUnindexed(gates)
if (unindexed.length) {
  console.error(`❌ 台账缺少 ${unindexed.length} 道门禁（它们不会被执行）：`)
  for (const f of unindexed) console.error(`   - ${f}`)
  console.error('   → 跑 node tools/gate-registry/cli.mjs index 后重试')
  process.exit(2)
}

if (args.domain) {
  const want = new Set(args.domain)
  gates = gates.filter((g) => want.has(g.category))
  const got = new Set(gates.map((g) => g.category))
  const missing = [...want].filter((d) => !got.has(d))
  if (missing.length) {
    console.error(`❌ 没有匹配到域：${missing.join(', ')}`)
    process.exit(2)
  }
}

if (args.only) {
  const want = new Set(args.only)
  gates = gates.filter((g) => want.has(g.name))
  const got = new Set(gates.map((g) => g.name))
  const missing = [...want].filter((n) => !got.has(n))
  if (missing.length) {
    console.error(`❌ 没有匹配到脚本：${missing.join(', ')}`)
    process.exit(2)
  }
}

if (!gates.length) {
  console.error('❌ 筛选后没有要执行的门禁')
  process.exit(2)
}

const domains = groupByDomain(gates)

if (args.list) {
  for (const [name, list] of domains) {
    console.log(`\n[${name}] ${list.length} 道`)
    for (const g of list) console.log(`  ${g.name}`)
  }
  console.log(`\n合计 ${gates.length} 道 / ${domains.size} 个域`)
  process.exit(0)
}

const t0 = Date.now()
console.log(
  `\n🧪 门禁执行：${gates.length} 道 / ${domains.size} 个域（${
    args.serial ? '串行' : `按耗时装箱、${Math.min(args.jobs, gates.length)} 路并发`
  }）`,
)
console.log(`   域：${[...domains.keys()].join(' · ')}\n`)

let results
if (args.serial) {
  results = []
  for (const [name, list] of domains) results.push(...(await runDomain(name, list, args)))
} else {
  results = await runSlots(planSlots(gates, args.jobs), args)
}
const failed = results.filter((r) => !r.ok)
const total = ((Date.now() - t0) / 1000).toFixed(1)

console.log(`\n📊 结果：${results.length - failed.length} 通过 / ${failed.length} 失败｜耗时 ${total}s`)

if (failed.length) {
  console.log('\n失败清单：')
  for (const f of failed) {
    console.log(`  ❌ ${f.gate.name}（${f.gate.file}，退出码 ${f.code}）`)
  }
  /*
   * 单独重跑提示：并行执行时终端输出会交错，直接给单跑命令，
   * 避免「知道失败了但没法看清为什么」。
   */
  console.log(`\n单独复现：node ${failed[0].gate.file}`)
  process.exit(1)
}

console.log('   ✅ 全部门禁通过')
process.exit(0)
