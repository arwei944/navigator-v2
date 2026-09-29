/**
 * 发布与云端命令：复用 lib/sync.mjs（发布流水线 / 云端一致性）、lib/sites.mjs（数据同步）、lib/vercel.mjs。
 * 长任务（发布、数据同步）走 jobs 管道，实时把子进程输出打到 stderr，stdout 只留最终 JSON。
 */
import * as sync from '../../console/lib/sync.mjs'
import * as sites from '../../console/lib/sites.mjs'
import * as vercel from '../../console/lib/vercel.mjs'
import * as jobs from '../../console/lib/jobs.mjs'
import * as git from '../../console/lib/git.mjs'
import * as changes from '../../console/lib/changes.mjs'
import { getAdminKey } from '../../console/lib/env.mjs'
import { CliError, EXIT, buildOptions, dryRunResult, parseCommandArgs, runJob, table } from '../lib/core.mjs'

function requireAdminKey(action) {
  if (getAdminKey()) return
  throw new CliError(`缺少管理密钥，无法${action}`, {
    code: 'ENV_MISSING',
    exitCode: EXIT.ENV,
    hint: '在 .env.local 配置 SITES_ADMIN_KEY（密钥不落盘、不进 git）',
  })
}

/** 同一时刻只允许一个同名长任务，避免并发发布互相覆盖云端版本 */
function guardRunning(title) {
  if (jobs.listJobs().some(j => j.title === title && j.status === 'running')) {
    throw new CliError(`已有「${title}」任务在运行中`, { code: 'BUSY', exitCode: EXIT.REJECTED, hint: '等待完成或到控制台终止后再试' })
  }
}

const statusCmd = {
  path: 'publish status',
  summary: '本地 / 云端版本对比：站点数、分支领先落后、热更新是否就绪、上次发布',
  usage: 'nav publish status',
  async run() {
    const st = await sync.status()
    return {
      data: st,
      render: d => [
        `站点：本地 ${d.local.count} · 云端 ${d.cloud.ok ? d.cloud.count : '读取失败'}${d.converged ? ' ✅ 已收敛' : ' ⚠️ 未收敛'}`,
        `版本：本地 package v${d.local.version} · 云端 v${d.cloud.version ?? '-'}`,
        `分支：${d.local.branch || '(detached)'} · 领先 ${d.local.ahead} / 落后 ${d.local.behind} · 未提交改动 ${d.local.changes}`,
        `热更新就绪：${d.hotUpdateReady ? '是' : '否（缺 SITES_ADMIN_KEY）'} · Vercel API：${d.vercel.apiAvailable ? '可用' : '不可用'}`,
        `最近提交：${d.local.head ? `${d.local.head.short} ${d.local.head.subject}` : '(无)'}`,
        d.cloud.error ? `云端读取：${d.cloud.error}` : '',
      ].filter(Boolean).join('\n'),
    }
  },
}

const runCmd = {
  path: 'publish run',
  summary: '一键发布流水线：检查改动 → 提交 → 推送 → 备份 → 数据门禁 → 构建 → 部署 → 热更新 → 一致性验证',
  usage: 'nav publish run [--message <提交消息>] [--skip-build] [--no-push] [--dry-run]',
  mutating: true,
  flags: {
    message: { desc: '存在已暂存改动时必填的提交消息', short: 'm' },
    'skip-build': { type: 'boolean', desc: '跳过前端构建，仅热更新云端数据' },
    'no-push': { type: 'boolean', desc: '跳过 git push（本地演练）' },
  },
  async run(argv, ctx) {
    const { values } = parseCommandArgs(argv, buildOptions(runCmd.flags), { usage: runCmd.usage })

    // 预演不触碰云端，先于密钥与并发校验返回：缺密钥 / 已有任务在跑时也能完成前置检查
    if (ctx.dryRun) {
      const st = await git.getStatus().catch(() => null)
      const staged = st ? st.files.filter(f => f.staged).length : 0
      const message = String(values.message || '').trim()
      const blockers = []
      if (!st) blockers.push('无法读取 git 状态（当前不是 git 仓库？）')
      else if (!st.branch) blockers.push('处于 detached HEAD，无法推送')
      if (staged > 0 && !message) blockers.push(`存在 ${staged} 个已暂存文件但未提供 --message，实际发布会中止`)
      if (!getAdminKey()) blockers.push('缺少 SITES_ADMIN_KEY，实际发布会中止在热更新前（用 data doctor 确认环境）')
      return dryRunResult({
        branch: st?.branch || '',
        stagedFiles: staged,
        ahead: st?.ahead || 0,
        push: !values['no-push'],
        skipBuild: Boolean(values['skip-build']),
        plan: [
          '检查本地改动',
          staged > 0 ? `提交 ${staged} 个已暂存文件` : '提交（无已暂存改动，跳过）',
          values['no-push'] ? '推送（已按 --no-push 跳过）' : `推送 ${st?.ahead || 0} 个领先提交`,
          '备份数据 → schema 门禁',
          values['skip-build'] ? '构建（已按 --skip-build 跳过）' : '前端构建',
          'Vercel 部署 → Blob 热更新 → 一致性验证',
        ],
        blockers,
      })
    }

    requireAdminKey('热更新云端数据')
    guardRunning(sync.PUBLISH_JOB_TITLE)

    const job = sync.startPublish({
      message: values.message || '',
      skipBuild: Boolean(values['skip-build']),
      push: !values['no-push'],
    })
    const res = await runJob(job, ctx, { label: '一键发布' })
    res.data.steps = res.data.steps.map(s => ({ ...s }))
    return res
  },
}

const verifyCmd = {
  path: 'publish verify',
  summary: '轮询云端数据直到与本地站点数一致（只读，不触发发布）',
  usage: 'nav publish verify [--expect <站点数>] [--tries <次数>]',
  flags: {
    expect: { desc: '期望站点数，默认取本地条数' },
    tries: { desc: '最多轮询次数，默认 6' },
  },
  async run(argv, ctx) {
    const { values } = parseCommandArgs(argv, buildOptions(verifyCmd.flags), { usage: verifyCmd.usage })
    const job = sync.startVerify({
      expectCount: values.expect !== undefined ? Number(values.expect) : null,
      tries: values.tries !== undefined ? Number(values.tries) : 6,
    })
    return runJob(job, ctx, { label: '云端一致性验证' })
  },
}

const syncDataCmd = {
  path: 'publish sync-data',
  summary: '只同步站点数据：差异检查 → 提交数据与图标 → 推送 → 备份 → 门禁 → 云端热更新 → 验证',
  usage: 'nav publish sync-data [--message <提交消息>] [--no-commit] [--no-push] [--dry-run]',
  mutating: true,
  flags: {
    message: { desc: '提交消息，默认由数据 diff 自动生成', short: 'm' },
    'no-commit': { type: 'boolean', desc: '不提交，仅热更新云端' },
    'no-push': { type: 'boolean', desc: '不推送远端' },
  },
  async run(argv, ctx) {
    const { values } = parseCommandArgs(argv, buildOptions(syncDataCmd.flags), { usage: syncDataCmd.usage })

    // 预演不触碰云端，先于密钥与并发校验返回：缺密钥 / 已有任务在跑时也能完成前置检查
    if (ctx.dryRun) {
      const diff = await changes.sitesSummary()
      const st = await git.getStatus().catch(() => null)
      return dryRunResult({
        dataChanged: Boolean(diff?.changed),
        sitesDiff: diff ? { head: diff.headCount, current: diff.currentCount, added: diff.diff.added.length, removed: diff.diff.removed.length, modified: diff.diff.modified.length } : null,
        commit: !values['no-commit'],
        push: !values['no-push'],
        plan: [
          diff?.changed ? `提交站点数据（+${diff.diff.added.length} / -${diff.diff.removed.length} / ~${diff.diff.modified.length}）` : '提交（数据与 HEAD 一致，跳过）',
          values['no-push'] ? '推送（已按 --no-push 跳过）' : `推送 ${st?.ahead || 0} 个领先提交`,
          '备份 → schema 门禁 → Blob 热更新 → 云端一致性验证',
        ],
      })
    }

    requireAdminKey('热更新云端数据')
    guardRunning(sites.DATA_SYNC_TITLE)

    const job = sites.startDataSync({
      commit: !values['no-commit'],
      push: !values['no-push'],
      message: values.message || '',
    })
    return runJob(job, ctx, { label: '站点数据同步' })
  },
}

const deploymentsCmd = {
  path: 'publish deployments',
  summary: '最近的 Vercel 部署（状态机 / 目标环境 / 关联提交），需 VERCEL_TOKEN',
  usage: 'nav publish deployments [--limit <n>]',
  flags: { limit: { desc: '条数，默认 8' } },
  async run(argv) {
    const { values } = parseCommandArgs(argv, buildOptions(deploymentsCmd.flags), { usage: deploymentsCmd.usage })
    if (!vercel.available()) {
      throw new CliError('未配置 VERCEL_TOKEN，无法读取部署列表', {
        code: 'ENV_MISSING', exitCode: EXIT.ENV, hint: '在 .env.local 配置 VERCEL_TOKEN / VERCEL_PROJECT_ID',
      })
    }
    const limit = values.limit ? Number(values.limit) : 8
    const list = await vercel.listDeployments(limit)
    return {
      data: { limit, count: list.length, deployments: list },
      render: d => table(
        ['状态', '环境', '地址', '提交'],
        d.deployments.map(x => [vercel.stateLabel(x.state), x.target || '-', x.url, (x.commitMessage || '').slice(0, 40)]),
      ),
    }
  },
}

export const commands = [statusCmd, runCmd, verifyCmd, syncDataCmd, deploymentsCmd]