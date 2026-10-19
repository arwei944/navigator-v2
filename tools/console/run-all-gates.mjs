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

/**
 * 台账自校验：跑任何门禁之前，先确认「台账本身是可信的」。
 *
 * 这一条是 2026-10 实测踩出来的第二个假绿：把 98 段 `&&` 长链换成执行器时，
 * 长链末尾的 `node tools/gate-registry/cli.mjs check` 一起消失了 ——
 * 执行器只扫描 `test-*.mjs` 文件，台账校验不在扫描范围内，于是：
 *
 *   - 新增 4 道门禁没归类      → 台账 check 报错，但**没人跑 check**；
 *   - 台账 JSON/MD 与现状不一致 → 同上；
 *   - 执行器照常打印「102 道全绿」。
 *
 * 也就是说：**用来发现假绿的东西本身没在跑**，是比漏跑一道门禁更隐蔽的问题。
 * 现在把它作为前置闸门，失败即中止（清单不完整时跑出来的绿没有意义）。
 *
 * 只在跑全量时执行；`--only` / `--domain` / `--list` 是排障与查询场景，
 * 不该被台账状态挡住（但也因此不会被当作「全绿」的证据）。
 */
function verifyLedger() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'tools/gate-registry/cli.mjs'), 'check'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    const cap = (b) => { out += String(b) }
    child.stdout.on('data', cap)
    child.stderr.on('data', cap)
    child.on('error', (e) => resolve({ ok: false, out: String(e.message) }))
    child.on('close', (code) => resolve({ ok: code === 0, out }))
  })
}

/* ---------------- 参数 ---------------- */

function parseArgs(argv) {
  const out = { jobs: 4, serial: false, list: false, domain: null, only: null, verbose: false, ci: false }
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
    else if (a === '--ci') out.ci = true
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
    /*
     * CI 模式下追加 `@ci-flags` 声明的参数（如 `--strict`）。
     * 语义：本地允许「缺前置产物 → 跳过」，CI 不允许 —— 否则构建没产物时
     * 产物体积门禁会静默跳过并报绿。
     */
    const ciFlags = gate.ciMode ? (gate.ciFlags || []) : []
    const child = spawn(
      process.execPath,
      [...(gate.nodeFlags || []), join(ROOT, gate.file), ...ciFlags],
      {
        cwd: ROOT,
        windowsHide: true,
        env: { ...process.env, NAV_GATE_RUNNER: 'test-all' },
      },
    )
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
  --ci             CI 模式：跳过声明了 @ci-skip <原因> 的门禁（逐条打印跳过项）
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

/*
 * 跑全量前先校验台账本身。筛选场景（--list / --only / --domain）跳过：
 * 它们是排障入口，不该被台账状态挡住；但只要走了全量路径，台账就必须是可信的。
 */
const isFullRun = !args.list && !args.only && !args.domain
if (isFullRun) {
  const ledger = await verifyLedger()
  if (!ledger.ok) {
    console.error('❌ 门禁台账自校验失败 —— 清单本身不可信，拒绝执行：\n')
    console.error(ledger.out.trim().replace(/^/gm, '   '))
    console.error('\n   → 跑 node tools/gate-registry/cli.mjs index 修复台账后重试')
    process.exit(2)
  }
}

/*
 * CI 模式：跳过显式声明 `@ci-skip <原因>` 的门禁。
 *
 * 为什么不是「CI 里悄悄少跑几道」：
 *   1. 跳过必须**逐道声明原因**，没有声明的绝不跳过 —— 否则「忘了接」与
 *      「有意跳过」在结果里长得一模一样，都是假绿。
 *   2. 跳过的门禁会**逐条打印**，日志里能看见「哪几道没跑、为什么」。
 *   3. 声明了标签但没写原因，视为不合规 → 直接失败（写了 `@ci-skip` 空行
 *      等于给自己开一张空白通行证）。
 */
const ciSkipped = []
if (args.ci) {
  const badDecl = gates.filter((g) => g.ciSkip === '')
  if (badDecl.length) {
    console.error(`❌ ${badDecl.length} 道门禁声明了 @ci-skip 但没写原因：`)
    for (const g of badDecl) console.error(`   - ${g.file}`)
    console.error('   → 写成 `@ci-skip <为什么 CI 跑不了>`，或删掉该行')
    process.exit(2)
  }
  const keep = []
  for (const g of gates) {
    if (g.ciSkip) ciSkipped.push(g)
    else keep.push({ ...g, ciMode: true })
  }
  gates = keep
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
    /*
     * 常见误区：`--ci --only <被跳过的脚本>`。用户以为脚本不存在，
     * 实际是它被 @ci-skip 挡在门外。直接把原因说出来，省一次排查。
     */
    const skippedNames = new Set(ciSkipped.map((g) => g.name))
    const blocked = missing.filter((n) => skippedNames.has(n))
    if (blocked.length) {
      console.error(`   ⏭  其中 ${blocked.join(', ')} 在 CI 模式下被 @ci-skip 跳过：`)
      for (const g of ciSkipped) {
        if (blocked.includes(g.name)) console.error(`      - ${g.name}：${g.ciSkip}`)
      }
      console.error('   → 去掉 --ci 即可在本机运行，或修改该脚本的 @ci-skip 声明')
    }
    process.exit(2)
  }
}

if (!gates.length) {
  /*
   * CI 模式下「全被跳过」是合法但危险的信号：说明 @ci-skip 声明已经覆盖了
   * 整个清单，CI 实际什么都没验却在报绿。这时应按失败处理并提示。
   */
  if (args.ci && ciSkipped.length) {
    console.error(`❌ CI 模式下全部门禁都被 @ci-skip 跳过（${ciSkipped.length} 道）—— CI 实际未验证任何东西`)
    console.error('   → 检查 @ci-skip 声明是否写得太宽')
    process.exit(2)
  }
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
console.log(`   域：${[...domains.keys()].join(' · ')}`)

/*
 * 跳过的门禁必须逐条可见。CI 日志里最怕的就是「总数变小了但没人注意」——
 * 那等于悄悄降低了保护级别。
 */
if (ciSkipped.length) {
  console.log(`\n   ⏭  按 @ci-skip 跳过 ${ciSkipped.length} 道（CI 环境限制，非失败）：`)
  for (const g of ciSkipped) console.log(`      - ${g.name}：${g.ciSkip}`)
}
console.log('')

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
