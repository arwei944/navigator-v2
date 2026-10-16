/**
 * 本站自身可用性：判定一次探测属于哪种故障，并把事件序列折叠成掉线区间。
 *
 * 与 `shared/health-probe.mjs` **不是一回事**：那个探的是我们收录的 300 个站点，
 * 这个探的是**我们自己部署的站点**（navigator-v2 在平台上是否可访问）。
 *
 * 为什么要把「平台挂了」和「我们挂了」分开：两者的处置完全不同 ——
 * 平台边缘故障只能等它自愈（重启容器治不了），我们的应用故障才需要动代码或重启。
 * 过去只能靠人工看响应体认出来，现在让判定成为可测的纯函数。
 */

// 平台边缘故障的指纹：所有路径（含 /api/health）都会返回这句平台文案。
// 我们的应用**永远不会**返回它 —— 我们的错误响应都是自己的 JSON。
export const EDGE_SIGNATURE = 'Botkeep web access is temporarily unavailable'

export const KIND = {
  OK: 'ok',
  EDGE: 'edge-down',
  APP: 'app-down',
  NET: 'network',
}

export const KIND_LABEL = {
  [KIND.OK]: '正常',
  [KIND.EDGE]: '平台边缘故障',
  [KIND.APP]: '应用故障',
  [KIND.NET]: '连不上（网络/DNS/超时）',
}

/**
 * 判定一次探测。
 * @param {{ status?: number, body?: string, error?: string }} r
 * @returns {'ok'|'edge-down'|'app-down'|'network'}
 */
export function classifyProbe(r = {}) {
  const status = Number(r.status) || 0
  const body = String(r.body || '')
  if (!status) return KIND.NET                       // 请求根本没到：DNS / 拒绝 / 超时
  if (status >= 200 && status < 400) return KIND.OK  // 3xx 也算可达（重定向不影响可用性）
  if (body.includes(EDGE_SIGNATURE)) return KIND.EDGE
  return KIND.APP
}

/** 把事件序列折叠成掉线区间。事件形如 { at, kind }，需按时间升序。 */
export function foldOutages(events, now = null) {
  const list = Array.isArray(events) ? events : []
  const out = []
  let cur = null
  for (const e of list) {
    if (e.kind !== KIND.OK) {
      if (!cur) cur = { startAt: e.at, endAt: null, samples: 1, kinds: { [e.kind]: 1 } }
      else {
        cur.samples++
        cur.kinds[e.kind] = (cur.kinds[e.kind] || 0) + 1
      }
    } else if (cur) {
      cur.endAt = e.at
      out.push(cur)
      cur = null
    }
  }
  if (cur) out.push(cur)
  return out.map(o => {
    const last = list.length ? list[list.length - 1].at : o.startAt
    const end = o.endAt != null ? o.endAt : (now != null ? now : last)
    return {
      ...o,
      ongoing: o.endAt == null,
      // 主要故障类型：掉线期间出现最多的那一种
      kind: Object.entries(o.kinds).sort((a, b) => b[1] - a[1])[0][0],
      durationMs: Math.max(0, end - o.startAt),
    }
  })
}

/** 汇总：可用率、掉线时长、掉线区间。窗口 = [since, now]，样本不足时按首末样本算。 */
export function summarize(events, { now = Date.now(), since = 0 } = {}) {
  const ev = (Array.isArray(events) ? events : [])
    .filter(e => e && Number.isFinite(e.at) && e.at >= since && e.at <= now)
    .sort((a, b) => a.at - b.at)
  const outages = foldOutages(ev, now)
  const first = ev.length ? ev[0].at : now
  const spanFrom = Math.max(since, first)
  const spanMs = Math.max(0, now - spanFrom)
  const downMs = outages.reduce((s, o) => s + o.durationMs, 0)
  const okCount = ev.filter(e => e.kind === KIND.OK).length
  return {
    samples: ev.length,
    okCount,
    failCount: ev.length - okCount,
    spanMs,
    downMs: Math.min(downMs, spanMs),
    upMs: Math.max(0, spanMs - Math.min(downMs, spanMs)),
    // 没有样本时不给"100% 可用"这种假结论，返回 null 让调用方如实显示
    availability: spanMs > 0 && ev.length ? Math.max(0, 1 - Math.min(downMs, spanMs) / spanMs) : null,
    outages,
  }
}

/** 人读时长：6s / 5m12s / 1h 6m */
export function fmtDuration(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}
