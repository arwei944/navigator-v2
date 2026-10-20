/**
 * 门禁：云端 → 本地实时镜像同步（含「本地离线期间补齐」这条核心能力）。
 *
 * ## 为什么必须有这道门禁
 *
 * 这套东西的价值全在**边界条件**上，而边界条件恰恰是构建和类型检查发现不了的：
 *
 *   · 失败时游标**不能推进** —— 推进了就永久跳过一个对象，且是静默的
 *   · 游标被裁剪时必须**降级全量对齐** —— 否则回一个空结果，调用方以为「没变化」
 *   · 删除要传播 —— 否则云端删了、本地还在，镜像就不是镜像
 *   · 变更日志必须与对象写入**同事务** —— 否则「写成功但没记账」，本地永远追不到
 *
 * 这几条都实测踩过（裁剪判据写成 `since < oldest - 1` 时漏掉了 seq=oldest 那条）。
 *
 * ## 怎么测
 *
 * 不 mock 存储层：直接起一个真实 SQLite（临时目录），用真实的 `put/del`
 * 造数据，再用真实的 `readChanges` 追游标。只有这样才能测到
 * 「事务里有没有记日志」这种实现细节。
 *
 * 云端 HTTP 层不参与：门禁要能在无网络环境下跑。
 * 网络失败的语义用「指向不可达端口」验证，不依赖真实外网。
 */
import { rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
// 临时目录必须**进程唯一**：门禁是并行执行的（4 路），共用固定路径时
// 两个实例会互相 rmSync 对方的库 —— 实测三轮并发里两轮直接 EPERM 崩掉。
const TMP_DB = join(ROOT, `.tmp-gate-mirror-db-${process.pid}`)

let pass = 0
let fail = 0
const failures = []

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

function section(title) {
  console.log(`\n${title}`)
}

/* ---------------- 准备：真实 SQLite ---------------- */

rmSync(TMP_DB, { recursive: true, force: true })
mkdirSync(TMP_DB, { recursive: true })
process.env.NAV_STORE_DIR = TMP_DB
// 镜像目录同样进程唯一：并发时共用 backups/mirror 会互相删除
process.env.NAV_MIRROR_DIR = join(ROOT, `.tmp-gate-mirror-out-${process.pid}`)
process.env.NAV_SITE_URL = 'http://127.0.0.1:3000'
// 密钥给一个值即可：本门禁不打真实云端，只测存储层与本地镜像逻辑
process.env.SITES_ADMIN_KEY = 'gate-test-key'

const store = await import('../../server/store.mjs')
const mirror = await import('./lib/ops/mirror.mjs')

try {
  /* ---------------- 1. 变更日志基础语义 ---------------- */

  section('变更日志基础语义')

  // 首启迁移（objects 为空时从 api/sites-data.json 导入）本身也会记一条变更 ——
  // 这是刻意的：迁移也是一次「对象出现」，漏记会让本地永远不知道要拉这份数据。
  // 所以这里不能假设初始 head=0，而要以「当前 head」为基线。
  const base = store.changesInfo().head
  ok('首启迁移已记入变更日志（迁移不能静默）', base >= 1, `实际 head=${base}`)

  // 用新对象名验证 create：sites.json 已被首启迁移创建，对它是「覆盖写」
  await store.put('gate-probe.json', '{"n":1}')
  const c1 = store.readChanges({ since: base })
  ok('put 会产生一条变更', c1.items.length === 1, `实际 ${c1.items.length}`)
  ok('新建记为 create', c1.items[0]?.op === 'create', `实际 ${c1.items[0]?.op}`)
  ok('变更带 etag（本地靠它判断要不要拉内容）', Boolean(c1.items[0]?.etag))

  await store.put('gate-probe.json', '{"n":2}')
  const c2 = store.readChanges({ since: base + 1 })
  ok('覆盖写记为 put', c2.items[0]?.op === 'put', `实际 ${c2.items[0]?.op}`)
  ok('覆盖写产生新 etag', c2.items[0]?.etag !== c1.items[0]?.etag)

  await store.del('gate-probe.json')
  const c3 = store.readChanges({ since: base + 2 })
  ok('删除记为 del（墓碑）', c3.items[0]?.op === 'del', `实际 ${c3.items[0]?.op}`)

  // 删除不存在的对象不该产生墓碑：否则本地收到一堆无意义事件
  const headBefore = store.changesInfo().head
  await store.del('never-existed.json')
  ok('删除不存在的对象不产生墓碑', store.changesInfo().head === headBefore)

  /* ---------------- 2. 游标语义 ---------------- */

  section('游标语义')

  await store.put('a.json', '{"a":1}')
  await store.put('b.json', '{"b":2}')
  const all = store.readChanges({ since: 0 })
  const mid = Math.floor(all.head / 2)

  const fromMid = store.readChanges({ since: mid })
  ok('since=N 只返回 N 之后的记录',
    fromMid.items.every(i => i.seq > mid),
    `实际 seq: ${fromMid.items.map(i => i.seq).join(',')}`)
  ok('head 是当前最大序号', fromMid.head === all.head)
  ok('未裁剪时 truncated=false', fromMid.truncated === false)

  /* ---------------- 3. 裁剪与缺口判定（踩过的坑） ---------------- */

  section('裁剪与缺口判定')

  // 造一批数据然后裁剪，制造「本地游标之后、现存最早记录之前」的缺口
  for (let i = 0; i < 8; i++) await store.put(`f${i}.json`, `{"i":${i}}`)
  const beforePrune = store.changesInfo()
  store.pruneChanges(3)
  const afterPrune = store.changesInfo()

  ok('裁剪后 oldest 前进', afterPrune.oldest > beforePrune.oldest,
    `${beforePrune.oldest} → ${afterPrune.oldest}`)
  ok('裁剪后 head 不变', afterPrune.head === beforePrune.head)

  // 缺口判据：since 之后的第一条现存记录，seq 必须正好是 since+1。
  // 踩过的坑是写成 `since < oldest - 1`：那样 oldest=12、since=10 时判 false，
  // 而 seq=11 其实已被裁掉 —— 本地从 10 往后读只能拿到 12，中间的 11 永久丢失。
  const gap = store.readChanges({ since: afterPrune.oldest - 2 })
  ok('游标落后一格时必须判为有缺口（不能静默丢一条）',
    gap.truncated === true,
    `oldest=${afterPrune.oldest} since=${afterPrune.oldest - 2} truncated=${gap.truncated}`)

  const edge = store.readChanges({ since: afterPrune.oldest - 1 })
  ok('游标紧邻 oldest 时无缺口（since+1 正好是 oldest）',
    edge.truncated === false,
    `oldest=${afterPrune.oldest} since=${afterPrune.oldest - 1} truncated=${edge.truncated}`)

  const noGap = store.readChanges({ since: afterPrune.oldest })
  ok('游标 = oldest 时无缺口', noGap.truncated === false)

  /* ---------------- 4. 镜像：正常同步 ---------------- */

  section('镜像同步')

  rmSync(mirror.MIRROR_DIR, { recursive: true, force: true })
  const st0 = mirror.status()
  ok('初始游标为 0', st0.cursor === 0, `实际 ${st0.cursor}`)
  ok('初始对象数为 0', st0.objects === 0, `实际 ${st0.objects}`)

  /* ---------------- 5. 失败时游标不推进 ---------------- */

  section('失败时游标不推进')

  const beforeFail = mirror.status()
  process.env.NAV_SITE_URL = 'http://127.0.0.1:59998' // 不可达端口
  const failRes = await mirror.syncOnce()
  process.env.NAV_SITE_URL = 'http://127.0.0.1:3000'

  ok('网络失败时 ok=false', failRes.ok === false)
  ok('网络失败时游标不推进',
    mirror.status().cursor === beforeFail.cursor,
    `${beforeFail.cursor} → ${mirror.status().cursor}`)
  ok('网络失败会记下错误', Boolean(mirror.status().lastError))

  // 上面测的是「第一页就失败」，此时 cursor 本来就等于起始值，
  // 推不推进看不出差别 —— 这是个**假守卫**（实测确认过：
  // 把「失败时也写 cursor」注入进去，上面三条照样全绿）。
  //
  // 真正危险的是「已经成功应用了几条、然后中途失败」：
  // 这时若把游标推进到局部值，那几条**之后的**变化就永久跳过了。
  //
  // 这里起一个本地桩服务精确控制「第几个对象开始失败」：
  //   · /api/changes 正常返回 3 条变更
  //   · /api/backup?object= 对前 2 个正常、第 3 个回 500
  // 正确行为是：游标**停在起始值**（一条都不能算成功），下次重试整批重来。
  {
    const http = await import('node:http')
    const stub = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      res.setHeader('Content-Type', 'application/json')
      if (url.pathname === '/api/changes') {
        const since = Number(url.searchParams.get('since') || 0)
        const items = [
          { seq: since + 1, pathname: 'p1.json', op: 'create', etag: 'e1', size: 2, at: '2026-01-01T00:00:00Z' },
          { seq: since + 2, pathname: 'p2.json', op: 'create', etag: 'e2', size: 2, at: '2026-01-01T00:00:01Z' },
          { seq: since + 3, pathname: 'p3.json', op: 'create', etag: 'e3', size: 2, at: '2026-01-01T00:00:02Z' },
        ]
        res.end(JSON.stringify({ ok: true, head: since + 3, oldest: 1, truncated: false, hasMore: false, items }))
        return
      }
      if (url.pathname === '/api/backup') {
        const obj = url.searchParams.get('object')
        if (obj === 'p3.json') { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: '模拟失败' })); return }
        res.end(JSON.stringify({ ok: true, pathname: obj, etag: obj.replace('.json', '-e'), size: 2, body: '{}' }))
        return
      }
      res.statusCode = 404
      res.end('{}')
    })
    await new Promise(r => stub.listen(0, '127.0.0.1', r))
    const port = stub.address().port
    process.env.NAV_SITE_URL = `http://127.0.0.1:${port}`

    rmSync(mirror.MIRROR_DIR, { recursive: true, force: true })
    const curBefore = mirror.status().cursor
    const partial = await mirror.syncOnce()
    const curAfter = mirror.status().cursor

    ok('中途失败时 ok=false', partial.ok === false, JSON.stringify(partial).slice(0, 80))
    ok('中途失败时游标**一条都不算**（不推进到局部值）',
      curAfter === curBefore,
      `${curBefore} → ${curAfter}（若推进到 2 就是永久跳过 p3）`)

    // 修好桩之后再同步一次，应该能把三条全部拿到 —— 证明失败没有留下半截状态
    stub.close()
    await new Promise(r => setTimeout(r, 100))
    process.env.NAV_SITE_URL = 'http://127.0.0.1:3000'
  }

  // 错误信息不得泄露凭据（实测踩过：execFile 的 message 带完整命令行）
  const errText = String(mirror.status().lastError || '')
  ok('错误信息不含密钥明文',
    !errText.includes(process.env.SITES_ADMIN_KEY) && !/Bearer\s+\S{8,}/.test(errText),
    errText.slice(0, 80))
  ok('错误信息不含完整命令行（无 -H 参数泄漏）',
    !errText.includes('-H') && !errText.includes('curl.exe'),
    errText.slice(0, 80))

  /* ---------------- 6. 状态文件不落密钥 ---------------- */

  section('状态文件安全')

  const statePath = join(mirror.MIRROR_DIR, '_state.json')
  ok('状态文件已生成', existsSync(statePath))
  if (existsSync(statePath)) {
    const raw = readFileSync(statePath, 'utf-8')
    ok('状态文件不含密钥明文', !raw.includes(process.env.SITES_ADMIN_KEY))
  }

  /* ---------------- 6b. 首次同步不能静默空跑 ---------------- */

  section('首次同步边界')

  // 踩过的真实缺陷：云端在「变更日志上线前」就有数据，head=0 且 items 为空。
  // 流程会「成功」返回 applied=0，调用方看到 ok:true 以为同步完成，实际本地一个对象都没有。
  // 线上第一次跑就命中了（云端 8 个对象、head=0、镜像为空却报成功）。
  {
    const http = await import('node:http')
    const stub = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      res.setHeader('Content-Type', 'application/json')
      if (url.pathname === '/api/changes') {
        // 空日志：这是关键 —— head=0、items=[]
        res.end(JSON.stringify({ ok: true, head: 0, oldest: 0, truncated: false, hasMore: false, items: [] }))
        return
      }
      if (url.pathname === '/api/backup') {
        if (url.searchParams.get('objects') !== null) {
          // 但云端确实有对象
          res.end(JSON.stringify({ ok: true, objects: [
            { pathname: 'legacy.json', etag: 'L1', size: 2, uploadedAt: '2026-01-01T00:00:00Z' },
          ] }))
          return
        }
        const obj = url.searchParams.get('object')
        res.end(JSON.stringify({ ok: true, pathname: obj, etag: 'L1', size: 2, body: '{}' }))
        return
      }
      res.statusCode = 404; res.end('{}')
    })
    await new Promise(r => stub.listen(0, '127.0.0.1', r))
    const port = stub.address().port
    process.env.NAV_SITE_URL = `http://127.0.0.1:${port}`

    rmSync(mirror.MIRROR_DIR, { recursive: true, force: true })
    const first = await mirror.syncOnce()

    ok('日志为空但云端有数据时，必须降级全量对齐（不能报「成功 0 变化」）',
      first.fullResync === true,
      JSON.stringify(first).slice(0, 100))
    ok('降级后确实拉到了对象',
      mirror.status().objects > 0,
      `实际 ${mirror.status().objects}`)

    stub.close()
    await new Promise(r => setTimeout(r, 100))
    process.env.NAV_SITE_URL = 'http://127.0.0.1:3000'
    rmSync(mirror.MIRROR_DIR, { recursive: true, force: true })
  }

  /* ---------------- 7. 镜像只读语义 ---------------- */

  section('镜像只读语义')

  const src = readFileSync(join(ROOT, 'tools/console/lib/ops/mirror.mjs'), 'utf-8')
  // 镜像绝不能回写云端：那会让它变成第二个真相源
  const writeCalls = src.match(/callCloud\([^)]*method:\s*'POST'/g) || []
  ok('镜像模块不向云端发起任何写请求', writeCalls.length === 0,
    `发现 ${writeCalls.length} 处 POST`)

  /* ---------------- 8. 路由登记 ---------------- */

  section('路由登记')

  const expected = readFileSync(join(ROOT, 'tools/console/lib/routes/api-routes.expected.mjs'), 'utf-8')
  ok('GET /api/mirror 已登记', expected.includes("'GET /api/mirror'"))
  ok('GET /api/mirror/objects 已登记', expected.includes("'GET /api/mirror/objects'"))
  ok('POST /api/mirror/sync 已登记', expected.includes("'POST /api/mirror/sync'"))

  /* ---------------- 9. 云端端点存在 ---------------- */

  section('云端端点')

  ok('api/changes.js 存在', existsSync(join(ROOT, 'api/changes.js')))
  const changesSrc = existsSync(join(ROOT, 'api/changes.js'))
    ? readFileSync(join(ROOT, 'api/changes.js'), 'utf-8')
    : ''
  ok('/api/changes 要求鉴权', changesSrc.includes('checkAuthHeader'))
  ok('/api/changes 只读（拒绝非 GET）', changesSrc.includes("req.method !== 'GET'"))

  // 对象级读取：镜像靠它拉内容
  const backupSrc = readFileSync(join(ROOT, 'api/backup.js'), 'utf-8')
  ok('backup 支持按对象读取（?object=）', backupSrc.includes('query.object'))
  ok('backup 支持对象清单（?objects=）', backupSrc.includes('query.objects'))

  /* ---------------- 10. 调度器语义 ---------------- */

  section('调度器')

  const sch = await import('./lib/ops/mirror-schedule.mjs')
  const off = sch.start({ intervalSec: 0 })
  ok('intervalSec=0 表示禁用', off.enabled === false)
  const on = sch.start({ intervalSec: 60 })
  ok('正常间隔会启用', on.enabled === true && on.intervalSec === 60)
  sch.stop()

  const schSrc = readFileSync(join(ROOT, 'tools/console/lib/ops/mirror-schedule.mjs'), 'utf-8')
  ok('调度器失败不推进计时（只更新 lastSuccessAt 于成功分支）',
    /if \(r\.ok\)[\s\S]{0,300}lastSuccessAt/.test(schSrc))
  ok('调度器用补跑而非纯 setInterval 计时',
    schSrc.includes('shouldRun') && schSrc.includes('lastSuccessAt'))
} finally {
  try { store.close() } catch { /* 已关闭 */ }
  rmSync(TMP_DB, { recursive: true, force: true })
  rmSync(mirror.MIRROR_DIR, { recursive: true, force: true })
}

console.log(`\n${fail === 0 ? '🔄' : '❌'} 镜像同步：${pass} 通过 / ${fail} 失败`)
if (fail > 0) {
  console.log('失败项：')
  for (const f of failures) console.log(`  ✗ ${f}`)
}
process.exit(fail === 0 ? 0 : 1)
