/**
 * 后台仪表盘的聚合请求与卡片取值。
 *
 * ## 为什么是几次并行请求而不是一个聚合接口
 *
 * 三份数据分属三个端点（运维面 / 插件清单 / 快照），而它们各自的读者就在自己那侧。
 * 为了「一次请求」去跨层拼一个聚合接口，代价是把数据面和运维面又搅在一起
 * （`api/ops.js` 头部专门解释过为什么要分开）。几次并行 GET 换来分层清楚，值。
 *
 * ## 取值原则：拿不到就留空
 *
 * 每张卡片的数字都只反映**手头真有的事实**。接口失败时留空，绝不回落到
 * 「0」或猜一个好看的值 —— 后台里的假数字比空白危险得多。
 *
 * ## 为什么从 AdminView.vue 里抽出来
 *
 * 这段约 120 行，只依赖 adminKey 与几个 store；抽出来之后 AdminView 只剩
 * 「布局 + Tab 切换 + 登录闸门」，读起来才是一条主线。
 *
 * @param {object} deps
 * @param {import('vue').Ref<string>} deps.adminKey
 * @param {object} deps.sitesStore
 * @param {object} deps.categoriesStore
 * @param {import('vue').Ref<number>} deps.unreadBadge 通知角标（拿不到 dashboard 时的兜底）
 * @param {import('vue').Ref<string>} deps.version 线上构建短 SHA
 */
import { ref, computed } from 'vue'
import { opsApi } from '@/services/opsApi'
import { pluginApi } from '@/services/pluginApi'
import { alertApi } from '@/services/alertApi'
import { aiApi } from '@/services/aiApi'
import { TABS, DASH_DESC } from '@/utils/adminNav'

export function useAdminDashboard({ adminKey, sitesStore, categoriesStore, unreadBadge, version }) {
  const dashOps = ref(null)
  const dashPlugins = ref(null)
  const dashSnapshots = ref(null)
  const dashBackup = ref(null)
  const dashAlerts = ref(null)
  const dashAi = ref(null)

  /**
   * 并行拉取六份摘要。任一失败只让对应卡片留空，不影响其余。
   * 用 `.catch(() => null)` 而不是 `Promise.allSettled`：这里只需要「有值 / 没值」，
   * 不需要区分「失败原因」—— 区分了也没人会在仪表盘上读错误信息。
   */
  async function loadDash() {
    const key = adminKey.value.trim()
    if (!key) return
    const [ops, plug, snaps, bak, alerts, ai] = await Promise.all([
      opsApi.dashboardSummary(key).catch(() => null),
      pluginApi.light(key).catch(() => null),
      opsApi.snapshots(key).catch(() => null),
      opsApi.backupMeta(key).catch(() => null),
      alertApi.load(key).catch(() => null),
      aiApi.probe().catch(() => null),
    ])
    dashOps.value = ops && ops.ok ? ops : null
    dashPlugins.value = plug && plug.ok ? plug : null
    dashSnapshots.value = snaps && snaps.ok !== false && Number.isFinite(snaps.count) ? snaps : null
    dashBackup.value = bak && bak.ok ? bak : null
    dashAlerts.value = alerts && alerts.ok ? alerts : null
    dashAi.value = ai && ai.ok !== false ? ai : null
  }

  /**
   * 卡片数据：id / 标题 / 说明 / 数值与单位 / 紧凑串。
   *
   * `short` 是给动作栏右缘那个窄位置用的（只放数字或短串），长单位留给面板自己显示 ——
   * 栏只有 224px 宽，把「约 120 KB」塞进去会把动作名挤掉。
   */
  const dashCards = computed(() =>
    TABS.filter((t) => t.id !== 'overview').map((t) => {
      const c = { id: t.id, label: t.label, desc: DASH_DESC[t.id] || '', value: '', unit: '', short: '' }
      const ops = dashOps.value
      const pl = dashPlugins.value
      const sn = dashSnapshots.value

      if (t.id === 'sites') {
        c.value = sitesStore.sites.length
        c.unit = '条'
      } else if (t.id === 'categories') {
        c.value = categoriesStore.categories.length
        c.unit = '个'
      } else if (t.id === 'deploy') {
        c.value = version.value || ''
      } else if (t.id === 'plugins') {
        if (pl) {
          c.value = pl.groups.length
          c.unit = '个引擎'
        }
      } else if (t.id === 'publish') {
        if (sitesStore.cloudVersion) {
          c.value = 'v' + sitesStore.cloudVersion
          c.unit = '云端'
        }
      } else if (t.id === 'snapshots') {
        if (sn) {
          c.value = sn.count
          c.unit = '个可回滚'
        }
      } else if (t.id === 'history') {
        if (ops) {
          c.value = ops.history.total
          c.unit = ops.history.successRate == null ? '次' : `次 · 成功率 ${ops.history.successRate}%`
        }
      } else if (t.id === 'audit') {
        if (ops) {
          c.value = ops.audit.total
          c.unit = ops.audit.failures ? `条 · 异常 ${ops.audit.failures}` : '条'
        }
      } else if (t.id === 'notify') {
        // 0 也要显示（「0 未读」是信息，「什么都不显示」不是）
        if (ops) {
          c.value = ops.notify.unread
          c.unit = '未读'
        } else if (unreadBadge.value) {
          c.value = unreadBadge.value
          c.unit = '未读'
        }
      } else if (t.id === 'backup') {
        /*
         * 备份没有「最近一次」的时间戳（服务端不记备份历史），所以给的是
         * 「一次备份会带走什么」—— 条目数 + 真实序列化体积，都是现算的。
         */
        if (dashBackup.value) {
          const m = dashBackup.value
          c.value = m.counts.sites
          c.unit = `站点可导出 · 约 ${Math.max(1, Math.round(m.bytes / 1024))} KB`
        }
      } else if (t.id === 'preferences') {
        if (dashAlerts.value) {
          const rules = dashAlerts.value.config?.rules || []
          c.value = rules.length
          c.unit = rules.length ? '条告警规则' : '条告警规则 · 用全局阈值'
        }
      } else if (t.id === 'ai') {
        // AI 的「状态」就是「能不能用 + 用的是哪个后端」，比任何数字都有用
        if (dashAi.value) {
          c.value = dashAi.value.ready ? dashAi.value.model || '已配置' : '未配置'
          c.unit = dashAi.value.ready ? '就绪' : '需要配置后端'
        }
      }

      c.short = c.value === '' ? '' : String(c.value)
      return c
    }),
  )

  /** 动作栏右缘的状态串：复用卡片取值，取紧凑写法 */
  function railMetaOf(tabId) {
    if (!tabId) return ''
    const c = dashCards.value.find((x) => x.id === tabId)
    return c && c.short ? String(c.short) : ''
  }

  return { dashCards, railMetaOf, loadDash }
}
