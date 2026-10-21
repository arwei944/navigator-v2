/**
 * 阶段 3：自动周报（规则版）。
 *
 * 与每日简报的区别：
 *   - 日报回答「今天发生了什么」；
 *   - 周报回答「这一周什么在持续、什么在扩散、下周该盯什么」。
 *
 * 周报不编造数据：所有数字都来自传入的统计与事件；缺数据时明确写「暂无」。
 * 配置 LLM 后可以在规则稿基础上润色，但结构与数字仍以规则稿为准。
 */

function pad(n) { return String(n).padStart(2, '0') }

function localDate(ts) {
  const d = new Date(Number(ts))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function localShort(ts) {
  const d = new Date(Number(ts))
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function reportPeriod({ now = Date.now(), days = 7 } = {}) {
  const end = Number(now)
  const start = end - Math.max(1, Number(days) || 7) * 86400000
  return {
    start,
    end,
    startDate: localDate(start),
    endDate: localDate(end),
    label: `${localShort(start)} ~ ${localShort(end)}`,
    days: Math.max(1, Number(days) || 7),
  }
}

function pctDelta(current, previous) {
  const c = Number(current) || 0
  const p = Number(previous) || 0
  if (!p) return c ? '新增' : '持平'
  const diff = Math.round(((c - p) / p) * 100)
  return `${diff >= 0 ? '+' : ''}${diff}%`
}

function levelLabel(level) {
  return level === 'high' ? '高' : level === 'medium' ? '中' : '低'
}

function domainLabel(domain) {
  const map = {
    'ai-work': 'AI / 工作',
    research: '研究',
    onchain: '链上',
    infra: '工具 / 基础设施',
  }
  return map[domain] || domain || '未分类'
}

function truncate(text, max = 180) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/**
 * 生成周报 Markdown。
 *
 * @param {{
 *   now?:number, days?:number,
 *   events?:Array, trends?:Array, entities?:Array, domainHeat?:Array,
 *   stats?:object, alerts?:Array, prev?:object, cross?:Array,
 * }} input
 */
export function weeklyReport({
  now = Date.now(), days = 7,
  events = [], trends = [], entities = [], domainHeat = [],
  stats = {}, alerts = [], prev = {}, cross = [],
} = {}) {
  const period = reportPeriod({ now, days })
  const high = events.filter(e => e.impact?.level === 'high')
  const medium = events.filter(e => e.impact?.level === 'medium')
  const unreadAlerts = alerts.filter(a => !a.read)
  const failing = Number(stats.failing) || 0
  const hidden = Number(stats.hidden) || 0

  const lines = []
  lines.push(`# 领域情报周报 · ${period.label}`)
  lines.push('')
  lines.push(`> 自动汇总（规则版）。覆盖 ${Number(stats.sources) || 0} 个启用源、`
    + `${Number(stats.total) || 0} 条留存条目；所有结论均可回链到原始报道。`)
  lines.push('')

  lines.push('## 一、本周概览')
  lines.push('')
  lines.push(`- 新增条目 **${Number(prev.added) || 0}** 条（上周 ${Number(prev.prevAdded) || 0} 条，${pctDelta(prev.added, prev.prevAdded)}）`)
  lines.push(`- 聚成事件 **${events.length}** 个：高影响 **${high.length}**、中影响 **${medium.length}**`)
  lines.push(`- 活跃实体 **${entities.length}** 个，突增实体 **${trends.length}** 个`)
  lines.push(`- 告警 **${alerts.length}** 条，其中未读 **${unreadAlerts.length}** 条`)
  if (failing) lines.push(`- 失败源 **${failing}** 个，需要检查抓取配置`)
  if (hidden) lines.push(`- 人工隐藏 **${hidden}** 条（已从时间线与聚类中排除）`)
  lines.push('')

  lines.push('## 二、高影响事件')
  lines.push('')
  if (!events.length) {
    lines.push('_本周没有形成多源事件。可能是新源刚接入，或事件聚类阈值偏高。_')
  } else {
    for (const [i, event] of events.slice(0, 8).entries()) {
      const impact = event.impact || {}
      lines.push(`### ${i + 1}. ${event.title}`)
      lines.push('')
      lines.push(`- 影响 **${impact.score ?? 0}/100（${levelLabel(impact.level)}）**`
        + ` · ${Number(event.sourceCount) || 0} 个来源 · ${Number(event.entryCount) || 0} 条报道`
        + ` · ${domainLabel(event.domain)}`)
      if (event.entities?.length) {
        lines.push(`- 相关实体：${event.entities.map(e => e.name).join('、')}`)
      }
      if (event.summary) lines.push(`- 摘要：${truncate(event.summary, 220)}`)
      if (event.actions?.length) lines.push(`- 建议：${event.actions[0]}`)
      lines.push('')
    }
  }

  lines.push('## 三、突增实体')
  lines.push('')
  if (!trends.length) {
    lines.push('_暂无达到阈值的突增实体。_')
  } else {
    lines.push('| 实体 | 类型 | 当前 24h | 基线期望 | z | 来源 |')
    lines.push('| --- | --- | ---: | ---: | ---: | ---: |')
    for (const t of trends.slice(0, 10)) {
      lines.push(`| ${t.name} | ${t.kind || '-'} | ${t.current} | ${t.expected} | ${t.z} | ${t.sources} |`)
    }
    lines.push('')
    lines.push('> z 值 = （当前窗口 − 基线期望）/ √(基线期望+1)；基线为过去 7 天。')
  }
  lines.push('')

  lines.push('## 四、领域热度')
  lines.push('')
  if (!domainHeat.length) {
    lines.push('_暂无数据。_')
  } else {
    lines.push('| 领域 | 24h 条目 | 占比 |')
    lines.push('| --- | ---: | ---: |')
    const total = domainHeat.reduce((n, d) => n + (Number(d.count) || 0), 0) || 1
    for (const d of domainHeat.slice(0, 8)) {
      const share = Math.round(((Number(d.count) || 0) / total) * 100)
      lines.push(`| ${domainLabel(d.domain)} | ${d.count} | ${share}% |`)
    }
  }
  lines.push('')

  lines.push('## 五、跨事件扩散')
  lines.push('')
  if (!cross.length) {
    lines.push('_没有实体同时出现在多个中/高影响事件中。_')
  } else {
    for (const item of cross.slice(0, 6)) {
      const titles = item.events.slice(0, 3).map(e => e.title).join('；')
      lines.push(`- **${item.name}** 出现在 ${item.events.length} 个事件：${truncate(titles, 160)}`)
    }
    lines.push('')
    lines.push('> 同一实体反复出现，通常意味着同一股力量在推动，值得单独建专题。')
  }
  lines.push('')

  lines.push('## 六、来源健康')
  lines.push('')
  if (!failing) {
    lines.push('- 所有启用源抓取正常。')
  } else {
    lines.push(`- 失败源 ${failing} 个；最近失败原因可在「内容源」面板查看，连续失败会自动退避。`)
  }
  if (alerts.length) {
    lines.push('')
    lines.push('最近告警：')
    for (const alert of alerts.slice(0, 5)) {
      lines.push(`- [${alert.severity || 'medium'}] ${alert.title}`)
    }
  }
  lines.push('')

  lines.push('## 七、下周建议')
  lines.push('')
  const suggestions = []
  if (high.length) suggestions.push(`优先跟进 ${high.length} 个高影响事件，补齐第二来源与官方口径。`)
  if (trends.length) suggestions.push(`把 ${trends.slice(0, 3).map(t => t.name).join('、')} 加入观察列表。`)
  if (cross.length) suggestions.push(`为 ${cross[0].name} 建立专题，串起相关事件。`)
  if (failing) suggestions.push('修复失败源，否则情报覆盖会出现盲区。')
  if (!suggestions.length) suggestions.push('本周信息密度较低，可考虑增加垂直领域源。')
  for (const s of suggestions) lines.push(`- ${s}`)
  lines.push('')

  return {
    type: 'weekly',
    period,
    markdown: lines.join('\n'),
    counts: {
      events: events.length,
      high: high.length,
      medium: medium.length,
      trends: trends.length,
      entities: entities.length,
      alerts: alerts.length,
      cross: cross.length,
    },
  }
}

export { localDate, localShort }