/**
 * 控制台路由 · 密钥域：各平台凭据的查看 / 写入 / 验证。
 *
 * 路由：
 *   GET  /api/secrets             → 分组状态（只有掩码，无完整值）
 *   POST /api/secrets/save        → 写入 .env.local（形态不符直接拒绝）
 *   POST /api/secrets/verify      → 主动问平台「这把还有效吗」（只读探测）
 *
 * 安全约束（与 audit 的口径一致）：
 *   · 本模块**从不**把完整值写进响应，只回掩码与形态结论；
 *   · 审计只记「改了哪一项」，不记值；
 *   · 控制台只监听 127.0.0.1，且入口已做 `isTrusted` 来源校验。
 */
import * as secrets from '../core/secrets.mjs'
import * as audit from '../core/audit.mjs'
import { sendJson } from './api-http.mjs'
import { readJsonBody } from './api-http.mjs'

export async function handleSecretsGet(req, res, path) {
  if (path === '/api/secrets') {
    sendJson(res, 200, secrets.status())
    return true
  }
  return false
}

export async function handleSecretsPost(req, res, path) {
  if (path === '/api/secrets/save') {
    const body = await readJsonBody(req)
    const entries = body.entries || {}
    const r = secrets.save(entries, { force: Boolean(body.force) })
    if (!r.ok) {
      // 拒绝理由要能直接指导用户改，而不是只说「失败」
      audit.record({
        action: 'secrets.save',
        result: 'fail',
        target: Object.keys(entries).join('+') || '(空)',
        detail: r.rejected.map(x => `${x.key}: ${x.reason}`).join(' | ').slice(0, 200),
      })
      sendJson(res, 400, { error: '部分密钥未写入', rejected: r.rejected })
      return true
    }
    audit.record({
      action: 'secrets.save',
      target: r.applied.map(x => x.key).join('+') || '(无变化)',
      detail: r.applied.map(x => (x.cleared ? `${x.key}=清空` : x.key)).join('+'),
    })
    sendJson(res, 200, { ok: true, ...r, status: secrets.status() })
    return true
  }

  if (path === '/api/secrets/verify') {
    const body = await readJsonBody(req)
    const keys = Array.isArray(body.keys) ? body.keys : (body.key ? [body.key] : [])
    const results = await secrets.verifyAll(keys)
    audit.record({
      action: 'secrets.verify',
      target: results.map(r => r.key).join('+') || '(全部)',
      detail: results.map(r => `${r.key}:${r.ok ? 'ok' : 'fail'}`).join('+'),
    })
    sendJson(res, 200, { ok: true, results })
    return true
  }

  return false
}
