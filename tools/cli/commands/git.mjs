/**
 * Git 工作流命令：复用 tools/console/lib/git.mjs 与 changes.mjs。
 * 路径参数统一经 assertSafePath 校验（拒绝绝对路径与目录穿越）。
 */
import { ROOT } from '../../console/lib/env.mjs'
import * as git from '../../console/lib/git.mjs'
import * as changes from '../../console/lib/changes.mjs'
import * as jobs from '../../console/lib/jobs.mjs'
import { assertIndexesInRange, hunkPreview, parseHunkIndexes } from '../../../shared/hunk-patch.mjs'
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
  usage: 'nav git stage <path> [<path>...] [--dry-run]',
  mutating: true,
  positionals: [{ name: 'path', required: true, desc: '仓库内相对路径，可多个' }],
  async run(argv, ctx) {
    const { positionals } = parseCommandArgs(argv, {}, { allowPositionals: true, usage: stageCmd.usage })
    if (positionals.length === 0) throw new CliError('未指定文件', { code: 'USAGE', exitCode: EXIT.USAGE, hint: `用法：${stageCmd.usage}` })
    if (ctx.dryRun) {
      const st = await git.getStatus()
      const known = new Map(st.files.map(f => [f.path, f]))
      return dryRunResult({
        paths: positionals,
        targets: positionals.map(p => {
          const f = known.get(p)
          return { path: p, exists: Boolean(f), alreadyStaged: Boolean(f?.staged) }
        }),
        note: '实际会执行 git add -- <paths>',
      })
    }
    return { data: { staged: await git.stagePaths(positionals) } }
  },
}

const unstageCmd = {
  path: 'git unstage',
  summary: '取消暂存指定文件',
  usage: 'nav git unstage <path> [<path>...] [--dry-run]',
  mutating: true,
  positionals: [{ name: 'path', required: true, desc: '仓库内相对路径，可多个' }],
  async run(argv, ctx) {
    const { positionals } = parseCommandArgs(argv, {}, { allowPositionals: true, usage: unstageCmd.usage })
    if (positionals.length === 0) throw new CliError('未指定文件', { code: 'USAGE', exitCode: EXIT.USAGE, hint: `用法：${unstageCmd.usage}` })
    if (ctx.dryRun) {
      const st = await git.getStatus()
      const known = new Map(st.files.map(f => [f.path, f]))
      return dryRunResult({
        paths: positionals,
        targets: positionals.map(p => {
          const f = known.get(p)
          return { path: p, exists: Boolean(f), wasStaged: Boolean(f?.staged) }
        }),
        note: '实际会执行 git reset -q HEAD -- <paths>',
      })
    }
    return { data: { unstaged: await git.unstagePaths(positionals) } }
  },
}

const hunksCmd = {
  path: 'git hunks',
  summary: '列出单个文件的 hunk 边界（供分块暂存/取消，序号从 0 开始）',
  usage: 'nav git hunks <path> [--staged]',
  positionals: [{ name: 'path', required: true, desc: '仓库内相对路径' }],
  flags: { staged: { type: 'boolean', desc: '查看已暂存侧（HEAD → 索引）的 hunk' } },
  async run(argv) {
    const { values, positionals } = parseCommandArgs(argv, buildOptions(hunksCmd.flags), { allowPositionals: true, usage: hunksCmd.usage })
    const relPath = requirePositional(positionals, 0, 'path', hunksCmd.usage)
    const d = await git.getDiff(relPath, Boolean(values.staged))
    const data = {
      path: d.path,
      staged: Boolean(d.staged),
      untracked: Boolean(d.untracked),
      binary: Boolean(d.binary),
      truncated: Boolean(d.truncated),
      usable: Boolean(d.hunksUsable),
      total: d.hunks.length,
      hunks: d.hunks.map(h => ({
        index: h.index,
        label: h.header.trim(),
        oldStart: h.oldStart,
        oldLines: h.oldLines,
        newStart: h.newStart,
        newLines: h.newLines,
        additions: h.additions,
        deletions: h.deletions,
        preview: hunkPreview(h).lines,
      })),
    }
    return {
      data,
      render: d => (d.hunks.length === 0
        ? `该文件${d.staged ? '已暂存侧' : '工作区侧'}没有可分块的差异${d.binary ? '（二进制）' : ''}。`
        : table(['#', 'hunk', '+', '-'], d.hunks.map(h => [h.index, h.label, h.additions, h.deletions]))),
    }
  },
}

/** 分块操作前的公共校验：序号合法 + 落在该侧 hunk 数量范围内 */
async function planHunks(relPath, rawIndexes, staged, usage) {
  const parsed = parseHunkIndexes(rawIndexes)
  if (!parsed.ok) {
    throw new CliError(parsed.error, { code: 'USAGE', exitCode: EXIT.USAGE, hint: `用法：${usage}（用 nav git hunks 查看序号）` })
  }
  const d = await git.getDiff(relPath, staged)
  if (!d.hunks.length) {
    throw new CliError(
      staged ? `该文件没有已暂存差异可取消：${relPath}` : `该文件没有未暂存差异可暂存：${relPath}`,
      { code: 'REJECTED', exitCode: EXIT.REJECTED },
    )
  }
  const range = assertIndexesInRange(parsed.indexes, d.hunks.length)
  if (!range.ok) throw new CliError(range.error, { code: 'REJECTED', exitCode: EXIT.REJECTED })
  return { indexes: parsed.indexes, diff: d }
}

function hunkPlanTargets(plan) {
  return plan.indexes.map(i => {
    const h = plan.diff.hunks[i]
    return { index: i, label: h.header.trim(), additions: h.additions, deletions: h.deletions }
  })
}

const stageHunksCmd = {
  path: 'git stage-hunks',
  summary: '暂存单个文件中指定的 hunk，其余块保留在工作区',
  usage: 'nav git stage-hunks <path> --hunks <序号,...> [--dry-run]',
  mutating: true,
  positionals: [{ name: 'path', required: true, desc: '仓库内相对路径' }],
  flags: { hunks: { desc: 'hunk 序号，逗号分隔，从 0 开始（用 nav git hunks 查看）' } },
  async run(argv, ctx) {
    const { values, positionals } = parseCommandArgs(argv, buildOptions(stageHunksCmd.flags), { allowPositionals: true, usage: stageHunksCmd.usage })
    const relPath = requirePositional(positionals, 0, 'path', stageHunksCmd.usage)
    const plan = await planHunks(relPath, values.hunks, false, stageHunksCmd.usage)
    if (ctx.dryRun) {
      return dryRunResult({
        path: relPath,
        mode: 'stage',
        targets: hunkPlanTargets(plan),
        total: plan.diff.hunks.length,
        note: '实际会执行 git apply --cached（只改索引，不动工作区文件）',
      })
    }
    return { data: await git.applyHunks(relPath, plan.indexes, { staged: false }) }
  },
}

const unstageHunksCmd = {
  path: 'git unstage-hunks',
  summary: '取消暂存单个文件中指定的 hunk，其余块留在索引',
  usage: 'nav git unstage-hunks <path> --hunks <序号,...> [--dry-run]',
  mutating: true,
  positionals: [{ name: 'path', required: true, desc: '仓库内相对路径' }],
  flags: { hunks: { desc: 'hunk 序号，逗号分隔，从 0 开始（用 nav git hunks --staged 查看）' } },
  async run(argv, ctx) {
    const { values, positionals } = parseCommandArgs(argv, buildOptions(unstageHunksCmd.flags), { allowPositionals: true, usage: unstageHunksCmd.usage })
    const relPath = requirePositional(positionals, 0, 'path', unstageHunksCmd.usage)
    const plan = await planHunks(relPath, values.hunks, true, unstageHunksCmd.usage)
    if (ctx.dryRun) {
      return dryRunResult({
        path: relPath,
        mode: 'unstage',
        targets: hunkPlanTargets(plan),
        total: plan.diff.hunks.length,
        note: '实际会执行 git apply --reverse --cached（只改索引，不动工作区文件）',
      })
    }
    return { data: await git.applyHunks(relPath, plan.indexes, { staged: true }) }
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

export const commands = [
  statusCmd, diffCmd, hunksCmd, logCmd, suggestCmd,
  stageCmd, unstageCmd, stageHunksCmd, unstageHunksCmd,
  commitCmd, pushCmd, remoteCmd,
]