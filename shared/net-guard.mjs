/**
 * 网络目标校验：字面主机名规则 + IP 段规则。
 *
 * 放在 shared/ 是因为有两类调用方：
 *   - `shared/http-fetch.mjs` 在**连接层**的解析回调里用它（真正的防线）；
 *   - `api/metadata.js` 用它做第一道零成本的字面拦截，并对外 re-export `isBlockedHost`
 *     （`tools/console/test-guard.mjs` 依赖这个导出）。
 *
 * 为什么校验要分两层：字面检查挡的是「直接把内网地址写进 URL」（零成本，先挡掉一批），
 * 而 IP 检查挡的是「域名解析到内网」——后者只有拿到真实解析结果才能判，所以必须在
 * 解析发生的那个时刻做（见 http-fetch.mjs 的 pinned lookup），否则 DNS rebinding 可绕。
 */

/* ---------------- IPv4 ---------------- */

const PRIVATE_V4_RE = [
  /^0\./, /^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^192\.0\.0\./,
  /^192\.0\.2\./, /^198\.18\./, /^198\.51\.100\./, /^203\.0\.113\./,
]

export function isPrivateV4(ip) {
  const s = String(ip || '').trim()
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(s)) return false
  if (PRIVATE_V4_RE.some(re => re.test(s))) return true
  const [a, b] = s.split('.').map(Number)
  if (a === 172 && b >= 16 && b <= 31) return true   // 172.16.0.0/12
  if (a === 100 && b >= 64 && b <= 127) return true  // 100.64.0.0/10 运营商级 NAT
  if (a >= 224) return true                          // 组播与保留段
  return false
}

/* ---------------- IPv6 ---------------- */

/**
 * IPv6 的字面前缀判定。
 *
 * 注意**不能用「前缀字符串」硬编**：同一个地址有多种合法写法（`fe80::1` 与 `fe80:0:0:0:0:0:0:1`、
 * 大小写、前导零），逐字节比较才可靠。这里把地址展开成 8 组 16 位再判段。
 */
export function isPrivateV6(ip) {
  const s = String(ip || '').trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]
  if (!s.includes(':')) return false

  // IPv4 映射 / 兼容写法：::ffff:a.b.c.d 与 ::a.b.c.d
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (tail) {
    const v4 = tail[1]
    if (/^::ffff:/.test(s) || /^::(\d+\.\d+\.\d+\.\d+)$/.test(s)) return isPrivateV4(v4)
  }

  const expanded = expandV6(s)
  if (!expanded) return true // 解析不出来就当它可疑，宁可拒绝
  const [g0, g1] = expanded

  if (expanded.every(g => g === 0)) return true                        // ::  未指定
  if (expanded.slice(0, 7).every(g => g === 0) && expanded[7] === 1) return true // ::1 回环
  if ((g0 & 0xfe00) === 0xfc00) return true                            // fc00::/7 唯一本地
  if ((g0 & 0xffc0) === 0xfe80) return true                            // fe80::/10 链路本地
  if ((g0 & 0xff00) === 0xff00) return true                            // ff00::/8 组播
  if (g0 === 0x2001 && g1 === 0x0db8) return true                      // 2001:db8::/32 文档示例
  return false
}

/** 把 IPv6 展开成 8 个 16 位数；无法解析返回 null */
function expandV6(s) {
  const parseGroups = str => {
    if (!str) return []
    const parts = str.split(':')
    const nums = []
    for (const p of parts) {
      if (!/^[0-9a-f]{1,4}$/.test(p)) return null
      nums.push(parseInt(p, 16))
    }
    return nums
  }
  const [headStr, tailStr, ...rest] = s.split('::')
  if (rest.length) return null
  if (tailStr === undefined) {
    const g = parseGroups(headStr)
    return g && g.length === 8 ? g : null
  }
  const head = parseGroups(headStr)
  const tail = parseGroups(tailStr)
  if (!head || !tail) return null
  const fill = 8 - head.length - tail.length
  if (fill < 1) return null
  return [...head, ...Array(fill).fill(0), ...tail]
}

/* ---------------- 主机名 ---------------- */

/** 任意字面 / 解析后的 IP 是否属于「不该让公网抓取服务访问」的网段 */
export function isBlockedIp(ip) {
  const s = String(ip || '').trim()
  if (!s) return true
  if (s.includes(':')) return isPrivateV6(s)
  return isPrivateV4(s)
}

/**
 * 字面主机名检查（不做 DNS）。这是第一道门：挡掉直接写死的内网地址与保留域名。
 * 域名交给 URL 解析后已归一化 —— 十进制 / 十六进制写的 IP（如 http://2130706433/）
 * 会被 WHATWG URL 还原成点分十进制，因此下面的 `\d+\.\d+\.\d+\.\d+` 分支能接住。
 */
export function isBlockedHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (!h) return true
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.home.arpa')) return true
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return isPrivateV4(h)
  if (h.includes(':')) return isBlockedIp(h)
  return false
}

/* ---------------- 连接层校验 ---------------- */

/**
 * 生成一个「解析即校验」的 lookup，交给 `http(s).request` 使用。
 *
 * 这是本模块存在的**唯一理由**：预检（先 lookup 再 fetch）挡不住 DNS rebinding ——
 * 预检拿到公网 IP，而 fetch 真正连接时会**再解析一次**，攻击者只要让第二次解析返回
 * 内网地址就绕过了。把校验放进 lookup，就意味着「用于校验的 IP」与「用于连接的 IP」
 * 必然是同一个，窗口归零。
 *
 * 语义：解析出的**每一个**地址都必须合法，任一命中内网段即整条拒掉（不做「挑一个合法的用」，
 * 那会让攻击者用一条 A 记录就能把请求引到另一个地址）。
 */
export function createPinnedLookup(lookupImpl) {
  return function pinnedLookup(hostname, options, callback) {
    const cb = typeof options === 'function' ? options : callback
    const opts = typeof options === 'function' ? {} : (options || {})
    lookupImpl(hostname, { ...opts, all: true, verbatim: true }, (err, addresses) => {
      if (err) return cb(err)
      const list = (Array.isArray(addresses) ? addresses : [addresses]).filter(Boolean)
      if (!list.length) {
        const e = new Error('域名未解析出任何地址')
        e.code = 'ENOTFOUND'
        return cb(e)
      }
      const bad = list.find(a => isBlockedIp(a.address))
      if (bad) {
        const e = new Error('该地址指向内网或本机')
        e.code = 'BLOCKED_HOST'
        return cb(e)
      }
      if (opts.all) return cb(null, list)
      return cb(null, list[0].address, list[0].family)
    })
  }
}
