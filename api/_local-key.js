/**
 * 本机自动登录用的密钥端点 —— **只在请求确实来自本机回环时**返回管理密钥。
 *
 * ## 它解决什么
 *
 * 本机开发时每次进 `/admin` 都要手输一遍 `SITES_ADMIN_KEY`，很烦。但把密钥写进前端
 * 产物是绝对不行的：产物是公开可下载的，写进去等于公开发布永久管理密钥。
 *
 * 所以密钥**留在服务端**，只在「确认是本机访问」时才吐出来 —— 前端拿到后自动登录，
 * 密钥始终没有离开这台机器。
 *
 * ## 为什么必须双重校验
 *
 * 只查 `req.socket.remoteAddress` 是不够的：反向代理（包括 BotKeep 这类托管平台）
 * 转发过来的请求，源地址可能是内网甚至回环，于是线上也会被判成「本机」。
 * 因此**再加一道 Host 校验**：
 *
 *   ① 连接来源是回环（127.0.0.1 / ::1 / ::ffff:127.0.0.1）
 *   ② **且** 请求的 Host 也是回环（127.0.0.1 / localhost / [::1]）
 *
 * 线上域名的 Host 是 `navigator-v2.bot-keep.xyz`，第 ② 条必然不成立 → 一律 404。
 * 两道条件都不满足时**返回 404（不是 403）**：不暴露「这里有个密钥端点」。
 *
 * ## 边界
 *
 * - 只读，不支持任何写操作；
 * - 未配置 `SITES_ADMIN_KEY` 时返回 204（无内容），不报错；
 * - 响应带 `Cache-Control: no-store`，避免被任何中间层缓存。
 */

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/** 取 Host 头里的主机名（剥端口；IPv6 字面量带方括号，与 URL.hostname 的输出形式一致） */
function hostNameOf(req) {
  const raw = String((req.headers && req.headers.host) || '').trim().toLowerCase()
  if (!raw) return ''
  if (raw.startsWith('[')) return raw.slice(0, raw.indexOf(']') + 1)
  return raw.split(':')[0]
}

/** 连接来源地址（Node 对 IPv4-mapped IPv6 会给 ::ffff:127.0.0.1 这种形态） */
function remoteOf(req) {
  const raw = String((req.socket && req.socket.remoteAddress) || '').trim().toLowerCase()
  return raw.replace(/^::ffff:/, '')
}

/**
 * 是否确实来自本机。**两个条件都要满足**（见文件头说明）。
 * 导出是为了让单测能直接断言这道闸门 —— 它是这个端点存在的唯一理由。
 */
export function isLocalRequest(req) {
  const remote = remoteOf(req)
  const host = hostNameOf(req)
  const remoteOk = remote === '127.0.0.1' || remote === '::1'
  const hostOk = LOOPBACK.has(host)
  return remoteOk && hostOk
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')

  if (req.method !== 'GET') {
    res.statusCode = 405
    return res.json({ ok: false, error: 'Method not allowed' })
  }

  // 判成非本机时返回 404 而不是 403：403 等于告诉对方「这里有个东西但不给你」
  if (!isLocalRequest(req)) {
    res.statusCode = 404
    return res.json({ ok: false, error: 'Not found' })
  }

  const key = String(process.env.SITES_ADMIN_KEY || '').trim()
  if (!key) {
    res.statusCode = 204
    return res.end()
  }

  return res.json({
    ok: true,
    key,
    // 前端据此在界面上如实标注「已通过本机密钥自动登录」，而不是假装是一次正常登录
    via: 'local-key',
  })
}
