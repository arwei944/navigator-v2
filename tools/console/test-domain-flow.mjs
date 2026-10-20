/**
 * 领域流水线：纯函数契约 + 真实页面渲染。
 *
 * ## 两层各守什么
 *
 * **纯函数层**（不需要浏览器）：领域定义自洽（stage id 不重复、顺序即语义）、
 * 位置归一、覆盖率统计、推断尊重人工覆写。这些是数据的正确性。
 *
 * **真机层**（需要浏览器）：三个视图真的渲染出来、能切换、点得到。
 * 纯函数全对但视图白屏是完全可能的（模板写错、导入失败），只有真实渲染能发现。
 *
 * 运行：node tools/console/test-domain-flow.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { launch } from './lib/cdp-driver.mjs'
import { makeWaitFor, makeClickUntil } from './lib/wait-for.mjs'
import {
  DOMAINS, STAGE_INDEX, STAGE_IDS, describePosition, bandOf,
  normalizePosition, domainCoverage,
} from '../../shared/domain-flow.mjs'
import { inferPosition, inferAllPositions, MIN_CONFIDENCE } from '../../shared/domain-infer.mjs'

const PORT = 5331
const DIST = join(process.cwd(), 'dist')

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }

/* ============ ① 领域定义自洽 ============ */

ok(DOMAINS.length >= 3, `领域数量合理（${DOMAINS.length} 个）`)
ok(DOMAINS.every((d) => d.stages.length >= 3), '每个领域至少 3 个环节（太短的链没有「上下游」可言）')
ok(STAGE_INDEX.size === DOMAINS.reduce((a, d) => a + d.stages.length, 0),
  'stage id 跨领域唯一（重复会在构建时抛错，这里确认没被吞掉）')

// 顺序即语义：describePosition 的 progress 必须随 order 单调递增
{
  const d = DOMAINS[0]
  const progresses = d.stages.map((s) => describePosition(s.id).progress)
  const monotonic = progresses.every((p, i) => i === 0 || p > progresses[i - 1])
  ok(monotonic, '同领域内 progress 随环节顺序单调递增', progresses.join(','))
  ok(progresses[progresses.length - 1] === 100, '最后一环进度为 100')
}

// 分段：上游/中游/下游必须覆盖全部环节
{
  const bands = DOMAINS.flatMap((d) => d.stages.map((s) => bandOf(s.id)))
  ok(bands.every((b) => ['upstream', 'midstream', 'downstream'].includes(b)), '每个环节都有明确分段')
  ok(bands.includes('upstream') && bands.includes('downstream'), '上下游两端都存在')
}

/* ============ ② 位置归一 ============ */

{
  ok(normalizePosition({ stage: 'swap', source: 'auto' })?.domain === 'onchain', '归一补全 domain')
  ok(normalizePosition({ stage: 'swap', domain: 'ai-work' }) === null, 'domain 与 stage 冲突时拒绝（不静默改）')
  ok(normalizePosition({ stage: 'not-exist' }) === null, '不存在的 stage 返回 null')
  ok(normalizePosition(null) === null, '空值返回 null 而非抛错')
  ok(normalizePosition({ stage: 'swap', source: 'manual' }).source === 'manual', '人工来源被保留')
  ok(normalizePosition({ stage: 'swap', source: '瞎写' }).source === 'auto', '非法 source 回落为 auto')
}

/* ============ ③ 覆盖率统计 ============ */

{
  const fake = [
    { id: 'a', position: { domain: 'onchain', stage: 'fiat-onramp', source: 'auto' } },
    { id: 'b', position: { domain: 'onchain', stage: 'swap', source: 'auto' } },
    { id: 'c' },
  ]
  const cov = domainCoverage(fake, 'onchain')
  ok(cov.buckets.length === DOMAINS.find((d) => d.id === 'onchain').stages.length,
    'buckets 与 stages 等长（视图直接按下标取值）')
  ok(cov.placed === 2, 'placed 统计正确', String(cov.placed))
  ok(cov.unplaced === 1, 'unplaced 统计正确', String(cov.unplaced))
  ok(cov.gaps === cov.buckets.filter((b) => b.empty).length, 'gaps 与空环节数一致')
  // 桶顺序必须与 stages 一致
  ok(cov.buckets.every((b, i) => b.order === i), '桶顺序与环节顺序一致')
}

/* ============ ④ 推断：置信度与人工覆写 ============ */

{
  const strong = inferPosition({ name: 'Uniswap', desc: '以太坊最核心 DEX，AMM 自动做市', url: 'uniswap.org' })
  ok(strong?.stage === 'swap', '强关键词命中正确环节', JSON.stringify(strong))

  ok(inferPosition({ name: '???', desc: '', url: '' }) === null, '无任何信号时返回 null（不瞎猜）')

  // 人工覆写保护 —— 这是「可覆写」这条需求的底线
  const sites = [
    { id: 'x', name: 'Uniswap', desc: 'DEX', position: { domain: 'onchain', stage: 'lending', source: 'manual' } },
    { id: 'y', name: 'Aave', desc: '借贷协议 lending' },
  ]
  const r = inferAllPositions(sites)
  ok(r.positions.x?.stage === 'lending', '人工覆写不被自动推断覆盖', JSON.stringify(r.positions.x))
  ok(r.positions.x?.source === 'manual', '人工来源标记保留')
  ok(r.skippedManual === 1, '统计了被跳过的人工条目')
  ok(r.positions.y?.stage === 'lending', '自动条目正常推断')
}

/* ============ ⑤ 真实数据 == */

{
  const raw = JSON.parse(readFileSync('api/sites-data.json', 'utf-8'))
  const sites = Array.isArray(raw) ? raw : raw.sites
  const withPos = sites.filter((s) => normalizePosition(s.position))
  ok(withPos.length === sites.length, `全部 ${sites.length} 个站点都有合法位置`, `实得 ${withPos.length}`)

  const bad = sites.filter((s) => s.position && !normalizePosition(s.position))
  ok(bad.length === 0, '没有 domain/stage 冲突的脏数据', bad.slice(0, 3).map((s) => s.id).join(','))

  const domains = new Set(withPos.map((s) => normalizePosition(s.position).domain))
  ok(domains.size === DOMAINS.length, '四个领域都有站点（没有整条线是空的）', [...domains].join(','))
}

/* ============ ⑤b 热力格子可读性 ============ */

{
  /*
   * 热力矩阵的格子里有计数与环节名，底色是领域色按浓度叠加。
   * 浓度做到 1.0 时深色底上的小字会读不出来（截图里「法币入金」几乎消失）。
   * 这里按**最浓**的情况算一次对比度，把「压上限」这个决定变成可验证的约束，
   * 而不是一句注释。
   */
  const MAX_ALPHA = 0.55           // 必须与 DomainFlowView.vue 里的常量一致
  const lum = (rgb) => {
    const c = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b)
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
  }
  const hex2rgb = (hex) => {
    const n = parseInt(String(hex).replace('#', ''), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  /** 领域色以 alpha 叠在白色底上（页面底色是浅色） */
  const blend = (fg, alpha) => fg.map((v) => Math.round(255 * (1 - alpha) + v * alpha))

  const TEXT = [0x1d, 0x1d, 0x1f]   // --text-primary 的近似值
  for (const d of DOMAINS) {
    const bg = blend(hex2rgb(d.color), MAX_ALPHA)
    const r = ratio(TEXT, bg)
    ok(r >= 4.5, `${d.label} 最浓格子上文字对比度 ${r.toFixed(2)}:1 ≥ 4.5`,
      r < 4.5 ? '浓度上限太高，环节名会读不清' : '')
  }
}

/* ============ ⑥ 真机渲染 ============ */

if (!existsSync(join(DIST, 'server.js'))) {
  failures.push('真机渲染 — 缺少 dist/server.js')
} else {
  // SQLite 必须进程独立：门禁并发执行，多个服务共写 dist/data/store.db
  // 会让彼此的数据互相污染（实测并发时流水线渲染出 0 条链、断言全「实得 0」）。
  const STORE_DIR = join(process.cwd(), `.tmp-gate-domain-store-${process.pid}`)
  rmSync(STORE_DIR, { recursive: true, force: true })
  mkdirSync(STORE_DIR, { recursive: true })
  const server = spawn(process.execPath, ['server.js'], {
    cwd: DIST,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NAV_CRON: '0', NAV_STORE_DIR: STORE_DIR },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const ready = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 20000)
    const onData = (b) => { if (String(b).includes('listening on')) { clearTimeout(timer); resolve(true) } }
    server.stdout.on('data', onData)
    server.stderr.on('data', onData)
    server.on('exit', () => { clearTimeout(timer); resolve(false) })
  })

  let browser = null
  try {
    ok(ready, '服务已启动')

    if (ready) {
      browser = await launch({ headless: true, port: 0, url: `http://127.0.0.1:${PORT}/` })
      const c = browser.client
      await c.sleep(1800)

      /* 路由直达 */
      // 用 goto 而不是 pushState：首屏还没渲染完时（并发下常见）
      // pushState 改了 URL 但 Vue 路由不会重新解析 —— 实测 app 内容长度为 0，
      // 页面停在空白，断言全「实得 0」。goto 是真正的导航，必然触发路由。
      await c.goto(`http://127.0.0.1:${PORT}/domain`, { settle: 600 })

      // 固定 sleep 在并发下不可靠：多个 Chrome 同时启动时首屏要好几秒，
      // 实测 1500ms 不够 —— 断言全「实得 0」，看起来像渲染 bug，其实是没等够。
      // 轮询等到领域视图真正出现再断言。
      const waitFor = makeWaitFor(c)
      ok(await waitFor(`document.querySelectorAll('.df-pipeline').length > 0`),
        '领域视图已渲染（并发下需要等，不能固定 sleep）')

      const title = await c.eval(`document.querySelector('.df-title')?.textContent || ''`)
      ok(/领域流水线/.test(title), '页面标题渲染', String(title))

      /* ① 流水线视图 */
      const pipes = await c.eval(`document.querySelectorAll('.df-pipeline').length`)
      ok(Number(pipes) === DOMAINS.length, `流水线视图渲染 ${DOMAINS.length} 条领域链`, `实得 ${pipes}`)

      const nodes = await c.eval(`document.querySelectorAll('.df-node').length`)
      ok(Number(nodes) >= STAGE_INDEX.size, '环节节点全部渲染', `实得 ${nodes}`)

      /*
       * 节点必须**有可读宽度**，不能被 flex 压扁。
       * 第一版用 `flex: 1 1 0`，在窄视口里节点被压缩成一条线，截图只能看到第一个 ——
       * 「渲染出了 N 个元素」和「用户能看见 N 个节点」是两回事，所以要量宽度。
       */
      const nodeWidth = await c.eval(`(() => {
        const n = document.querySelector('.df-node')
        return n ? Math.round(n.getBoundingClientRect().width) : 0
      })()`)
      ok(Number(nodeWidth) >= 120, '流水线节点有可读宽度（未被 flex 压扁）', `${nodeWidth}px`)

      const chips = await c.eval(`document.querySelectorAll('.df-chip').length`)
      ok(Number(chips) > 0, '站点 chip 渲染出来', `实得 ${chips}`)

      /* ② 切到矩阵 */
      // 点击重试到生效：元素存在 ≠ 事件已绑定（详见 wait-for.mjs）
      const clickUntil = makeClickUntil(c)
      await clickUntil(
        `[...document.querySelectorAll('.df-vbtn')].find(x => x.textContent.trim() === '热力矩阵')?.click()`,
        `document.querySelectorAll('.df-mx-tile').length > 0`,
      )
      /*
       * 格子总数 = 各领域环节数之和（8+8+6+6=28）。
       *
       * 同时守一件事：**每个领域一张表**（`.df-mx-block` 数 == 领域数）。
       * 第一版把四个领域摞在一张表里共用一个表头 —— 各领域环节含义不同，
       * 结果「AI 工作流」行的数字落在「法币入金」列下面，是错的。
       */
      const expectedCells = DOMAINS.reduce((a, d) => a + d.stages.length, 0)
      const cells = await c.eval(`document.querySelectorAll('.df-mx-tile').length`)
      ok(Number(cells) === expectedCells, `矩阵格子数等于环节总数（${expectedCells}）`, `实得 ${cells}`)

      const blocks = await c.eval(`document.querySelectorAll('.df-mx-block').length`)
      ok(Number(blocks) === DOMAINS.length,
        `每个领域独立一张矩阵表（${DOMAINS.length} 张）`, `实得 ${blocks}`)

      /* ③ 切到清单 */
      await clickUntil(
        `[...document.querySelectorAll('.df-vbtn')].find(x => x.textContent.trim() === '清单')?.click()`,
        `document.querySelectorAll('.df-list-row').length > 0`,
      )
      const rows = await c.eval(`document.querySelectorAll('.df-list-row').length`)
      ok(Number(rows) > 200, '清单视图列出全部站点', `实得 ${rows}`)

      /* ④ 领域筛选仍然可用 */
      await c.eval(`(() => {
        const sel = document.querySelector('.df-select')
        if (!sel) return false
        sel.value = 'onchain'
        sel.dispatchEvent(new Event('change'))
        return true
      })()`)
      await c.sleep(600)
      const filtered = await c.eval(`document.querySelectorAll('.df-list-row').length`)
      ok(Number(filtered) > 0 && Number(filtered) < Number(rows), '按领域筛选后条目减少', `${rows} → ${filtered}`)

      /* ⑤ 没有运行时错误 */
      const err = await c.eval(`window.__navErrors ? JSON.stringify(window.__navErrors.slice(0,2)) : '[]'`)
      ok(err === '[]' || err === undefined, '页面无运行时错误', String(err).slice(0, 120))
    }
  } finally {
    if (browser) await browser.close().catch(() => {})
    server.kill()
    // 临时 SQLite 必须删掉（理由同 test-visit-tracking-real）
    await new Promise(r => setTimeout(r, 300))
    try { rmSync(STORE_DIR, { recursive: true, force: true }) } catch { /* 句柄未释放 */ }
  }
}

console.log(`\n🔗 领域流水线：${pass} 通过 / ${failures.length} 失败`)
if (failures.length) {
  console.log('\n失败明细：')
  for (const f of failures) console.log(`- ${f}`)
  process.exit(1)
}
console.log('  ✓ 领域定义自洽｜位置归一与覆盖率正确｜人工覆写受保护｜三视图真机渲染')
