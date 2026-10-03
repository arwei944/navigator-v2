/**
 * 后台操作审计埋点。
 *
 * 三条约束（与本地控制台 tools/console/lib/audit.mjs 同源）：
 *  ① 旁路：写失败静默，绝不阻断发布 / 编辑这些主流程；
 *  ② 无密钥不发：密钥不存在时直接跳过，避免打出必然 401 的请求；
 *  ③ 只记已发生的事实 —— 预演、预检这类只读动作按只读结果记录，不记「将要发生」。
 */
import { getAdminKey, opsApi } from '@/services/opsApi'

// 当前操作者：登录后由 AdminView 写入用户名，登出时清空。
// 审计的「可追溯」价值全在这里 —— 共用密钥直连时只能记 'admin'。
let currentActor = ''

export function setAuditActor(actor) {
  currentActor = String(actor || '').trim()
}

export function getAuditActor() {
  return currentActor || 'admin'
}

export function recordAudit(action, { target = '', result = 'ok', detail = '', actor } = {}) {
  const key = getAdminKey()
  if (!key) return
  opsApi.appendAudit(key, { action, target, result, detail, actor: actor || getAuditActor() }).catch(() => {})
}