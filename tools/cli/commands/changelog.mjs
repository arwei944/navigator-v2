/**
 * 发布记录命令：从 git 历史聚合**约定式提交**，生成本版变更记录。
 *
 * 为什么需要它：项目提交高度规范（213 条里 feat/fix/docs/test/perf… 齐全），
 * release-please 也配好了，但 CHANGELOG 一直没产出 —— 「生产记录」这一环在本地是空的。
 * 本命令让「这一版改了什么」随时可查、可导出，不依赖 CI 是否跑通。
 *
 * 刻意**不自动写 CHANGELOG.md**：那是 release-please 的产物，本机硬造会与它打架。
 * 需要落盘时用 --out 显式指定目标文件。
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { buildOptions, parseCommandArgs } from '../lib/core.mjs'

const TYPE_LABEL = {
  feat: '新功能',
  fix: '修复',
  perf: '性能',
  refactor: '重构',
  docs: '文档',
  test: '测试',
  build: '构建',
  ci: 'CI',
  chore: '杂务',
  style: '样式',
  revert: '回滚',
}
const TYPE_ORDER = Object.keys(TYPE_LABEL)

function git(args) {
  return execFileSync('git', args, { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 }).trim()
}

function detectLastTag() {
  try {
    return git(['describe', '--tags', '--abbrev=0']) || null
  } catch {
    return null
  }
}

function readCommits(since) {
  const args = ['log', '--no-merges', '--format=%H%x1f%s%x1f%ad', '--date=short']
  if (since) args.push(`${since}..HEAD`)
  const out = git(args)
  if (!out) return []
  return out.split('\n').map((line) => {
    const [sha, subject, date] = line.split('\x1f')
    return { sha: sha.slice(0, 7), subject, date }
  })
}

/** 约定式提交：type(scope)!: text */
function parseConventional(subject) {
  const m = subject.match(/^([a-z]+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/)
  if (!m) return null
  return { type: m[1], scope: m[2] || '', breaking: !!m[3], text: m[4] }
}

const changelogCmd = {
  path: 'release changelog',
  summary: '从 git 历史聚合约定式提交，生成本版变更记录（供发行说明 / 核对这一版改了什么）',
  usage: 'nav release changelog [--since <ref>] [--out <文件>]',
  flags: {
    since: { desc: '起始 ref（不含）；缺省取最近 tag，无 tag 则取全部历史' },
    out: { desc: '写入指定文件；缺省只打印，不落盘（CHANGELOG.md 归 release-please 管）' },
  },
  async run(argv) {
    const { values } = parseCommandArgs(argv, buildOptions(changelogCmd.flags), { usage: changelogCmd.usage })
    const since = values.since || detectLastTag() || ''
    const commits = readCommits(since).map((c) => ({ ...c, conv: parseConventional(c.subject) }))

    const groups = {}
    for (const c of commits) {
      const key = c.conv ? c.conv.type : 'other'
      ;(groups[key] ||= []).push(c)
    }

    const data = {
      since: since || '(全部历史)',
      total: commits.length,
      conforming: commits.filter((c) => c.conv).length,
      breaking: commits.filter((c) => c.conv?.breaking).length,
      groups,
    }

    const render = (d) => {
      const lines = [`发布记录${since ? `（${since}..HEAD）` : '（全部历史）'}：${d.total} 条提交，${d.conforming} 条符合约定式`]
      if (d.breaking) lines.push(`⚠️ 含 ${d.breaking} 条 BREAKING CHANGE`)
      lines.push('')
      for (const type of [...TYPE_ORDER, 'other']) {
        const items = d.groups[type]
        if (!items?.length) continue
        const label = TYPE_LABEL[type] || '未归类'
        lines.push(`## ${label} (${items.length})`)
        for (const c of items) {
          const scope = c.conv?.scope ? `**${c.conv.scope}**: ` : ''
          const text = c.conv ? c.conv.text : c.subject
          const bang = c.conv?.breaking ? ' ⚠️BREAKING' : ''
          lines.push(`- ${scope}${text}${bang}  \`${c.sha}\` ${c.date}`)
        }
        lines.push('')
      }
      return lines.join('\n')
    }

    if (values.out) {
      writeFileSync(values.out, render(data) + '\n', 'utf-8')
      data.writtenTo = values.out
    }

    return { ok: true, data, render }
  },
}

export const commands = [changelogCmd]
