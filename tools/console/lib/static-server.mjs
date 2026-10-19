/**
 * 极简静态服务：给真机门禁喂构建产物。
 *
 * 为什么不用项目自己的 `dist/server.js`：
 *   - 它要读密钥、连 SQLite、起迁移，测试不该被这些前置条件牵连；
 *   - 它把 ROOT 固定为自身所在目录，没法指向临时产物。
 *
 * 用法：node tools/console/lib/static-server.mjs <root>
 * 端口由系统分配（listen 0），启动后向 stdout 打一行 `static on <port>`。
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'

const ROOT = normalize(process.argv[2] || 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(String(req.url || '/').split('?')[0])
    if (path === '/') path = '/index.html'

    /* 目录穿越防护：规范化后必须仍在 ROOT 之内 */
    let file = normalize(join(ROOT, path))
    if (!file.startsWith(ROOT + sep) && file !== ROOT) {
      res.writeHead(403); res.end('forbidden'); return
    }

    try { await stat(file) } catch { file = join(ROOT, 'index.html') } // SPA 兜底
    const body = await readFile(file)
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    })
    res.end(body)
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(String(e?.message || e))
  }
})

server.listen(0, '127.0.0.1', () => {
  console.log(`static on ${server.address().port} root=${ROOT}`)
})
