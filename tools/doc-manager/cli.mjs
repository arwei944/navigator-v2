#!/usr/bin/env node
/**
 * doc-manager —— nav-v2 工作区文档管理工具（CLI 入口）
 *
 * 体例见 README.md。核心思想：**把「有哪些文档、谁取代谁、和什么关联」变成机器可读的事实**，
 * 这样人和 AI 都能基于同一份台账做判断，而不是各自 grep。
 *
 * 用法：
 *   node tools/doc-manager/cli.mjs scan      [--json] [--root <dir>]
 *   node tools/doc-manager/cli.mjs index     [--json] [--out <dir>]
 *   node tools/doc-manager/cli.mjs check     [--json] [--strict]
 *   node tools/doc-manager/cli.mjs lifecycle [--json]
 *   node tools/doc-manager/cli.mjs graph     [--json] [--mermaid]
 *
 * 共同选项：
 *   --root <dir>  指定工作区根（默认本工具的上两级目录，即 nav-v2 仓库根）
 *   --json        输出机器可读 JSON（供 AI / 其它脚本消费）
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanWorkspace } from './lib/scanner.mjs'
import { buildIndex, renderIndexMarkdown } from './lib/indexer.mjs'
import { runChecks, renderCheckReport } from './lib/checker.mjs'
import { analyzeLifecycle, renderLifecycleReport } from './lib/lifecycle.mjs'
import { buildGraph, renderGraphMermaid } from './lib/graph.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = path.resolve(HERE, '..', '..')

const HELP = `doc-manager —— nav-v2 工作区文档管理工具

用法：node tools/doc-manager/cli.mjs <command> [options]

命令：
  scan       扫描文档并输出统计（有哪些、多大、多新）
  index      生成文档台账（doc-index.json + DOC-INDEX.md）
  check      一致性巡检（死链 / 重复标题 / 过期引用 / 孤儿 / 状态冲突）
  lifecycle  生命周期分析（状态推断 / 取代链 / 归档建议）
  graph      关联图谱（文档↔项目↔文档，可导出 Mermaid）

选项：
  --json        输出机器可读 JSON
  --root <dir>  指定工作区根（默认 nav-v2 仓库根）
  --out <dir>   index 的输出目录（默认 <root>/projects 之外的 tools/doc-manager/.out）
  --strict      check：存在 error 级问题时以非 0 退出（门禁用）
  --mermaid     graph：额外打印 Mermaid 源码
  --help        显示本帮助
`

/** 极简参数解析：支持 `--k v`、`--k=v`、裸开关 `--k` */
function parseArgs(argv) {
  const flags = {}
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1)
        continue
      }
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      rest.push(a)
    }
  }
  return { flags, rest }
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

async function main() {
  const argv = process.argv.slice(2)
  const { flags, rest } = parseArgs(argv)
  const cmd = rest[0] || 'help'
  const root = flags.root ? path.resolve(String(flags.root)) : DEFAULT_ROOT

  if (flags.help || cmd === 'help') {
    process.stdout.write(HELP)
    return 0
  }

  const scan = () => scanWorkspace({ root })

  switch (cmd) {
    case 'scan': {
      const result = scan()
      if (flags.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n')
        return 0
      }
      const { stats } = result
      console.log(`\n📚 工作区文档扫描 — ${result.root}`)
      console.log(`   共 ${stats.total} 份 / ${human(stats.bytes)}`)
      console.log(`   最早 ${stats.oldest || '-'}｜最新 ${stats.newest || '-'}`)
      console.log('\n   按类型：')
      for (const [k, v] of Object.entries(stats.byKind).sort((a, b) => b[1] - a[1])) {
        console.log(`     ${k.padEnd(12)} ${v}`)
      }
      console.log('\n   按状态：')
      for (const [k, v] of Object.entries(stats.byStatus)) console.log(`     ${k.padEnd(12)} ${v}`)
      console.log()
      return 0
    }

    case 'index': {
      const result = scan()
      const index = buildIndex(result)
      if (flags.json) {
        process.stdout.write(JSON.stringify(index, null, 2) + '\n')
        return 0
      }
      console.log(`\n📇 文档台账已生成：${index.total} 份`)
      console.log(`   按类型：${Object.entries(index.byKind).map(([k, v]) => `${k}×${v}`).join('  ')}`)
      console.log(`   按状态：${Object.entries(index.byStatus).map(([k, v]) => `${k}×${v}`).join('  ')}`)
      console.log(`   缺失标题：${index.missingTitle.length} 份`)
      if (flags.out) {
        const fs = await import('node:fs')
        const outDir = path.resolve(String(flags.out))
        fs.mkdirSync(outDir, { recursive: true })
        fs.writeFileSync(path.join(outDir, 'doc-index.json'), JSON.stringify(index, null, 2), 'utf-8')
        fs.writeFileSync(path.join(outDir, 'DOC-INDEX.md'), renderIndexMarkdown(index), 'utf-8')
        console.log(`   → ${path.join(outDir, 'doc-index.json')}`)
        console.log(`   → ${path.join(outDir, 'DOC-INDEX.md')}`)
      }
      console.log()
      return 0
    }

    case 'check': {
      const result = scan()
      const report = runChecks(result)
      if (flags.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n')
        return flags.strict && report.counts.error > 0 ? 1 : 0
      }
      process.stdout.write(renderCheckReport(report) + '\n')
      return flags.strict && report.counts.error > 0 ? 1 : 0
    }

    case 'lifecycle': {
      const result = scan()
      const lc = analyzeLifecycle(result)
      if (flags.json) {
        process.stdout.write(JSON.stringify(lc, null, 2) + '\n')
        return 0
      }
      process.stdout.write(renderLifecycleReport(lc) + '\n')
      return 0
    }

    case 'graph': {
      const result = scan()
      const g = buildGraph(result)
      if (flags.json) {
        process.stdout.write(JSON.stringify(g, null, 2) + '\n')
        return 0
      }
      console.log(`\n🕸  关联图谱：${g.nodes.length} 节点 / ${g.edges.length} 边`)
      console.log(`   孤立文档（无入链无出链）：${g.orphans.length}`)
      for (const n of g.byProject.slice(0, 20)) {
        console.log(`   项目 ${n.project}：${n.docs.length} 份文档`)
      }
      if (flags.mermaid) {
        console.log('\n' + renderGraphMermaid(g))
      }
      console.log()
      return 0
    }

    default:
      console.error(`未知命令：${cmd}\n`)
      process.stdout.write(HELP)
      return 1
  }
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    console.error(`doc-manager 运行失败：${(err && err.stack) || err}`)
    process.exit(1)
  })
