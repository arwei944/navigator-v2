/**
 * 发布门禁与云端快照命令：预检放行、快照清单、一键回滚。
 * 业务逻辑在 lib/gate.mjs（凭证）与 lib/snapshots.mjs（云端快照读写），与发布流水线同源。
 */
import * as gate from '../../console/lib/gate.mjs'
import * as snapshots from '../../console/lib/snapshots.mjs'
import { CliError, EXIT, buildOptions, dryRunResult, parseCommandArgs, table } from '../lib/core.mjs'

const preflightCmd = {
  path: 'publish preflight',
  summary: '发布预检：列出将提交文件 / 待推送提交 / 云端版本对比 / 数据增删统计，并产出放行凭证',
  usage: 'nav publish preflight',
  async run() {
    const d = await gate.preflight({ kind: 'publish' })
    return {
      data: d,
      render: x => [
        `放行凭证：${x.id}（${x.ttlSeconds}s 内有效，工作区一变动即作废）`,
        '',
        `分支 ${x.workspace.branch || '(detached)'} · HEAD ${x.workspace.head ? x.workspace.head.short : '-'} · 领先 ${x.workspace.ahead} / 落后 ${x.workspace.behind}`,
        `将提交 ${x.willCommit.length} 个文件：${x.willCommit.join('、') || '(无)'}`,
        x.willNotCommit.length ? `不会提交（未暂存）${x.willNotCommit.length} 个：${x.willNotCommit.slice(0, 6).join('、')}${x.willNotCommit.length > 6 ? ' …' : ''}` : '',
        `待推送提交 ${x.pendingCommits.length} 个：${x.pendingCommits.slice(0, 5).map(c => c.short).join('、') || '(无)'}`,
        '',
        `云端：${x.cloud.ok ? `v${x.cloud.version} · ${x.cloud.count} 站点 · ${x.cloud.withIcons} 带图标` : `读取失败（${x.cloud.error}）`}`,
        `本地数据：${x.data ? `${x.data.currentCount} 站点（HEAD ${x.data.headCount}）` : '读取失败'}`,
        x.data ? `数据增删改：+${x.data.added.length} / -${x.data.removed.length} / ~${x.data.modified.length}` : '',
        '',
        x.blockers.length ? `阻断项（${x.blockers.length}）：\n  - ${x.blockers.join('\n  - ')}` : '✅ 无阻断项，可放行',
        (x.warnings || []).length ? `提醒（${x.warnings.length}）：\n  - ${x.warnings.join('\n  - ')}` : '',
        '',
        `放行方式：nav publish run --gate ${x.id} --message "<提交消息>"`,
      ].filter(Boolean).join('\n'),
    }
  },
}

const snapshotsCmd = {
  path: 'publish snapshots',
  summary: '云端数据快照清单（新 → 旧），并对照本机 backups/ 目录',
  usage: 'nav publish snapshots [--limit <n>]',
  flags: { limit: { desc: '最多列出多少份，默认 20' } },
  async run(argv) {
    const { values } = parseCommandArgs(argv, buildOptions(snapshotsCmd.flags), { usage: snapshotsCmd.usage })
    const limit = values.limit ? Number(values.limit) : 20
    const cloud = await snapshots.listSnapshots()
    const local = snapshots.localBackups(limit)
    const items = cloud.snapshots.slice(0, limit)
    return {
      data: { keep: cloud.keep, cloudCount: cloud.count, snapshots: items, local },
      render: d => [
        `云端快照 ${d.cloudCount} 份（保留最近 ${d.keep} 份）：`,
        table(['版本', '时间', '大小', 'pathname'], d.snapshots.map(s => [`v${s.version}`, s.ts, `${(s.size / 1024).toFixed(1)}KB`, s.pathname])),
        '',
        `本机 backups/ ${d.local.count} 份（不上云，仅本机对照）：`,
        table(['文件', '大小'], d.local.items.map(x => [x.name, `${(x.size / 1024).toFixed(1)}KB`])),
      ].join('\n'),
    }
  },
}

const rollbackCmd = {
  path: 'publish rollback',
  summary: '把指定云端快照写回生产数据（version 继续递增，不回退计数）；--dry-run 只预演差异',
  usage: 'nav publish rollback <snapshot-pathname> [--dry-run]',
  mutating: true,
  positionals: [{ name: 'snapshot', required: true, desc: '快照 pathname，如 sites-data.snapshots/000096-2026-09-25T10-00-00-000Z.json' }],
  async run(argv, ctx) {
    const { positionals } = parseCommandArgs(argv, {}, { allowPositionals: true, usage: rollbackCmd.usage })
    const pathname = positionals[0]
    if (!pathname) {
      throw new CliError('缺少快照 pathname', { code: 'USAGE', exitCode: EXIT.USAGE, hint: `用法：${rollbackCmd.usage}（用 nav publish snapshots 查看清单）` })
    }
    const preview = await snapshots.previewRollback(pathname)
    if (ctx.dryRun) {
      return dryRunResult({
        ...preview,
        note: '实际会把该快照写回云端主数据；回滚前的当前数据也会自动存一份快照，version 继续 +1',
      })
    }
    const r = await snapshots.rollbackTo(pathname)
    return {
      data: {
        restoredFrom: r.restoredFrom,
        previousVersion: r.previousVersion,
        version: r.version,
        count: r.sites.length,
        withIcons: r.sites.filter(s => s.icon).length,
        safetySnapshot: r.snapshot,
      },
      render: d => `✅ 已回滚到 ${d.restoredFrom}\n云端 v${d.previousVersion} → v${d.version} · ${d.count} 站点 · ${d.withIcons} 带图标\n回滚前数据已存快照：${d.safetySnapshot?.pathname || '(无)'}`,
    }
  },
}

export const commands = [preflightCmd, snapshotsCmd, rollbackCmd]