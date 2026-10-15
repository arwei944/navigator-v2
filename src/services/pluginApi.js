/**
 * 插件管理的前端封装。
 *
 * 走与 `/api/ops` 同一套凭据（sessionStorage 里的会话 token，见 opsApi.js 的说明）——
 * 插件配置能改「站点怎么抓、怎么翻、AI 走哪个后端」，属于管理动作，不对匿名开放。
 */
import { getAdminKey } from './opsApi'

const BASE = '/api/plugins'

async function call(method, body, key) {
  const k = key || getAdminKey()
  if (!k) return { ok: false, error: '未登录' }
  const res = await fetch(BASE, {
    method,
    headers: {
      // 双头并发：Authorization 给本机直连，X-Nav-Key 穿透发布沙箱的网关
      Authorization: `Bearer ${k}`,
      'X-Nav-Key': k,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) window.dispatchEvent(new CustomEvent('nav-auth-expired'))
  if (!res.ok) return { ok: false, error: data.error || `请求失败（${res.status}）`, rejected: data.rejected || [] }
  return { ok: true, ...data }
}

export const pluginApi = {
  /** 拉取全部插件组（含真实可用性探测） */
  list: (key) => call('GET', null, key),

  /**
   * 保存配置覆盖。只传变化的项：
   *   · 值为具体 id 列表 → 写入
   *   · 值为空串 → 清除该项（回到默认）
   */
  save: (key, overrides) => call('POST', { overrides }, key),
}
