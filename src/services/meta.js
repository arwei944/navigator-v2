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

/** 默认超时：抓外站要留够时间，但不能久到用户以为卡死 */
export const META_TIMEOUT_MS = 12000

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

/** 把失败结果拼成界面文案（统一「抓取失败：…（可手动填写）」的句式） */
export function metaFailureText(result) {
  return `抓取失败：${result?.message || '未知原因'}（可手动填写）`
}
