/**
 * 站点元信息抓取 **引擎注册表（热拔插）**。
 *
 * 两个引擎，输出形状完全一致（都是 nav 的 inferSite 形状），可互换：
 *
 *   native    —— nav-v2 自带：调用方自己的抓取（控制台走 curl、线上走 fetchCapped） + inferSite。
 *                 始终可用、零外部依赖。是默认引擎与**最终回退**。
 *
 *   siteprobe —— 外部 HTTP 服务（C:\work\test\siteprobe，`siteprobe serve`，默认 127.0.0.1:8799）。
 *                 一次拿到更全的维度（DNS / TLS 证书链 / robots / sitemap / 安全头 / CDN / 图标主色），
 *                 且**支持本地代理** —— 这一点对控制台很关键：native 的 fetchCapped（node:http）
 *                 不接受代理，在「外网必须走 7897」的本机环境里只能靠 curl 代劳，siteprobe 则自带 CONNECT 隧道。
 *
 * 选择优先级：函数参数 → 环境变量 NAV_SITE_ENGINE → 'auto'。
 *   auto：探活 siteprobe /health，在线则用它、离线**自动回退 native**（探活结果缓存 30s）。
 *
 * 「热拔插」的确切含义：切换不需要改代码、也不需要重启进程 ——
 *   · 改 API 参数 / NAV_SITE_ENGINE 即可指定；
 *   · auto 模式下，直接起停 siteprobe 服务就会在 30s 内自动生效；
 *   · 任何一步失败（探活失败 / 服务报错 / 返回不完整）都静默回退 native，绝不降低可用性。
 */

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8799'
const HEALTH_TTL_MS = 30_000
const ENGINE_IDS = ['native', 'siteprobe']

let healthCache = { at: 0, ok: false, endpoint: '' }

/** siteprobe 服务地址（可用 SITEPROBE_ENDPOINT 覆盖） */
export function siteprobeEndpoint() {
  return String(process.env.SITEPROBE_ENDPOINT || DEFAULT_ENDPOINT).replace(/\/+$/, '')
}

/** 解析引擎 id（纯配置，不探活）：'native' | 'siteprobe' | 'auto' */
export function resolveEngineId(explicit) {
  const raw = String(explicit || process.env.NAV_SITE_ENGINE || 'auto').trim().toLowerCase()
  return ENGINE_IDS.includes(raw) ? raw : 'auto'
}

/** siteprobe 服务探活（30s 缓存，避免每次抓取都打一次健康检查） */
export async function siteprobeAlive({ endpoint = siteprobeEndpoint(), timeoutMs = 800, force = false } = {}) {
  const now = Date.now()
  if (!force && healthCache.endpoint === endpoint && now - healthCache.at < HEALTH_TTL_MS) return healthCache.ok
  let ok = false
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(`${endpoint}/health`, { signal: ctrl.signal })
    clearTimeout(timer)
    if (res.ok) {
      const j = await res.json()
      ok = Boolean(j && j.ok)
    }
  } catch { ok = false }
  healthCache = { at: now, ok, endpoint }
  return ok
}

/** 最终决定用哪个引擎（auto 会探活）。返回 'native' | 'siteprobe' */
export async function resolveEngine(explicit) {
  const id = resolveEngineId(explicit)
  if (id !== 'auto') return id
  return (await siteprobeAlive()) ? 'siteprobe' : 'native'
}

/**
 * 经 siteprobe 抓取并转成 nav 形状；任何失败返回 null（调用方据此回退 native）。
 * 返回值就是 nav 的 inferSite 形状（categoryId 已映射到本仓 30 分类白名单）。
 */
export async function probeViaSiteprobe(url, { endpoint = siteprobeEndpoint(), timeoutMs = 20_000 } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${endpoint}/probe?url=${encodeURIComponent(url)}&nav=1`, { signal: ctrl.signal })
    if (!res.ok) return null
    const j = await res.json()
    return (j && j.nav) || null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 引擎清单（供控制台展示与切换） */
export async function listEngines({ check = true } = {}) {
  const alive = check ? await siteprobeAlive({ force: true }) : false
  return [
    { id: 'native', label: '内置引擎', available: true, reason: '始终可用（回退项）' },
    {
      id: 'siteprobe',
      label: 'siteprobe',
      available: alive,
      endpoint: siteprobeEndpoint(),
      reason: alive ? '服务在线' : '服务未启动（先跑 `siteprobe serve`）',
    },
  ]
}
