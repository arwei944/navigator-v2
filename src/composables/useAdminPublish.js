/**
 * 后台「云端发布」流程：预检 → 推数据 → 回填基底 → 清覆盖层 → 记历史 / 通知 / webhook。
 *
 * ## 顺序为什么不能反
 *
 * 发布的就是「云端基底 + 本地覆盖层」拼出的当前列表，覆盖层内容已进云端：
 *   1. 先用响应回填基底 —— 避免清层后短暂回退到旧数据；
 *   2. 再清掉覆盖层 —— 否则本地改动会长期遮蔽后续云端变更。
 * 分类同理：响应带着云端新表，已进云端的本地新增记录撤掉；
 * 被云端表挡下的记录保留，等域回来再生效。
 *
 * 这段顺序此前散在 `publishToCloud` 一个 40 行的函数里，注释比代码长；
 * 抽出来后「发布成功之后到底改了哪些状态」变成一处可读的清单。
 *
 * @param {object} deps
 * @param {import('vue').Ref<string>} deps.adminKey
 * @param {import('vue').Ref<string>} deps.webhookUrl
 * @param {object} deps.sitesStore
 * @param {object} deps.categoriesStore
 * @param {() => void} [deps.onPublished] 发布成功后的回调（组件用来刷新角标）
 */
import { ref, computed } from 'vue'
import { opsApi } from '@/services/opsApi'
import { recordAudit } from '@/services/auditLog'

export function useAdminPublish({ adminKey, webhookUrl, sitesStore, categoriesStore, onPublished }) {
  const publishState = ref('idle') // idle | loading | success | error
  const publishMsg = ref('')

  /* 预检结果由面板 emit 上来（AdminPublishPreflight 自己负责跑检查） */
  const preflight = ref(null)
  const preflightOk = computed(() => Boolean(preflight.value?.ok))
  const preflightBlockers = computed(() => (preflight.value?.blockers || []).map((b) => b.message).join('；'))

  function onPreflight(result) {
    preflight.value = result
  }

  /** webhook 通知失败不影响发布结果，静默忽略 */
  async function notifyWebhook(version, count) {
    try {
      await fetch(webhookUrl.value.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'publish', version, count, time: new Date().toISOString() }),
      })
    } catch {
      /* 见上 */
    }
  }

  /** 发布成功后落一条历史 + 一条通知（运维面失败不影响发布结果） */
  function recordPublish(data) {
    const key = adminKey.value.trim()
    const count = data.sites?.length || sitesStore.sites.length
    opsApi
      .appendHistory(key, {
        runner: 'cloud',
        trigger: 'admin',
        ok: true,
        duration: null,
        steps: [
          {
            key: 'hotupdate',
            label: 'Blob 热更新',
            status: 'success',
            detail: `v${data.version} · ${count} 站点`,
          },
        ],
        cloud: { version: data.version, count, previousVersion: data.previousVersion || 0 },
        snapshot: data.snapshot?.pathname ? { pathname: data.snapshot.pathname, ok: data.snapshot.ok !== false } : null,
        counts: { sites: count },
        note: '线上后台热更新',
      })
      .catch(() => {})
    opsApi
      .pushNotification(key, {
        kind: 'publish.done',
        title: `发布完成 · v${data.version}`,
        body: `${count} 站点已热更新到云端`,
        meta: { version: data.version, count },
      })
      .catch(() => {})
  }

  async function publishToCloud() {
    if (!adminKey.value.trim()) {
      publishState.value = 'error'
      publishMsg.value = '凭据已失效，请重新登录'
      return
    }
    if (!preflightOk.value) {
      publishState.value = 'error'
      publishMsg.value = '预检未通过：' + preflightBlockers.value
      return
    }
    publishState.value = 'loading'
    publishMsg.value = ''
    try {
      /*
       * 分类表只在本地草稿偏离云端时才推送：否则每次发布都会把云端表覆盖成本地副本，
       * 一旦本地没成功拉到云端表（离线 / 首屏兜底），就会静默把云端分类退回默认表。
       */
      const cats = categoriesStore.dirty ? categoriesStore.toCloudGroups() : undefined
      const data = await opsApi.publish(adminKey.value.trim(), sitesStore.sites, cats)
      publishState.value = 'success'
      publishMsg.value = `发布成功！云端版本 v${data.version}，其他设备将在 30 秒内自动更新。`

      // 顺序见文件头注释：先回填基底，再清覆盖层
      sitesStore.applyCloudData(data)
      sitesStore.clearLocalOverlay()
      categoriesStore.clearLocalAdds()

      recordAudit('publish.done', {
        target: `v${data.version}`,
        detail: `${data.sites?.length || sitesStore.sites.length} 站点热更新到云端${cats ? '（含分类表）' : ''}`,
      })
      recordPublish(data)
      if (webhookUrl.value.trim()) {
        notifyWebhook(data.version, data.sites?.length || sitesStore.sites.length)
      }
      onPublished?.()
    } catch (e) {
      publishState.value = 'error'
      publishMsg.value = '发布失败：' + e.message
      recordAudit('publish.fail', { target: '', result: 'fail', detail: e.message })
    }
  }

  /**
   * 回滚成功：先丢弃未发布的本地分类新建（与站点覆盖层同口径），
   * 再把响应回填为云端基底后清覆盖层 —— 顺序反了，自动建的分类会被重新叠进旧表。
   */
  function onRolled(data) {
    categoriesStore.clearLocalAdds()
    sitesStore.applyCloudData(data)
    sitesStore.clearLocalOverlay()
    recordAudit('rollback.apply', {
      target: data.restoredFrom || '',
      detail: `回滚到 v${data.version} · ${data.sites?.length || 0} 站点`,
    })
  }

  /** 退出登录时调用：清掉上一次会话留下的发布态 */
  function resetPublishState() {
    publishState.value = 'idle'
    publishMsg.value = ''
    preflight.value = null
  }

  return {
    publishState,
    publishMsg,
    preflight,
    preflightOk,
    preflightBlockers,
    onPreflight,
    publishToCloud,
    onRolled,
    resetPublishState,
  }
}
