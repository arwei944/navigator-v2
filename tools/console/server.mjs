/**
 * nav-console — 本地运维控制台
 *
 * 仅监听 127.0.0.1，绝不可部署。零框架依赖（node:http）。
 * 用法: node tools/console/server.mjs [--port 5175]
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, normalize, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { ROOT, loadEnv } from './lib/env.mjs'
import { handleApi, sendJson } from './lib/api.mjs'
import * as jobs from './lib/jobs.mjs'

loadEnv()

const args = parseArgs({
  args: process.argv.slice(2),
  options: { port: { type: 'string', short: 'p' } },
  allowPositionals: false,
})
const START_PORT = Number(args.values.port) || 5175
const UI_DIR = join(ROOT, 'tools', 'console', 'ui')
const ICON_DIR = join(ROOT, 'public', 'icons')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
}

/** 静态文件服务：解析后的路径必须仍在该目录内，防目录穿越 */
async function serveFrom(res, baseDir, rel) {
  const target = normalize(join(baseDir, rel))
  if (!target.startsWith(baseDir + sep) && target !== baseDir) {
    sendJson(res, 403, { error: 'Forbidden' })
    return
  }
  try {
    const data = await readFile(target)
    res.writeHead(200, {
      'Content-Type': MIME[extname(target)] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
    })
    res.end(data)
  } catch {
    sendJson(res, 404, { error: 'Not found' })
  }
}

function openSse(req, res, job) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.write(': connected\n\n')

  const unsubscribe = jobs.subscribe(job, res)
  // 心跳：防止空闲连接被中间层掐断
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n') } catch { /* 交给 close 处理 */ }
  }, 15000)

  req.on('close', () => {
    clearInterval(heartbeat)
    unsubscribe()
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const path = url.pathname

  try {
    if (req.method === 'GET' && path === '/') {
      await serveFrom(res, UI_DIR, 'index.html')
      return
    }

    if (req.method === 'GET' && path.startsWith('/ui/')) {
      await serveFrom(res, UI_DIR, path.replace(/^\/ui\//, ''))
      return
    }

    // 站点图标：直接复用仓库 public/icons，使面板内可预览本地图标
    if (req.method === 'GET' && path.startsWith('/icons/')) {
      await serveFrom(res, ICON_DIR, path.replace(/^\/icons\//, ''))
      return
    }

    if (req.method === 'GET' && path === '/api/events') {
      const job = jobs.getJob(url.searchParams.get('job') || '')
      if (!job) { sendJson(res, 404, { error: 'Job not found' }); return }
      openSse(req, res, job)
      return
    }

    if (await handleApi(req, res, path, url)) return

    sendJson(res, 404, { error: 'Not found' })
  } catch (e) {
    sendJson(res, 500, { error: e.message })
  }
})

let port = START_PORT
server.on('error', err => {
  if (err.code === 'EADDRINUSE' && port < START_PORT + 10) {
    port += 1
    server.listen(port, '127.0.0.1')
  } else {
    console.error('❌ 控制台启动失败:', err.message)
    process.exit(1)
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`\n  nav-console 已启动  →  http://localhost:${port}\n`)
  console.log(`  项目根目录: ${ROOT}`)
  console.log('  仅监听 127.0.0.1，Ctrl+C 退出\n')
})