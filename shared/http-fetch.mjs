/**
 * 最小 HTTP(S) GET 客户端：把「校验用的 IP」与「连接用的 IP」锁成同一个。
 *
 * 为什么不能直接用全局 `fetch`：它不接受自定义 `lookup`，而 Node 也没有导出内置的
 * undici `Agent`（`node:undici` 不存在），所以拿不到挂自定义解析器的入口。
 * 而**自定义解析器正是防 DNS rebinding 的唯一手段** —— 预检（先解析一次、再发起请求）
 * 之间存在 TOCTOU 窗口，攻击者让第二次解析返回内网地址即可绕过。
 *
 * 因此这里基于 `node:http`/`node:https` 自己实现 GET，成本是必须自己处理
 * 压缩与字节上限，收益是 `lookup` 归我们掌控。
 *
 * 只做 GET，**不跟重定向**（`redirect: manual` 的等价语义）：调用方逐跳跟随并逐跳校验。
 */
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { lookup as dnsLookup } from 'node:dns'
import { createGunzip, createBrotliDecompress, createInflate, createUnzip } from 'node:zlib'
import { createPinnedLookup, isBlockedHost } from './net-guard.mjs'

export const DEFAULT_MAX_BYTES = 256 * 1024

/**
 * @param {string} href 目标地址
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @param {Record<string,string>} [opts.headers]
 * @param {number} [opts.maxBytes] 响应体读取上限，超出按截断返回
 * @param {Function} [opts.lookup] **仅供测试注入**：默认是 IP 校验版 lookup。
 *   传了它就等于显式声明「这是测试路径」—— 字面主机名检查也会一并跳过，
 *   否则测试没法连本机服务器。生产路径永远不该传它。
 * @returns {Promise<{status:number, headers:Record<string,string>, body:Buffer, truncated:boolean}>}
 */
export async function fetchCapped(href, { signal, headers = {}, maxBytes = DEFAULT_MAX_BYTES, lookup } = {}) {
  const u = new URL(href)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    const e = new Error(`不支持的协议：${u.protocol}`)
    e.code = 'BAD_PROTOCOL'
    throw e
  }
  const isHttps = u.protocol === 'https:'

  /**
   * 字面主机名检查（第一层）。
   *
   * 为什么这一层必须放在这里、而不是只留给调用方：对**字面 IP**（`http://10.0.0.1/`），
   * Node 的 `net.connect` 根本不会走 lookup —— 它认得那是 IP，直接连。于是 pinned lookup
   * 那层防线对字面 IP 完全不起作用（实测：`http://127.0.0.1/` 会真去连、报 ECONNREFUSED，
   * 而不是 BLOCKED_HOST）。所以本模块必须自己挡一次，否则安全性就取决于「调用方有没有
   * 记得先调 isBlockedHost」——那是一条会随新调用方加入而失效的保证。
   */
  if (!lookup && isBlockedHost(u.hostname)) {
    const e = new Error('该主机名指向内网或本机')
    e.code = 'BLOCKED_HOST'
    throw e
  }

  const opts = {
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port || (isHttps ? 443 : 80),
    path: u.pathname + u.search,
    method: 'GET',
    // 主动要 identity：自己解压要额外处理 raw deflate 等边角情况，而这里的响应体
    // 本就有 256KB 上限、请求频率也很低，不值得为此引入解压分支。
    // 但仍保留下面的解压兜底 —— 有服务器会无视这个头照发 gzip。
    headers: { 'accept-encoding': 'identity', ...headers },
    // 第二层：域名解析即校验。对「域名解析到内网」这是唯一的正解（字面规则看不见解析结果）。
    lookup: lookup || createPinnedLookup(dnsLookup),
    signal,
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const done = (fn, v) => { if (!settled) { settled = true; fn(v) } }
    const fail = e => done(reject, e)

    const req = (isHttps ? httpsRequest : httpRequest)(opts, res => {
      let stream = res
      const enc = String(res.headers['content-encoding'] || '').toLowerCase().trim()
      if (enc) {
        if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(createGunzip())
        else if (enc === 'br') stream = res.pipe(createBrotliDecompress())
        else if (enc === 'deflate') stream = res.pipe(createInflate())
        // 服务器无视 identity 时也照解码；未知编码则不处理，按原字节返回
        else if (enc !== 'identity') stream = res.pipe(createUnzip())
      }

      const chunks = []
      let total = 0
      let truncated = false
      stream.on('data', chunk => {
        if (truncated) return
        total += chunk.length
        if (total > maxBytes) {
          truncated = true
          // 超限即断开：不必把剩下的几百 KB 也读进内存
          stream.destroy()
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      stream.on('error', err => fail(err))
      stream.on('close', () => done(resolve, {
        status: res.statusCode || 0,
        headers: res.headers,
        body: Buffer.concat(chunks).subarray(0, maxBytes),
        truncated,
      }))
      // 3xx：正文没有用处，直接断开，避免为一次重定向白读一个页面
      if ((res.statusCode || 0) >= 300 && (res.statusCode || 0) < 400) {
        res.destroy()
        done(resolve, { status: res.statusCode || 0, headers: res.headers, body: Buffer.alloc(0), truncated: false })
      }
    })

    req.on('error', err => fail(err))
    req.end()
  })
}
