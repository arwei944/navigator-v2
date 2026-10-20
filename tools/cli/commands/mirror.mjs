/**
 * 镜像同步命令：把云端变化拉到本地。
 *
 * 为什么要有 CLI：同步最该出现在两个时刻 ——「换机器后初始化」和
 * 「排查线上到底改成什么样了」。这两个场景用户都在命令行里。
 */
import * as mirror from '../../console/lib/ops/mirror.mjs'
import { EXIT, buildOptions, parseCommandArgs } from '../lib/core.mjs'
import { fmtDateTimeSec, fmtBytes } from '../../../shared/format.mjs'

const syncCmd = {
  path: 'mirror sync',
  summary: '把云端变化同步到本地镜像（本机离线期间的也会补齐）',
  usage: 'nav mirror sync [--force]',
  examples: ['nav mirror sync', 'nav mirror sync --force'],
  flags: {
    force: { desc: '忽略游标，从零做一次全量对齐' },
  },
  mutating: true,
  async run(argv, ctx = {}) {
    const { values } = parseCommandArgs(argv, buildOptions(syncCmd.flags), { usage: syncCmd.usage })
    const force = Boolean(values.force)

    if (ctx.dryRun) {
      const st = mirror.status()
      return {
        dryRun: true,
        data: { action: 'mirror sync', force, cursor: st.cursor, objects: st.objects },
        render: () => [
          '预演（未生效）',
          '',
          `将从游标 ${force ? 0 : st.cursor} 开始拉取`,
          `本地当前：${st.objects} 个对象 · ${fmtBytes(st.bytes)}`,
        ].join('\n'),
      }
    }

    const r = await mirror.syncOnce({ force })
    if (!r.ok) {
      const e = new Error(r.error || '同步失败')
      e.exitCode = EXIT.FAIL
      throw e
    }
    return {
      data: r,
      render: d => [
        `✅ 已同步 ${d.applied} 个变化${d.removed ? ` · 删除 ${d.removed} 个` : ''}`,
        `游标：${d.from} → ${d.cursor}`,
        d.fullResync ? '⚠ 游标落后于日志保留区间，已改走全量对齐' : '',
      ].filter(Boolean).join('\n'),
    }
  },
}

const statusCmd = {
  path: 'mirror status',
  summary: '查看本地镜像状态（游标、对象数、最近同步结果）',
  usage: 'nav mirror status',
  async run() {
    const s = mirror.status()
    return {
      data: s,
      render: d => {
        const lines = [
          `镜像目录：${d.dir}`,
          `已追游标：${d.cursor}`,
          `本地对象：${d.objects} 个 · ${fmtBytes(d.bytes)}`,
          `最近成功：${fmtDateTimeSec(d.lastSuccessAt, '从未')}`,
          `最近尝试：${fmtDateTimeSec(d.lastAttemptAt, '从未')}`,
        ]
        if (d.lastError) lines.push(`最近错误：${d.lastError}`)
        if (d.lastFullResyncAt) {
          lines.push(`最近全量对齐：${fmtDateTimeSec(d.lastFullResyncAt)}（累计 ${d.truncatedEvents} 次）`)
        }
        lines.push(
          '',
          d.lastError
            ? '✗ 上次同步失败；游标未推进，下次会从同一位置重试'
            : '✓ 同步正常',
        )
        return lines.join('\n')
      },
    }
  },
}

const objectsCmd = {
  path: 'mirror objects',
  summary: '列出本地镜像里的对象',
  usage: 'nav mirror objects [--limit 50]',
  flags: {
    limit: { desc: '最多列出多少个，默认 50' },
  },
  async run(argv) {
    const { values } = parseCommandArgs(argv, buildOptions(objectsCmd.flags), { usage: objectsCmd.usage })
    const limit = Number(values.limit) || 50
    const items = mirror.listObjects(limit)
    return {
      data: { count: items.length, items },
      render: d => {
        if (!d.items.length) return '本地镜像为空。先跑 nav mirror sync'
        return [
          `共 ${d.count} 个对象：`,
          ...d.items.map(o => `  ${String(o.size ?? '?').padStart(8)}  ${o.pathname}`),
        ].join('\n')
      },
    }
  },
}

export const commands = [syncCmd, statusCmd, objectsCmd]
