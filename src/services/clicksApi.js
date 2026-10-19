/**
 * 点击统计的后台写操作（目前只有「清空」）。
 *
 * 读路径不走这里 —— 前端读 `/api/clicks` 是**匿名公开**的（卡片角标 / 排行 / 洞察都依赖它），
 * 放进 store 里顺带做。这里只放需要鉴权的管理动作。
 */

import { getAdminKey } from './opsApi'

const BASE = '/api/clicks'

/**
 * 清空全网点击统计。
 *
 * 鉴权走**已登录的管理员会话**：登录后 `getAdminKey()` 拿到会话 token，
 * `checkAuthHeader` 先验签 token、再回落共享密钥 —— 所以后台不需要用户
 * 额外配置共享密钥，这也是这个按钮存在的意义：
 * 共享密钥在线上是被平台托管的 secret（只写不读），本地拿不到，够不着。
 *
 * 双头并发：`X-Nav-Key` 穿透发布沙箱对 Authorization 的改写（与 opsApi 同因）。
 */
export async function resetClicks() {
  const key = getAdminKey()
  const res = await fetch(BASE, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}`, 'X-Nav-Key': key } : {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // 401 单独给一句能action的话：用户需要先去登录
    if (res.status === 401) throw new Error('需要先登录后台才能清空')
    throw new Error(data.error || `HTTP ${res.status}`)
  }
  return data
}
