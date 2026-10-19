/**
 * 控制台 HTTP 辅助：JSON 响应、请求体解析、来源可信判定。
 *
 * 从 `api.mjs` 抽出，原因是这三件事与「有哪些路由」无关 ——
 * 任何新增的域路由文件都要用它们，放在路由文件里会导致每个域文件重复实现，
 * 或者互相 import 形成环。
 */

export function sendJson(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

/** 批量结果里 `next` 是整份站点数组（300+ 条），只对落盘有意义，不回传给前端 */
export function stripNext({ next, ...rest }) {
  return rest
}

export async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (chunks.length === 0) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf-8')) } catch { return {} }
}

/** 回环主机名白名单（IPv6 字面量带方括号，与 URL.hostname 的输出形式一致） */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/** 取 Host 头的主机名部分：剥离端口，兼容 [::1]:5175 这类 IPv6 字面量 */
function hostNameOf(req) {
  const raw = String(req.headers.host || '').trim().toLowerCase()
  if (!raw) return ''
  const v6 = raw.match(/^\[([^\]]+)\](?::\d+)?$/)
  return v6 ? v6[1] : raw.replace(/:\d+$/, '')
}

function isLoopbackOrigin(origin) {
  try { return LOOPBACK.has(new URL(origin).hostname) } catch { return false }
}

/**
 * 来源可信判定 —— 控制台所有请求（含静态资源与读接口）的统一入口校验。
 *
 * ① Host 必须是回环地址：DNS rebinding 攻击中浏览器发出的 Host 仍是攻击者域名，
 *    仅监听 127.0.0.1 挡不住，这一条才是核心防线。
 * ② Origin 存在时其主机名也必须是回环地址：阻断跨站页面直接调用。
 * ③ 非 GET 的写操作额外要求自定义头 X-Nav-Console：跨站携带该头会触发预检，
 *    而本服务不返回 CORS 许可。GET 通道（如 EventSource）无法携带请求头，由 ①② 兜底。
 *
 * 本机 curl / 脚本调试天然满足 ①②（Host=127.0.0.1、无 Origin）；
 * 调写接口需自行附加 -H "X-Nav-Console: 1"。
 */
export function isTrusted(req) {
  if (!LOOPBACK.has(hostNameOf(req))) return false
  const origin = req.headers.origin
  if (origin && !isLoopbackOrigin(origin)) return false
  if (req.method !== 'GET' && req.headers['x-nav-console'] !== '1') return false
  return true
}
