/**
 * 数据库备份命令：把线上 SQLite 拉到本机。
 *
 * 为什么要有 CLI 而不只有控制台面板：备份这件事最该出现在「发布前」和
 * 「出事时」，而这两个场景用户往往在命令行里。面板适合日常查看，CLI 适合卡点。
 */
import * as backup from '../../console/lib/ops/backup.mjs'
import { EXIT } from '../lib/core.mjs'
import { fmtDateTimeSec, fmtBytes } from '../../../shared/format.mjs'

const backupCmd = {
  path: 'db backup',
  summary: '备份线上数据库到本机（整份 SQLite，含站点/点击/健康/审计）',
  usage: 'nav db backup [--keep 24]',
  examples: ['nav db backup', 'nav db backup --keep 48'],
  mutating: true,
  async run({ flags }) {
    const keep = Number(flags.keep) || undefined
    const r = await backup.runBackup(keep ? { keep } : {})
    if (!r.ok) {
      const e = new Error(r.error || '备份失败')
      e.exitCode = EXIT.FAIL
      throw e
    }
    return {
      data: r,
      render: d => [
        `✅ 已备份 ${d.siteCount} 站点 · ${d.objects} 个对象 · ${fmtBytes(d.bytes)}`,
        `文件：${d.name}`,
        `完整性：${d.integrity}`,
        d.pruned?.length ? `清理旧备份 ${d.pruned.length} 个文件` : '',
      ].filter(Boolean).join('\n'),
    }
  },
}

const statusCmd = {
  path: 'db status',
  summary: '查看备份状态与新鲜度（能否安全部署）',
  usage: 'nav db status',
  async run() {
    const s = backup.status()
    return {
      data: s,
      render: d => {
        const f = d.freshness
        const lines = [
          `${f.ok ? '✅' : '❌'} ${f.reason}`,
          '',
          `备份目录：${d.dir}`,
          `备份份数：${d.count}`,
          `最近备份：${fmtDateTimeSec(d.lastAt, '从未')}`,
        ]
        if (d.items?.length) {
          lines.push('', '最近几份：')
          for (const it of d.items.slice(0, 5)) {
            const at = it.at ? fmtDateTimeSec(it.at, it.name) : it.name
            lines.push(`  ${at}  ${fmtBytes(it.size).padStart(8)}  ${it.siteCount ?? '?'} 站点`)
          }
        }
        lines.push('', f.ok
          ? '✓ 现在可以安全部署（万一出事有备份可回滚）'
          : '✗ 不建议部署：此时容器重建会丢数据，且没有副本可回滚')
        return lines.join('\n')
      },
    }
  },
}

export const commands = [backupCmd, statusCmd]
