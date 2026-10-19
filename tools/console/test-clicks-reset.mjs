/**
 * 点击清空端点守卫：真实启动服务，验证 DELETE /api/clicks 的鉴权与行为。
 *
 * ## 为什么需要真机
 *
 * 静态断言只能确认「代码里写了 checkAuthHeader」，确认不了：
 *   · 匿名请求真的被拒（401），且**拒的时候没有把数据清掉**；
 *   · 鉴权请求真的清空，且返回的是空态；
 *   · 清空后 GET 也读到空 —— 证明写的是同一份存储。
 *
 * 第三条尤其重要：清空写成「写到别处」或「只清缓存」，静态断言看不出来。
 *
 * ## 用临时数据目录
 *
 * 不改仓库里的 `dist/data`：测试写入 `NAV_STORE_DIR` 指定的临时目录，
 * 跑完即删。否则「跑一次门禁清空一次线上本地库」这种事迟早会发生。
 *
 * 运行：node tools/console/test-clicks-reset.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = 5322
const ROOT = process.cwd()
const DIST = join(ROOT, 'dist')

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }

if (!existsSync(join(DIST, 'server.js'))) {
  console.error('\n❌ 缺少 dist/server.js —— 先跑 npm run build')
  process.exit(1)
}

const storeDir = await mkdtemp(join(tmpdir(), 'nav-clicks-'))
const server = spawn(process.execPath, ['server.js'], {
  cwd: DIST,
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NAV_STORE_DIR: storeDir },
  stdio: ['ignore', 'pipe', 'pipe'],
})

const ready = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 20000)
  const onData = (b) => { if (String(b).includes('listening on')) { clearTimeout(timer); resolve(true) } }
  server.stdout.on('data', onData)
  server.stderr.on('data', onData)
  server.on('exit', () => { clearTimeout(timer); resolve(false) })
})

const base = `http://127.0.0.1:${PORT}`

try {
  ok(ready, '服务已启动', ready ? '' : `${PORT} 未就绪`)

  if (ready) {
    // 测试用的管理员密钥（服务启动时从 data/admin-key.txt 回填的同一个值）
    const keyPath = join(DIST, 'data', 'admin-key.txt')
    const key = existsSync(keyPath) ? (await readFile(keyPath, 'utf8')).trim() : ''
    ok(Boolean(key), '读到本地管理员密钥（构建产物里的 data/admin-key.txt）')

    /* ① 先造一些点击数据 */
    const seed = await fetch(`${base}/api/clicks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clicks: [{ id: 's1', n: 4 }, { id: 's2', n: 2 }] }),
    }).then(r => r.json()).catch(() => null)
    ok(seed && seed.total === 6, '写入测试点击数据', `total=${seed?.total}`)

    /* ② 匿名 DELETE 必须被拒 */
    const anon = await fetch(`${base}/api/clicks`, { method: 'DELETE' })
    ok(anon.status === 401, '匿名清空被拒绝（401）', `实得 ${anon.status}`)

    /* ③ 被拒之后数据必须还在 —— 「先清空再报错」是最危险的反向实现 */
    const afterAnon = await fetch(`${base}/api/clicks`).then(r => r.json()).catch(() => null)
    ok(afterAnon && afterAnon.total === 6, '拒绝时没有清掉任何数据', `total=${afterAnon?.total}`)

    /* ④ 带鉴权清空 */
    const del = await fetch(`${base}/api/clicks`, {
      method: 'DELETE',
      headers: { 'X-Nav-Key': key },
    })
    ok(del.status === 200, '带鉴权清空成功', `实得 ${del.status}`)
    const delBody = await del.json().catch(() => null)
    ok(delBody && delBody.ok === true, '返回 ok:true')
    ok(delBody && delBody.total === 0, '返回体是空态', `total=${delBody?.total}`)

    /* ⑤ GET 读到空 —— 证明清的是同一份存储，不是只清了缓存 */
    const after = await fetch(`${base}/api/clicks`).then(r => r.json()).catch(() => null)
    ok(after && after.total === 0, '清空后 GET 读到空', `total=${after?.total}`)
    ok(after && Object.keys(after.clicks || {}).length === 0, 'clicks 明细已清空')
    ok(after && Object.keys(after.series || {}).length === 0, 'series 趋势也已清空（不留孤儿桶）')

    /* ⑥ 清空后还能正常再加 —— 端点没有把存储写坏 */
    const again = await fetch(`${base}/api/clicks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clicks: [{ id: 's1', n: 1 }] }),
    }).then(r => r.json()).catch(() => null)
    ok(again && again.total === 1, '清空后可继续累加', `total=${again?.total}`)
  }
} finally {
  server.kill()
  await rm(storeDir, { recursive: true, force: true }).catch(() => {})
}

console.log(`\n🧹 点击清空端点：${pass} 通过 / ${failures.length} 失败`)
if (failures.length) {
  console.log('\n失败明细：')
  for (const f of failures) console.log(`- ${f}`)
  process.exit(1)
}
console.log('  ✓ 匿名拒绝｜拒绝时不清数据｜鉴权清空｜GET 同步为空｜清后可继续累加')
