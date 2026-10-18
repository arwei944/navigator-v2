/**
 * 本站可用性命令：盯的是**我们自己部署的站点**是否可访问。
 *
 * 与 `nav ops inspect` 的区别：那个探我们收录的 300 个站点，这个探我们自己。
 * 有了它，平台边缘故障不再只能靠人工盯着看 —— 掉线区间会带时间戳落盘，
 * 并且能一眼分出「平台挂了」还是「我们的应用挂了」。
 */
import { CliError, EXIT, buildOptions, note, parseCommandArgs, table } from '../lib/core.mjs'
import * as uptime from '../../console/lib/uptime.mjs'
import * as notify from '../../console/lib/notify.mjs'
import { KIND, KIND_LABEL, summarize, fmtDuration } from '../../../shared/uptime.mjs'
import { fmtClockTime } from '../../../shared/format.mjs'


/** 从日志尾部折叠出「最近一段掉线」——恢复通知要报的是**真实掉线时长**，不是两次采样的间隔 */
function outageTail(now) {
  const { events } = uptime.read({ limit: 500 })
  if (!events.length) return null
  const s = summarize(events, { now, since: events[0].at })
  return s.outages[s.outages.length - 1] || null
}

/**
 * 状态变化时推一条通知（落控制台通知中心 + 走已配置的 webhook）。
 * 通知是旁路：失败绝不影响监测本身。
 */
function notifyTransition(ev, prev, silent) {
  if (silent || !prev) return null
  try {
    if (ev.kind !== KIND.OK) {
      return notify.push({
        kind: 'uptime.down',
        title: `本站掉线：${KIND_LABEL[ev.kind]}`,
        body: [ev.status ? `HTTP ${ev.status}` : (ev.error || '无响应'), ev.body || ''].filter(Boolean).join(' · ').slice(0, 200),
        target: ev.url,
        actor: 'uptime',
      })
    }
    const o = outageTail(ev.at)
    return notify.push({
      kind: 'uptime.recovered',
      title: '本站已恢复',
      body: o ? `掉线 ${fmtDuration(o.durationMs)}（判定：${KIND_LABEL[o.kind] || o.kind}）` : '已恢复',
      target: ev.url,
      actor: 'uptime',
    })
  } catch { return null }
}



const mark = k => (k === KIND.OK ? '✅' : k === KIND.EDGE ? '⚠️' : '❌')

function lineFor(ev) {
  const bits = [`${mark(ev.kind)} ${fmtClockTime(ev.at)}`, KIND_LABEL[ev.kind] || ev.kind]
  if (ev.status) bits.push(`HTTP ${ev.status}`)
  if (ev.ms != null) bits.push(`${ev.ms}ms`)
  if (ev.error) bits.push(ev.error)
  return bits.join(' · ')
}

/* ---------------- 探一次 ---------------- */

const checkCmd = {
  path: 'uptime check',
  summary: '探一次本站可用性，判定属于哪种故障（平台边缘 / 应用 / 连不上），不落盘',
  usage: 'nav uptime check [--url <地址>] [--timeout <秒>]',
  flags: {
    url: { desc: '探测目标，默认取发布通道当前指向的站点地址' },
    timeout: { desc: '单次超时秒数，默认 12' },
  },
  async run(argv) {
    const { values } = parseCommandArgs(argv, buildOptions(checkCmd.flags), { usage: checkCmd.usage })
    const ev = await uptime.probeOnce({
      url: values.url || '',
      timeoutMs: values.timeout ? Number(values.timeout) * 1000 : undefined,
    })
    return {
      ok: ev.ok,
      data: { ...ev, target: uptime.siteUrl(), logPath: uptime.logPath() },
      error: ev.ok ? null : {
        code: ev.kind === KIND.EDGE ? 'EDGE_DOWN' : ev.kind === KIND.NET ? 'NETWORK' : 'APP_DOWN',
        message: `${KIND_LABEL[ev.kind]}（${ev.status ? 'HTTP ' + ev.status : ev.error || '无响应'}）`,
        hint: ev.kind === KIND.EDGE
          ? '平台边缘故障：重启容器治不了，等它自愈；连测几次确认是否恢复'
          : '先看站点日志与容器状态，再决定是否重启',
      },
      render: d => [
        lineFor(d),
        `目标 ${d.url}`,
        d.body ? `响应开头：${d.body}` : '',
      ].filter(Boolean).join('\n'),
    }
  },
}

/* ---------------- 持续盯 ---------------- */

const watchCmd = {
  path: 'uptime watch',
  summary: '持续探测并落盘（data/uptime.jsonl）：只在状态变化时出声，其余按心跳报平安',
  usage: 'nav uptime watch [--interval <秒>] [--samples <n>] [--url <地址>] [--every <n>] [--silent]',
  flags: {
    interval: { desc: '探测间隔秒数，默认 60' },
    samples: { desc: '最多探多少次后退出，默认 0 = 一直盯着（Ctrl+C 停）' },
    url: { desc: '探测目标，默认取发布通道指向的站点地址' },
    every: { desc: '每多少次打印一行心跳，默认 10' },
    silent: { type: 'boolean', desc: '只落盘，不推通知（通知走控制台通知中心 + 已配置的 webhook）' },
  },
  async run(argv, ctx) {
    const { values } = parseCommandArgs(argv, buildOptions(watchCmd.flags), { usage: watchCmd.usage })
    const intervalMs = Math.max(5, Number(values.interval) || 60) * 1000
    const maxSamples = Math.max(0, Number(values.samples) || 0)
    const every = Math.max(1, Number(values.every) || 10)
    const target = String(values.url || uptime.siteUrl()).replace(/\/+$/, '')

    note(`目标 ${target} · 每 ${intervalMs / 1000}s 一次 · 日志 ${uptime.logPath()}`, ctx)

    return await new Promise(resolve => {
      const silent = !!values.silent
      let downSince = 0
      let outages = 0
      let fails = 0
      let notified = 0

      const done = (stoppedBy) => {
        resolve({
          data: { target, samples: watcher.count, fails, outages, notified, stoppedBy, logPath: uptime.logPath() },
          render: d => `\n本次监测结束（${d.stoppedBy}）：${d.samples} 次探测 · ${d.fails} 次异常 · ${d.outages} 段掉线${d.notified ? ` · 推送通知 ${d.notified} 条` : ''}`,
        })
      }

      const watcher = uptime.watch({
        intervalMs,
        url: target,
        maxSamples,
        onSample(ev, n, prev) {
          // prev 来自**日志里的上一条**，所以「一次只探一个样本」的计划任务也能识别状态变化
          const changed = !prev || prev.kind !== ev.kind
          if (changed) {
            if (ev.kind !== KIND.OK) {
              if (!downSince) { downSince = ev.at; outages++ }
              console.log(`${mark(ev.kind)} ${fmtClockTime(ev.at)}  掉线 —— ${KIND_LABEL[ev.kind]}${ev.status ? `（HTTP ${ev.status}）` : ''}${ev.body ? `\n              ${ev.body}` : ''}`)
            } else if (downSince) {
              console.log(`\x1b[1m✅ ${fmtClockTime(ev.at)}  已恢复 —— 掉线 ${fmtDuration(ev.at - downSince)}\x1b[0m`)
              downSince = 0
            } else {
              console.log(`✅ ${fmtClockTime(ev.at)}  正常（HTTP ${ev.status} · ${ev.ms}ms）`)
            }
            // 只在**真的发生变化**时推通知；首次样本（prev 为空）不推，否则每次重启都报一次
            if (notifyTransition(ev, prev, silent)) notified++
          } else if (n % every === 0) {
            console.log(`· ${fmtClockTime(ev.at)}  ${ev.ok ? 'ok' : KIND_LABEL[ev.kind]}  ${ev.ms}ms  （第 ${n} 次${fails ? ` · 异常 ${fails} 次` : ''}）`)
          }
          if (ev.kind !== KIND.OK) fails++
        },
      })

      const onSig = () => { watcher.stop(); done('Ctrl+C') }
      process.once('SIGINT', onSig)
      process.once('SIGTERM', onSig)

      // 有限次数的跑法：等它自己停
      if (maxSamples) {
        const wait = setInterval(() => {
          if (watcher.count >= maxSamples) {
            clearInterval(wait)
            setTimeout(() => { watcher.stop(); done(`探满 ${maxSamples} 次`) }, Math.min(intervalMs, 3000))
          }
        }, 500)
      }
    })
  },
}

/* ---------------- 报告 ---------------- */

const reportCmd = {
  path: 'uptime report',
  summary: '读本机监测日志，给出可用率、掉线区间与每段是谁的故障',
  usage: 'nav uptime report [--hours <n>] [--list <n>]',
  flags: {
    hours: { desc: '统计窗口小时数，默认 24' },
    list: { desc: '最多列出最近几段掉线，默认 10' },
  },
  async run(argv) {
    const { values } = parseCommandArgs(argv, buildOptions(reportCmd.flags), { usage: reportCmd.usage })
    const hours = Math.max(0.1, Number(values.hours) || 24)
    const now = Date.now()
    const since = now - hours * 3600 * 1000
    const { events, skipped, total } = uptime.read({ since })
    if (!events.length) {
      throw new CliError(`最近 ${hours}h 没有监测样本`, {
        code: 'NO_SAMPLES', exitCode: EXIT.ENV,
        hint: '先跑 nav uptime watch 让它盯一会儿（或 --samples N 探有限次）',
      })
    }
    const s = summarize(events, { now, since })
    const listed = s.outages.slice().reverse().slice(0, Math.max(1, Number(values.list) || 10))
    return {
      ok: s.outages.length === 0,
      data: {
        window: { since, now, hours },
        samples: s.samples, okCount: s.okCount, failCount: s.failCount,
        availability: s.availability, upMs: s.upMs, downMs: s.downMs,
        outages: s.outages, skipped, totalInLog: total,
        edgeOutages: s.outages.filter(o => o.kind === KIND.EDGE).length,
        appOutages: s.outages.filter(o => o.kind === KIND.APP).length,
      },
      render: d => {
        const pct = d.availability == null ? '—' : (d.availability * 100).toFixed(3) + '%'
        const head = [
          `窗口：最近 ${d.window.hours}h（${fmtDateTimeShort(d.window.since)} → 现在）`,
          `样本 ${d.samples} 次（正常 ${d.okCount} / 异常 ${d.failCount}）· 可用率 ${pct}`,
          `掉线 ${d.outages.length} 段 · 累计 ${fmtDuration(d.downMs)}${d.outages.length ? `（平台边缘 ${d.edgeOutages} 段 / 应用 ${d.appOutages} 段）` : ''}`,
        ]
        if (!d.outages.length) return head.join('\n') + '\n\n窗口内没有掉线。'
        const rows = listed.map(o => [
          fmtDateTimeShort(o.startAt),
          o.ongoing ? '进行中' : fmtDuration(o.durationMs),
          KIND_LABEL[o.kind] || o.kind,
          String(o.samples),
        ])
        return [
          ...head,
          '',
          table(['开始', '时长', '判定', '样本'], rows),
          d.skipped ? `\n（日志里跳过 ${d.skipped} 行损坏数据）` : '',
        ].filter(Boolean).join('\n')
      },
    }
  },
}

export const commands = [checkCmd, watchCmd, reportCmd]
