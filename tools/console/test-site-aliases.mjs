/**
 * 站点别名数据守卫（F2①）：零依赖（只读本地 JSON，不联网）。
 *
 * 守的核心：
 *  1. **别名是数据资产**：抽查的事实性别名（代币代号 / 旧名 / 社区简写 / 拼音主体）
 *     必须还在对应站点上 —— 一次回滚或全量写回把整条数据写丢时，这里会红；
 *  2. 每条 aliases 都是非空字符串数组、无重复项、不与自身站名重复
 *     （与站名相同的别名只会白白占一个档位，检索时永远排不进任何新信息）。
 *
 * 检索内核的命中逻辑（域名主体档 / 别名分档 / 排序）归 test-search.mjs，
 * 这里只守**数据**，不重复测内核。
 *
 * 运行：node tools/console/test-site-aliases.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dataPath = join(root, 'api', 'sites-data.json')

let pass = 0
const failures = []
function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}

let sites
try {
  sites = JSON.parse(readFileSync(dataPath, 'utf-8'))
} catch (e) {
  console.error(`✖ 读不到数据文件：${dataPath}\n${e.message}`)
  process.exit(2)
}

const byName = new Map(sites.map(s => [s.name, s]))

/** 抽查的事实性别名（2026-10-18 F2① 批次写入）：代币代号 / 旧名 / 社区简写 / 拼音主体 */
const SPOT = {
  'Perplexity': 'pplx',
  'Windsurf': 'Codeium',
  'Pika': 'Pika Labs',
  'Runway': 'RunwayML',
  'Arbitrum': 'ARB',
  'Optimism': 'OP',
  'Chainlink': 'LINK',
  'Celestia': 'TIA',
  'The Graph': 'GRT',
  'Bittensor': 'TAO',
  'Helium': 'HNT',
  'Render Network': 'RNDR',
  'Uniswap': 'UNI',
  'OpenSea': 'OS',
  'TradingView': 'Trading View',
  'Cointelegraph': 'CT',
  '机器之心': 'jiqizhixin',
  '量子位': 'qbitai',
  '书格': 'shuge',
}

for (const [siteName, alias] of Object.entries(SPOT)) {
  const s = byName.get(siteName)
  if (!s) { ok(false, `抽查站点「${siteName}」存在`, '数据里找不到'); continue }
  ok(Array.isArray(s.aliases) && s.aliases.includes(alias),
    `「${siteName}」保有别名「${alias}」`,
    `实得 ${JSON.stringify(s.aliases || null)}`)
}

/* ---------------- 全表结构：别名可用且不重复 ---------------- */

let badShape = 0
let dupAliases = 0
let aliasEqualsName = 0
for (const s of sites) {
  if (!Array.isArray(s.aliases)) continue
  const nameLower = String(s.name || '').toLowerCase()
  const seen = new Set()
  for (const a of s.aliases) {
    if (typeof a !== 'string' || !a.trim()) { badShape++; continue }
    const lower = a.toLowerCase()
    if (seen.has(lower)) dupAliases++
    seen.add(lower)
    if (lower === nameLower) aliasEqualsName++
  }
}
ok(badShape === 0, '所有别名都是非空字符串', `${badShape} 条异常`)
ok(dupAliases === 0, '同站内别名无重复', `${dupAliases} 条重复`)
ok(aliasEqualsName === 0, '别名不与自身站名重复', `${aliasEqualsName} 条重复`)

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.log(`✖ ${failures.length} 条失败：`)
  for (const f of failures) console.log('  - ' + f)
  console.log(`\n通过 ${pass}，失败 ${failures.length}`)
  process.exit(1)
}
console.log(`✓ 站点别名数据守卫：${pass} 条通过`)
