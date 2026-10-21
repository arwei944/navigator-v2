/**
 * 生产服务：静态资源 + **全部 16 个 `/api/*` 接口** + SQLite 存储与巡检。
 *
 * ## `api/` 是什么（最容易误读的一点）
 *
 * `api/` 下 16 个文件**全部**导出 Vercel 风格的 `(req, res)` handler，
 * 但它们**没有一个依赖 Vercel 平台**：只用 Node 内置模块 + `shared/` 下的纯函数，
 * 没有任何 `@vercel/*` 包。也就是说，`api/` 不是「迁移后待删的残留」，
 * **它是默认发布通道（BotKeep）实际在用的实现源** —— 由本文件在启动时全量加载。
 *
 * 签名的意义只在于「可移植」：同一份源码既能被 Vercel 通道直接吃，
 * 也能被这里的薄适配层托起来。删掉 `api/` 会同时打断两条通道。
 *
 * ## 为什么保留 Vercel 签名而不是改写成原生 (req, res)
 *
 * 接口只碰到 `req.headers / req.query / req.socket` 与
 * `res.setHeader / res.status(...).json(...)`。在原生 ServerResponse 上补上
 * `status()` 和 `json()` 两个方法即可，**接口源码零改动** —— 改源码会让
 * `tools/console/test-guard.mjs` / `test-netguard.mjs` 这两套 SSRF 用例的
 * 保护范围失效，那才是真正的安全风险。
 *
 * ## 路由表从目录派生
 *
 * 见下方 `loadApiRoutes()`：`api/<name>.js` ↔ `/api/<name>`，新增端点只需加文件。
 * 构建后置脚本把 `api/`、`shared/`、`server/` 整体复制进部署目录。
 *
 * ## 路由约定（前端 `stores/sites.js` 依赖这些语义）
 *
 * - `/api/<name>` 命中 → 交给对应 handler
 * - 其余 `/api/*` → **404 JSON**（绝不能回 index.html：前端靠「404」判定
 *   「该部署没有这个接口」并停止轮询，回了 HTML 会被当成响应体异常）
 * - 其余路径 → 静态文件；无扩展名且文件不存在时回 index.html（SPA 兜底，
 *   让「在子页面按刷新」不至于 404 —— 与构建时生成的 `<route>/index.html` 双保险）
 */
import http from 'node:http'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname } from 'node:path'

/**
 * 服务根目录 —— 部署产物与源码树的布局**不同**，这里要同时兼容：
 *
 *   部署产物：  dist/server.js + dist/api/ + dist/shared/     → ROOT = dist/
 *   源码直跑：  server/main.mjs  + api/ + shared/（仓库根）    → ROOT = 仓库根
 *
 * 判据是「同级有没有 api/」：产物里一定有；源码树里 main.mjs 在 server/ 下，
 * 同级没有 api/，得往上一层。
 *
 * 这条兼容不能省：路由表是按 `ROOT/api` 派生的（见下方 loadApiRoutes），
 * 只看产物会让 `node server/main.mjs` 直接 ENOENT 起不来 —— 而本地调试、
 * 真机门禁都走这条路。
 */
function resolveRoot() {
  const here = dirname(fileURLToPath(import.meta.url))
  if (existsSync(join(here, 'api'))) return here
  const parent = resolve(here, '..')
  if (existsSync(join(parent, 'api'))) return parent
  return here
}
const ROOT = resolveRoot()
// HIVE 平台约定不一：Vercel / WorkBuddy 沙箱注入 PORT，BotKeep 注入 SERVER_PORT —— 两个都认。
const PORT = Number(process.env.PORT || process.env.SERVER_PORT) || 3000
const HOST = process.env.HOST || '0.0.0.0'

/**
 * 管理凭据回填：发布沙箱没有环境变量注入，构建脚本把两项配置写进 data/ 下的小文件
 * （不入 git；静态服务对 `/data/*` 一律拒绝）。启动时读回 process.env ——
 * shared/auth.mjs 在**调用时**才读环境变量，所以这里补上即可，鉴权源码零改动。
 *   admin-key.txt            → SITES_ADMIN_KEY（共享密钥直连，CLI/脚本用）
 *   admin-password-hash.txt  → ADMIN_PASSWORD_HASH（scrypt 口令哈希，登录用）
 * 没配口令哈希时登录接口会明确回 500「未配置登录口令」，共享密钥路径照常可用。
 */
if (!process.env.SITES_ADMIN_KEY) {
  try { process.env.SITES_ADMIN_KEY = readFileSync(join(ROOT, 'data', 'admin-key.txt'), 'utf8').trim() } catch { /* 没有就没有：写接口按未配置拒绝 */ }
}
/**
 * 过渡期旧密钥（`SITES_ADMIN_KEY_PREVIOUS`）：与当前密钥**同时有效**。
 *
 * 存在的原因：平台把线上密钥存为只写不读的 secret，无法得知旧值来「统一成一个」；
 * 而环境变量变更要平台层面重建容器才生效（restart 不够，实测进程仍读到旧值）。
 * 双密钥让两端并存，轮换不再需要「先停机再换」。
 *
 * 启动时打一行日志说明它是否生效 —— 这个变量**长期存在是有风险的**
 * （等于多一把有效钥匙），运维应该能一眼看到它还在。
 */
if (process.env.SITES_ADMIN_KEY_PREVIOUS) {
  console.log('[auth] 过渡期旧密钥已启用（SITES_ADMIN_KEY_PREVIOUS）—— 轮换完成后请删除该变量')
}
if (!process.env.ADMIN_PASSWORD_HASH) {
  try { process.env.ADMIN_PASSWORD_HASH = readFileSync(join(ROOT, 'data', 'admin-password-hash.txt'), 'utf8').trim() } catch { /* 未配口令：登录不可用，密钥直连不受影响 */ }
}

/* ---------------- /api/* 处理器 ---------------- */

/**
 * 路由表**从 `api/` 目录派生**，不再逐个手抄。
 *
 * 此前这里是 16 组「import 一行 + 表里一行」，而 `api/` 下正好是同样 16 个文件；
 * 新增一个端点要改三处（接口文件、这里的 import、这里的表，另加构建脚本的复制清单），
 * 漏一处就是运行时 404 —— 而 404 在我们的约定里**有业务含义**（前端据此判定
 * 「本部署没有该接口」并停止轮询），所以漏掉会表现成「后台某面板静默不工作」，
 * 不是报错。这类漂移靠人记不住，只能靠结构消掉。
 *
 * 约定：`api/<name>.js` ↔ `/api/<name>`；只认 `.js`，`_` 前缀同样保留
 * （`_local-key` 是端点名的一部分，其回环判定在接口内部）。非接口文件
 * （`sites-data.json`、`data/` 目录）自然被过滤掉。
 *
 * 启动即全量 import：与改造前逐一等价 —— 原先也是启动时把所有 handler
 * 静态拉起来。接口模块的顶层代码必须保持无副作用（现有 16 个都满足）。
 */
const API_DIR = join(ROOT, 'api')
const apiFiles = readdirSync(API_DIR).filter(f => f.endsWith('.js')).sort()

/** 文件名 → 路由 + 导出模块。失败时把文件名带进错误，别让人对着空栈猜 */
async function loadApiRoutes() {
  const routes = {}
  const mods = {}
  for (const f of apiFiles) {
    const name = f.slice(0, -3)
    const mod = await import(pathToFileURL(join(API_DIR, f)).href)
    if (typeof mod.default !== 'function') {
      throw new Error(`api/${f} 没有 default 导出的处理函数 —— 它不该放在 api/ 下（路由表由目录派生）`)
    }
    routes[`/api/${name}`] = mod.default
    mods[name] = mod
  }
  return { routes, mods }
}

const { routes: API_ROUTES, mods: API_MODS } = await loadApiRoutes()
// 插件管理多一个启动期动作（把 9 个引擎注册表落成运行期配置），仍从同一份模块表取
const pluginsMod = API_MODS.plugins
const { etagOf } = await import('./store.mjs')
const cronMod = await import('./cron.mjs')
const { startHealthCron } = cronMod

/** 给原生 res 补上 Vercel 风格的 `status().json()`，接口源码零改动 */
function withHelpers(res) {
  res.status = code => { res.statusCode = code; return res }
  res.json = obj => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(obj))
    return res
  }
  return res
}

/** 从请求 URL 解析出 Vercel 风格的 `req.query`（全是 string，与 Vercel 行为一致） */
function parseQuery(url) {
  const query = {}
  for (const [k, v] of new URL(url, 'http://x').searchParams) query[k] = v
  return query
}

/** POST 体读取：整包缓冲 + 封顶（session 的 512KB 门禁在接口里，这里是传输层的粗保险） */
function readRawBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolveP, rejectP) => {
    const chunks = []
    let total = 0
    req.on('data', c => {
      total += c.length
      if (total > limit) {
        const err = new Error('request body too large')
        err.statusCode = 413
        rejectP(err)
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolveP(Buffer.concat(chunks).toString('utf8')))
    req.on('error', rejectP)
  })
}

/** 带体的方法才读体；体以**原始字符串**挂到 req.body —— sites/session 的 readBody 都认这种形态 */
async function attachBody(req) {
  if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') return
  req.body = await readRawBody(req)
}

/* ---------------- 静态文件 ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

/** 带完整文件名的资源（构建时带内容哈希）可以永久缓存；会变的名字绝不缓存 */
function cacheControl(abs) {
  const rel = abs.slice(ROOT.length).replace(/\\/g, '/')
  if (rel === '/index.html' || rel === '/sw.js' || rel === '/manifest.webmanifest') return 'no-cache'
  if (rel.startsWith('/assets/')) return 'public, max-age=31536000, immutable'
  if (rel.endsWith('/index.html')) return 'no-cache'
  return 'public, max-age=86400'
}

/** 把 URL 路径解析成 ROOT 内的绝对路径；越界（目录穿越）返回 null */
function safeResolve(pathname) {
  let decoded
  try { decoded = decodeURIComponent(pathname) } catch { return null }
  const normalized = normalize(decoded).replace(/^([.][.][\\/])+/, '')
  const abs = resolve(ROOT, '.' + normalized)
  if (abs !== ROOT && !abs.startsWith(ROOT + sep)) return null
  return abs
}

function sendFile(req, res, abs) {
  const type = MIME[extname(abs).toLowerCase()] || 'application/octet-stream'
  res.setHeader('Content-Type', type)
  res.setHeader('Cache-Control', cacheControl(abs))
  res.statusCode = 200
  if (req.method === 'HEAD') { res.end(); return }
  createReadStream(abs).pipe(res)
}

/** 见下方「旧产物自愈通道」：作为模块被浏览器执行，注销 SW 后重载一次 */
const SELF_HEAL_JS = `(() => {
  try {
    const key = 'nav:sw-selfheal'
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
  } catch (e) {}
  const go = () => location.reload()
  if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
    navigator.serviceWorker.getRegistrations()
      .then(list => Promise.all(list.map(r => r.unregister())))
      .then(go, go)
  } else { go() }
})()
`

function sendJson(res, code, obj) {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(obj))
}

/* ---------------- 服务器 ---------------- */

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x')
    const pathname = url.pathname

    /* ---- API ----
     * v10：除 metadata 外全部接口都接回来了（sites/session/clicks/ops/auth/health）。
     * 路由表里没有的一律 404 JSON —— 前端靠「404」判定「这个部署没有该接口」
     * （CLOUD_FATAL 停轮询），绝不能回 index.html 把语义搅浑。 */
    if (pathname.startsWith('/api/')) {
      /**
       * 鉴权自检：只暴露布尔值与密钥指纹（sha256 前 10 位，不可逆），
       * 用于远端排查「密钥没带到位 / 带错了」—— 不暴露任何可用的凭据材料。
       */
      if (pathname === '/api/_diag' && req.method === 'GET') {
        const secret = String(process.env.AUTH_SECRET || process.env.SITES_ADMIN_KEY || '')
        // 收到的 Bearer 也只回指纹与长度 —— 用来判定「密钥不一致」还是「网关改写了 Authorization 头」
        const received = String((req.headers && req.headers.authorization) || '')
        const xnav = String((req.headers && req.headers['x-nav-key']) || '')
        sendJson(res, 200, {
          hasEnvKey: Boolean(process.env.SITES_ADMIN_KEY),
          hasEnvSecret: Boolean(process.env.AUTH_SECRET),
          hasKeyFile: existsSync(join(ROOT, 'data', 'admin-key.txt')),
          secretFp: secret ? createHash('sha256').update(secret).digest('hex').slice(0, 10) : '',
          receivedAuthLen: received.length,
          receivedBearerFp: received ? createHash('sha256').update(received.replace(/^Bearer\s+/i, '').trim()).digest('hex').slice(0, 10) : '',
          receivedXNavLen: xnav.length,
          receivedXNavFp: xnav ? createHash('sha256').update(xnav).digest('hex').slice(0, 10) : '',
          routes: Object.keys(API_ROUTES),
          // 进程内定时任务的状态：它坏掉时没有任何请求症状，只能靠这里看
          cron: {
            enabled: cronMod.status.enabled,
            started: cronMod.status.started,
            running: cronMod.status.running,
            phase: cronMod.status.lastPhase,
            lastRunAgoSec: cronMod.status.lastRunAt ? Math.round((Date.now() - cronMod.status.lastRunAt) / 1000) : null,
            lastCount: cronMod.status.lastCount,
            lastError: cronMod.status.lastError,
            nodeMajor: process.versions.node.split('.')[0],
            uptimeSec: Math.round(process.uptime()),
          },
        })
        return
      }

      const handler = API_ROUTES[pathname]
      if (!handler) {
        sendJson(res, 404, { error: `接口不存在：${pathname}（本部署提供 ${Object.keys(API_ROUTES).join('、')}）` })
        return
      }

      // GET /api/sites 的条件请求：Blob 时代由平台自动加 ETag，自建后自己补，
      // 命中 If-None-Match 直接 304，省掉一次全量读 + 序列化
      if (pathname === '/api/sites' && req.method === 'GET') {
        const etag = etagOf('sites.json')
        const inm = String(req.headers['if-none-match'] || '').trim()
        if (etag && inm && inm === etag) { res.statusCode = 304; res.end(); return }
        if (etag) res.setHeader('ETag', etag)
      }

      await attachBody(req)
      // 各接口自己管鉴权（checkAuthHeader 已优先读 X-Nav-Key）与方法白名单
      await handler(
        { headers: req.headers, query: parseQuery(req.url), socket: req.socket, method: req.method, body: req.body },
        withHelpers(res),
      )

      /**
       * 顺带推进健康巡检一小步（**在响应已经发出之后**才做，不给请求加延迟）。
       * 沙箱没有长驻进程（uptimeSec 恒为 0），定时器不触发，只能靠请求驱动；
       * 进度落在存储里，进程被回收也不丢。失败一律吞掉 —— 它绝不能影响本次响应。
       */
      if (pathname === '/api/sites' || pathname === '/api/health') {
        cronMod.tickOnDemand().catch(() => { /* 巡检是兜底，失败不影响本次请求 */ })
      }
      return
    }

    /* ---- 静态文件 ---- */
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405
      res.setHeader('Allow', 'GET, HEAD')
      res.end()
      return
    }

    // 静态服务拒绝清单：/data/*（SQLite + 管理密钥）与服务自身文件。源码本就公开（GitHub），
    // 但密钥与数据库绝不能变成一个 GET 就能拖走的文件。
    if (/^\/data(\/|$)/i.test(pathname) || /^\/(server\.js|store\.mjs|package\.json)$/i.test(pathname)) {
      sendJson(res, 403, { error: 'Forbidden' })
      return
    }

    let abs = safeResolve(pathname)
    if (!abs) { sendJson(res, 403, { error: '非法路径' }); return }

    // 目录请求（/ 或 /archived/）→ 目录里的 index.html
    if (existsSync(abs) && statSync(abs).isDirectory()) abs = join(abs, 'index.html')

    if (existsSync(abs) && statSync(abs).isFile()) { sendFile(req, res, abs); return }

    /**
     * 旧产物自愈通道（2026-10-14 白屏事故）。
     *
     * Service Worker 缓存了**旧版 index.html**，它引用的 `assets/index-<旧 hash>.js`
     * 已被新版本换掉并从磁盘删掉 → 请求 404 → 模块脚本一次都没执行 → `#app` 永远空着。
     * 这时页面**无法自愈**：新 SW 装好了也只是 waiting；提示刷新的代码正躺在那个
     * 没跑起来的模块里。用户只会看到一片白，刷新多少次都一样。
     *
     * 所以这里对「assets 下不存在的 .js」不回 404，而回一段自愈脚本 —— 浏览器会把它
     * 当模块执行，于是注销全部 SW 并重载一次，用户什么都不用做就回到最新版本。
     *
     * 代价：这类请求的 404 变成了 200。范围刻意收在 `/assets/*.js`（带哈希的构建产物，
     * 正常情况下不会有人去请求一个不存在的 chunk），其它路径的 404 语义一字未动。
     * `sessionStorage` 标记保证只重载一次，不会因为某个 chunk 真的缺失而刷成死循环。
     */
    if (/^\/assets\/.*\.js$/i.test(pathname)) {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(SELF_HEAL_JS)
      return
    }

    // SPA 兜底：无扩展名的路径（如 /archived）回壳文件；带扩展名却不存在的是真 404
    if (!extname(pathname)) {
      sendFile(req, res, join(ROOT, 'index.html'))
      return
    }
    sendJson(res, 404, { error: 'File not found' })
  } catch (e) {
    // 单请求异常不能带走整个进程 —— 这是唯一常驻的东西
    try { sendJson(res, 500, { error: String(e?.message || e) }) } catch { /* 连响应都发不出去就算了 */ }
  }
})

/**
 * 进程级兜底：**常驻进程不能因为一次异步异常就整个消失**。
 *
 * 请求路径已经有 try/catch（见上面那句「单请求异常不能带走整个进程」），
 * 但那只覆盖请求内；**定时器与后台任务**里的未捕获异常走的是另一条路 ——
 * 没有这两个监听器时 Node 直接终止进程，站点整体变 503。
 *
 * 部署到常驻容器后实测踩过：平台上报 `botCrashed: true`，而日志只剩启动那几行、
 * 一条错误栈都没有（进程是「消失」而非「报错退出」）。健康巡检按 6 小时一轮、
 * 每轮要真实抓 300 个站，任何一次未被捕获的拒绝都会命中这条路。
 *
 * 这里**只记录、不退出**：本服务是无状态的（静态资源 + 只读站点库 + 巡检写状态文件），
 * 「这轮巡检没跑完」远好于「整站下线」。Node 官方对 uncaughtException 的建议是
 * 「清理后退出」，那是针对持有不一致状态的有状态服务；这里不适用。
 */
process.on('uncaughtException', (e) => {
  console.error('[nav-server] 未捕获异常（进程继续运行）：', e)
})
process.on('unhandledRejection', (e) => {
  console.error('[nav-server] 未处理的 Promise 拒绝（进程继续运行）：', e)
})

/**
 * 启动时应用持久化的插件配置（白名单内的 NAV_* 覆盖）。
 *
 * 放在 listen **之前**：让第一个请求就带正确的引擎配置，而不是「先按默认跑一会儿」。
 * 失败不阻塞启动 —— 读不到配置就按环境变量默认值运行，这比站点起不来好得多。
 */
try {
  await pluginsMod.ensureApplied()
} catch (e) {
  console.error('[nav-server] 应用插件配置失败（按默认配置运行）：', e.message)
}

server.listen(PORT, HOST, () => {
  console.log(`[nav-server] listening on http://${HOST}:${PORT}  root=${ROOT}`)
})

/**
 * 常驻健康巡检（v10）：仅在**进程会长驻**的环境里有效（本地 console）。
 * 发布沙箱实测每个请求一个新进程（`/api/_diag` 的 uptimeSec 恒为 0），
 * 这里的定时器不会触发 —— 线上靠 `tickOnDemand()` 请求驱动分片，见 cron.mjs 注释。
 */
startHealthCron()

/**
 * 三端同步调度器（本地库 ↔ BotKeep ↔ Vercel）。
 *
 * 默认**关闭**：只有 `NAV_SYNC_ENABLED=1` 或状态文件里显式开启时才启动。
 * 线上两端不跑定时器 —— 三个写者互相推没有收益，只会放大冲突；
 * 线上的角色是「被动接收最新内容」。
 *
 * 路径用 ROOT 拼：源码直跑时 ROOT 是仓库根，产物里是 dist，
 * 两种情况都能落到 `shared/tri-sync.mjs`。
 */
try {
  const syncMod = await import(pathToFileURL(join(ROOT, 'shared', 'tri-sync.mjs')).href)
  const s = syncMod.startSchedule()
  if (s.started) console.log(`[nav-server] 三端同步调度器已启动（每 ${s.intervalSec}s）`)
} catch (e) {
  console.error('[nav-server] 三端同步调度器未启动：', e.message)
}
