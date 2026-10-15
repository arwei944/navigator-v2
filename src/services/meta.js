/**
 * 站点元信息抓取（`/api/metadata`）的**唯一入口**。
 *
 * ## 为什么不能让调用方各自 `await res.json()`
 *
 * 这条链路的响应体有三种「不是 JSON」的情况，而且都不会带着我们的 `error` 字段回来：
 *
 *   1. **平台把部署停了** —— Vercel 在 Hobby 配额打满后会暂停整个部署，全站（含静态资源）
 *      返回 `402 Payment Required` + `Content-Type: text/plain`，正文是
 *      `Payment required / DEPLOYMENT_DISABLED / <request-id>`；
 *   2. 网关或平台替换出来的 5xx HTML 错误页（502 / 504 常见）；
 *   3. 代理、登录页或 SPA 兜底把请求接走，回一页 HTML（本地 `vite preview` 就是这种）。
 *
 * 直接 `res.json()` 遇到这些只会抛
 * `Unexpected token 'P', "Payment re"... is not valid JSON` —— 这句话既解释不了发生了什么，
 * 也指不出该找谁，用户唯一能做的就是放弃。所以这里统一：**先读文本、再尽力解析**，
 * 非 2xx 与服务端 `error` 文案优先，最后兜一句能照着做的人话。
 *
 * 返回结构固定为 `{ ok: true, data }` 或 `{ ok: false, status, reason, message }`，
 * `reason` ∈ `'http' | 'non-json' | 'timeout' | 'network'`（机器可读），`message` 给人看。
 */
import { peekCachedMeta, rememberMeta } from '../utils/metaCache.js'

/** 默认超时：抓外站要留够时间，但不能久到用户以为卡死 */
export const META_TIMEOUT_MS = 12000

/**
 * ## 为什么这里要读写共享缓存
 *
 * 同一条网址在一次操作里会被问**两到三遍**：搜索框预览一次、秒加的后台补全一次；
 * 走弹窗那条路则是预览 + 弹窗各一次。问的是同一个接口、同一份数据，而抓一个慢站
 * 要 1~10 秒 —— 用户刚在卡片上看到「Gitlab / 描述是……」，回车后弹窗又转圈重问一遍，
 * 预览刚建立起来的确定性当场作废。
 *
 * 缓存本身放在 `utils/metaCache.js`：它是纯数据模块，首屏的预览需要**同步** peek
 * （命中即出卡、不闪抓取中），不能为这一点把本文件静态拖回首屏（见 `test-bundle.mjs` 第 7 节）。
 * 本文件只负责读与写。
 */

/** 平台暂停部署时的正文特征（用于把 message 说得更具体） */
const PLATFORM_PAUSED_HINT = /DEPLOYMENT_DISABLED|Payment required/i

/**
 * 非 2xx 且响应体不是 JSON 时的兜底文案。
 * 402 单独说清楚：它不是「我们写错了」，而是部署被平台停了，用户需要去面板处理。
 */
export function httpFailureText(status, body = '') {
  if (status === 402 || PLATFORM_PAUSED_HINT.test(body)) {
    return '云端部署已被平台暂停（HTTP 402），请到部署平台查看用量'
  }
  if (status === 401 || status === 403) return `抓取服务拒绝访问（HTTP ${status}）`
  if (status === 404) return '抓取服务不存在（HTTP 404），可能是部署已下线'
  if (status === 429) return '抓取过于频繁，请稍后再试'
  if (status >= 500) return `抓取服务暂时不可用（HTTP ${status}）`
  return `抓取服务返回异常（HTTP ${status}）`
}

/**
 * 抓取目标站点的元信息。
 *
 * @param {string} url 已归一化的网址
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} [opts]
 *        `signal` 供调用方取消（例如弹窗被关掉）；超时由内部 AbortController 负责。
 */
export async function fetchSiteMeta(url, { timeoutMs = META_TIMEOUT_MS, signal } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  if (signal) {
    if (signal.aborted) ctrl.abort()
    else signal.addEventListener('abort', () => ctrl.abort(), { once: true })
  }

  try {
    const res = await fetch('/api/metadata?url=' + encodeURIComponent(url), { signal: ctrl.signal })
    // 先拿文本：非 JSON 的响应体也要能看一眼，才能说出到底发生了什么
    const body = await res.text().catch(() => '')
    let data = null
    try { data = body ? JSON.parse(body) : null } catch { data = null }

    if (!res.ok) {
      return {
        ok: false, status: res.status, reason: 'http',
        // 服务端自己的文案优先（内网地址被拒、URL 非法、限流……都带 error 字段）
        message: (data && typeof data.error === 'string' && data.error) || httpFailureText(res.status, body),
      }
    }
    if (!data || typeof data !== 'object') {
      return {
        ok: false, status: res.status, reason: 'non-json',
        message: `抓取服务返回了非 JSON 内容（HTTP ${res.status}，可能是代理或部署异常）`,
      }
    }
    return { ok: true, status: res.status, data }
  } catch (e) {
    const aborted = e && e.name === 'AbortError'
    return {
      ok: false, status: 0, reason: aborted ? 'timeout' : 'network',
      message: aborted
        ? `抓取超时（超过 ${Math.round(timeoutMs / 1000)} 秒未响应）`
        : '网络不可达，请检查连接后重试',
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 带会话缓存的抓取 —— **所有非「用户主动要求重抓」的调用方都该走这个**。
 *
 * 与 `fetchSiteMeta` 的区别只有一条：同域名在本次会话里抓过就直接回放，
 * 不再联网。返回结构多一个 `cached` 标志供调用方区分（目前无人依赖它做分支，
 * 留着是为了排查「这次到底联网没有」）。
 *
 * @param {{ skipCache?: boolean }} [opts] 用户点了「重新补全」这类**主动重抓**时传 true
 */
export async function fetchSiteMetaShared(url, { timeoutMs = META_TIMEOUT_MS, signal, skipCache = false } = {}) {
  if (!skipCache) {
    const hit = peekCachedMeta(url)
    if (hit) return { ok: true, status: 200, data: hit, cached: true }
  }
  const res = await fetchSiteMeta(url, { timeoutMs, signal })
  if (res.ok) rememberMeta(url, res.data)
  return { ...res, cached: false }
}

/** 把失败结果拼成界面文案（统一「抓取失败：…（可手动填写）」的句式） */
export function metaFailureText(result) {
  return `抓取失败：${result?.message || '未知原因'}（可手动填写）`
}
