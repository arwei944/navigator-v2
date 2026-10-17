/**
 * 部署端点注册表用例（N2）：零依赖、不联网、不触发真实发布会。
 *
 * 守的核心是**向后兼容**与**凭据不外泄**：
 *   · 不配额外端点时，只有默认端点，且 resolveEndpoints([]) 只选它 —— 单端点行为不变；
 *   · 单选 / 多选都正确解析；未知 id 明确报错而不是静默少发；
 *   · publicEndpoints()（给清单接口用）**绝不包含 key / workloadId 等凭据材料**。
 *
 * 运行：node tools/console/test-endpoints.mjs
 */
import { listEndpoints, publicEndpoints, resolveEndpoints } from '../console/lib/endpoints.mjs'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

const saved = {
  list: process.env.NAV_DEPLOY_ENDPOINTS,
  url: process.env.DEPLOY_SITE_URL,
  wid: process.env.BOTKEEP_WORKLOAD_ID,
  key: process.env.BOTKEEP_API_KEY,
}
const restore = () => {
  for (const [k, v] of Object.entries({
    NAV_DEPLOY_ENDPOINTS: saved.list, DEPLOY_SITE_URL: saved.url,
    BOTKEEP_WORKLOAD_ID: saved.wid, BOTKEEP_API_KEY: saved.key,
  })) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

/* ---------------- 无额外端点：向后兼容 ---------------- */
{
  delete process.env.NAV_DEPLOY_ENDPOINTS
  process.env.DEPLOY_SITE_URL = 'https://main.example.com/'
  process.env.BOTKEEP_WORKLOAD_ID = 'wl-main'
  process.env.BOTKEEP_API_KEY = 'bk-main'

  const list = listEndpoints()
  eq(list.length, 1, '未配额外端点时只有默认端点')
  eq(list[0].id, 'default', '默认端点 id 是 default')
  eq(list[0].url, 'https://main.example.com', '默认端点 URL 去掉尾斜杠')

  const picked = resolveEndpoints([])
  ok(picked.ok, '空选择解析成功')
  eq(picked.endpoints.length, 1, '空选择 = 只选默认端点（单端点行为不变）')
  eq(picked.endpoints[0].id, 'default', '空选择得到的就是默认端点')
}

/* ---------------- 配了额外端点 ---------------- */
{
  process.env.NAV_DEPLOY_ENDPOINTS = JSON.stringify([
    { id: 'mirror', label: '镜像站', url: 'https://mirror.example.com/', workloadId: 'wl-mirror', key: 'bk-mirror' },
    { id: 'backup', label: '备用站', url: 'https://backup.example.com', workloadId: 'wl-backup', key: 'bk-backup' },
  ])

  const list = listEndpoints()
  eq(list.length, 3, '默认 + 2 个额外端点')
  eq(list[1].url, 'https://mirror.example.com', '额外端点 URL 也去尾斜杠')

  /* 单选 */
  const one = resolveEndpoints(['mirror'])
  ok(one.ok, '单选解析成功')
  eq(one.endpoints.length, 1, '单选只返回一个')
  eq(one.endpoints[0].id, 'mirror', '单选命中的是 mirror')

  /* 多选 */
  const many = resolveEndpoints(['mirror', 'backup', 'default'])
  ok(many.ok, '多选解析成功')
  eq(many.endpoints.length, 3, '多选返回三个')

  /* 未知端点：明确报错，不静默少发 */
  const bad = resolveEndpoints(['nope'])
  ok(!bad.ok, '未知端点解析失败')
  ok(/nope/.test(bad.error || ''), '错误信息里点名未知的 id')

  /* 保留 id 不能被额外端点占用 */
  process.env.NAV_DEPLOY_ENDPOINTS = JSON.stringify([{ id: 'default', url: 'https://evil.example.com' }])
  eq(listEndpoints().length, 1, "额外端点里 id='default' 被忽略（保留 id）")
  eq(listEndpoints()[0].url, 'https://main.example.com', '默认端点未被覆盖')
}

/* ---------------- 公开视图不含凭据 ---------------- */
{
  process.env.NAV_DEPLOY_ENDPOINTS = JSON.stringify([
    { id: 'mirror', label: '镜像站', url: 'https://mirror.example.com', workloadId: 'wl-secret', key: 'bk-secret-key' },
  ])
  const pub = publicEndpoints()
  const json = JSON.stringify(pub)
  ok(!/bk-secret-key/.test(json), 'publicEndpoints 不含 API key')
  ok(!/wl-secret/.test(json), 'publicEndpoints 不含 workloadId')
  ok(pub.every(e => typeof e.hasCredentials === 'boolean'), 'publicEndpoints 只回「配没配」布尔值')
  ok(pub.find(e => e.id === 'mirror')?.hasCredentials === true, '配了凭据的端点 hasCredentials=true')
}

/* ---------------- 坏配置容错 ---------------- */
{
  process.env.NAV_DEPLOY_ENDPOINTS = '{ 坏 JSON'
  eq(listEndpoints().length, 1, '坏 JSON 退回默认端点，不抛')
  process.env.NAV_DEPLOY_ENDPOINTS = '{"not":"array"}'
  eq(listEndpoints().length, 1, '非数组配置退回默认端点')
}

restore()

/* ---------------- 报告 ---------------- */
console.log(`\n部署端点注册表用例（N2）：${pass} 通过，${failures.length} 失败`)
if (failures.length) {
  for (const f of failures) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('  ✓ 全部通过')
