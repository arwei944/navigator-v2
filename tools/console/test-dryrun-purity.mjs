/**
 * 预演纯净性门禁：dryRun 分支不得产生外部副作用
 *
 * 为什么需要它：MCP 的闸门承诺是「写操作默认只预演」，智能体据此决定要不要
 * 带 `confirm: true`。但「预演」只约束了**写盘**，没约束**读外网** —— 于是
 * `sites icon` 的预演仍会真实抓取目标站点页面（单次实测 3.2s），
 * 既违背「只看不动」的语义，也让每次 MCP 预演变成可能超时的网络调用。
 *
 * 本门禁钉住两条：
 *   ① `downloadIcon` 的 dryRun 必须在任何 fetch 之前返回（静态结构断言）
 *   ② 真实调用 dryRun 路径，断言候选列表里没有「页面探测」出来的条目，
 *      且返回体显式标注 `pageProbeSkipped`
 *
 * 为什么用真实调用而不只看代码：静态断言只能证明顺序，证明不了「真的没联网」。
 * 这里通过 monkey-patch 全局 fetch 计数来实测 —— 预演期间调用次数必须为 0。
 *
 * 运行：node tools/console/test-dryrun-purity.mjs
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? ` → ${extra}` : ''}`) }
  else { failures.push(`${label}${extra ? ` — ${extra}` : ''}`); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`) }
}

/* ---------------- ① 静态结构：dryRun 早于网络调用 ---------------- */

console.log('\n── ① downloadIcon 的预演分支早于任何抓取 ──')

const sitesSrc = readFileSync(join(ROOT, 'tools', 'console', 'lib', 'content', 'sites.mjs'), 'utf8')
const fnStart = sitesSrc.indexOf('export async function downloadIcon')
ok(fnStart > 0, '找到 downloadIcon 实现')

const fnBody = sitesSrc.slice(fnStart, sitesSrc.indexOf('\n}\n', fnStart))
const dryIdx = fnBody.indexOf('if (dryRun)')
const fetchIdx = fnBody.indexOf('fetchMeta(')
ok(dryIdx > 0, 'downloadIcon 有 dryRun 分支')
ok(fetchIdx > 0, 'downloadIcon 有 fetchMeta 调用（真实执行需要）')
// 顺序本身不构成问题 —— 抓取被 `!dryRun` 守卫住同样安全。
// 真正的不变量是「预演路径上网络调用被守卫」，两条满足其一即可。
const guarded = /if \(!dryRun && !candidates\.length\)/.test(fnBody)
ok(dryIdx < fetchIdx || guarded,
  '预演路径不会触达网络（预演早返回，或抓取被 !dryRun 守卫）',
  dryIdx > fetchIdx && !guarded ? 'dryRun 在 fetchMeta 之后且抓取未被守卫 —— 预演会联网' : '')

/* ---------------- ② 行为：预演期间零网络调用 ---------------- */

console.log('\n── ② 真实调用预演：fetch 与 fetchMeta 均不触发 ──')

const realFetch = globalThis.fetch
let fetchCount = 0
globalThis.fetch = (...args) => { fetchCount++; return realFetch(...args) }

let result = null
let callErr = null
try {
  const sites = await import(new URL('./lib/content/sites.mjs', import.meta.url).href)
  // 用一个真实存在的站点 id；dryRun 路径不应触碰网络，所以选哪个都一样
  const all = sites.loadSites()
  if (!all.length) throw new Error('sites-data.json 为空，无法验证')
  result = await sites.downloadIcon(all[0].id, { dryRun: true })
} catch (e) {
  callErr = e
} finally {
  globalThis.fetch = realFetch
}

ok(!callErr, '预演调用不抛错', callErr ? callErr.message : '')
ok(fetchCount === 0, '预演期间 fetch 调用次数为 0', `实际 ${fetchCount} 次`)

if (result) {
  ok(result.dryRun === true, '返回体标注 dryRun')
  ok(result.pageProbeSkipped === true, '返回体标注「页面探测被跳过」（调用方据此知道候选不完整）')
  ok(Array.isArray(result.candidates) && result.candidates.length >= 2,
    `预演给出 ${result.candidates?.length ?? 0} 个确定性兜底来源`)
  ok(typeof result.note === 'string' && /不访问网络|预演/.test(result.note),
    '返回体说明预演不访问网络')
}

/* ---------------- ③ 真实执行仍会探测（防止改过头） ---------------- */

console.log('\n── ③ 守卫没有把真实执行也关掉 ──')

ok(/if \(!dryRun && !candidates\.length\)/.test(fnBody),
  '抓取被 `!dryRun` 守卫，真实执行路径保持原行为')
ok(/candidates\.push\(`https:\/\/\$\{host\}\/favicon\.ico`/.test(fnBody),
  '兜底来源在预演与真实执行中都会给出')

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 预演纯净性门禁 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  console.error('\n  预演的承诺是「只看不动」。一旦它开始联网，智能体就无法安全地先预演再确认。')
  process.exit(1)
}
console.log(`\n✅ 预演纯净性门禁通过：${pass} 条断言`)
