/**
 * 部署多端点发布链路用例（N2 补齐）：零依赖、不联网、**绝不触发真实上传**。
 *
 * 任务书要求「端点多选 + 鉴权拒绝」用例。分四层，都不碰真实发布：
 *   1. `isTrusted` 纯函数 —— 来源 / CSRF 鉴权拒绝（控制台唯一的鉴权闸门）；
 *   2. `resolveEndpoints` —— 空/单选/多选/未知 id；
 *   3. `publishAll` 行为 —— 无凭据下**逐端点回报、失败不静默、一个失败不阻断其余**
 *      （凭据缺失时 publish 在构建之前就抛，所以不会真的构建或上传）；
 *   4. 静态不变量 —— 钉住「startPublish 对显式端点必须走多端点路径」与
 *      「路由层未知端点转 400」，防将来有人把它改回只走单端点（那会把镜像站选择丢掉）。
 *
 * 运行：node tools/console/test-endpoints-run.mjs
 */
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/**
 * 控制台路由域文件集（`api.mjs` 是分发起，路由体在 `api-<域>.mjs`）。
 * 静态断言针对「路由层」而不是某一个文件名 —— 否则路由换个文件归置，
 * 断言就会在悄悄失效的同时继续报绿。
 */
const ROUTE_FILES = ['api.mjs', 'api-http.mjs', 'api-system.mjs', 'api-git.mjs', 'api-sites.mjs', 'api-health.mjs', 'api-ops.mjs']
  .map((f) => `tools/console/lib/routes/${f}`)

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }

/* ============ 1. isTrusted：鉴权 / CSRF 拒绝 ============ */
{
  const { isTrusted } = await import('./lib/routes/api.mjs')
  const req = (headers, method = 'GET') => ({ headers, method })
  const H = (o) => ({ host: '127.0.0.1:5175', ...o })

  ok(isTrusted(req(H({ 'x-nav-console': '1' }), 'POST')), '回环 Host + X-Nav-Console → 放行')
  ok(isTrusted(req(H({}), 'GET')), '回环 Host 的 GET → 放行（读接口不需 CSRF 头）')

  ok(!isTrusted(req({ host: 'evil.example.com', 'x-nav-console': '1' }, 'POST')),
    '非回环 Host → 拒绝')
  ok(!isTrusted(req({ host: '192.168.1.9:5175', 'x-nav-console': '1' }, 'POST')),
    '局域网 IP（非回环）→ 拒绝')

  ok(!isTrusted(req(H({ origin: 'https://evil.example.com' }), 'GET')),
    '外部 Origin → 拒绝')
  ok(isTrusted(req(H({ origin: 'http://127.0.0.1:5175' }), 'GET')),
    '回环 Origin → 放行')

  ok(!isTrusted(req(H({}), 'POST')), '非 GET 缺 X-Nav-Console 头 → 拒绝（CSRF 防护）')
  ok(!isTrusted(req(H({}), 'DELETE')), '非 GET 缺 CSRF 头 → 拒绝')

  // 端口无关：回环的任意端口都算可信（控制台端口可配）
  ok(isTrusted(req({ host: 'localhost:8080', 'x-nav-console': '1' }, 'POST')), 'localhost 任意端口 → 放行')
  ok(isTrusted(req({ host: '[::1]:5175', 'x-nav-console': '1' }, 'POST')), 'IPv6 回环字面量 → 放行')
}

/* ============ 2. resolveEndpoints：空 / 单选 / 多选 / 未知 ============ */
{
  const saved = process.env.NAV_DEPLOY_ENDPOINTS
  process.env.NAV_DEPLOY_ENDPOINTS = JSON.stringify([
    { id: 'mirror', label: '镜像站', url: 'https://mirror.example.com/', workloadId: 'wl-x', key: 'bk-x' },
    { id: 'backup', label: '备用站', url: 'https://backup.example.com', workloadId: 'wl-y', key: 'bk-y' },
  ])
  process.env.DEPLOY_SITE_URL = 'https://main.example.com'

  const { resolveEndpoints } = await import('./lib/publish/endpoints.mjs')

  const empty = resolveEndpoints([])
  ok(empty.ok && empty.endpoints.length === 1 && empty.endpoints[0].id === 'default',
    '空选择 → 只默认端点（单端点行为不变）')

  const one = resolveEndpoints(['mirror'])
  ok(one.ok && one.endpoints.length === 1 && one.endpoints[0].id === 'mirror',
    '单选非默认端点 → 正确命中（不是默认端点）')

  const many = resolveEndpoints(['mirror', 'backup', 'default'])
  ok(many.ok && many.endpoints.length === 3, '多选三个 → 返回三个')

  const dedup = resolveEndpoints(['mirror', 'mirror'])
  ok(dedup.ok && dedup.endpoints.length === 1, '重复 id 去重')

  const bad = resolveEndpoints(['nope'])
  ok(!bad.ok && /nope/.test(bad.error || ''), '未知 id → 解析失败且点名（路由层转 400）')

  if (saved === undefined) delete process.env.NAV_DEPLOY_ENDPOINTS
  else process.env.NAV_DEPLOY_ENDPOINTS = saved
}

/* ============ 3. publishAll：无凭据下逐端点回报，失败不静默 ============ */
{
  // 关键：**先占住**这几个 env（含空串），loadEnv 见 `in process.env` 就不会从 .env.local 读回真凭据。
  // 于是 credentials() 返回空 → publish 在构建前即抛 → 不会构建、不会上传。
  const saved = {}
  for (const k of ['BOTKEEP_API_KEY', 'BK_KEY', 'BOTKEEP_WORKLOAD_ID', 'BK_WID']) {
    saved[k] = process.env[k]
    process.env[k] = ''
  }
  try {
    const { publishAll } = await import('./lib/publish/deploy.mjs')
    const eps = [
      { id: 'mirror', label: '镜像站', url: 'https://mirror.example.com', workloadId: '', key: '' },
      { id: 'backup', label: '备用站', url: 'https://backup.example.com', workloadId: '', key: '' },
    ]
    const logs = []
    const r = await publishAll({ log: t => logs.push(t), skipBuild: true, endpoints: eps })

    ok(Array.isArray(r.results) && r.results.length === 2,
      '每个端点各有一条结果（不静默少发）', `实得 ${r.results?.length}`)
    ok(r.results.every(x => 'endpoint' in x && 'ok' in x),
      '结果里每个端点都带 endpoint 与 ok 字段')
    ok(r.results.map(x => x.endpoint).join(',') === 'mirror,backup',
      '结果按端点顺序、点名各自 id')
    ok(r.results.every(x => x.ok === false && x.error), '无凭据时每个端点都如实报失败（带原因）')
    ok(r.ok === false, '整体 ok=false（有端点失败）')
    ok(logs.some(t => /镜像站/.test(t)) && logs.some(t => /备用站/.test(t)),
      '两个端点都各自出现在日志里（失败不静默）')
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

/* ============ 4. 静态不变量：防「显式端点被悄悄降级成单端点」回退 ============ */
{
  const deploySrc = read('tools/console/lib/publish/deploy.mjs')
  ok(/eps\.length\s*\?[\s\S]{0,120}publishAll/.test(deploySrc),
    'startPublish 对「显式给了端点」走 publishAll（含只给一个 —— 否则单选镜像站会发到默认端点）')
  ok(/endpoints:\s*eps/.test(deploySrc), 'startPublish 把解析后的端点数组传给 publishAll')
  ok(/function applyEndpointEnv/.test(deploySrc) && /function restoreEnv/.test(deploySrc),
    '端点环境变量切换与恢复函数仍在（不得被覆盖）')

  // 路由已按域拆分，publish 路由在 api-ops.mjs；读整个路由域文件集，
  // 避免「拆到别的文件后这条断言失效却仍然报绿」
  const routeSrc = ROUTE_FILES.map(read).join('\n')
  ok(/endpointsCfg\.resolveEndpoints\(\s*body\.endpoints\s*\)/.test(routeSrc),
    'publish 路由用 resolveEndpoints 解析请求里的端点')
  ok(/if\s*\(picked && !picked\.ok\)[\s\S]{0,160}sendJson\(res,\s*400/.test(routeSrc),
    '未知端点 → 400（明确报错，不静默发布）')
}

/* ============ 5. N2 幂等键：重复请求不得重复部署 ============ */
{
  // 与第 3 节同法：先占住凭据 env（含空串），publish 在构建前即抛 —— 不联网、不构建
  const saved = {}
  for (const k of ['BOTKEEP_API_KEY', 'BK_KEY', 'BOTKEEP_WORKLOAD_ID', 'BK_WID']) {
    saved[k] = process.env[k]
    process.env[k] = ''
  }
  const idemFile = join(ROOT, 'tools', 'console', '.data', 'deploy-idempotency.json')
  let original = null
  let hadFile = true
  try { original = readFileSync(idemFile, 'utf8') } catch { hadFile = false }

  try {
    const { startPublish } = await import('./lib/publish/deploy.mjs')
    const jobsMod = await import('./lib/core/jobs.mjs')
    const waitDone = async (id) => {
      for (let i = 0; i < 120; i++) {
        const j = jobsMod.getJob(id)
        if (!j || j.status !== 'running') return j
        await new Promise(r => setTimeout(r, 50))
      }
      return jobsMod.getJob(id)
    }
    let seq = 0
    const K = (s) => `test-idem-${s}-${Date.now()}-${++seq}`.slice(0, 64)

    const key = K('same')
    const j1 = startPublish({ skipBuild: true, idempotencyKey: key })
    ok(!!(j1 && j1.id), '首次带幂等键发布 → 返回任务')
    const j2 = startPublish({ skipBuild: true, idempotencyKey: key })
    ok(j2.id === j1.id, '同 key 重复请求 → 返回同一任务（未重复部署）', `实得 ${j2.id} vs ${j1.id}`)
    ok(Number(j2.replayed) >= 1, '重复请求被标记为幂等回放（replayed）')
    await waitDone(j1.id)
    const j3 = startPublish({ skipBuild: true, idempotencyKey: key })
    ok(j3.id === j1.id, '任务结束后再用同 key → 仍回放同一任务，不再发一次')

    const ledger = JSON.parse(readFileSync(idemFile, 'utf8'))
    ok(ledger[key] && ledger[key].jobId === j1.id, '幂等台账已落盘（控制台重启后仍有据可查）')

    let threwShort = ''
    try { startPublish({ skipBuild: true, idempotencyKey: 'short' }) } catch (e) { threwShort = e.message }
    ok(/不合规/.test(threwShort), '幂等键格式不合规 → 明确抛错，不静默接受', threwShort)

    // 模拟「控制台重启」：台账里有、内存里没有该任务 —— 绝不能当没发生过再发一次
    const ghost = K('ghost')
    const l2 = JSON.parse(readFileSync(idemFile, 'utf8'))
    l2[ghost] = { jobId: 'deadbeef', endpoints: 'default', at: Date.now() }
    writeFileSync(idemFile, JSON.stringify(l2))
    let threwGhost = ''
    try { startPublish({ skipBuild: true, idempotencyKey: ghost }) } catch (e) { threwGhost = e.message }
    ok(/已用于任务|避免重复部署/.test(threwGhost), '重启后（台账有、内存无）同 key → 拒绝而非重发', threwGhost)

    const epKey = K('ep')
    const ja = startPublish({ skipBuild: true, idempotencyKey: epKey, endpoints: [{ id: 'mirror', label: '镜像站', url: 'https://mirror.example.com' }] })
    await waitDone(ja.id)
    let threwEp = ''
    try {
      startPublish({ skipBuild: true, idempotencyKey: epKey, endpoints: [{ id: 'backup', label: '备用站', url: 'https://backup.example.com' }] })
    } catch (e) { threwEp = e.message }
    ok(/端点/.test(threwEp), '同一幂等键换端点 → 拒绝（防绕过端点确认）', threwEp)
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    try {
      if (hadFile) writeFileSync(idemFile, original)
      else rmSync(idemFile)
    } catch { /* 清理失败不影响用例结论（最多在 .data 下留一条测试键） */ }
  }
}

/* ============ 6. 静态不变量：防幂等能力被回退掉 ============ */
{
  const routeSrc = ROUTE_FILES.map(read).join('\n')
  ok(/idempotency-key/.test(routeSrc), '发布路由读 Idempotency-Key 请求头')
  ok(/idempotencyKey:\s*idem/.test(routeSrc), '路由把幂等键传给 startPublish')
  const deploySrc = read('tools/console/lib/publish/deploy.mjs')
  ok(/IDEM_FILE/.test(deploySrc) && /writeIdemLedger/.test(deploySrc), '幂等台账落盘实现仍在')
  ok(/避免重复部署，本次请求被拒绝/.test(deploySrc), '重启后重复请求的拒绝分支仍在（防回退成「重复部署」）')
}

/* ---------------- 报告 ---------------- */
console.log(`\n部署多端点发布链路用例（N2 补齐）：${pass} 通过，${failures.length} 失败`)
if (failures.length) {
  for (const f of failures) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('  ✓ 全部通过')
