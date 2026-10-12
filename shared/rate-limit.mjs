/**
 * 「新增站点」这类**访客可见**接口的滥用防护。
 *
 * ## 为什么不能加登录鉴权
 *
 * 「添加站点」任何访客都能用（加的是他自己浏览器里的数据）。加鉴权等于把这个功能
 * 对普通访客关掉。真正能加的是两道与功能无关的门：
 *
 *   1. **跨站调用拦下**：`Sec-Fetch-Site: cross-site` 表示请求来自别的站点。
 *      浏览器设置这个头、页面脚本改不了，于是「第三方网页把我们的接口当成开放抓取
 *      代理」这条路被堵死，而自家页面（same-origin）完全不受影响。
 *   2. **每实例每分钟的次数上限**：拦截单个实例上的高频刷取。
 *
 * ## 诚实说明它的边界
 *
 * serverless 是多实例的，Map 只活在一个热实例里，因此第 2 条是 **best-effort**，
 * 不是分布式限流；要做分布式就得每次请求都写一次共享存储，代价远大于收益。
 *
 * 抽成独立模块是因为 `/api/metadata` 与 `/api/translate` **都要用** ——
 * 复制一份的下场是将来只修一处（这类「两份实现漂移」在本项目已经出过事故）。
 */

/**
 * 每实例每分钟的请求上限。
 *
 * 20 次/分钟对真人够用（手动添加站点不可能更快），对刷取足够紧。
 * 注意翻译接口的单次请求会**内部**发起 2 次出网（name + desc），所以它这里按 1 次计。
 */
export const RL_WINDOW_MS = 60_000
export const RL_MAX_PER_WINDOW = 20

const rlHits = new Map()

/** 取客户端 IP：优先反代给的头，退化到 socket 地址 */
export function clientIp(req) {
  const headers = (req && req.headers) || {}
  const fwd = headers['x-forwarded-for'] || headers['x-real-ip'] || ''
  const first = String(fwd).split(',')[0].trim()
  return first || (req && req.socket && req.socket.remoteAddress) || 'unknown'
}

/** 该请求是否来自别的站点（浏览器会带这个头，页面脚本改不了） */
export function isCrossSite(req) {
  return String((req?.headers && req.headers['sec-fetch-site']) || '').toLowerCase() === 'cross-site'
}

/**
 * 记一次命中，返回是否**已经超限**。
 * @returns {boolean} true 表示该拒绝这次请求
 */
export function rateLimited(ip, { max = RL_MAX_PER_WINDOW, windowMs = RL_WINDOW_MS } = {}) {
  const now = Date.now()
  const hits = (rlHits.get(ip) || []).filter(t => now - t < windowMs)
  if (hits.length >= max) {
    rlHits.set(ip, hits)
    return true
  }
  hits.push(now)
  rlHits.set(ip, hits)
  // 顺手清理：只在本实例记录的人多起来时才做一次全扫，避免每次请求都 O(n)
  if (rlHits.size > 2000) {
    for (const [k, v] of rlHits) {
      if (!v.some(t => now - t < windowMs)) rlHits.delete(k)
    }
  }
  return false
}

/**
 * 统一的前置门：跨站调用 → 403；超限 → 429。
 * @returns {boolean} true 表示已拒绝（调用方直接 return）
 */
export function rejectAbusive(req, res) {
  if (isCrossSite(req)) {
    res.status(403).json({ error: '该接口仅限站内调用' })
    return true
  }
  if (rateLimited(clientIp(req))) {
    res.setHeader('Retry-After', '60')
    res.status(429).json({ error: '请求过于频繁，请稍后再试' })
    return true
  }
  return false
}

/** 仅供测试：重置计数 */
export function __resetRateLimitForTest() {
  rlHits.clear()
}
