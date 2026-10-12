/**
 * 站点元信息代理 API：抓取目标页，推断出收录一个站点所需的全部字段。
 * GET /api/metadata?url=https://example.com
 *
 * 返回 { name, desc, favicon, faviconUrl, domain, url, color, categoryId, categoryLabel,
 *        purposes, blocked, confidence, sources, warning,
 *        nameOriginal, descOriginal, translated, translateEngine }
 *
 * 推断逻辑全部在 shared/site-infer.mjs，分类白名单在 shared/categories.mjs ——
 * 与本地控制台 tools/console/lib/sites.mjs 同源，两个「新增站点」入口的推荐口径永远一致。
 * 自动翻译（非中文 → 中文）在 shared/translate.mjs，同样与本地控制台共用同一内核。
 * 这里只负责网络抓取、编码回退、翻译传输与安全校验。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { inferSite, decodeHtmlBytes, pickThemeColor, manifestHref, manifestThemeColor, BLOCKED_WARNING } from '../shared/site-infer.mjs'
import { translateSiteFields, needsTranslation, shouldTranslateName } from '../shared/translate.mjs'
import { categoryMeta } from '../shared/categories.mjs'
import { isBlockedHost } from '../shared/net-guard.mjs'
import { fetchCapped } from '../shared/http-fetch.mjs'
import { rejectAbusive, clientIp, rateLimited } from '../shared/rate-limit.mjs'

// 既有的 SSRF 用例（tools/console/test-guard.mjs）从这里 import，保持导出位置不变。
// 实现已搬到 shared/net-guard.mjs：字面规则与 IP 段规则要在「连接层的解析回调」里复用。
export { isBlockedHost }
// 限流/取 IP 的实现搬到 shared/rate-limit.mjs，这里 re-export 保持既有 import 路径可用
export { clientIp, rateLimited }
// 给守卫用例直接测「独立小上限」的行为（纯函数，无副作用）
export { withBudget }

// 已收录站点作为「像不像已有某站」的参照（域名同族 / 品牌词命中）。
// 用构建期快照即可：它只影响推荐权重，实时数据仍在 Vercel Blob。
const SEED_SITES = JSON.parse(
  readFileSync(fileURLToPath(new URL('./sites-data.json', import.meta.url)), 'utf-8')
)
const CATEGORY_META = categoryMeta()

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/**
 * 只读 64KB，并且**读到 `</head>` 就断开**。
 *
 * 推断所需的字段（title / meta description / og:* / link[rel=icon] / link[rel=manifest] /
 * meta theme-color）**全部在 head 里**，没有理由把正文也读完。实测（本机 3 轮中位数，
 * 只换这两个参数）：
 *   vercel 697→322ms（2.2×）、openai 1634→661ms（2.5×）、figma 1588→1062ms（1.5×）、
 *   tapecode 357→57ms（6.3×）。
 *
 * 64KB 是**兜底**：内联了大量 CSS 的 head 可能超过 32KB，而畸形页面（没有 `</head>`）
 * 需要一个上限来收口 —— 此时传输层会自动退化为「读满 64KB 断开」。
 */
const MAX_BYTES = 64 * 1024
const STOP_AT = '</head>'
const MAX_REDIRECTS = 4

/**
 * 总时间预算 3s（原为 6s）。
 *
 * 为什么敢收紧：用户**早就看到内容了** —— 前端第 0 跳的本地推断是 0ms 的（浏览器里跑同一个
 * inferSite 引擎），抓取只是「把草稿升级成真实信息」。抓不到不再是「空白」，而是「少一次升级」，
 * 所以让用户干等 6s（github.com 实测端到端 13s）比快速失败差得多。
 *
 * 实测线上端到端：sspai 844ms / vercel 1697ms / stripe 1790ms / tapecode 2670ms 都在 3s 内；
 * 落在 3s 外的 github.com(超时)、news.ycombinator.com(超时) 本来就没抓到东西。
 *
 * ## TRANSLATE_MIN_MS 为什么是 3.5s 而不是 2s
 *
 * 翻译和抓取**争同一个预算**：抓取吃掉大部分后，翻译只剩
 * `max(下限, 剩余)` —— 下限就是它在最坏情况下的全部时间。
 * 线上实测（同一站点连打 4 次）：总耗时 5.2s / 5.5s / 7.3s 的三次都译成了中文，
 * 而总耗时 9.4s 的那次译文为空（下限 2s 不够 MyMemory 往返）→ 描述落成英文原文。
 *
 * **但这不是解药**：MyMemory 的免密钥额度是**按出口 IP 计的日配额**，部署出口是共享 IP，
 * 随时会被耗尽；耗尽时它不报 HTTP 错，而是在译文位回一句警告（parseMyMemory 能识别）。
 * 真正的解法是「本地词表 + 浏览器本地模型优先，在线引擎只做兜底」——
 * 见 shared/glossary.mjs 与 src/services/browserTranslate.js。
 */
const FETCH_BUDGET_MS = 3000
const TOTAL_BUDGET_MS = 9000
const TRANSLATE_MIN_MS = 3500

/**
 * manifest 补抓的**独立**上限：它排在主抓之后，不能让它把剩余预算拖空。
 *
 * 注意它会被总预算夹住（`min(900, 剩余)`）—— 线上实测过「固定 900ms 叠在 3s 之上」
 * 会把整次请求顶到 3.4s 之外。见 `manifestThemeOf`。
 */
const MANIFEST_BUDGET_MS = 900
/** 剩余预算小于这个值就整个跳过补抓：往返都不止这么久，只会把请求拖过总预算 */
const MANIFEST_MIN_MS = 150

/* ---------------- 同域抓取缓存 ---------------- */

/**
 * 同一域名在 TTL 内只真抓一次。
 *
 * 两个真实收益：
 *   ① 「秒加」与「弹窗预填」会在同一秒内对同一个 URL 各抓一次（实测重复请求）；
 *      并流去重（`inflight`）让第二次直接搭第一次的车。
 *   ② 用户改完再提交、或重新打开弹窗时，第二次是 0ms。
 *
 * 两条纪律：
 *   - **只缓存成功结果**。缓存超时/失败会把一次网络抖动固化 5 分钟，比不缓存更坏。
 *   - 是**进程内** best-effort（与限流同理）：serverless 多实例各存各的，不是共享缓存。
 */
const CACHE_TTL_MS = 5 * 60_000
const CACHE_MAX = 200
const cache = new Map()      // href → { value, at }
const inflight = new Map()   // href → Promise

function cacheGet(href) {
  const hit = cache.get(href)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(href); return null }
  return hit.value
}

function cacheSet(href, value) {
  if (cache.size >= CACHE_MAX) {
    // 简单的 FIFO 淘汰：Map 保持插入顺序，删最早的一条即可
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(href, { value, at: Date.now() })
}

/**
 * 并流去重 + 缓存：同一个 key 并发请求只真抓一次。`onHit` 用于把「命中缓存」暴露给调用方。
 *
 * `cacheable` 决定「什么结果值得存」——
 * 页面走默认谓词（**只有真拿到 html 才存**：把一次网络抖动缓存 5 分钟比不缓存更坏）；
 * manifest 传自己的谓词（主题色是字符串，且空串不值得占位）。
 */
function dedupe(key, run, { onHit, cacheable = res => Boolean(res && res.html) } = {}) {
  const hit = cacheGet(key)
  if (hit !== null && hit !== undefined) {
    if (typeof onHit === 'function') onHit()
    return Promise.resolve(hit)
  }
  const pending = inflight.get(key)
  if (pending) return pending
  const p = run()
    .then(res => { if (cacheable(res)) cacheSet(key, res); return res })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

function blockedHostError() {
  const err = new Error('该地址指向内网或本机')
  err.code = 'BLOCKED_HOST'
  return err
}

/* ---------------- 公网滥用防护 ---------------- */

// 跨站调用拦截 + 每实例限流：实现搬到 shared/rate-limit.mjs，
// 因为 /api/translate 要用同一套（两份实现漂移在本项目已经出过事故）。
// 仍按原顺序导出 clientIp/rateLimited，避免既有用例的 import 断掉。

/* ---------------- 抓取 ---------------- */

/**
 * 手动跟重定向：每跳都重新校验主机，否则「公网 URL 302 到内网」就能绕过字面检查。
 *
 * 注意字面检查（`isBlockedHost`）只是第一道门。真正的防线在 `fetchCapped` 内部：
 * 它把同一套 IP 规则挂到 `lookup` 上，于是**解析出的地址**在用于连接之前就被逐个校验，
 * DNS rebinding（域名先解析到公网、连接时再解析到内网）这条路也一并堵上。
 */
async function fetchHtml(startHref, signal, accept = 'text/html,application/xhtml+xml', stopAt = STOP_AT) {
  let href = startHref
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = new URL(href)
    if (isBlockedHost(u.hostname)) throw blockedHostError()
    const resp = await fetchCapped(href, {
      signal,
      headers: {
        'user-agent': UA,
        'accept-language': 'zh-CN,zh;q=0.9',
        'accept': accept,
      },
      maxBytes: MAX_BYTES,
      // 早断只对 HTML 有意义（manifest 是 JSON，里面没有 </head>）
      stopAt,
    })
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.location
      if (!loc) return resp
      href = new URL(loc, href).href
      continue
    }
    return resp
  }
  const err = new Error('重定向次数过多')
  err.code = 'TOO_MANY_REDIRECTS'
  throw err
}

/**
 * 给一次出网套一个**独立的小上限**，同时保留外层的整体预算。
 *
 * 不用 `AbortSignal.any` / `AbortSignal.timeout`：它们在旧运行时不存在，
 * 而这个文件在部署沙箱里跑 —— 为了一个可选的补抓步骤引入运行时版本依赖不划算。
 * 手写版本行为完全等价，且好测。
 */
function withBudget(outerSignal, ms) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  const relay = () => ctl.abort()
  if (outerSignal) {
    if (outerSignal.aborted) ctl.abort()
    else outerSignal.addEventListener('abort', relay, { once: true })
  }
  return {
    signal: ctl.signal,
    done() {
      clearTimeout(timer)
      if (outerSignal) outerSignal.removeEventListener('abort', relay)
    },
  }
}

const okStatus = s => s >= 200 && s < 300

export default async function handler(req, res) {
  // 滥用防护先于一切：跨站调用直接拒，再按来源 IP 限一次速。
  // 放在最前面是因为这两条不依赖参数合法性 —— 一个打满配额的请求不该先花时间解析 URL。
  if (rejectAbusive(req, res)) return

  // 可能是数组（`?url=a&url=b`）→ 先归一成字符串，别让后面的字符串方法抛类型错
  const raw = typeof req.query.url === 'string' ? req.query.url.trim() : ''
  if (!raw) {
    res.status(400).json({ error: '缺少 url 参数' })
    return
  }

  /**
   * 只有**带 `://` 的显式 scheme** 才算 scheme。
   *
   * 不能写成 `raw.startsWith('http') ? raw : 'https://' + raw` —— 那样 `ftp://x.com`
   * 会被拼成 `https://ftp//x.com`（host 是 `ftp`，path 是 `//x.com`），
   * protocol 一路是 `https:`，于是下面那句「仅支持 http/https」成了**死代码**；
   * `file:///c:/x` 同理会变成 host = `file`。
   *
   * 也不用 `/^[a-z]+:/` 直接判：`example.com:8080` 和 `localhost:5173` 会被误判成 scheme `example.com`。
   * 要求后面跟 `://` 就同时避开了这两种误伤（这两种走下面的 `https://` 前缀，行为不变）。
   */
  const proto = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw)?.[1]?.toLowerCase()
  if (proto && proto !== 'http' && proto !== 'https') {
    res.status(400).json({ error: '仅支持 http/https' })
    return
  }

  let target
  try {
    target = new URL(proto ? raw : 'https://' + raw)
  } catch {
    res.status(400).json({ error: '无效的 URL' })
    return
  }
  // 第二道网：`data:` / `javascript:` 这类没有 `://` 的输入会落到这里（前缀拼接后通常直接抛错，
  // 但被解析成功的少数形状必须在这里拦住）
  if (!['http:', 'https:'].includes(target.protocol)) {
    res.status(400).json({ error: '仅支持 http/https' })
    return
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_BUDGET_MS)
  const startedAt = Date.now()

  // https 抓不到时回退 http：少数站点只在 http 上响应，直接判定失败会让用户白填一遍
  const grabUncached = async (u) => {
    try {
      const resp = await fetchHtml(u.href, controller.signal)
      if (!okStatus(resp.status)) return { html: '', status: resp.status }
      return { html: decodeHtmlBytes(resp.body), status: resp.status }
    } catch (e) {
      /**
       * 超时（AbortError）**不回退 http**：预算已经耗尽，再抓一次只可能把请求拖过硬上限。
       *
       * 这条曾经漏掉 —— 判据只有 `BLOCKED_HOST` 与协议，于是「主抓 3s 超时」会走进回退分支
       * 再发一次请求。回退用的还是**同一个已 abort 的 signal**，所以它在当前 Node 上会立刻失败、
       * 看不出损害（本地实测超时路径 3011~3191ms）；但那是**依赖实现细节**的运气：
       * 一旦某条路径上 abort 未被立即观察到，这次多余的出网就会实打实地突破预算。
       * 语义上也本就不该重试 —— 回退存在的理由是「少数站点只在 http 上响应」，
       * 而超时的站点与协议无关。其余错误（连接被拒 / 证书失败等）照常回退。
       */
      if (e.code === 'BLOCKED_HOST' || e.name === 'AbortError' || u.protocol !== 'https:') throw e
      const httpU = new URL(u.href)
      httpU.protocol = 'http:'
      const resp = await fetchHtml(httpU.href, controller.signal)
      if (!okStatus(resp.status)) return { html: '', status: resp.status }
      return { html: decodeHtmlBytes(resp.body), status: resp.status }
    }
  }

  // 并流去重 + 短 TTL 缓存：同一 URL 在缓存期内只真抓一次。
  // 缓存**不走 AbortController** —— 命中缓存时必须立刻返回，不能受本次请求的预算影响。
  let cacheHits = 0
  const grab = (u) => dedupe(u.href, () => grabUncached(u), { onHit: () => { cacheHits++ } })

  /**
   * manifest 补抓也走同一套缓存/去重。
   *
   * 它**排在主抓之后**（manifest 地址是从 HTML 里解析出来的，没法提前并行），所以它的耗时
   * 是纯加在关键路径上的。而它的产出只有一个**装饰性**的品牌色 —— 「秒加」与「弹窗预填」
   * 在同一秒内对同一 origin 各触发一次时，没理由为这个颜色等两遍。
   * 空结果不缓存：主题色缺失不是「错误内容」，不该被固化成一分钟的「这个站没有品牌色」，
   * 但也不必为它把一次网络抖动固定住 —— 谓词只收非空字符串。
   */
  const manifestThemeOf = (mHref, signal) => dedupe(
    'manifest:' + mHref,
    async () => {
      /**
       * 独立上限，**但必须被总预算夹住**。
       *
       * 曾经写法是「固定 900ms」—— 于是它能叠在主抓的 3s 之上：线上实测 figma 3372ms
       * （≈2472 主抓 + 900 manifest）、github 3317ms，**整次请求被顶到 3.4s 以外**，
       * 而这两个站点的 manifest 只为一个装饰性品牌色服务。
       *
       * 现在取 `min(900, 距总预算到点还剩多少)`：主抓已经吃满预算时就**整个跳过**补抓，
       * 让「抓取阶段 ≤ 3s」成为真正的硬上限，而不是「3s + 900ms」。
       */
      const left = startedAt + FETCH_BUDGET_MS - Date.now()
      if (left < MANIFEST_MIN_MS) return ''
      const budget = withBudget(signal, Math.min(MANIFEST_BUDGET_MS, left))
      try {
        const mr = await fetchHtml(mHref, budget.signal, 'application/manifest+json,application/json,text/plain,*/*', null)
        return okStatus(mr.status) ? manifestThemeColor(decodeHtmlBytes(mr.body)) : ''
      } finally { budget.done() }
    },
    { cacheable: v => typeof v === 'string' && v.length > 0 },
  )

  // 贴的是子页时并行补抓主域名首页：落库口径永远是主域名，元信息也应以主域名为准。
  // 并行而非串行 —— 两跳共享同一个 8s AbortController，串行会白吃掉一倍的超时预算。
  const wantsRoot = Boolean(target.pathname) && target.pathname !== '/'

  let html = ''
  let rootHtml = ''
  let manifestTheme = ''
  let warning = ''
  try {
    const [pageR, rootR] = await Promise.allSettled([
      grab(target),
      wantsRoot ? grab(new URL(target.origin + '/')) : Promise.resolve(null),
    ])
    if (rootR.status === 'fulfilled' && rootR.value?.html) rootHtml = rootR.value.html

    if (pageR.status === 'rejected') {
      // 子页抓失败但根页拿到了 → 按根页推断，不必再报「抓取失败」
      if (!rootHtml) throw pageR.reason
    } else {
      html = pageR.value.html
      if (!html && !rootHtml) warning = `目标站点返回 ${pageR.value.status}，已按域名推断，请复核名称与分类`
    }

    // 品牌色只写在 webmanifest 里的站点：页面没有「可用」的 meta theme-color 时补抓 manifest 取 theme_color。
    // 注意判据是「可用」而非「存在」—— 按配色方案声明 light #ffffff / dark #0a0b0d 的页面
    // 两条都不可用，只判存在会白白跳过 manifest，拿不到真正的品牌色。
    if (!pickThemeColor(html) && !pickThemeColor(rootHtml)) {
      const base = target.origin + '/'
      const mHref = manifestHref(html, base) || (rootHtml ? manifestHref(rootHtml, base) : '')
      if (mHref) {
        // 排在主抓之后 + 独立小上限 + 同 origin 缓存，三件事缺一不可，理由见 manifestThemeOf
        try {
          manifestTheme = await manifestThemeOf(mHref, controller.signal)
        } catch { /* manifest 抓不到不影响主流程，色值退回其它来源 */ }
      }
    }
  } catch (e) {
    if (e.code === 'BLOCKED_HOST') {
      res.status(400).json({ error: e.message })
      return
    }
    warning = e.name === 'AbortError'
      ? '抓取超时，已按域名推断，请复核名称与分类'
      : '抓取失败（可能被反爬拦截），已按域名推断，请复核名称与分类'
  } finally {
    clearTimeout(timer)
  }

  /**
   * 抓取阶段真实耗时（含超时收尾），**不含**后续的推断/序列化。
   *
   * 为什么要把它单独报出来：`FETCH_BUDGET_MS` 是**服务端**能承诺的硬上限，而调用方测到的
   * 耗时里还叠着网络 RTT 与宿主冷启动 —— 线上实测同一批站点，服务端 3011~3191ms 的抓取
   * 在部署端表现为 3405~4294ms（沙箱开销 400~1300ms，且抖动不可控）。
   * 用端到端耗时去判「服务端有没有守住预算」，会在慢宿主上给出假失败；
   * 反之，缺了它就只能看到端到端数字，无法区分「服务端超了」和「网络慢」。
   */
  const fetchMs = Date.now() - startedAt

  // 抓不到页面不算失败：照常产出一份按域名推断的草稿，让用户只需复核而不是从零手填
  const info = inferSite({
    html,
    rootHtml,
    manifestTheme,
    url: target.href,
    existingSites: SEED_SITES,
    categoryMeta: CATEGORY_META,
  })

  // 挑战页返回 200，抓取层看不出异常，只有内容层知道这是拦截页：warning 必须盖过抓取层文案
  if (info.blocked) warning = BLOCKED_WARNING

  /**
   * 翻译：**默认不在这里做**，改为让前端异步补（`GET /api/translate`）。
   *
   * 为什么改：翻译是这条链路上最慢、最不可控的一段（等 MyMemory 往返，最多 3.5s），
   * 而它产出的「中文描述」只是**锦上添花** —— 用户此刻已经看到了：本地的中文草稿（0ms）、
   * 以及刚抓回来的真实名称与原文描述。把它串在响应里，等于让每一次添加都为一个
   * 可能失败的外部调用多等几秒，这正是 figma.com 实测 10.3s 的一大块。
   *
   * 兼容：显式带 `?translate=1` 时仍走旧的内联翻译（既有探针与调用方不必改）。
   */
  const wantsInline = /^(1|true|yes)$/i.test(String(req.query.translate || ''))
  const needs = {
    name: shouldTranslateName(info.name),
    desc: needsTranslation(info.desc),
  }

  const tr = wantsInline
    ? await autoTranslate(info, UA, Math.max(TRANSLATE_MIN_MS, TOTAL_BUDGET_MS - (Date.now() - startedAt)))
    : {
        original: { name: info.name, desc: info.desc },
        translated: { name: false, desc: false },
        engines: { name: '', desc: '' },
      }

  // 抓取结果随目标页变动，不缓存（同域缓存是**服务端进程内**的，与此无关）
  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({
    ...info,
    favicon: info.faviconUrl,
    warning,
    nameOriginal: tr.original.name,
    descOriginal: tr.original.desc,
    translated: tr.translated,
    translateEngine: tr.engines,
    // 新增：告诉前端「这两项还需不需要译」，由它决定去不去 /api/translate。
    // 默认路径下 translated 恒为 false，光看它分不清「不需要译」与「还没译」。
    needsTranslate: wantsInline ? { name: false, desc: false } : needs,
    translateMode: wantsInline ? 'inline' : 'deferred',
    // 本次抓取是否命中了服务端同域缓存（探针据此区分「快是因为缓存」与「快是因为早断」）
    cached: cacheHits > 0,
    // 服务端抓取阶段的真实耗时 —— 与「调用方测到的端到端」分开，理由见 handler 里的注释
    fetchMs,
  })
}

/**
 * 就地把 info.name / info.desc 换成中文译文，并返回原文与翻译状态。
 * 内核（shared/translate.mjs）负责「该不该译」，这里只提供传输层：
 * 复用与抓取相同的 UA，带**由调用方算好的剩余预算**做超时（不是固定值 —— 见 handler 里的注释），
 * 任何异常都静默退回原文。
 */
async function autoTranslate(info, ua, timeoutMs) {
  const fallback = {
    original: { name: info.name, desc: info.desc },
    translated: { name: false, desc: false },
    engines: { name: '', desc: '' },
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || TRANSLATE_MIN_MS))
  const fetchText = async (url) => {
    const r = await fetch(url, { headers: { 'user-agent': ua }, signal: controller.signal })
    if (!r.ok) throw new Error(`translate http ${r.status}`)
    return r.text()
  }
  try {
    const t = await translateSiteFields({ name: info.name, desc: info.desc }, { fetchText })
    info.name = t.name
    info.desc = t.desc
    return { original: t.original, translated: t.translated, engines: t.engines }
  } catch {
    return fallback
  } finally {
    clearTimeout(timer)
  }
}