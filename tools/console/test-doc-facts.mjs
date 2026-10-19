#!/usr/bin/env node
/**
 * test-doc-facts —— 文档「事实断言」门禁（防 README / HANDOVER 叙事漂移）。
 *
 * ## 为什么需要
 *
 * doc-manager 的 check 能查死链、重复标题、过期引用，但**查不出数字说错**：
 * README 写「290+ 站点 / 29 个子分类 / 35 条命令 / 5 个工具 / Vercel Blob 真相源」，
 * 而仓库实际是 300 / 30 / 49 / 6 / SQLite —— 六项全错，巡检却全绿。
 *
 * 文档漂移不会让构建失败，但它会让后来的人（和智能体）基于错的地图做决定：
 * 照着 README 去 Vercel 后台找 Blob、按 35 条命令写脚本、以为只有 5 个 MCP 工具。
 *
 * ## 校验口径
 *
 * 只校验**可机器判定的事实**，并且只从**权威源**取值，绝不手写第二份：
 *
 *   | 断言 | 权威源 |
 *   |---|---|
 *   | 站点数 | `api/sites-data.json` 的数组长度 |
 *   | 子分类 / 大类数 | `shared/categories.mjs` 的 `categoryList()` / `domainList()` |
 *   | CLI 命令数 / 域数 | `tools/cli/lib/registry.mjs` 的 `commandList()` |
 *   | MCP 工具数 | `tools/mcp/server.mjs` 里实际注册的 `registerTool` 调用数 |
 *   | 门禁数 | `tools/gate-registry/gate-index.json` |
 *   | 必填环境变量 | `shared/env-registry.mjs` 的 `required: true` |
 *   | 默认发布通道 | `shared/publisher.mjs` 的 `resolvePublisher()` |
 *
 * ## 范围
 *
 * - `README.md`：全文（它是「当前状态」的说明）。
 * - `HANDOVER.md`：只校验开头到第一个 `## ` 章节之前的**当前状态**区段 ——
 *   正文是按时间线记录的历史，当时的数字在当时是对的，不该被今天的值改写。
 *
 * 只对**明确句式**生效（「聚合 N+ 优质站点」「N 个子分类」…），不做模糊语义判断：
 * 门禁宁可漏，不可误报 —— 误报一次就会被人加进白名单，然后就永远失效了。
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { categoryList, domainList } from '../../shared/categories.mjs'
import { commandList } from '../cli/lib/registry.mjs'
import { resolvePublisher } from '../../shared/publisher.mjs'
import { ENV_VARS } from '../../shared/env-registry.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
let pass = 0
const failures = []
const ok = (cond, msg) => {
  if (cond) pass++
  else failures.push(msg)
}

const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8')

/* ---------------- 权威值 ---------------- */

const siteData = JSON.parse(read('api/sites-data.json'))
const siteCount = (siteData.sites || siteData).length
const categories = categoryList()
const domains = domainList()
const cliCommands = commandList()
const cliGroups = [...new Set(cliCommands.map((c) => c.group))]

const mcpSource = read('tools/mcp/server.mjs')
/** registerTool( 之后紧跟的第一个字符串字面量就是工具名 */
const mcpTools = [...mcpSource.matchAll(/registerTool\(\s*'([^']+)'/g)].map((m) => m[1])

const gateIndex = JSON.parse(read('tools/gate-registry/gate-index.json'))
const gateCount = Array.isArray(gateIndex) ? gateIndex.length : (gateIndex.gates || []).length

const requiredEnv = ENV_VARS.filter((v) => v.required).map((v) => v.name)
const publisher = resolvePublisher()

const FACTS = {
  站点: siteCount,
  子分类: categories.length,
  大类: domains.length,
  'CLI 命令': cliCommands.length,
  'CLI 命令域': cliGroups.length,
  'MCP 工具': mcpTools.length,
  门禁: gateCount,
}

/* ---------------- 断言抽取 ---------------- */

/**
 * 在文本中找「数字 + 单位」的断言，逐条与权威值比对。
 * @param {string} label 可读的文档名（失败信息里用）
 * @param {string} text  待检文本
 * @param {Array<{re:RegExp, expect:number, what:string, fix:string}>} rules
 */
function assertNumbers(label, text, rules) {
  for (const r of rules) {
    const m = text.match(r.re)
    if (!m) continue // 没写就不管（门禁只管「写了且写错」）
    const got = Number(m[1])
    ok(
      got === r.expect,
      `${label}：${r.what}写的是 ${got}，实际 ${r.expect} —— ${r.fix}`,
    )
  }
}

const NUMBER_RULES = [
  {
    re: /聚合\s*(\d+)\+?\s*优质站点/,
    expect: FACTS.站点,
    what: '站点数',
    fix: '改成实际条数（或去掉写死的数字，避免下次再漂）',
  },
  {
    re: /(\d+)\s*个子分类/,
    expect: FACTS.子分类,
    what: '子分类数',
    fix: 'shared/categories.mjs 的 categoryList() 才是真相源',
  },
  {
    re: /(\d+)\s*个大类/,
    expect: FACTS.大类,
    what: '大类数',
    fix: 'shared/categories.mjs 的 domainList() 才是真相源',
  },
  {
    re: /共\s*\**\s*(\d+)\s*条命令\s*\**/,
    expect: FACTS['CLI 命令'],
    what: 'CLI 命令数',
    fix: 'tools/cli/lib/registry.mjs 的 commandList() 才是真相源',
  },
  {
    re: /(\d+)\s*个域级工具/,
    expect: FACTS['MCP 工具'],
    what: 'MCP 工具数',
    fix: 'tools/mcp/server.mjs 里实际 registerTool 的数量才是真相源',
  },
  {
    re: /(\d+)\s*道门禁/,
    expect: FACTS.门禁,
    what: '门禁数',
    fix: 'tools/gate-registry/gate-index.json 才是真相源',
  },
]

/* ---------------- README ---------------- */

const readme = read('README.md')
assertNumbers('README.md', readme, NUMBER_RULES)

/* 命令域数量：README 用「四个命令域」这类中文数字表述 */
const CN_DIGITS = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
for (const m of readme.matchAll(/([一二两三四五六七八九十])\s*个命令域/g)) {
  ok(
    CN_DIGITS[m[1]] === FACTS['CLI 命令域'],
    `README.md：命令域数写的是「${m[1]}」，实际 ${FACTS['CLI 命令域']}（${cliGroups.join(' / ')}）`,
  )
}

/* 当前状态不得再把这些已废弃的事实当成现状描述 */
const STALE_CLAIMS = [
  {
    re: /\*\*数据真相源\*\*\s*[:：]\s*Vercel Blob/i,
    msg: 'README.md 仍把「Vercel Blob」写成数据真相源 —— v9 起运行时存储是 server/store.mjs 的 SQLite 适配层',
  },
  {
    re: /部署在\s*Vercel(?!\s*[（(]\s*已停用)/,
    msg: 'README.md 仍写「部署在 Vercel」—— 默认发布通道已是 botkeep（自有服务器）',
  },
  {
    re: /\*\*部署\*\*\s*[:：]\s*Vercel\b/,
    msg: 'README.md 的「部署」一行仍写 Vercel —— 应写当前默认通道（见 shared/publisher.mjs）',
  },
]
for (const c of STALE_CLAIMS) {
  ok(!c.re.test(readme), c.msg)
}

/* 必填环境变量：文档里的表格若列了必填项，必须与注册表一致 */
const requiredInReadme = [...readme.matchAll(/^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|\s*(✅|必需)\s*\|/gm)].map((m) => m[1])
ok(
  requiredInReadme.length > 0,
  'README.md 没有识别到「必填环境变量」表格行 —— 表格格式可能变了，门禁已失效，请检查',
)
const missingEnv = requiredEnv.filter((n) => !requiredInReadme.includes(n))
const extraEnv = requiredInReadme.filter((n) => !requiredEnv.includes(n))
ok(
  missingEnv.length === 0,
  `README.md 漏列必填环境变量：${missingEnv.join(', ')}（真相源 shared/env-registry.mjs）`,
)
ok(
  extraEnv.length === 0,
  `README.md 把非必填变量标成了必填：${extraEnv.join(', ')}（真相源 shared/env-registry.mjs）`,
)

/* 默认发布通道必须被如实提及 */
ok(
  readme.includes(publisher.id) || readme.includes(publisher.label),
  `README.md 没有提到当前默认发布通道「${publisher.id}」（${publisher.label}）—— 见 shared/publisher.mjs`,
)

/* ---------------- HANDOVER 当前状态区段 ---------------- */

const handover = read('HANDOVER.md')
/** 只取第一个 `## ` 章节之前的内容：那才是「当前状态」，正文是历史 */
const headEnd = handover.search(/^## /m)
const handoverHead = headEnd === -1 ? handover : handover.slice(0, headEnd)

assertNumbers('HANDOVER.md 当前状态区', handoverHead, NUMBER_RULES)

/* ---------------- 报告 ---------------- */

console.log(`\n📄 文档事实门禁：${pass} 通过 / ${failures.length} 失败`)
console.log(
  `   权威值：站点 ${FACTS.站点}｜分类 ${FACTS.大类} 大类 / ${FACTS.子分类} 子分类｜` +
    `CLI ${FACTS['CLI 命令']} 命令 / ${FACTS['CLI 命令域']} 域｜MCP ${FACTS['MCP 工具']} 工具｜门禁 ${FACTS.门禁} 道｜` +
    `默认通道 ${publisher.id}`,
)
if (failures.length) {
  for (const f of failures) console.log(`   ❌ ${f}`)
  console.log('   → 修正文档后重跑；数字请直接照抄上面「权威值」一行')
  process.exit(1)
}
console.log('   ✅ 文档数字与当前实现一致｜无过期事实断言｜必填环境变量与注册表一致')
