/**
 * 开发流水线命令：把「测试门禁 → 提交 → 推送 → 构建 → 产物门禁 → 打包 → 上传 → 重启 → 线上验证」
 * 收成一条闭环。
 *
 * 业务逻辑全在 `tools/console/lib/release.mjs` —— 与控制台的「流水线」面板共用同一套编排，
 * 这里只做参数解析与输出。长任务走 jobs 管道，实时把子进程输出打到 stderr，stdout 只留最终 JSON。
 */
import * as release from '../../console/lib/release.mjs'
import { CliError, EXIT, buildOptions, dryRunResult, parseCommandArgs, runJob } from '../lib/core.mjs'

/** 命令行开关 → 编排选项（连字符键保持原样，与既有命令一致） */
function optsOf(v) {
  return {
    message: String(v.message || ''),
    skipTest: Boolean(v['skip-test']),
    noPush: Boolean(v['no-push']),
    skipBuild: Boolean(v['skip-build']),
    // N2：部署端点单选 / 多选（逗号分隔）；空 = 默认端点，行为与之前一致
    endpointIds: String(v.endpoint || '').split(',').map(s => s.trim()).filter(Boolean),
  }
}

const FLAGS = {
  message: { desc: '提交消息（工作区有改动时必填）', short: 'm' },
  'skip-test': { type: 'boolean', desc: '跳过测试门禁（会在日志留痕）' },
  'no-push': { type: 'boolean', desc: '不推送远端（本地演练）' },
  'skip-build': { type: 'boolean', desc: '跳过前端构建，复用现有 dist' },
  endpoint: { desc: '部署端点 id，逗号分隔可多选（默认 default；额外端点见 NAV_DEPLOY_ENDPOINTS）' },
}

const planCmd = {
  path: 'release plan',
  summary: '预检：列出即将执行的步骤、阻塞项与事实（只读，不触碰任何东西）',
  usage: 'nav release plan [--message <提交消息>] [--skip-test] [--no-push] [--skip-build]',
  flags: FLAGS,
  async run(argv) {
    const { values } = parseCommandArgs(argv, buildOptions(planCmd.flags), { usage: planCmd.usage })
    const p = await release.preflight(optsOf(values))
    return {
      data: p,
      render: d => [
        `分支：${d.facts.branch || '(detached)'} · ${d.facts.dirty} 处改动（已暂存 ${d.facts.staged}）· 领先 ${d.facts.ahead}`,
        '',
        '计划步骤：',
        ...d.steps.map((s, i) => `  ${String(i + 1).padStart(2)}. ${s.label.padEnd(6)} ${s.status === 'skipped' ? `（跳过：${s.note}）` : s.role}`),
        '',
        d.blockers.length ? `阻塞项（${d.blockers.length}）：\n` + d.blockers.map(b => `  ✗ ${b}`).join('\n') : '✅ 无阻塞项，可以执行 release run',
      ].join('\n'),
    }
  },
}

const runCmd = {
  path: 'release run',
  summary: '跑完整开发流水线：测试门禁 → 提交 → 推送 → 构建 → 产物门禁 → 打包 → 上传 → 重启 → 线上验证',
  usage: 'nav release run [--message <提交消息>] [--skip-test] [--no-push] [--skip-build] [--dry-run]',
  mutating: true,
  flags: FLAGS,
  async run(argv, ctx) {
    const { values } = parseCommandArgs(argv, buildOptions(runCmd.flags), { usage: runCmd.usage })
    const opts = optsOf(values)

    // 预演先于任何副作用返回：缺凭据 / 有阻塞项时也能拿到完整计划
    if (ctx.dryRun) {
      const p = await release.preflight(opts)
      return dryRunResult({ ...p.facts, options: opts, plan: p.plan, blockers: p.blockers })
    }

    const p = await release.preflight(opts)
    if (p.blockers.length) {
      throw new CliError(`流水线预检未通过：${p.blockers[0]}`, {
        code: 'REJECTED',
        exitCode: EXIT.REJECTED,
        hint: p.blockers.length > 1 ? `还有 ${p.blockers.length - 1} 项：${p.blockers.slice(1).join('；')}` : '先解决后再跑 release run',
      })
    }

    const job = release.startRelease(opts)
    return runJob(job, ctx, { label: '开发流水线' })
  },
}

export const commands = [planCmd, runCmd]
