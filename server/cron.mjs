/**
 * 服务端常驻巡检（v10 第三批）。
 *
 * ## 为什么不能复用 shared/health-probe.mjs
 *
 * 那个引擎是**本机（Windows）专用**的：它靠 `curl.exe` 出网，因为本机 Node fetch 不走
 * 系统代理（Clash）。部署沙箱是 Linux，压根没有 curl.exe —— 直接复用会 300 个站点全 ERR。
 * 所以这里改走**纯 Node 的 fetchCapped**：零外部依赖，且它自带两层 SSRF 防护
 * （字面主机名拦截 + pinned lookup 防 DNS rebinding）。这层防护是公网可触达探测端点的底线，
 * 绝不能为了省事自己拼 http.request。
 *
 * ## 口径
 *
 *  - 与 `api/health.js` 的 POST 共用 `buildHealthPayload` / `toIncoming`：
 *    合并而非覆盖、按当前站点集剔除、version 递增、计数 —— 同一实现，不会漂移。
 *  - 6h 一轮；启动后延迟一轮，且**上一份判定不到 6h 就跳过**（刚被控制台/CLI 探过不必再来）。
 *  - 跳过归档站；并发 8、单站超时 8s、单轮上限 400 站。
 *  - 任何异常都吞掉并记日志：这是常驻进程里的可选任务，不能因为它把站点服务带崩。
 */
import { get, put } from './store.mjs'
import { fetchCapped } from './shared/http-fetch.mjs'
import { buildHealthPayload, toIncoming } from './shared/health-rules.mjs'

const PATHNAME = 'ops/health.json'
const SITES_PATHNAME = 'sites.json'
const INTERVAL_MS = 6 * 60 * 60 * 1000
const BOOT_DELAY_MS = 45 * 1000
const CONCURRENCY = 8
const TIMEOUT_MS = 8000
const MAX_SITES = 400
const UA = 'Mozilla/5.0 (compatible; NavigatorHealthBot/1.0; +https://navigator.local)'

async function readJson(pathname) {
  const blob = await get(pathname, { access: 'private' })
  if (!blob || !blob.stream) return null
  return JSON.parse(await new Response(blob.stream).text())
}

/** 当前站点集（运行时权威表，不是部署包里的种子） */
async function readSites() {
  try {
    const data = await readJson(SITES_PATHNAME)
    if (!data || !Array.isArray(data.sites)) return null
    const sites = data.sites.filter(s => s && s.id && typeof s.url === 'string' && /^https?:\/\//i.test(s.url) && !s.archived)
    return { sites, knownIds: new Set(data.sites.map(s => s.id)) }
  } catch {
    return null
  }
}

/** 单站探测：只取状态码与耗时，body 封顶 2KB（判定用不上正文） */
async function probeOne(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const t0 = Date.now()
  try {
    const r = await fetchCapped(url, { signal: controller.signal, headers: { 'user-agent': UA }, maxBytes: 2048 })
    return { code: String(r.status || 0), ms: Date.now() - t0 }
  } catch (e) {
    // BLOCKED_HOST = 命中 SSRF 防护（站址指向内网），按失效记录，不重试
    return { code: e && e.code === 'BLOCKED_HOST' ? 'BLOCKED' : 'ERR', ms: Date.now() - t0 }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 启动巡检。返回 `{ runNow, stop }` 便于测试与手动触发。
 * 关闭开关：环境变量 `NAV_CRON=0`（本地 console 调试时不想它跑）。
 */
export function startHealthCron() {
  if (process.env.NAV_CRON === '0') {
    console.log('[cron] 健康巡检已由 NAV_CRON=0 关闭')
    return { runNow: async () => null, stop() {} }
  }

  let running = false

  async function run(reason) {
    if (running) return null
    running = true
    try {
      const prev = await readJson(PATHNAME).catch(() => null)
      // 6h 内已有判定就不重探：发布后首启、控制台刚手动探过，都属这种情况
      const age = prev && prev.updatedAt ? Date.now() - Date.parse(prev.updatedAt) : Infinity
      if (Number.isFinite(age) && age < INTERVAL_MS) {
        console.log(`[cron] 健康巡检跳过（${reason}）：上次判定 ${Math.round(age / 60000)} 分钟前`)
        return null
      }

      const snapshot = await readSites()
      if (!snapshot || !snapshot.sites.length) return null
      const sites = snapshot.sites.slice(0, MAX_SITES)

      const rows = []
      for (let i = 0; i < sites.length; i += CONCURRENCY) {
        const chunk = sites.slice(i, i + CONCURRENCY)
        const out = await Promise.all(chunk.map(async s => ({ id: s.id, ...(await probeOne(s.url)) })))
        rows.push(...out)
      }

      const payload = buildHealthPayload({
        prev,
        incoming: toIncoming(rows),
        knownIds: snapshot.knownIds,
        actor: 'cron',
      })
      await put(PATHNAME, JSON.stringify(payload), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
      })
      console.log(`[cron] 健康巡检完成（${reason}）：${rows.length} 站 → ${JSON.stringify(payload.counts)}`)
      return payload
    } catch (e) {
      console.error('[cron] 健康巡检失败：', String((e && e.message) || e))
      return null
    } finally {
      running = false
    }
  }

  const boot = setTimeout(() => {
    void run('启动首轮')
    setInterval(() => { void run('每 6 小时') }, INTERVAL_MS)
  }, BOOT_DELAY_MS)

  return {
    runNow: () => run('手动触发'),
    stop() { clearTimeout(boot) },
  }
}