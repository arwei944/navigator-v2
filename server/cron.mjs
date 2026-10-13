/**
 * 服务端常驻巡检（v10 第三批）。
 *
 * ## 探测实现来自共享注册表
 *
 * 沙箱是 Linux，没有 `curl.exe`，所以这里**显式**选 `fetch-http` 探针：
 * 纯 Node fetch + `fetchCapped`，零外部依赖，且自带两层 SSRF 防护
 * （字面主机名拦截 + pinned lookup 防 DNS rebinding）—— 这层防护是公网可触达探测端点的底线，
 * 绝不能为了省事自己拼 http.request。
 *
 * 本机（控制台 / CLI）走的是同一个注册表，只是 `curl-http` 的 `available()` 在 Windows
 * 为 true 而优先命中。**两边共用「HEAD 不收就 GET 复核」的口径**，不再各写一遍。
 *
 * ## 口径
 *
 *  - 与 `api/health.js` 的 POST 共用 `buildHealthPayload` / `toIncoming`：
 *    合并而非覆盖、按当前站点集剔除、version 递增、计数 —— 同一实现，不会漂移。
 *  - 6h 一轮；启动后延迟一轮，且**上一份判定不到 6h 就跳过**（刚被控制台/CLI 探过不必再来）。
 *  - 跳过归档站；并发 8、单站超时 8s、单轮上限 400 站。
 *  - 任何异常都吞掉并记日志：这是常驻进程里的可选任务，不能因为它把站点服务带崩。
 */
/**
 * 依赖用**子路径 imports**（`#store` / `#shared/*`）而不是相对路径：
 * server/*.mjs 会被原样复制到部署根目录（server.js / cron.mjs），相对路径在部署包
 * 里能解析、在仓库里不能（`server/shared/` 不存在）—— 于是本地根本 import 不进来，
 * 巡检出问题时连单测都写不了。两处 package.json 各自把 `#shared/*` 映射到
 * 各自的 shared 目录，源码零分支。
 */
import { get, put } from '#store'
import { buildHealthPayload, toIncoming } from '#shared/health-rules.mjs'
import { probeChain, runProbe } from '#shared/probe-engine.mjs'

const PATHNAME = 'ops/health.json'
const SITES_PATHNAME = 'sites.json'
const INTERVAL_MS = 6 * 60 * 60 * 1000
const BOOT_DELAY_MS = 45 * 1000
const CONCURRENCY = 10
const TIMEOUT_MS = 6000
/** 每几批落一次库：300 站跑完可能要几分钟，增量落库让健康角标早早就动起来 */
const FLUSH_EVERY_CHUNKS = 5
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
    /**
     * 站点表里的 `url` **多数是裸域名**（`chat.openai.com`）—— 补协议再探。
     * （踩过的坑：一开始按 /^https?:\/\// 过滤，结果 300 条全被滤掉、巡检永远「站点表为空」。）
     */
    const sites = []
    for (const s of data.sites) {
      if (!s || !s.id || s.archived) continue
      const raw = typeof s.url === 'string' ? s.url.trim() : ''
      if (!raw) continue
      sites.push({ id: s.id, name: s.name, url: /^https?:\/\//i.test(raw) ? raw : `https://${raw}` })
    }
    return { sites, knownIds: new Set(data.sites.map(s => s.id)) }
  } catch {
    return null
  }
}

/**
 * 单站探测：只取状态码与耗时。
 *
 * 显式指定 `fetch-http` 而不是走默认链：沙箱要的是「不依赖外部二进制」的那一个 ——
 * 不该因为某天镜像里恰好装了 curl.exe 就悄悄换掉探测实现（那会让线上口径与本机对齐，
 * 而本机是走代理的，两者前提不同）。
 */
async function probeOne(url) {
  const r = await runProbe(url, { timeoutMs: TIMEOUT_MS, ua: UA, chain: probeChain('fetch-http') })
  return r ? { code: r.code, ms: r.ms } : { code: 'ERR', ms: 0 }
}

/**
 * 启动巡检。返回 `{ runNow, stop }` 便于测试与手动触发。
 * 关闭开关：环境变量 `NAV_CRON=0`（本地 console 调试时不想它跑）。
 */
/**
 * 运行状态 —— 只为**远程可观测**存在：进程内定时任务坏掉时没有任何 4xx/5xx、
 * 前端也没有症状（只是健康角标一直空），没有这块就只能靠猜。
 * `/api/_diag` 会把它读出来（main.mjs 与本模块是同一个模块实例）。
 */
export const status = {
  enabled: false,
  started: false,
  running: false,
  lastRunAt: 0,
  lastPhase: '未启动',
  lastError: '',
  lastCount: 0,
  lastActor: '',
}

export function startHealthCron() {
  if (process.env.NAV_CRON === '0') {
    status.enabled = false
    status.lastPhase = '已由 NAV_CRON=0 关闭'
    console.log('[cron] 健康巡检已由 NAV_CRON=0 关闭')
    return { runNow: async () => null, stop() {} }
  }

  status.enabled = true
  let running = false

  async function run(reason) {
    if (running) return null
    running = true
    status.running = true
    status.lastRunAt = Date.now()
    status.lastPhase = `开始（${reason}）`
    status.lastError = ''
    try {
      const prev = await readJson(PATHNAME).catch(() => null)
      // 6h 内已有判定就不重探：发布后首启、控制台刚手动探过，都属这种情况
      const age = prev && prev.updatedAt ? Date.now() - Date.parse(prev.updatedAt) : Infinity
      if (Number.isFinite(age) && age < INTERVAL_MS) {
        console.log(`[cron] 健康巡检跳过（${reason}）：上次判定 ${Math.round(age / 60000)} 分钟前`)
        return null
      }

      status.lastPhase = '读取站点表'
      const snapshot = await readSites()
      if (!snapshot || !snapshot.sites.length) {
        status.lastPhase = snapshot ? '站点表为空' : '读不到站点表'
        return null
      }
      const sites = snapshot.sites.slice(0, MAX_SITES)

      let base = prev
      let payload = null
      const rows = []
      const flush = async (phase) => {
        payload = buildHealthPayload({
          prev: base,
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
        base = payload
        console.log(`[cron] 健康巡检${phase}（${reason}）：已探 ${rows.length}/${sites.length} 站 → ${JSON.stringify(payload.counts)}`)
        return payload
      }

      status.lastPhase = `探测中（共 ${sites.length} 站）`
      let chunkNo = 0
      for (let i = 0; i < sites.length; i += CONCURRENCY) {
        const chunk = sites.slice(i, i + CONCURRENCY)
        const out = await Promise.all(chunk.map(async s => ({ id: s.id, ...(await probeOne(s.url)) })))
        rows.push(...out)
        chunkNo++
        if (chunkNo % FLUSH_EVERY_CHUNKS === 0) await flush('增量落库')
      }
      const final = await flush('完成')
      status.lastPhase = `完成（${rows.length} 站）`
      status.lastCount = rows.length
      return final
    } catch (e) {
      status.lastError = String((e && e.message) || e)
      status.lastPhase = `失败：${status.lastError}`
      console.error('[cron] 健康巡检失败：', String((e && e.message) || e))
      return null
    } finally {
      running = false
      status.running = false
    }
  }

  status.started = true
  status.lastPhase = `已启动，${Math.round(BOOT_DELAY_MS / 1000)}s 后跑首轮`
  const boot = setTimeout(() => {
    void run('启动首轮')
    setInterval(() => { void run('每 6 小时') }, INTERVAL_MS)
  }, BOOT_DELAY_MS)

  return {
    runNow: () => run('手动触发'),
    stop() { clearTimeout(boot) },
  }
}
/* ══════════════════════ 请求驱动的分片巡检 ══════════════════════
 *
 * 为什么需要它：发布沙箱**没有长驻进程** —— 实测每个请求都会起一个新进程
 * （`/api/_diag` 的 `uptimeSec` 恒为 0），所以 `setTimeout`/`setInterval`
 * 这类进程内定时器永远不会触发（startHealthCron 在那里是死代码）。
 * 于是服务端巡检改成「谁请求谁推进一小步」：
 *
 *   - 进度（游标）落在 `ops/health-sweep.json`，不依赖进程内存 —— 进程随时被回收也不丢。
 *   - 每次只探 budget 个站（默认 2），**在响应发完之后**才跑，不给请求加延迟。
 *   - 探到的判定用同一套 buildHealthPayload 合并进 ops/health.json（口径不分叉）。
 *   - 一轮跑完（或 6h 内已跑完一轮）就什么都不做。
 *
 * 主力路径仍然是控制台/CLI 的一次性体检（走本机 curl + Clash 代理，并发快、准）；
 * 这里只是「没人操作时也会慢慢收敛」的兜底。
 */

const SWEEP_PATHNAME = 'ops/health-sweep.json'
const DEFAULT_BUDGET = 4

export async function tickOnDemand({ budget = DEFAULT_BUDGET } = {}) {
  const prev = await readJson(PATHNAME).catch(() => null)
  let sweep = null
  try { sweep = await readJson(SWEEP_PATHNAME) } catch { /* 首轮无进度 */ }

  const snapshot = await readSites()
  if (!snapshot || !snapshot.sites.length) return null
  const sites = snapshot.sites
  const now = Date.now()

  /**
   * 顺序很重要（踩过的坑）：先看「本轮有没有跑完」，再看新鲜度。
   * 早先写成「只要刚写过判定就整体跳过」—— 于是第一次 tick 写下 2 条之后，
   * 后续每个请求都被自己的成果挡住，整轮永远停在 2/300。
   */
  const inRound = sweep && !sweep.done && Number(sweep.cursor) < sites.length
    && now - Number(sweep.roundStart || 0) <= INTERVAL_MS
  if (!inRound) {
    const age = prev && prev.updatedAt ? Date.now() - Date.parse(prev.updatedAt) : Infinity
    if (Number.isFinite(age) && age < INTERVAL_MS) return null // 本轮已跑完且判定还新鲜 → 什么都不做
    sweep = { cursor: 0, done: false, roundStart: now, startedAt: new Date(now).toISOString() }
    await put(SWEEP_PATHNAME, JSON.stringify(sweep), { allowOverwrite: true, contentType: 'application/json' })
  }

  const batch = sites.slice(Number(sweep.cursor), Number(sweep.cursor) + Math.max(1, budget))

  /**
   * **逐站落库**：进程随时可能被回收，探一站存一站才不会白干。
   * （探一站的代价一次探测、一次几 KB 的写，对 SQLite 完全可忽略。）
   */
  let base = prev
  let cursor = Number(sweep.cursor)
  for (const s of batch) {
    const row = { id: s.id, ...(await probeOne(s.url)) }
    base = buildHealthPayload({ prev: base, incoming: toIncoming([row]), knownIds: snapshot.knownIds, actor: 'cron' })
    await put(PATHNAME, JSON.stringify(base), { allowOverwrite: true, contentType: 'application/json' })
    cursor += 1
    await put(SWEEP_PATHNAME, JSON.stringify({ ...sweep, cursor, done: cursor >= sites.length }), { allowOverwrite: true, contentType: 'application/json' })
  }

  status.lastRunAt = Date.now()
  status.lastPhase = `分片巡检 ${cursor}/${sites.length}`
  status.lastCount = base.counts.total
  console.log(`[cron] 分片巡检：${cursor}/${sites.length} 站 → ${JSON.stringify(base.counts)}`)
  return base
}
