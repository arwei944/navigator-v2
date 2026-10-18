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
import { evaluateAlerts } from '#shared/alert-rules.mjs'
import { probeChain, runProbe } from '#shared/probe-engine.mjs'
import { alertNotifications, webhookBody, parseWebhookUrls } from '#shared/ops/alert-notify.mjs'

const PATHNAME = 'ops/health.json'
const SITES_PATHNAME = 'sites.json'
const INTERVAL_MS = 6 * 60 * 60 * 1000
const BOOT_DELAY_MS = 45 * 1000
const CONCURRENCY = 10
const TIMEOUT_MS = 6000
/** 每几批落一次库：300 站跑完可能要几分钟，增量落库让健康角标早早就动起来 */
const FLUSH_EVERY_CHUNKS = 5
const MAX_SITES = 400
/** 告警 webhook 单次发送超时：渠道失联时不能让巡检卡住 */
const ALERT_TIMEOUT_MS = 8000
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
      // 带上 categoryId：告警/归档规则的「按分类设阈值」要靠它匹配
      sites.push({ id: s.id, name: s.name, categoryId: s.categoryId || '', url: /^https?:\/\//i.test(raw) ? raw : `https://${raw}` })
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

  // 巡检顺带做一次「连续失效 → 自动归档」：巡检本就持有最新判定，顺手判定最省事，
  // 也不引入新的定时器（沙箱里进程内定时器根本不触发）。异常一律吞掉，不影响巡检本身。
  try { await autoArchiveFailing(base, snapshot.sites) } catch (e) { console.warn('[cron] 自动归档跳过：', String((e && e.message) || e)) }

  // 告警站外出口（G3）：判据与站内同源（alert-rules），这里只是多一个「推出去」的动作。
  // 没配 NAV_ALERT_WEBHOOK_URL 时函数直接返回，不产生任何网络请求。
  try { await sendAlertWebhooks(base, snapshot.sites) } catch (e) { console.warn('[cron] 告警推送跳过：', String((e && e.message) || e)) }

  // 一轮跑完时记一个历史点：可用性曲线（ok/limited/down 计数）与响应时间趋势的**唯一数据来源**
  if (cursor >= sites.length) {
    try { await appendHistoryPoint(base) } catch (e) { console.warn('[cron] 历史点写入跳过：', String((e && e.message) || e)) }
  }

  return base
}

/* ══════════════════════ 可用性 / 响应时间历史 ══════════════════════ */

const HISTORY_PATHNAME = 'ops/health-history.json'
/** 保留最近 336 个点：一轮按 6h 算约等于 12 周；更早的曲线本来也没人看，留着只是拖慢读写 */
const HISTORY_MAX = 336

/** 全部已知判定里的平均耗时（毫秒）；没有有效样本时返回 null（曲线要能画出「断点」） */
function avgMsOf(results) {
  const list = Object.values(results || {})
    .map(r => Number(r && r.ms))
    .filter(n => Number.isFinite(n) && n > 0)
  if (!list.length) return null
  return Math.round(list.reduce((a, b) => a + b, 0) / list.length)
}

/**
 * 追加一个历史点。
 *
 * 为什么用**独立文件**而不是塞进 `ops/health.json`：那个文件是「当前判定」（每次读都只要最新状态），
 * 而这是**时间序列**（每次追加一行、读的时候要整段）—— 两种访问模式混在一个文件里，
 * 会让「读当前状态」每次都拖着几百个历史点走。
 */
async function appendHistoryPoint(payload) {
  let hist = null
  try { hist = await readJson(HISTORY_PATHNAME) } catch { /* 首次没有 */ }
  const points = Array.isArray(hist && hist.points) ? hist.points : []
  const counts = (payload && payload.counts) || {}
  points.push({
    t: new Date().toISOString(),
    total: counts.total || 0,
    ok: counts.ok || 0,
    limited: counts.limited || 0,
    down: counts.down || 0,
    avgMs: avgMsOf(payload && payload.results),
  })
  const trimmed = points.slice(-HISTORY_MAX)
  await put(HISTORY_PATHNAME, JSON.stringify({ version: 1, points: trimmed }), {
    allowOverwrite: true, contentType: 'application/json',
  })
  return trimmed.length
}

/* ══════════════════════ 失效站点自动归档 ══════════════════════
 *
 * 口径：`ops/health.json` 里 `fails`（连续不可达次数，见 health-rules.mjs#nextResult）
 * 达到阈值的站点，自动移入归档。
 *
 * 三个安全约束（这是会**自动改数据**的动作，必须收得住）：
 *   ① **只归档、不删除** —— 归档是完全可逆的（后台「取消归档」一键取回，主站也有归档 scope），
 *      误判的代价只是「一条站暂时从默认列表消失」，不是数据丢失；
 *   ② **CAS 写** —— 改 sites.json 前先读 etag，写入带 `ifMatch`；与前端 / 控制台的并发写
 *      不会互相覆盖（冲突时抛错 → 本次放弃，下一轮巡检再看）；
 *   ③ **可关可调** —— `NAV_AUTO_ARCHIVE_FAILS=0` 完全关闭；阈值默认 5（约等于连续 5 轮巡检不可达）。
 */
const AUTO_ARCHIVE_FAILS = (() => {
  const v = Number(process.env.NAV_AUTO_ARCHIVE_FAILS)
  return Number.isFinite(v) ? v : 5
})()

/** 告警规则表（后台「偏好设置」里配的；`api/alert-rules.js` 写的就是这个路径） */
const ALERT_RULES_PATHNAME = 'alert-rules.json'

async function readAlertConfig() {
  try { return await readJson(ALERT_RULES_PATHNAME) } catch { return null }
}

/** @returns {Promise<number>} 实际归档的站点数（0 表示什么都没做） */
export async function autoArchiveFailing(health, sites = []) {
  /**
   * 阈值来自**告警规则表**（后台「偏好设置」可配，按 host / 分类给不同阈值）；
   * 没配过就退回环境变量默认值 —— 保证「不配也照旧工作」，配了才改变行为。
   * 与告警共用同一套阈值：若两处各写一套，会出现「提醒说没事、后台却已经把它归档了」。
   */
  const stored = await readAlertConfig()
  const config = stored || { rules: [], fallback: { downThreshold: AUTO_ARCHIVE_FAILS } }
  const failing = new Set(evaluateAlerts({ results: health && health.results, sites, config }).map(a => a.id))
  if (!failing.size) return 0

  const blob = await get(SITES_PATHNAME, { access: 'private' })
  if (!blob || !blob.stream) return 0
  const etag = (blob.blob && blob.blob.etag) || blob.etag || null
  let data
  try { data = JSON.parse(await new Response(blob.stream).text()) } catch { return 0 }
  if (!data || !Array.isArray(data.sites)) return 0

  const now = Date.now()
  let changed = 0
  // 注意变量名：参数已叫 `sites`（站点表快照），这里的产物必须另起一个名字
  const nextSites = data.sites.map(s => {
    if (!s || !failing.has(s.id) || s.archived) return s
    changed++
    // 与前端 toggleArchive 同一口径：归档即取消置顶（两者互斥）
    return { ...s, archived: true, pinned: false, updatedAt: now }
  })
  if (!changed) return 0

  await put(SITES_PATHNAME, JSON.stringify({ ...data, sites: nextSites }), {
    access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json',
    ifMatch: etag,
  })
  console.log(`[cron] 自动归档：${changed} 个站点连续 ${AUTO_ARCHIVE_FAILS} 轮不可达 → 移入归档（可一键取回）`)
  return changed
}

/* ══════════════════════ 告警站外出口（Webhook，G3） ══════════════════════
 *
 * 巡检判出「连续 N 次不可达」的站点后，除站内展示外还能推到你配的 webhook。
 *
 * 三条约束（这是会**主动对外发请求**的动作，必须有边界）：
 *   ① **没配就不发** —— `NAV_ALERT_WEBHOOK_URL` 为空时直接返回，零网络请求；
 *   ② **失败不阻塞巡检** —— 告警是旁路，渠道失联只记日志，绝不让它拖垮巡检；
 *   ③ **凭据只留服务端** —— URL 与格式只从环境变量读，不进前端产物、不落库。
 *
 * 多渠道 = 逗号分隔多个 URL，逐渠道独立发送、独立失败。
 * 节流交给巡检本身的 6h 节奏 —— 比在内存里再记一份冷却状态更不容易出错。
 */
async function sendAlertWebhooks(payload, sites = []) {
  const urls = parseWebhookUrls(process.env.NAV_ALERT_WEBHOOK_URL)
  if (!urls.length) return 0
  const events = alertNotifications({
    results: payload && payload.results, sites, config: await readAlertConfig(),
  })
  if (!events.length) return 0

  const format = process.env.NAV_ALERT_WEBHOOK_FORMAT || 'json'
  const contentType = format === 'text' ? 'text/plain; charset=utf-8' : 'application/json'
  let sent = 0
  for (const url of urls) {
    for (const ev of events) {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), ALERT_TIMEOUT_MS)
      try {
        const res = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': contentType },
          body: webhookBody(ev, format), signal: ctrl.signal,
        })
        if (res && res.ok) sent++
        else console.warn(`[cron] 告警 webhook 返回 ${res && res.status}：${url}`)
      } catch (e) {
        console.warn(`[cron] 告警 webhook 发送失败（不影响巡检）：${url} — ${String((e && e.message) || e)}`)
      } finally {
        clearTimeout(timer)
      }
    }
  }
  if (sent) console.log(`[cron] 告警已推送 ${sent} 条 → ${urls.length} 个渠道`)
  return sent
}
