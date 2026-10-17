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
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }

/* ============ 1. isTrusted：鉴权 / CSRF 拒绝 ============ */
{
  const { isTrusted } = await import('./lib/api.mjs')
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

  const { resolveEndpoints } = await import('./lib/endpoints.mjs')

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
    const { publishAll } = await import('./lib/deploy.mjs')
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
  const deploySrc = read('tools/console/lib/deploy.mjs')
  ok(/eps\.length\s*\?[\s\S]{0,120}publishAll/.test(deploySrc),
    'startPublish 对「显式给了端点」走 publishAll（含只给一个 —— 否则单选镜像站会发到默认端点）')
  ok(/endpoints:\s*eps/.test(deploySrc), 'startPublish 把解析后的端点数组传给 publishAll')
  ok(/function applyEndpointEnv/.test(deploySrc) && /function restoreEnv/.test(deploySrc),
    '端点环境变量切换与恢复函数仍在（不得被覆盖）')

  const apiSrc = read('tools/console/lib/api.mjs')
  ok(/endpointsCfg\.resolveEndpoints\(\s*body\.endpoints\s*\)/.test(apiSrc),
    'publish 路由用 resolveEndpoints 解析请求里的端点')
  ok(/if\s*\(picked && !picked\.ok\)[\s\S]{0,160}sendJson\(res,\s*400/.test(apiSrc),
    '未知端点 → 400（明确报错，不静默发布）')
}

/* ---------------- 报告 ---------------- */
console.log(`\n部署多端点发布链路用例（N2 补齐）：${pass} 通过，${failures.length} 失败`)
if (failures.length) {
  for (const f of failures) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('  ✓ 全部通过')
