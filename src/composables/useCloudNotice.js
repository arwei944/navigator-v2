/**
 * 云端状态条文案：把 store 里的机器可读短码翻译成人话。
 *
 * ## 为什么在 UI 层而不是 store 里
 *
 * store 只负责产出**短码**（`offline` / `timeout` / `http-404` …），文案与措辞的取舍是
 * 产品决定，放 UI 层才能单独改措辞、也便于将来做多语言。store 里写中文会让
 * 「状态机」和「文案」绑死。
 *
 * ## 每条文案都在回答「现在该做什么」
 *
 * 状态条的价值不是复述错误码，而是替用户决定下一步：
 *   - `offline` → 等联网自己恢复（不用操作）
 *   - `http-404` / `invalid-payload` → 这个部署没接后端，**别去重启路由器**
 *   - `http-402` → 部署被平台停了，重试不会好，去面板看用量
 *
 * 最后这条来自真实事故：Vercel Hobby 额度打满后全站 402，用户看到「云端不可用」
 * 只会不停点重试。说清楚「去哪儿处理」比说清楚「错在哪」更有用。
 */
import { computed } from 'vue'
import { useSitesStore } from '@/stores/sites'

export function useCloudNotice() {
  const sitesStore = useSitesStore()

  const cloudNotice = computed(() => {
    const e = sitesStore.cloudError
    if (!e) return null

    if (e === 'offline') {
      return { tone: 'warn', retry: true, text: '已离线，当前展示的是本机数据，联网后会自动更新' }
    }
    if (e === 'timeout') {
      return { tone: 'warn', retry: true, text: '读取云端数据超时，当前展示的是本机数据' }
    }

    /*
     * 「这个部署没有后端接口」的两种表现，文案一致。
     *   404：纯静态托管下 `/api/sites` 根本不存在；
     *   非 JSON：SPA 兜底页 / 登录页 / 代理拦截页。
     * 它们跟「离线」是两件事 —— 用户网络好得很，是这个部署环境没接后端。
     * 说成「已离线」会让人去重启路由器，找错方向。
     */
    if (e === 'http-404' || e === 'invalid-payload') {
      return { tone: 'warn', retry: true, text: '本站未接入云端同步，展示的是本机数据（本地增删改照常可用）' }
    }

    /*
     * 402 单独说清楚：它不是「网络抖了一下」，而是部署被平台停了
     * （Vercel Hobby 额度打满后会暂停整个部署，全站返回 402 DEPLOYMENT_DISABLED）。
     * 这种状态重试不会好，所以要直接告诉用户去哪儿处理。
     */
    if (e === 'http-402') {
      return {
        tone: 'bad',
        retry: true,
        text: '云端部署已被平台暂停（402 · 多为用量超限），展示的是本机数据；请到部署平台面板查看用量',
      }
    }

    if (String(e).startsWith('http-')) {
      return { tone: 'bad', retry: true, text: `云端数据读取失败（${e.slice(5)}），当前展示的是本机数据` }
    }
    return { tone: 'warn', retry: true, text: '云端数据暂时不可用，当前展示的是本机数据' }
  })

  return { cloudNotice }
}
