/**
 * 告警站外出口（G3 / L1-3）：把巡检判定里「达到告警阈值」的站点转成可推送的事件。
 *
 * ## 为什么要单独一层
 *
 * 告警判据在 `shared/alert-rules.mjs`（连续 N 次不可达，按 host / 分类分级）。
 * 站内「通知中心」与站外 webhook 必须用**同一条判据**——若各写一遍，就会出现
 * 「站内说没事、webhook 却在报」这种自相矛盾（`alert-rules.mjs` 文件头已记录过
 * 同类病灶：告警阈值与自动归档阈值分家）。所以这里只做
 * **判据 → 通知事件 → 请求载荷** 的转换，网络发送与凭据留在调用方（`server/cron.mjs`）。
 *
 * ## 为什么是纯函数
 *
 * 发送要联网、要读环境变量，没法在门禁里跑；但「哪些站该告警 / 载荷长什么样 /
 * 多个渠道怎么解析」全是纯计算。抽出来就能用真实数据测，不必真发一条消息。
 *
 * 零依赖（只引同层的两个纯模块），Node 与浏览器都能直接用。
 */
import { evaluateAlerts } from '../alert-rules.mjs'
import { hostOf } from '../host.mjs'
import { buildNotification, webhookPayload, notificationText } from './notify-core.mjs'

/**
 * 聚合键：取站点 host。
 *
 * 用 host 而不是完整 URL —— 同站多入口（github.com/trending 与 github.com/copilot）
 * 是两条独立收录，但「这台主机挂了」是同一件事，不该给用户发两条告警。
 */
function targetOf(site) {
  return hostOf(site && site.url) || String((site && site.id) || '')
}

/**
 * 本轮该告警的事件。
 *
 * @param {{ results?: object, sites?: object[], config?: object, ts?: string }} args
 * @returns {object[]} 通知事件（notify-core 的结构）
 */
export function alertNotifications({ results, sites = [], config, ts } = {}) {
  const alerts = evaluateAlerts({ results, sites, config })
  const byId = new Map((sites || []).map(s => [s.id, s]))
  return alerts.map(a => {
    const site = byId.get(a.id) || { id: a.id, url: a.url || '', name: a.name || a.id }
    return buildNotification({
      kind: 'health.down',
      title: `${site.name || a.id} 无法访问`,
      body: `连续 ${a.fails} 次不可达（阈值 ${a.threshold}）`,
      target: targetOf(site),
      meta: { id: a.id, fails: a.fails, threshold: a.threshold, ruleId: a.ruleId },
      ts,
    })
  })
}

/**
 * webhook 请求体。
 *
 * `json`（默认）是扁平通用结构，对接自建服务 / 通用机器人；
 * `text` 是 `🔴 标题\n正文` 一行文本，飞书 / 钉钉这类「文本机器人」直接收。
 * 两者都由 `notify-core` 的既有实现产出，这里不做第二套序列化。
 */
export function webhookBody(notification, format = 'json') {
  return String(format).toLowerCase() === 'text'
    ? notificationText(notification)
    : JSON.stringify(webhookPayload(notification))
}

/**
 * 解析 `NAV_ALERT_WEBHOOK_URL`：**逗号分隔即多渠道**。
 *
 * 去空白、去重、丢弃非 http(s) 项 —— 配置由人填，一个错字不该让整轮推送哑掉：
 * 丢掉那一条、其余照发，并在结果里体现（调用方据此能看出「配了但没生效」）。
 */
export function parseWebhookUrls(raw) {
  const seen = new Set()
  const out = []
  for (const piece of String(raw || '').split(',')) {
    const u = piece.trim()
    if (!/^https?:\/\//i.test(u) || seen.has(u)) continue
    seen.add(u)
    out.push(u)
  }
  return out
}
