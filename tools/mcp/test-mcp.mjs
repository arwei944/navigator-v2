/**
 * nav-mcp 端到端用例：用官方 SDK 的 Client 走真实 stdio 握手，逐条断言工具契约。
 *
 * 覆盖三类风险：
 *   ① 工具数膨胀 —— 断言恰好 5 个工具，且每个都有描述与输入 schema
 *   ② 写操作裸奔 —— 不带 confirm 时必须只预演，且数据文件哈希不变
 *   ③ 闸门失灵   —— 带 confirm 时必须真的进入执行路径（用一个不存在的 id 触发业务拒绝来验证）
 *
 * 用法: node tools/mcp/test-mcp.mjs   （或 npm run mcp:test）
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const SERVER = join(HERE, 'server.mjs')
const DATA = join(ROOT, 'api', 'sites-data.json')

let pass = 0
const failures = []

function ok(cond, label, extra = '') {
  if (cond) { pass++; console.log(`✅ ${label}`); return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
  console.log(`❌ ${label}${extra ? ` — ${extra}` : ''}`)
}

function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

function dataHash() {
  return createHash('sha256').update(readFileSync(DATA)).digest('hex')
}

const localCount = JSON.parse(readFileSync(DATA, 'utf-8')).length

/** 调用工具并解析回传的 JSON 文本；同时保留 isError 供断言 */
async function call(client, name, args = {}) {
  const r = await client.callTool({ name, arguments: args })
  const text = r.content?.[0]?.text || ''
  let json = null
  try { json = JSON.parse(text) } catch { /* 非 JSON 时保留原文供失败信息 */ }
  return { isError: Boolean(r.isError), json, text }
}

const EXPECTED_TOOLS = ['nav_status', 'nav_sites', 'nav_publish', 'nav_git', 'nav_data']

const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], cwd: ROOT })
const client = new Client({ name: 'nav-mcp-test', version: '1.0.0' })

try {
  await client.connect(transport)

  /* ---------------- ① 工具清单 ---------------- */

  const { tools } = await client.listTools()
  eq(tools.length, EXPECTED_TOOLS.length, `工具数收敛到 ${EXPECTED_TOOLS.length} 个（避免选择准确率退化）`)
  eq(tools.map(t => t.name).sort().join(','), [...EXPECTED_TOOLS].sort().join(','), '工具名与预期一致')

  for (const t of tools) {
    ok(Boolean(t.description && t.description.length > 20), `工具 ${t.name} 有可读描述`)
    ok(Boolean(t.inputSchema && typeof t.inputSchema === 'object'), `工具 ${t.name} 声明了输入 schema`)
  }

  const sitesTool = tools.find(t => t.name === 'nav_sites')
  const actions = sitesTool?.inputSchema?.properties?.action?.enum || []
  ok(actions.includes('add') && actions.includes('check'), 'nav_sites 的 action 枚举覆盖增删改查与探活')
  ok(actions.length <= 12, `nav_sites 动作数受控（${actions.length} 个）`)

  /* ---------------- ② nav_status：智能体第一问 ---------------- */

  const status = await call(client, 'nav_status')
  ok(status.json?.ok !== false, 'nav_status 正常返回')
  eq(status.json.data.cloud.localCount, localCount, 'nav_status 报出的本地站点数与数据文件一致')
  ok(Array.isArray(status.json.data.env?.checks) && status.json.data.env.checks.length > 0, 'nav_status 带回环境自检明细')
  eq(status.json.data.workspace.branch, 'master', 'nav_status 带回当前分支')
  ok(!/SITES_ADMIN_KEY=[^\s]/.test(status.text), 'envSummary 只暴露是否配置，不泄露密钥值')

  /* ---------------- ③ 只读工具 ---------------- */

  const stats = await call(client, 'nav_data', { action: 'stats' })
  eq(stats.json.data.total, localCount, 'nav_data stats 站点总数与本地一致')

  const integrity = await call(client, 'nav_data', { action: 'integrity' })
  ok(typeof integrity.json.data.issueCount === 'number', 'nav_data integrity 返回问题计数')

  const list = await call(client, 'nav_sites', { action: 'list', limit: 3 })
  eq(list.json.data.returned, 3, 'nav_sites list 的 limit 生效')
  ok(list.json.data.total === localCount, 'nav_sites list 报出全量总数')

  const cats = await call(client, 'nav_sites', { action: 'categories' })
  ok(cats.json.data.groups.length > 0, 'nav_sites categories 返回分类树')
  ok(cats.json.data.total > 10, `分类数合理（${cats.json.data.total} 个）`)

  const gs = await call(client, 'nav_git', { action: 'status' })
  eq(gs.json.data.branch, 'master', 'nav_git status 返回分支')

  const remote = await call(client, 'nav_git', { action: 'remote' })
  ok(typeof remote.json.data.url === 'string', 'nav_git remote 返回 origin 地址')

  /* ---------------- ④ 写操作闸门：不带 confirm 只预演 ---------------- */

  const before = dataHash()
  const countsBefore = JSON.stringify(gs.json.data.counts)

  const addPreview = await call(client, 'nav_sites', {
    action: 'add',
    url: 'mcp-gate-test.example.com',
    name: 'MCP 闸门测试',
    desc: '这条记录只应出现在预演结果里，绝不能落盘',
    category: 'data',
  })
  eq(addPreview.json.gate.write, true, 'nav_sites add 被识别为写操作')
  eq(addPreview.json.gate.confirmed, false, '未带 confirm 时标记为未确认')
  eq(addPreview.json.gate.preview, true, '未带 confirm 时降级为预演')
  eq(addPreview.json.data.dryRun, true, '预演结果显式标注 dryRun')
  eq(addPreview.json.data.applied, false, '预演结果显式标注 applied=false')
  ok(Boolean(addPreview.json.data.wouldAdd?.id), '预演给出了将要写入的条目与自动分配的 id')

  const iconPreview = await call(client, 'nav_sites', { action: 'icon', id: 'dt33' })
  eq(iconPreview.json.gate.preview, true, 'nav_sites icon 未带 confirm 时降级为预演')
  eq(iconPreview.json.data.dryRun, true, 'icon 预演标注 dryRun')
  ok(Array.isArray(iconPreview.json.data.candidates), 'icon 预演列出将要尝试的图标来源')

  const stagePreview = await call(client, 'nav_git', { action: 'stage', paths: ['api/sites-data.json'] })
  eq(stagePreview.json.gate.preview, true, 'nav_git stage 未带 confirm 时降级为预演')
  eq(stagePreview.json.data.dryRun, true, 'stage 预演标注 dryRun')

  // 分块动作只断言闸门契约（hunk 数学由 tools/console/test-hunks.mjs 在临时仓库里实测）
  const hunksRead = await call(client, 'nav_git', { action: 'hunks', path: 'api/sites-data.json' })
  eq(hunksRead.json.gate.write, false, 'nav_git hunks 是只读动作，不触发写闸门')
  ok(Array.isArray(hunksRead.json.data?.hunks), 'hunks 返回结构化分块（该文件无差异时为空数组）')

  const stageHunksPreview = await call(client, 'nav_git', { action: 'stage-hunks', path: 'api/sites-data.json', hunks: [0] })
  eq(stageHunksPreview.json.gate.write, true, 'nav_git stage-hunks 被识别为写操作')
  eq(stageHunksPreview.json.gate.preview, true, 'nav_git stage-hunks 未带 confirm 时降级为预演')

  const unstageHunksPreview = await call(client, 'nav_git', { action: 'unstage-hunks', path: 'api/sites-data.json', hunks: [0] })
  eq(unstageHunksPreview.json.gate.write, true, 'nav_git unstage-hunks 被识别为写操作')
  eq(unstageHunksPreview.json.gate.preview, true, 'nav_git unstage-hunks 未带 confirm 时降级为预演')

  const pushPreview = await call(client, 'nav_git', { action: 'push' })
  eq(pushPreview.json.gate.preview, true, 'nav_git push 未带 confirm 时降级为预演')

  const publishPreview = await call(client, 'nav_publish', { action: 'run' })
  eq(publishPreview.json.gate.preview, true, 'nav_publish run 未带 confirm 时降级为预演')
  ok(Array.isArray(publishPreview.json.data.blockers), 'publish run 预演列出阻断原因')
  ok(Array.isArray(publishPreview.json.data.plan), 'publish run 预演列出执行计划')

  const syncPreview = await call(client, 'nav_publish', { action: 'sync-data' })
  eq(syncPreview.json.gate.preview, true, 'nav_publish sync-data 未带 confirm 时降级为预演')

  eq(dataHash(), before, '一轮写操作预演后 api/sites-data.json 字节未变（未误写）')
  const gsAfterPreviews = await call(client, 'nav_git', { action: 'status' })
  eq(JSON.stringify(gsAfterPreviews.json.data.counts), countsBefore, '一轮写操作预演后 git 索引与工作区计数未变（未误暂存）')

  /* ---------------- ⑤ 预演仍做校验：坏数据必须被拦住 ---------------- */

  const badCat = await call(client, 'nav_sites', {
    action: 'add', url: 'bad.example.com', name: '坏分类', desc: '分类未登记应被拒绝', category: 'not-a-real-category',
  })
  eq(badCat.json.ok, false, '预演也执行校验：未登记分类被拒绝')
  eq(badCat.isError, true, '业务拒绝通过 isError 传达')

  const dupDomain = await call(client, 'nav_sites', { action: 'add', url: 'https://github.com', name: '重复域名', desc: '同域名已收录应被拒绝', category: 'data' })
  eq(dupDomain.json.ok, false, '预演也执行校验：同域名重复收录被拒绝')
  ok(/已收录/.test(dupDomain.json.error?.message || ''), '重复域名拒绝原因指向「已收录」而非其他校验')

  const noName = await call(client, 'nav_sites', { action: 'add', url: 'x.example.com', desc: '缺名称' })
  eq(noName.json.ok, false, '预演也执行校验：缺名称被拒绝')

  /* ---------------- ⑥ 闸门放开：带 confirm 真的进入执行路径 ---------------- */

  const opened = await call(client, 'nav_sites', { action: 'icon', id: 'zz-not-exist', confirm: true })
  eq(opened.json.gate.confirmed, true, '带 confirm 时标记为已确认')
  eq(opened.json.gate.preview, false, '带 confirm 时不再降级为预演')
  eq(opened.json.ok, false, '带 confirm 后进入真实执行：不存在的站点被业务拒绝')
  ok(/不存在/.test(opened.json.error?.message || ''), '带 confirm 后拿到的是真实执行错误而非预演结果')
  ok(opened.json.data?.dryRun === undefined, '带 confirm 的结果里没有 dryRun 标记')

  eq(dataHash(), before, '闸门测试全程未改动 api/sites-data.json')

  /* ---------------- ⑦ 参数拼错要报错而非静默忽略 ---------------- */

  // 实测 SDK 会做 zod 校验，并把校验失败包成 isError 结果（而非抛错、也非静默通过）：
  // 文本为 `MCP error -32602: Input validation error: ... expected one of "list"|"get"|...`。
  let badActionThrew = false
  let badActionResult = null
  try {
    badActionResult = await call(client, 'nav_sites', { action: 'nope' })
  } catch {
    badActionThrew = true
  }
  ok(badActionThrew || badActionResult?.isError === true, '非法 action 被拒绝（抛错或 isError，而非静默通过）')
  ok(badActionThrew || /validation error|-32602/.test(badActionResult?.text || ''), '非法 action 报的是输入校验错误')
  ok(badActionThrew || /"list"/.test(badActionResult?.text || ''), '非法 action 的错误信息回显合法取值，便于智能体自我纠正')
} catch (e) {
  failures.push(`用例执行异常：${e.message}`)
  console.log(`❌ 用例执行异常：${e.message}`)
} finally {
  await client.close().catch(() => {})
}

console.log(`\n${failures.length === 0 ? '全部通过' : `${failures.length} 条失败`}（共 ${pass + failures.length} 条断言，通过 ${pass}）`)
if (failures.length) {
  console.log('\n失败明细：')
  for (const f of failures) console.log(`- ${f}`)
}
process.exit(failures.length === 0 ? 0 : 1)