/**
 * 复刻「无 SPA 兜底」的静态宿主（等价 `python -m http.server`，但用 node 起）。
 *
 * 为什么要这个而不是 `vite preview`：preview 自带 SPA 兜底，会把「子页面直达 /
 * 刷新 404」这个问题**掩盖掉** —— 而那正是宿主的真实行为。
 * 行为对齐：目录发 301 到带斜杠的路径、文件按扩展名给 Content-Type、
 * 找不到就回纯文本 404（与 Python 的错误页同形）。
 *
 * 用法：node probe/static-server.mjs [port] [rootDir]
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize, resolve } from 'node:path'

const PORT = Number(process.argv[2] || 4174)
const ROOT = resolve(process.argv[3] || 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
}

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    const full = join(ROOT, normalize(p))
    if (!full.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return }
    const st = await stat(full)
    if (st.isDirectory()) {
      // 宿主行为（对齐 python -m http.server）：不带斜杠 → 301 补斜杠；
      // 带斜杠 → 直接找 index.html，**不能**再 301 回自身（那会死循环，
      // Chrome 放弃重定向后停在 about:blank，表现为「直达渲染出首页」）。
      if (!p.endsWith('/')) {
        res.writeHead(301, { Location: p + '/' })
        res.end()
        return
      }
      const idx = join(full, 'index.html')
      try {
        const buf = await readFile(idx)
        res.writeHead(200, { 'Content-Type': MIME['.html'] })
        res.end(buf)
        return
      } catch { /* 无 index.html → 与宿主一致回 404 */ }
    }
    if (p.endsWith('/')) { res.writeHead(404).end('File not found.'); return }
    const buf = await readFile(full)
    res.writeHead(200, { 'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream' })
    res.end(buf)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Error code: 404.\nMessage: File not found.')
  }
}).listen(PORT, '127.0.0.1', () => console.log(`static server → http://127.0.0.1:${PORT} (root=${ROOT})`))
