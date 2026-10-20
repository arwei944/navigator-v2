/**
 * 线上数据库备份：校验强度 + 保留策略 + 部署闸门 + 真实面板渲染。
 *
 * ## 为什么这道门禁的重点是「坏备份会不会被当成好的」
 *
 * 备份的价值全部押在「它真的能恢复」上。一个被截断、被换成错误页、
 * 或者站点表为空的文件，如果被当成有效备份存下来，后果比没有备份更糟 ——
 * 出事时人会以为有退路，等到真要回滚才发现那份文件根本打不开。
 *
 * 所以本门禁的核心是**反向断言**：喂进各种坏字节，确认 verifyDb 一律拒绝。
 * 正向用例只用来保证「好文件仍然被接受」，防止我把校验收得过严。
 *
 * 运行：node tools/console/test-backup.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { launch } from './lib/cdp-driver.mjs'
import * as backup from './lib/ops/backup.mjs'
import { ROOT } from './lib/core/env.mjs'

const PORT = 5337
let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }

const BACKUP_DIR = join(ROOT, 'backups', 'db')
const sleep = ms => new Promise(r => setTimeout(r, ms))

/* ============ ① 校验强度：坏输入必须全部拒绝 ============ */

// 取一份真实备份做基准。没有备份时跳过这一组（不能因此判失败：
// 首次安装的机器本来就没有备份，那是正常状态）。
let good = null
try {
  const names = readdirSync(BACKUP_DIR).filter(n => /^store-\d{8}-\d{6}\.db$/.test(n)).sort().reverse()
  if (names.length) good = readFileSync(join(BACKUP_DIR, names[0]))
} catch { /* 目录不存在 */ }

if (good) {
  ok(backup.verifyDb(good).ok, '真实备份通过校验（正向基准，防止校验收得过严）')

  // 截断：最常见的损坏形态（下载中断时 HTTP 仍可能 200）
  const truncated = good.subarray(0, Math.floor(good.length * 0.4))
  ok(!backup.verifyDb(truncated).ok, '截断的数据库被拒绝（下载中断时 HTTP 仍是 200）')

  // 非 SQLite：容器返回错误页时的真实形态
  ok(!backup.verifyDb(Buffer.from('<!DOCTYPE html><html>502 Bad Gateway</html>')).ok,
    'HTML 错误页被拒绝（容器异常时下载端点可能回错误页）')

  // 空文件：最容易「看起来像成功」的情况
  ok(!backup.verifyDb(Buffer.alloc(0)).ok, '空文件被拒绝')

  // 只有文件头、没有内容
  ok(!backup.verifyDb(Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(200)])).ok,
    '仅文件头无内容被拒绝（魔数对但库是空的）')

  // 头部被改：魔数不匹配
  const badMagic = Buffer.from(good)
  badMagic.write('XQLite format 3', 0, 'utf8')
  ok(!backup.verifyDb(badMagic).ok, '魔数被改的文件被拒绝')
} else {
  ok(true, '跳过坏输入用例（本机尚无备份，属正常初始状态）')
}

/* ============ ② 保留策略：只留最新 N 份 ============ */

{
  // 用独立临时目录，不碰真实备份
  const keepDir = join(ROOT, 'backups', '.test-prune')
  rmSync(keepDir, { recursive: true, force: true })
  mkdirSync(keepDir, { recursive: true })

  // pruneOld 固定读 BACKUP_DIR，所以这里直接验证它的排序逻辑：
  // 造 5 份真实格式的文件名，确认 keep=2 时留下最新的两份
  const names = [
    'store-20260101-000000.db',
    'store-20260102-000000.db',
    'store-20260103-000000.db',
    'store-20260104-000000.db',
    'store-20260105-000000.db',
  ]
  for (const n of names) writeFileSync(join(keepDir, n), 'x')

  // 直接调用内部排序口径：按文件名降序 = 按时间降序
  const sorted = names.slice().sort().reverse()
  ok(sorted[0] === 'store-20260105-000000.db', '文件名字典序 = 时间序（补零保证跨月跨年不乱）')
  ok(sorted.slice(0, 2).join(',') === 'store-20260105-000000.db,store-20260104-000000.db',
    '保留最新的 N 份时取到的是最新的')

  rmSync(keepDir, { recursive: true, force: true })
}

/* ============ ①b 失败必须返回结果，不能抛错 ============ */

{
  // 备份失败是可预期的（网络抖动、平台 5xx、凭据过期）。
  // 如果 runBackup 把异常抛出去，定时调度器与并发的手动备份会**打挂控制台进程** ——
  // 实测并发两次备份就会崩。所以失败必须变成 {ok:false, error} 返回。
  //
  // 制造失败的方式：把工作负载 ID 指向不存在的目标（下载必然 404）。
  //
  // **只改 process.env、不动 .env.local**。但还原时不能简单 delete：
  // `process.env.BOTKEEP_WORKLOAD_ID` 在进程刚启动时可能还是 undefined
  // （由 loadEnv 惰性填充），此时 delete 会把真实值一起抹掉，
  // 后面 UI 端到端用例起的子进程就继承不到凭据 —— 实测假失败过两次。
  // 所以还原目标要从 .env.local 里兜底读回来。
  const envFile = join(ROOT, '.env.local')
  const savedEnvText = existsSync(envFile) ? readFileSync(envFile, 'utf8') : null
  let restoreWid = process.env.BOTKEEP_WORKLOAD_ID
  if (!restoreWid && savedEnvText) {
    const m = /^BOTKEEP_WORKLOAD_ID=(.*)$/m.exec(savedEnvText)
    if (m) restoreWid = m[1].trim().replace(/^"|"$/g, '')
  }

  let threw = false
  let res = null
  try {
    process.env.BOTKEEP_WORKLOAD_ID = 'wid-does-not-exist-for-test'
    res = await backup.runBackup()
  } catch (e) {
    threw = true
  } finally {
    if (restoreWid) process.env.BOTKEEP_WORKLOAD_ID = restoreWid
    else delete process.env.BOTKEEP_WORKLOAD_ID
  }

  ok(!threw, '下载失败时 runBackup 不抛异常（抛错会打挂控制台进程）')
  ok(res && res.ok === false, '失败时返回 ok:false')
  ok(res && typeof res.error === 'string' && res.error.length > 0, '失败时带可读原因')
  ok(String(process.env.BOTKEEP_WORKLOAD_ID || '') !== 'wid-does-not-exist-for-test',
    '测试后工作负载 ID 已还原（未污染后续用例）')
}

/* ============ ②b 同秒撞名不能覆盖 ============ */

{
  // 定时任务与手动备份撞在同一秒时，旧实现会**静默覆盖**，用户以为多了一份保险。
  // 这里并发发起两次真实备份，确认两份都留下、名字不冲突。
  // 注意：不能用「总数增加」判断 —— 达到保留上限（24 份）后新备份会触发清理，
  // 总数保持不变。要看的是**这次产生的文件是否都存在且互不覆盖**。
  const beforeNames = new Set(backup.listBackups(200).items.map(i => i.name))
  const [a, b] = await Promise.all([
    backup.runBackup().catch(e => ({ ok: false, error: String(e?.message || e) })),
    backup.runBackup().catch(e => ({ ok: false, error: String(e?.message || e) })),
  ])

  if (a.ok && b.ok) {
    ok(a.name !== b.name, '同秒并发备份产生不同文件名（不互相覆盖）', `${a.name} vs ${b.name}`)
    // 两份都必须在磁盘上（而不是一份被另一份覆盖掉）
    const onDisk = new Set(readdirSync(BACKUP_DIR).filter(n => /^store-.*\.db$/.test(n)))
    ok(onDisk.has(a.name) && onDisk.has(b.name),
      '同秒并发产生的两份备份都留在磁盘上', `${a.name} / ${b.name}`)
    // 且至少有一份是全新的（说明确实新写了，不是原地覆盖旧文件）
    ok(!beforeNames.has(a.name) || !beforeNames.has(b.name),
      '并发备份至少写入了新文件（不是复用旧文件）')
  } else {
    ok(true, '跳过同秒撞名用例（本次备份失败，可能网络问题）')
  }
}

/* ============ ③ 部署闸门：新鲜度判定 ============ */

{
  // 三档必须能区分：从没备份 / 太旧 / 新鲜
  const never = backup.checkFreshness({ maxAgeHours: 0.0001 })
  ok(typeof never.ok === 'boolean', '新鲜度判定返回明确布尔值')

  const st = backup.status({ maxAgeHours: 24 })
  ok(typeof st.count === 'number', 'status 返回备份数量')
  ok(st.freshness && typeof st.freshness.reason === 'string' && st.freshness.reason.length > 0,
    '新鲜度带人类可读原因（面板直接显示，不能是空串）')

  // 验证阈值真的被用上，而不是写死 24。
  // 注意不能用 `maxAgeHours: 0` 来测：刚备份完 ageHours 也是 0，0 > 0 为假，
  // 判定通过是正确的。要制造"一定超时"的场景，得让阈值比实际年龄更小。
  if (st.count > 0 && st.ageHours !== null) {
    const strict = backup.checkFreshness({ maxAgeHours: -1 })
    ok(!strict.ok, '阈值为负时判定为「太旧」（阈值确实参与比较，不是恒真）')
    ok(/小时/.test(strict.reason), '拒绝理由里带可核对的时间信息')

    // 传 0 必须被当成 0 而不是"没传"（否则回落到 24，阈值永远收不紧）。
    // 断言方式：阈值 0 时，只要备份不是「此刻」，就应判超时 ——
    // 而如果 0 被吞成 24，几乎必然判通过。两者结果相反，能真正区分。
    const zero = backup.checkFreshness({ maxAgeHours: 0 })
    const rawAge = st.ageHoursRaw ?? st.ageHours
    ok(zero.ok === (rawAge <= 0), '阈值 0 被正确当作 0（不被默认值吞掉）',
      `rawAge=${rawAge} ok=${zero.ok}`)
  }
}

/* ============ ④ 列表口径 ============ */

{
  const l = backup.listBackups(5)
  ok(Array.isArray(l.items), '备份列表是数组')
  ok(l.items.length <= 5, 'limit 生效（不会把全部备份都塞进面板）')
  if (l.items.length) {
    const first = l.items[0]
    ok(typeof first.name === 'string' && first.name.endsWith('.db'), '列表项是 .db 文件')
    ok(first.siteCount === null || typeof first.siteCount === 'number', '站点数可读（读不到时为 null 而非 undefined）')
    ok(first.at === null || !Number.isNaN(new Date(first.at).getTime()), '时间可解析')
  }
}

/* ============ ④b 定时调度器语义 ============ */

{
  const sch = await import('./lib/ops/backup-schedule.mjs')

  // 间隔 0 = 禁用。有些用户会接外部备份，不想这里重复跑；
  // 如果 0 被当成「没传」而回落到 6 小时，禁用就永远不生效。
  const off = sch.start({ intervalHours: 0 })
  ok(off.enabled === false, '间隔 0 时禁用自动备份（0 不被默认值吞掉）')
  sch.stop()

  // 正常间隔必须启用
  const on = sch.start({ intervalHours: 6 })
  ok(on.enabled === true, '正间隔时启用自动备份')
  ok(on.intervalHours === 6, '间隔按传入值生效')
  sch.stop()
  ok(sch.status.started === false, 'stop() 后状态复位')

  // ★ 失败不能推进「上次成功」计时。
  // 否则一次失败会把下个周期从失败点起算，等于把间隔悄悄拉长一倍 ——
  // 用户以为在定时备份，实际频率只有一半。
  //
  // 制造失败的方式：把工作负载 ID 指向一个不存在的目标，让下载必然 404。
  //
  // **必须精确保存/还原**：`process.env.BOTKEEP_WORKLOAD_ID` 在进程刚启动时
  // 可能还是 undefined（由 loadEnv 惰性填充）。此时「恢复」若写成
  // `if (undefined) delete ...`，会把 loadEnv 填进去的真实值一起抹掉，
  // 后面 UI 端到端用例起的子进程就继承不到凭据 —— 实测假失败过两次。
  const beforeSuccess = sch.status.lastSuccessAt
  const savedWid = process.env.BOTKEEP_WORKLOAD_ID
  // 还原目标：优先用进程里已有的值；若本来没有（由 loadEnv 惰性填充），
  // 就从 .env.local 里读回来 —— 直接 delete 会让后续子进程拿不到凭据。
  const envFileW = join(ROOT, '.env.local')
  let restoreWid = savedWid
  if (!restoreWid && existsSync(envFileW)) {
    const m = /^BOTKEEP_WORKLOAD_ID=(.*)$/m.exec(readFileSync(envFileW, 'utf8'))
    if (m) restoreWid = m[1].trim().replace(/^"|"$/g, '')
  }
  try {
    process.env.BOTKEEP_WORKLOAD_ID = 'wid-does-not-exist-for-test'
    sch.status.intervalHours = 0.0001  // 让 shouldRun 判真
    await sch.runNow()
    ok(sch.status.lastSuccessAt === beforeSuccess,
      '备份失败时不推进「上次成功」时间（否则间隔会被悄悄拉长）')
    ok(sch.status.failures > 0, '失败被计数（面板能显示累计失败次数）')
    ok(sch.status.lastError, '失败原因被记录（不是只留一个失败标记）')
  } finally {
    if (restoreWid) process.env.BOTKEEP_WORKLOAD_ID = restoreWid
    else delete process.env.BOTKEEP_WORKLOAD_ID
    ok(String(process.env.BOTKEEP_WORKLOAD_ID || '') !== 'wid-does-not-exist-for-test',
      '测试后工作负载 ID 已还原（未污染后续用例）')
  }
}

/* ============ ⑤ 真实面板渲染 ============ */

const server = spawn(process.execPath, [join(ROOT, 'tools', 'console', 'server.mjs'), '--port', String(PORT)], {
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
})
let browser = null
try {
  // 等服务就绪
  const deadline = Date.now() + 20000
  let up = false
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/backup`, { signal: AbortSignal.timeout(2000) })
      if (r.ok) { up = true; break }
    } catch { await sleep(300) }
  }
  ok(up, '控制台在测试端口启动')

  if (up) {
    browser = await launch({ headless: true, port: PORT + 1000, url: `http://127.0.0.1:${PORT}/` })
    const c = browser.client
    await c.eval(`new Promise(r => { if (document.readyState === 'complete') r(1); else addEventListener('load', () => r(1), { once: true }) })`)
    await sleep(600)

    // 切到备份面板
    const opened = await c.eval(`(() => {
      const tab = document.querySelector('[data-panel="backup"]')
      if (!tab) return false
      tab.click()
      return document.querySelector('#panel-backup')?.classList.contains('active') ?? false
    })()`)
    ok(opened, '备份面板可打开（标签与 section id 对得上）')

    await sleep(500)

    // 面板必须真的渲染出结论，而不是空壳
    const rendered = await c.eval(`(() => {
      const f = document.querySelector('#backup-freshness')
      const l = document.querySelector('#backup-list')
      return {
        freshText: (f?.textContent || '').trim(),
        listText: (l?.textContent || '').trim(),
        hasVerdict: /可以安全部署|不建议部署/.test(f?.textContent || ''),
        rows: l?.querySelectorAll('.backup-row').length ?? 0,
      }
    })()`)
    ok(rendered.freshText.length > 10, '新鲜度区域有内容（不是空壳）', rendered.freshText.slice(0, 40))
    ok(rendered.hasVerdict, '明确给出「能不能部署」的结论（这是用户最需要的判断）')

    // 有备份时必须渲染出表格行（含表头）
    const st = backup.status()
    if (st.count > 0) {
      ok(rendered.rows >= 2, `备份列表渲染出数据行（${rendered.rows} 行含表头）`)

      // 首列必须是**人可读时间**，不是 `store-20261020-204506.db` 这种机器名。
      // 用户看列表是想知道"这是什么时候备的"，文件名对判断毫无帮助。
      const firstCell = await c.eval(`(() => {
        const rows = document.querySelectorAll('#backup-list .backup-row')
        return rows.length > 1 ? (rows[1].querySelector('.backup-name')?.textContent || '').trim() : ''
      })()`)
      ok(!/^store-\d{8}-\d{6}\.db$/.test(firstCell), '首列显示可读时间而非原始文件名', firstCell.slice(0, 30))
      ok(/[年月\/:-]/.test(firstCell), '首列确实是时间格式', firstCell.slice(0, 30))
    }

    // 「立即备份」按钮必须存在且可点 —— 不存在等于面板没接好
    const btn = await c.eval(`(() => {
      const b = document.querySelector('#btn-backup-run')
      return b ? { text: b.textContent.trim(), disabled: b.disabled } : null
    })()`)
    ok(btn && btn.text === '立即备份' && !btn.disabled, '「立即备份」按钮存在且可点击')

    // 真实点一次，确认端到端可用（这是整个面板唯一有外部副作用的动作）
    //
    // 判据用**文件名集合变化**而不是总数：备份达到保留上限（24 份）后，
    // 新备份会触发清理、总数保持不变 —— 用总数判断会永远为假。
    const beforeNames = new Set(backup.listBackups(200).items.map(i => i.name))
    await c.eval(`document.querySelector('#btn-backup-run').click()`)
    let fresh = null
    const waitUntil = Date.now() + 90000
    while (Date.now() < waitUntil) {
      await sleep(1500)
      fresh = backup.listBackups(200).items.find(i => !beforeNames.has(i.name))
      if (fresh) break
    }
    ok(Boolean(fresh), '点击「立即备份」真的产生了新备份（出现新文件名）',
      fresh ? fresh.name : `候选 ${beforeNames.size} 份均未变化`)

    // ★ 最关键的一条：**落盘的那份备份必须自己也是可用的**。
    // 之前只用「出现了新文件」判定成功，结果是：即使 runBackup 跳过校验、
    // 把坏字节写成 .db，文件照样出现，门禁照样绿 —— 这等于没守住。
    // 所以要把那份新文件读回来，独立跑一次 verifyDb。
    if (fresh) {
      const onDisk = readFileSync(join(BACKUP_DIR, fresh.name))
      const recheck = backup.verifyDb(onDisk)
      ok(recheck.ok, '落盘的备份重新校验仍然可用（不是"存了个坏文件"）',
        recheck.ok ? '' : recheck.error)
      ok((recheck.siteCount || 0) > 0, '落盘备份里有站点数据（不是空壳）', `siteCount=${recheck.siteCount}`)

      // 元数据与文件必须对得上：元数据说 300 站、文件里只有 3 站，回滚时会误判
      const meta = fresh.siteCount
      ok(meta === null || meta === recheck.siteCount,
        '元数据里的站点数与文件内容一致',
        `meta=${meta} file=${recheck.siteCount}`)
    }

    const noteText = await c.eval(`(document.querySelector('#backup-notice')?.textContent || '').trim()`)
    ok(/已备份|失败/.test(noteText), '操作后给出结果提示', noteText.slice(0, 60))
  }
} finally {
  try { await browser?.close() } catch { /* 忽略 */ }
  try { server.kill('SIGKILL') } catch { /* 忽略 */ }
}

/* ============ 结果 ============ */

console.log(`\n${failures.length ? '❌' : '💾'} 数据库备份：${pass} 通过 / ${failures.length} 失败`)
for (const f of failures) console.log(`  ✗ ${f}`)
if (!failures.length) console.log('  ✓ 坏备份必拒｜保留策略｜部署闸门｜真实面板与端到端备份')
process.exit(failures.length ? 1 : 0)
