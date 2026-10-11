/**
 * 静态资源 + `/api/metadata` 的**零依赖**单文件服务。
 *
 * ## 为什么会有这个文件
 *
 * 站点从 Vercel 迁到纯静态托管后，`/api/metadata`（自动补全的抓取接口）跟着消失了 ——
 * 自动补全退化成「按域名猜」。但排查依赖链后发现：**这个接口根本不依赖 Vercel**
 * （`api/metadata.js` 只用 Node 内置模块 + `shared/` 下的纯函数，连 npm 包都没有），
 * 真正绑死 Vercel 的只有云同步那几个 Blob 接口。
 *
 * 所以把部署形态从「纯静态」升级成「Node 服务」：静态文件照发，
 * 同时带上这一个接口，自动补全恢复到与 Vercel 时代**同一份引擎、同一套 SSRF 防护**的真实抓取。
 * 构建后置脚本会把 `api/metadata.js`、`api/sites-data.json`、`shared/*.mjs` 一并复制进部署目录。
 *
 * ## 适配层为什么这么薄
 *
 * `api/metadata.js` 用的是 Vercel 函数签名 `(req, res)`，但实际只碰到
 * `req.headers / req.query / req.socket` 与 `res.setHeader / res.status(...).json(...)`。
 * 在原生 ServerResponse 上补上 `status()` 和 `json()` 两个方法即可，**不改接口源码** ——
 * 改源码会让 `tools/console/test-guard.mjs` / `test-netguard.mjs` 这两套 SSRF 用例的
 * 保护范围失效，那才是真正的安全风险。
 *
 * ## 路由约定（前端 `stores/sites.js` 依赖这些语义）
 *
 * - `/api/metadata` → 真实抓取
 * - 其余 `/api/*` → **404 JSON**（绝不能回 index.html：前端靠「404」判定
 *   「该部署没有这个接口」并停止轮询，回了 HTML 会被当成响应体异常）
 * - 其余路径 → 静态文件；无扩展名且文件不存在时回 index.html（SPA 兜底，
 *   让「在子页面按刷新」不至于 404 —— 与构建时生成的 `<route>/index.html` 双保险）
 */
import http from 'node:http'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const ROOT = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 3000
const HOST = process.env.HOST || '0.0.0.0'

/**
 * 管理密钥回填：发布沙箱没有环境变量注入，构建脚本会把共享密钥写进 `data/admin-key.txt`
 * （不入 git；静态服务对 `/data/*` 一律拒绝）。启动时读回 process.env —— shared/auth.mjs
 * 在调用时才读环境变量，所以这里补上即可，鉴权源码零改动。
 */
if (!process.env.SITES_ADMIN_KEY) {
  try { process.env.SITES_ADMIN_KEY = readFileSync(join(ROOT, 'data', 'admin-key.txt'), 'utf8').trim() } catch { /* 没有就没有：写接口按未配置拒绝 */ }
}

/* ---------------- /api/* 处理器 ---------------- */

const metadataHandler = (await import('./api/metadata.js')).default
const sitesHandler = (await import('./api/sites.js')).default
const sessionHandler = (await import('./api/session.js')).default
const { etagOf } = await import('./store.mjs')

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
     * sites/session 是 v9 数据回归的主路径（SQLite 适配层）；
     * metadata 是自动补全的真实抓取；其余 /api/* 一律 404 JSON ——
     * 前端靠「404」判定「这个部署没有该接口」（CLOUD_FATAL 停轮询），
     * 绝不能回 index.html 把语义搅浑。 */
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
        })
        return
      }

      if (pathname === '/api/metadata' && req.method === 'GET') {
        // 尊重接口自带的 SSRF 防护：它读 req.headers（UA）与 req.query（url）
        await metadataHandler(
          { headers: req.headers, query: parseQuery(req.url), socket: req.socket },
          withHelpers(res),
        )
        return
      }

      if (pathname === '/api/sites') {
        // 条件请求：store 里 sites.json 的 etag 就是响应 ETag（Blob 时代由平台自动加，
        // 自建后自己补 —— 客户端 30s 轮询靠它拿到 304 零字节）。数据没变时直接 304，
        // 不进 handler，省掉一次全量读 + 序列化。
        if (req.method === 'GET') {
          const etag = etagOf('sites.json')
          const inm = String(req.headers['if-none-match'] || '').trim()
          if (etag && inm && inm === etag) { res.statusCode = 304; res.end(); return }
          if (etag) res.setHeader('ETag', etag)
        }
        await attachBody(req)
        await sitesHandler(
          { headers: req.headers, query: parseQuery(req.url), socket: req.socket, method: req.method, body: req.body },
          withHelpers(res),
        )
        return
      }

      if (pathname === '/api/session') {
        await attachBody(req)
        await sessionHandler(
          { headers: req.headers, query: parseQuery(req.url), socket: req.socket, method: req.method, body: req.body },
          withHelpers(res),
        )
        return
      }

      sendJson(res, 404, { error: `接口不存在：${pathname}（本部署提供 /api/sites、/api/session、/api/metadata）` })
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

server.listen(PORT, HOST, () => {
  console.log(`[nav-server] listening on http://${HOST}:${PORT}  root=${ROOT}`)
})
