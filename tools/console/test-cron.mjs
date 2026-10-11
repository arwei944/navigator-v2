/**
 * `server/cron.mjs` 巡检路径守卫（v10 第三批）。
 *
 * 为什么要有这个：cron 是**进程内定时任务**，没有请求会打进来，失败时既没有 4xx/5xx
 * 也没有前端症状 —— 线上表现只是「健康角标一直是空的」，极难归因。
 * 这个测试把整条链路真跑一遍：临时库 → 三个站点（可达 / 域名不存在 / 内网地址）→
 * 跑一轮 → 断言落库内容与 SSRF 拦截。
 *
 * 依赖真实出网（三个站点各自可能耗时到超时上限），所以整轮最长约 30s；
 * 但它守住的是「巡检到底能不能用」这条最容易静默坏掉的链路。
 *
 * 运行：node tools/console/test-cron.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'nav-cron-'))
process.env.NAV_STORE_DIR = dir
delete process.env.NAV_CRON

const store = await import('../../server/store.mjs')
const { startHealthCron } = await import('../../server/cron.mjs')

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }

/* 三个探针目标：可达站点 / 域名不存在 / 内网地址（必须被 SSRF 拦下） */
const SITES = [
  { id: 'ok1', name: '可达', url: 'https://example.com/' },
  { id: 'bad1', name: '不存在', url: 'https://nav-v9-nonexistent-test.invalid/' },
  { id: 'ssrf', name: '内网', url: 'http://127.0.0.1:9/' },
]
const ARCHIVED = { id: 'arch', name: '归档站', url: 'https://example.org/', archived: true }
// 站点表里的 url 多数是**裸域名**（真实数据就是 chat.openai.com 这种），
// 巡检必须补协议再探 —— 这条用例就是为「别再按 /^https?:\/\// 过滤」立的。
const BARE = { id: 'bare', name: '裸域名', url: 'example.net' }

await store.put('sites.json', JSON.stringify({ version: 1, sites: [...SITES, ARCHIVED, BARE], updatedAt: new Date().toISOString() }), { allowOverwrite: true })

const cron = startHealthCron()
const payload = await cron.runNow()

try {
  ok(Boolean(payload), '巡检跑完并返回了 payload', payload ? '' : '返回 null（可能被「6h 内已有判定」跳过或读不到站点表）')
  if (payload) {
    const ids = Object.keys(payload.results)
    ok(ids.includes('ok1'), '可达站点有判定', ids.join(','))
    ok(ids.includes('bad1'), '不可达站点也有判定（失败不等于没记录）')
    ok(ids.includes('bare'), '裸域名站点（chat.openai.com 这种）也被探到', ids.join(','))
    ok(!ids.includes('arch'), '归档站被跳过', ids.join(','))
    // 内网地址：net-guard 会在**发请求前**拒掉，判定落成 code=BLOCKED（而不是任何一次真连接）。
    // 这里断言的正是「没有真去连」—— 若防护失效，它的 code 会是 ERR/000（连接失败）
    // 或更糟：ok（真连上了）。
    ok(payload.results.ssrf && payload.results.ssrf.code === 'BLOCKED',
      '内网地址被 SSRF 防护拦下（code=BLOCKED，没有真发请求）', JSON.stringify(payload.results.ssrf))
    ok(payload.results.ssrf && payload.results.ssrf.status !== 'ok',
      '内网地址绝不会被判为可达', payload.results.ssrf && payload.results.ssrf.status)
    ok(payload.counts.total === ids.length, 'counts.total 与实际条目一致', `${payload.counts.total} vs ${ids.length}`)
    ok(payload.version === 1, '首轮 version=1', String(payload.version))
    ok(payload.actor === 'cron', 'actor=cron（与控制台/CLI 的写入区分得开）', payload.actor)

    // 落库验证：真的写进存储了（而不是只在内存里）
    const blob = await store.get('ops/health.json', {})
    ok(Boolean(blob), '判定已落库到 ops/health.json')
    if (blob) {
      const saved = JSON.parse(await new Response(blob.stream).text())
      ok(Object.keys(saved.results).length === ids.length, '落库条目数与返回一致')
    }
  }

  // 幂等：6h 内再跑一次应当跳过（刚探过就别把 300 个站再打一遍）
  const again = await cron.runNow()
  ok(again === null, '6h 内重复触发会跳过（避免重复探测全站）')
} finally {
  cron.stop()
  store.close()
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清不掉留给系统临时目录 */ }
}

if (failures.length) {
  console.error(`\n❌ 巡检链路 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 巡检链路全部通过：${pass} 条断言`)
process.exit(0)