/**
 * 站点健康检查：批量检测导航站所有站点是否可访问
 * 用法: node scripts/check-sites.mjs [--limit N] [--timeout 15] [--only-bad] [--report]
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sites = JSON.parse(readFileSync(join(root, 'api', 'sites-data.json'), 'utf-8'))

const args = parseArgs({
  args: process.argv.slice(2),
  options: {
    limit: { type: 'string', short: 'l' },
    timeout: { type: 'string', short: 't' },
    'only-bad': { type: 'boolean' },
    report: { type: 'boolean' },
  },
  allowPositionals: false
})
const limit = args.values.limit !== undefined ? Number(args.values.limit) : sites.length
const timeout = args.values.timeout !== undefined ? Number(args.values.timeout) : 15
const onlyBad = !!args.values['only-bad']
const makeReport = !!args.values.report

const targets = sites.slice(0, limit)
const CONC = 12
const results = []
let done = 0

async function check(site) {
  const url = site.url.includes('://') ? site.url : 'https://' + site.url
  let code = 'ERR'
  try {
    let out = execFileSync('curl.exe', ['-s', '-o', 'NUL', '-w', '%{http_code}', '-I', '-L', '--max-time', String(timeout), url], { encoding: 'utf8', timeout: (timeout + 5) * 1000 }).trim()
    code = out || 'ERR'
    if (code === '000' || code === 'ERR') {
      out = execFileSync('curl.exe', ['-s', '-o', 'NUL', '-w', '%{http_code}', '-L', '--max-time', String(timeout), url], { encoding: 'utf8', timeout: (timeout + 5) * 1000 }).trim()
      code = out || 'ERR'
    }
  } catch {
    code = 'ERR'
  }
  results.push({ site, code })
  done++
  if (done % 50 === 0) console.log(`checked ${done}/${targets.length}`)
}

// 真失效：连不上或页面不存在；可忽略：限流(429)/反爬(403)/方法误用(405)/鉴权(401)
const IGNORABLE = new Set(['429', '405', '403', '401'])

function isBad(code) {
  const n = Number(code)
  return code === 'ERR' || code === '000' || (n >= 400 && !IGNORABLE.has(code))
}

function classify(code) {
  if (code === 'ERR' || code === '000') return '连接失败'
  const n = Number(code)
  if (n >= 400) return IGNORABLE.has(code) ? '可忽略' : 'HTTP ' + code
  return '正常'
}

async function main() {
  console.log(`检查 ${targets.length} 个站点（并发 ${CONC}，超时 ${timeout}s）...`)
  for (let i = 0; i < targets.length; i += CONC) {
    await Promise.all(targets.slice(i, i + CONC).map(check))
  }

  const bad = results.filter(r => isBad(r.code))
  const ok = results.length - bad.length
  console.log(`\n--- 完成 --- 正常 ${ok} / 异常 ${bad.length} / 共 ${results.length}`)

  if (bad.length > 0) {
    console.log('\n异常站点：')
    bad.forEach(r => console.log(`  [${r.code}] ${r.site.id} ${r.site.name} ${r.site.url}`))
  }

  if (makeReport) {
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    const reportDir = join(root, 'backups')
    mkdirSync(reportDir, { recursive: true })
    const critical = bad.filter(r => classify(r.code) !== '可忽略')
    const ignorable = bad.filter(r => classify(r.code) === '可忽略')
    const lines = []
    lines.push(`# 导航站健康检查报告`)
    lines.push(``)
    lines.push(`- 检查时间: ${new Date().toISOString()}`)
    lines.push(`- 站点总数: ${results.length}`)
    lines.push(`- 正常: ${ok} / 异常: ${bad.length}`)
    lines.push(``)
    lines.push(`## 需处理（连接失败 / 页面不存在） — ${critical.length}`)
    if (critical.length) {
      lines.push(`| ID | 名称 | 地址 | 状态 |`)
      lines.push(`|---|---|---|---|`)
      critical.forEach(r => lines.push(`| ${r.site.id} | ${r.site.name} | ${r.site.url} | ${r.code} |`))
    } else {
      lines.push(`无`)
    }
    lines.push(``)
    lines.push(`## 可忽略（限流/反爬/方法）（仅供参考） — ${ignorable.length}`)
    if (ignorable.length) {
      lines.push(`| ID | 名称 | 地址 | 状态 |`)
      lines.push(`|---|---|---|---|`)
      ignorable.forEach(r => lines.push(`| ${r.site.id} | ${r.site.name} | ${r.site.url} | ${r.code} |`))
    } else {
      lines.push(`无`)
    }
    lines.push(``)
    lines.push(`> 人工复核补充：429/405/403 多为反爬或 WAF 拦截，站点实际可用。`)
    const reportFile = join(reportDir, `check-report-${ts}.md`)
    writeFileSync(reportFile, lines.join('\n'), 'utf-8')
    console.log(`\n报告已生成: backups/check-report-${ts}.md`)
  }

  if (!onlyBad) {
    const redir = results.filter(r => /^3/.test(r.code))
    if (redir.length > 0) {
      console.log(`\n重定向（可能失效，建议人工确认）：${redir.length}`)
      redir.slice(0, 20).forEach(r => console.log(`  [${r.code}] ${r.site.id} ${r.site.name} ${r.site.url}`))
    }
  }

  process.exit(bad.length > 0 ? 1 : 0)
}

main()
