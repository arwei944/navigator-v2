/**
 * 站点健康检查：批量检测导航站所有站点是否可访问
 * 用法: node scripts/check-sites.mjs [--limit N] [--timeout 15] [--only-bad] [--report]
 *
 * 探测方式与分级口径**全部来自 `shared/health-probe.mjs`**，与控制台看板、
 * CLI `nav sites check` 同源。此处不再自建 curl 逻辑 —— 历史上这里复制了一份
 * 「HEAD 优先」的实现，与主引擎一起踩了同一个坑（HEAD 404/超时未回落 GET，
 * 把 Kaggle / 文心一言 / BlockBeats 误判为失效），两处各修一遍不如只留一份。
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { probeMany } from '../shared/health-probe.mjs'

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

async function main() {
  console.log(`检查 ${targets.length} 个站点（并发 ${CONC}，超时 ${timeout}s）...`)
  const probed = await probeMany(targets, {
    timeout,
    concurrency: CONC,
    onProgress: ({ done, total }) => { if (done % 50 === 0 || done === total) console.log(`checked ${done}/${total}`) },
  })
  const results = probed.map((r, i) => ({ site: targets[i], code: r.code, status: r.status }))

  const bad = results.filter(r => r.status === 'down')
  const ok = results.length - bad.length
  console.log(`\n--- 完成 --- 正常 ${ok} / 需处理 ${bad.length} / 共 ${results.length}`)

  if (bad.length > 0) {
    console.log('\n需处理站点：')
    bad.forEach(r => console.log(`  [${r.code}] ${r.site.id} ${r.site.name} ${r.site.url}`))
  }

  if (makeReport) {
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    const reportDir = join(root, 'backups')
    mkdirSync(reportDir, { recursive: true })
    const limited = results.filter(r => r.status === 'limited')
    const lines = []
    lines.push(`# 导航站健康检查报告`)
    lines.push(``)
    lines.push(`- 检查时间: ${new Date().toISOString()}`)
    lines.push(`- 站点总数: ${results.length}`)
    lines.push(`- 正常: ${ok} / 需处理: ${bad.length}`)
    lines.push(``)
    lines.push(`## 需处理（连接失败 / 页面不存在） — ${bad.length}`)
    if (bad.length) {
      lines.push(`| ID | 名称 | 地址 | 状态 |`)
      lines.push(`|---|---|---|---|`)
      bad.forEach(r => lines.push(`| ${r.site.id} | ${r.site.name} | ${r.site.url} | ${r.code} |`))
    } else {
      lines.push(`无`)
    }
    lines.push(``)
    lines.push(`## 可忽略（限流/反爬/方法）（仅供参考） — ${limited.length}`)
    if (limited.length) {
      lines.push(`| ID | 名称 | 地址 | 状态 |`)
      lines.push(`|---|---|---|---|`)
      limited.forEach(r => lines.push(`| ${r.site.id} | ${r.site.name} | ${r.site.url} | ${r.code} |`))
    } else {
      lines.push(`无`)
    }
    lines.push(``)
    lines.push(`> 判定由本机代理环境（curl.exe 走系统代理）产出；429/405/403 多为反爬或 WAF 拦截，站点实际可用。`)
    lines.push(`> 404/402 等也偶有 WAF 误报，删除前建议人工复核。`)
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