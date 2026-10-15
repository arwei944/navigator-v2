/**
 * 告警规则的前端封装。
 *
 * 走与 `/api/ops` / `/api/plugins` 同一套凭据（会话 token 或管理密钥）——
 * 规则表会暴露「你在意哪些站、盯得多紧」，属管理动作，不对匿名开放。
 */
import { getAdminKey } from './opsApi'

const BASE = '/api/alert-rules'

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
  if (!res.ok) return { ok: false, error: data.error || `请求失败（${res.status}）` }
  return { ok: true, ...data }
}

export const alertApi = {
  /** 读当前规则（归一后的 config） */
  load: (key) => call('GET', null, key),
  /** 整体替换规则表 */
  save: (key, config) => call('POST', config, key),
}
