/**
 * Git 工作流命令：复用 tools/console/lib/git.mjs 与 changes.mjs。
 * 路径参数统一经 assertSafePath 校验（拒绝绝对路径与目录穿越）。
 */
import { ROOT } from '../../console/lib/env.mjs'
import * as git from '../../console/lib/git.mjs'
import * as changes from '../../console/lib/changes.mjs'
import * as jobs from '../../console/lib/jobs.mjs'
import { CliError, EXIT, buildOptions, dryRunResult, parseCommandArgs, requirePositional, runJob, table } from '../lib/core.mjs'

const statusCmd = {
  path: 'git status',
  summary: '工作区状态：分支、领先/落后、文件列表（含增删行数）',
  usage: 'nav git status',
  async run() {
    const st = await git.getStatus()
    return {
      data: st,
      render: d => [
        `分支 ${d.branch || '(detached)'}${d.upstream ? ` → ${d.upstream}` : ''} · 领先 ${d.ahead} / 落后 ${d.behind}`,
        `改动 ${d.counts.total}（已暂存 ${d.counts.staged} / 未暂存 ${d.counts.unstaged} / 未跟踪 ${d.counts.untracked}）· +${d.counts.added} -${d.counts.deleted}`,
        '',
        table(['暂存', '路径', '+', '-'], d.files.map(f => [f.staged ? '✓' : '', f.path, f.added, f.deleted])),
      ].join('\n'),
    }
  },
}

const diffCmd = {
  path: 'git diff',
  summary: '单个文件的 diff（未跟踪文件按新增文件构造；超限会截断并标记）',
  usage: 'nav git diff <path> [--staged]',
  positionals: [{ name: 'path', required: true, desc: '仓库内相对路径' }],
  flags: { staged: { type: 'boolean', desc: '查看已暂存版本（--cached）' } },
  async run(argv) {
    const { values, positionals } = parseCommandArgs(argv, buildOptions(diffCmd.flags), { allowPositionals: true, usage: diffCmd.usage })
    const relPath = requirePositional(positionals, 0, 'path', diffCmd.usage)
    const r = await git.getDiff(relPath, Boolean(values.staged))
    return { data: r, render: d => d.text || '(无差异)' }
  },
}

const logCmd = {
  path: 'git log',
  summary: '提交历史（含作者、时间、主题）',
  usage: 'nav git log [--limit <n>]',
  flags: { limit: { desc: '条数，默认 20' } },
  async run(argv) {
    const { values } = parseCommandArgs(argv, buildOptions(logCmd.flags), { usage: logCmd.usage })
    const limit = values.limit ? Number(values.limit) : 20
    const commits = await git.getLog(limit)
    return {
      data: { limit, count: commits.length, commits },
      render: d => table(['SHA', '时间', '主题'], d.commits.map(c => [c.short, c.date.slice(0, 19).replace('T', ' '), c.subject])),
    }
  },
}

const suggestCmd = {
  path: 'git suggest',
  summary: '按改动生成规范提交消息（Conventional Commits），并给出站点数据差异摘要',
  usage: 'nav git suggest',
  async run() {
    const st = await git.getStatus()
    if (st.files.length === 0) {
      return { data: { suggestion: null, reason: '工作区无改动', branch: st.branch } }
    }
    const sites = await changes.sitesSummary()
    const suggestion = changes.suggestMessage(st, sites)
    return {
      data: {
        suggestion,
        branch: st.branch,
        counts: st.counts,
        sitesChanged: Boolean(sites?.changed),
        sitesDiff: sites ? { added: sites.diff.added.length, removed: sites.diff.removed.length, modified: sites.diff.modified.length } : null,
      },
      render: d => [
        `建议消息：${d.suggestion?.message || '(无)'}`,
        d.suggestion?.details?.length ? `\n细节：\n- ${d.suggestion.details.join('\n- ')}` : '',
      ].join('\n'),
    }
  },
}

const stageCmd = {
  path: 'git stage',
  summary: '暂存指定文件',
  usage: 'nav git stage <path> [<path>...]',
  positionals: [{ name: 'path', required: true, desc: '仓库内相对路径，可多个' }],
  async run(argv) {
    const { positionals } = parseCommandArgs(argv, {}, { allowPositionals: true, usage: stageCmd.usage })
    if (positionals.length === 0) throw new CliError('未指定文件', { code: 'USAGE', exitCode: EXIT.USAGE, hint: `用法：${stageCmd.usage}` })
    return { data: { staged: await git.stagePaths(positionals) } }
  },
}

const unstageCmd = {
  path: 'git unstage',
  summary: '取消暂存指定文件',
  usage: 'nav git unstage <path> [<path>...]',
  positionals: [{ name: 'path', required: true, desc: '仓库内相对路径，可多个' }],
  async run(argv) {
    const { positionals } = parseCommandArgs(argv, {}, { allowPositionals: true, usage: unstageCmd.usage })
    if (positionals.length === 0) throw new CliError('未指定文件', { code: 'USAGE', exitCode: EXIT.USAGE, hint: `用法：${unstageCmd.usage}` })
    return { data: { unstaged: await git.unstagePaths(positionals) } }
  },
}

const commitCmd = {
  path: 'git commit',
  summary: '提交（--paths 时只提交这些文件，否则提交全部已暂存改动）',
  usage: 'nav git commit --message <消息> [--paths a,b] [--dry-run]',
  mutating: true,
  flags: {
    message: { desc: '提交消息（必填）', short: 'm' },
    paths: { desc: '只提交这些文件，逗号分隔' },
  },
  async run(argv, ctx) {
    const { values } = parseCommandArgs(argv, buildOptions(commitCmd.flags), { usage: commitCmd.usage })
    const message = String(values.message || '').trim()
    if (!message) throw new CliError('缺少提交消息', { code: 'USAGE', exitCode: EXIT.USAGE, hint: `用法：${commitCmd.usage}` })
    const paths = values.paths ? String(values.paths).split(',').map(s => s.trim()).filter(Boolean) : undefined
    if (ctx.dryRun) {
      const st = await git.getStatus()
      const staged = st.files.filter(f => f.staged)
      return dryRunResult({
        message,
        targets: paths || staged.map(f => f.path),
        stagedCount: staged.length,
        aheadBefore: st.ahead,
        note: paths ? '实际提交会先暂存这些路径再创建 commit' : '实际提交会创建 commit 并更新 HEAD',
      })
    }
    const r = await git.commit(message, paths)
    return { data: { ...r, message, paths: paths || null } }
  },
}

const pushCmd = {
  path: 'git push',
  summary: '推送到 origin（长任务，实时输出进度；凭据缺失会快速失败而非挂起）',
  usage: 'nav git push [--branch <分支>] [--dry-run]',
  mutating: true,
  flags: { branch: { desc: '分支名，默认取当前分支' } },
  async run(argv, ctx) {
    const { values } = parseCommandArgs(argv, buildOptions(pushCmd.flags), { usage: pushCmd.usage })
    const st = await git.getStatus()
    const branch = values.branch || st.branch
    if (!branch) throw new CliError('当前处于 detached HEAD，无法推送', { code: 'REJECTED', exitCode: EXIT.REJECTED })

    const job = jobs.createJob(ctx.dryRun ? 'git push --dry-run' : 'git push')
    jobs.log(job, `${ctx.dryRun ? '预演' : '推送'} ${branch} → origin（领先 ${st.ahead} 个提交）`, 'info')
    jobs.run(job, 'git', ctx.dryRun ? ['push', '--dry-run', 'origin', branch] : ['push', 'origin', branch], {
      cwd: ROOT,
      env: { GIT_TERMINAL_PROMPT: '0' },
      stderrMode: 'info',
      timeoutMs: ctx.timeoutMs,
    })
    const res = await runJob(job, ctx, { label: `git push ${branch}` })
    res.data.branch = branch
    res.data.aheadBefore = st.ahead
    if (ctx.dryRun) res.data.dryRun = true
    return res
  },
}

const remoteCmd = {
  path: 'git remote',
  summary: 'origin 远端地址与当前上游分支',
  usage: 'nav git remote',
  async run() {
    const [url, st] = await Promise.all([git.getRemoteUrl(), git.getStatus().catch(() => null)])
    return { data: { url, upstream: st?.upstream || '', branch: st?.branch || '' } }
  },
}

export const commands = [statusCmd, diffCmd, logCmd, suggestCmd, stageCmd, unstageCmd, commitCmd, pushCmd, remoteCmd]