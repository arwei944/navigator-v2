/**
 * 运维事件命令：发布历史、通知中心、可用性巡检。
 *
 * 与控制台「通知中心」面板、线上 /admin 的发布历史与通知区共用同一套落盘与内核
 * （tools/console/lib/{publishlog,notify,schedule}.mjs + shared/ops/*），
 * 因此 CLI 查到的记录与 UI 看到的是同一批，不会出现「命令行说成功、面板没记录」。
 */
import * as publishlog from '../../console/lib/publishlog.mjs'
import * as notify from '../../console/lib/notify.mjs'
import * as schedule from '../../console/lib/schedule.mjs'
import { readSites } from '../../console/lib/data.mjs'
import { record } from '../../console/lib/audit.mjs'
import { CliError, EXIT, buildOptions, note, parseCommandArgs, table } from '../lib/core.mjs'

const SEV_MARK = { error: '✖', warn: '!', info: '·' }

function fmtClock(ts) {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts || '')
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/* ---------------- 发布历史 ---------------- */

const historyCmd = {
  path: 'ops history',
  summary: '发布历史（新 → 旧）：结果 / 触发来源 / 云端版本 / 耗时，附成功率概览',
  usage: 'nav ops history [--ok ok|fail] [--trigger manual|schedule|cli|admin] [--q <关键字>] [--limit <n>]',
  flags: {
    ok: { desc: '按结果过滤：ok=只看成功 / fail=只看失败' },
    trigger: { desc: '按触发来源过滤：manual / schedule / cli / admin' },
    q: { desc: '关键词：匹配提交信息 / 失败原因 / 部署 URL / 备注' },
    limit: { desc: '最多列出多少条，默认 30' },
  },
  async run(argv) {
    const { values } = parseCommandArgs(argv, buildOptions(historyCmd.flags), { usage: historyCmd.usage })
    const r = publishlog.list({
      ok: values.ok || '',
      trigger: values.trigger || '',
      q: values.q || '',
      limit: values.limit ? Number(values.limit) : 30,
    })
    return {
      data: r,
      render: d => [
        d.summary.total
          ? `共 ${d.summary.total} 次 · 成功 ${d.summary.ok} / 失败 ${d.summary.failed} · 成功率 ${d.summary.successRate}% · 最近 ${fmtClock(d.summary.lastAt)}${d.summary.avgDuration ? ` · 平均耗时 ${(d.summary.avgDuration / 1000).toFixed(1)}s` : ''}`
          : '暂无发布记录。跑一次 nav publish run 或控制台「一键发布」后就会有。',
        '',
        d.items.length
          ? table(['时间', '结果', '来源', '云端', '耗时', '说明'], d.items.map(x => [
            fmtClock(x.ts),
            x.ok ? '✓ 成功' : '✗ 失败',
            d.triggers[x.trigger] || x.trigger,
            x.cloud ? `v${x.cloud.version} · ${x.cloud.count}` : '-',
            x.duration ? `${(x.duration / 1000).toFixed(1)}s` : '-',
            x.ok ? (x.commit?.message || x.note || '') : (x.reason || '未说明'),
          ]))
          : `（${d.matched} 条匹配筛选条件）`,
      ].join('\n'),
    }
  },
}

/* ---------------- 通知中心 ---------------- */

const notifyCmd = {
  path: 'ops notify',
  summary: '通知中心列表（新 → 旧）：发布 / 批量操作 / 回滚 / 巡检事件，附未读概览',
  usage: 'nav ops notify [--severity error|warn|info] [--kind <类型>] [--q <关键字>] [--unread] [--limit <n>]',
  flags: {
    severity: { desc: '按级别过滤：error 严重 / warn 注意 / info 提示' },
    kind: { desc: '按类型过滤，如 publish.fail / health.down（用 --kinds 查看全部）' },
    q: { desc: '关键词：匹配标题 / 正文 / 目标' },
    unread: { type: 'boolean', desc: '只看未读' },
    limit: { desc: '最多列出多少条，默认 50' },
    kinds: { type: 'boolean', desc: '只列出通知类型目录（不查记录）' },
  },
  async run(argv) {
    const { values } = parseCommandArgs(argv, buildOptions(notifyCmd.flags), { usage: notifyCmd.usage })
    if (values.kinds) {
      const kinds = Object.values(notify.NOTIFY_KINDS)
      return {
        data: { kinds: notify.NOTIFY_KINDS },
        render: () => table(['类型', '名称', '级别', '建议动作'], kinds.map(k => [k.id, k.label, k.severity, k.action || '-'])),
      }
    }
    const r = notify.list({
      severity: values.severity || '',
      kind: values.kind || '',
      q: values.q || '',
      limit: values.limit ? Number(values.limit) : 50,
      unreadOnly: Boolean(values.unread),
    })
    return {
      data: r,
      render: d => [
        `去重后 ${d.total} 条 · 匹配 ${d.matched} 条 · 未读 ${d.summary.unread}`,
        '',
        d.items.length
          ? table(['时间', '级别', '类型', '标题', '目标'], d.items.map(n => [
            fmtClock(n.ts), `${SEV_MARK[n.severity] || '·'} ${d.severities[n.severity] || n.severity}`,
            n.kind, `${n.read ? '' : '[未读] '}${n.title || n.label}`, n.target || '-',
          ]))
          : '没有匹配的通知。',
      ].join('\n'),
    }
  },
}

const notifyReadCmd = {
  path: 'ops notify-read',
  summary: '把通知标记为已读（--ids 指定则只标这些，否则全部标记已读）',
  usage: 'nav ops notify-read [--ids <id,id,...>]',
  mutating: true,
  flags: { ids: { desc: '只标记这些通知 id，逗号分隔；省略则全部标记已读' } },
  async run(argv, ctx) {
    const { values } = parseCommandArgs(argv, buildOptions(notifyReadCmd.flags), { usage: notifyReadCmd.usage })
    const ids = values.ids ? String(values.ids).split(',').map(s => s.trim()).filter(Boolean) : null
    if (ctx.dryRun) {
      const before = notify.list({ unreadOnly: true, limit: 500 })
      return {
        data: { dryRun: true, applied: false, scope: ids ? `${ids.length} 条` : '全部', wouldRead: before.summary.unread },
        render: d => `预演（未生效）：将把 ${d.scope}（当前未读 ${d.wouldRead} 条）标记为已读`,
      }
    }
    const r = notify.markRead({ ids })
    record({ action: 'notify.read', target: ids ? ids.join(',') : '全部', detail: `已读 ${r.read} 条`, actor: 'cli' })
    return {
      data: { ok: true, read: r.read, scope: ids ? ids.length : 'all' },
      render: d => `已标记 ${d.read} 条通知为已读。`,
    }
  },
}

const notifyClearCmd = {
  path: 'ops notify-clear',
  summary: '清空全部通知（不可撤销，须显式 --yes）',
  usage: 'nav ops notify-clear [--yes]',
  mutating: true,
  flags: { yes: { type: 'boolean', desc: '确认清空（不可撤销）' } },
  async run(argv, ctx) {
    const { values } = parseCommandArgs(argv, buildOptions(notifyClearCmd.flags), { usage: notifyClearCmd.usage })
    const current = notify.list({ limit: 1 })
    if (ctx.dryRun) {
      return {
        data: { dryRun: true, applied: false, wouldClear: current.total },
        render: d => `预演（未生效）：将清空 ${d.wouldClear} 条通知`,
      }
    }
    if (!values.yes) {
      throw new CliError('清空通知不可撤销，需加 --yes 确认', {
        code: 'REJECTED', exitCode: EXIT.REJECTED, hint: '先 --dry-run 看将清空多少条，确认后再加 --yes',
      })
    }
    const r = notify.clear()
    record({ action: 'notify.clear', target: '全部', detail: `清空 ${r.cleared} 条`, actor: 'cli' })
    return { data: r, render: d => `已清空 ${d.cleared} 条通知。` }
  },
}

/* ---------------- Webhook ---------------- */

const webhookCmd = {
  path: 'ops webhook',
  summary: '查看通知 Webhook 配置（地址 / 最低级别）',
  usage: 'nav ops webhook',
  async run() {
    const cfg = notify.webhookConfig()
    return {
      data: cfg,
      render: d => d.url
        ? `Webhook：${d.url}\n最低级别：${d.minSeverity}（${d.minSeverity === 'error' ? '仅严重' : d.minSeverity === 'warn' ? '严重 + 注意' : '全部'}）`
        : '未配置 Webhook。用 nav ops webhook-set --url <地址> [--min-severity error|warn|info] 设置。',
    }
  },
}

const webhookSetCmd = {
  path: 'ops webhook-set',
  summary: '设置通知 Webhook：达到最低级别的通知会以 POST 推送到该地址',
  usage: 'nav ops webhook-set [--url <地址>] [--min-severity error|warn|info] [--clear]',
  mutating: true,
  flags: {
    url: { desc: 'Webhook 地址；留空且未加 --clear 时保持原值' },
    'min-severity': { desc: '最低推送级别：error / warn / info，默认 warn' },
    clear: { type: 'boolean', desc: '清空 Webhook 地址（停用推送）' },
  },
  async run(argv, ctx) {
    const { values } = parseCommandArgs(argv, buildOptions(webhookSetCmd.flags), { usage: webhookSetCmd.usage })
    const patch = {}
    if (values.clear) patch.url = ''
    else if (values.url !== undefined) patch.url = values.url
    if (values['min-severity'] !== undefined) patch.minSeverity = values['min-severity']
    if (Object.keys(patch).length === 0) {
      throw new CliError('未提供任何要修改的项', { code: 'USAGE', exitCode: EXIT.USAGE, hint: `用法：${webhookSetCmd.usage}` })
    }
    const before = notify.webhookConfig()
    if (ctx.dryRun) {
      return {
        data: { dryRun: true, applied: false, before, after: { ...before, ...patch } },
        render: d => `预演（未生效）：Webhook ${d.before.url || '(未配置)'} → ${d.after.url || '(停用)'} · 最低级别 ${d.after.minSeverity}`,
      }
    }
    const next = notify.saveWebhookConfig(patch)
    record({ action: 'notify.webhook', target: next.url || '(停用)', detail: `最低级别 ${next.minSeverity}`, actor: 'cli' })
    return {
      data: next,
      render: d => d.url ? `Webhook 已设为 ${d.url} · 最低级别 ${d.minSeverity}` : 'Webhook 已停用。',
    }
  },
}

/* ---------------- 可用性巡检 ---------------- */

const inspectCmd = {
  path: 'ops inspect',
  summary: '立即执行一次全站巡检：对比上一轮识别「新失效 / 已恢复」并落通知（控制台未开时也能跑）',
  usage: 'nav ops inspect',
  mutating: true,
  async run(argv, ctx) {
    parseCommandArgs(argv, {}, { usage: inspectCmd.usage })
    const cfg = schedule.config()
    const total = readSites().length
    if (ctx.dryRun) {
      return {
        data: {
          dryRun: true, applied: false, total,
          timeout: cfg.timeout, concurrency: cfg.concurrency, attempts: cfg.attempts,
          note: '实际会探活全部站点，把结果落为健康快照，并对「新失效 / 已恢复」推送通知',
        },
        render: d => `预演（未生效）：将巡检 ${d.total} 个站点（超时 ${d.timeout}s · 并发 ${d.concurrency} · 重试 ${d.attempts - 1} 次），落健康快照并按差集推送通知`,
      }
    }
    note(`开始巡检（超时 ${cfg.timeout}s · 并发 ${cfg.concurrency} · 重试 ${cfg.attempts - 1} 次）…`, ctx)
    const r = await schedule.runInspection({ trigger: 'cli', actor: 'cli' })
    const c = r.counts
    return {
      ok: c.down === 0,
      data: {
        run: r.run, ts: r.ts, total: r.total, counts: c,
        fresh: r.fresh.map(x => ({ id: x.id, name: x.name, url: x.url, code: x.code })),
        recovered: r.recovered.map(x => ({ id: x.id, name: x.name, url: x.url, code: x.code })),
        saved: r.saved,
      },
      error: c.down ? { code: 'UNHEALTHY', message: `${c.down} 个站点需处理（新增 ${r.fresh.length}）`, hint: '详见 data.fresh；可用 nav sites check --ids <id> 复验' } : null,
      render: d => [
        `巡检 run ${d.run}（${fmtClock(d.ts)}）· ${d.total} 站点`,
        `正常 ${d.counts.ok} / 可忽略 ${d.counts.limited} / 需处理 ${d.counts.down}`,
        d.fresh.length ? `\n新增失效（${d.fresh.length}）：\n` + table(['ID', 'HTTP', '名称'], d.fresh.map(x => [x.id, x.code, x.name])) : '',
        d.recovered.length ? `\n已恢复（${d.recovered.length}）：\n` + table(['ID', 'HTTP', '名称'], d.recovered.map(x => [x.id, x.code, x.name])) : '',
        d.saved ? '' : '\n（快照落盘失败，本轮结果仅本次可见）',
      ].filter(Boolean).join('\n'),
    }
  },
}

export const commands = [historyCmd, notifyCmd, notifyReadCmd, notifyClearCmd, webhookCmd, webhookSetCmd, inspectCmd]