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
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const ROOT = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 3000
const HOST = process.env.HOST || '0.0.0.0'

/* ---------------- /api/metadata ---------------- */

const metadataHandler = (await import('./api/metadata.js')).default

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

    /* ---- API：只有 metadata 是真的，其余一律 404 JSON（语义见文件头注释） ---- */
    if (pathname.startsWith('/api/')) {
      if (pathname === '/api/metadata' && req.method === 'GET') {
        // 尊重接口自带的 SSRF 防护：它读 req.headers（UA）与 req.query（url）
        await metadataHandler(
          { headers: req.headers, query: parseQuery(req.url), socket: req.socket },
          withHelpers(res),
        )
        return
      }
      sendJson(res, 404, { error: `接口不存在：${pathname}（本部署只提供 /api/metadata）` })
      return
    }

    /* ---- 静态文件 ---- */
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405
      res.setHeader('Allow', 'GET, HEAD')
      res.end()
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
