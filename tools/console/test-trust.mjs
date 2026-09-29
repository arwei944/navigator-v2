/**
 * nav-console 来源校验用例（零依赖）。
 *
 * 在独立端口拉起真实服务进程，用 node:http 精确控制 Host / Origin / 自定义头，
 * 逐条断言「可信放行、不可信拒绝」。退出码非 0 即门禁失败。
 *
 * 用法: node tools/console/test-trust.mjs
 */
import { spawn } from 'node:child_process'
import { request } from 'node:http'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER = join(HERE, 'server.mjs')
const START_PORT = 5399

function req(port, { method = 'GET', path = '/', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port, method, path, headers }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }))
    })
    r.on('error', reject)
    r.end()
  })
}

/** 拉起服务并返回实际监听端口（端口被占用时服务端会自动 +1） */
function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER, '--port', String(START_PORT)], {
      cwd: join(HERE, '..', '..'),
      windowsHide: true,
    })
    let out = ''
    const timer = setTimeout(() => reject(new Error(`服务启动超时，输出：${out}`)), 15000)
    const onData = chunk => {
      out += String(chunk)
      const m = out.match(/localhost:(\d+)/)
      if (m) {
        clearTimeout(timer)
        resolve({ child, port: Number(m[1]) })
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', code => {
      clearTimeout(timer)
      reject(new Error(`服务提前退出（code ${code}），输出：${out}`))
    })
  })
}

async function waitReady(port) {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await req(port, { path: '/api/health' })
      if (r.status === 200) return
    } catch { /* 尚未监听，继续等 */ }
    await new Promise(r => setTimeout(r, 150))
  }
  throw new Error('服务未在预期时间内就绪')
}

function cases(port) {
  return [
    { name: '本机 Host 读接口放行', opt: { path: '/api/health' }, expect: 200 },
    { name: 'Host=localhost 放行', opt: { path: '/api/health', headers: { Host: `localhost:${port}` } }, expect: 200 },
    { name: 'Host=[::1] IPv6 字面量放行', opt: { path: '/api/health', headers: { Host: `[::1]:${port}` } }, expect: 200 },
    { name: 'Host=evil.com 读接口拒绝（DNS rebinding）', opt: { path: '/api/sites/list', headers: { Host: 'evil.com' } }, expect: 403 },
    { name: 'Host=evil.com 静态资源拒绝', opt: { path: '/ui/core.js', headers: { Host: 'evil.com' } }, expect: 403 },
    { name: '跨站 Origin 读接口拒绝', opt: { path: '/api/sites/list', headers: { Origin: 'https://evil.com' } }, expect: 403 },
    { name: '同源 Origin 读接口放行', opt: { path: '/api/health', headers: { Origin: `http://127.0.0.1:${port}` } }, expect: 200 },
    { name: 'POST 缺 X-Nav-Console 拒绝', opt: { method: 'POST', path: '/api/jobs/selfcheck' }, expect: 403 },
    { name: 'POST 带 X-Nav-Console 放行', opt: { method: 'POST', path: '/api/jobs/selfcheck', headers: { 'X-Nav-Console': '1' } }, expect: 200 },
    { name: '跨站 Origin 即使带自定义头也拒绝', opt: { method: 'POST', path: '/api/jobs/selfcheck', headers: { 'X-Nav-Console': '1', Origin: 'https://evil.com' } }, expect: 403 },
    { name: '伪造 Host 且带自定义头仍拒绝', opt: { method: 'POST', path: '/api/jobs/selfcheck', headers: { 'X-Nav-Console': '1', Host: 'evil.com' } }, expect: 403 },
    { name: '目录穿越尝试被拒', opt: { path: '/ui/%2e%2e/package.json' }, expect: [403, 404] },
    { name: '不存在的接口 404', opt: { path: '/api/nope' }, expect: 404 },
  ]
}

const ok = status => typeof status === 'number'
  ? [status]
  : status

let child = null
try {
  const started = await startServer()
  child = started.child
  const { port } = started
  await waitReady(port)

  let failed = 0
  for (const c of cases(port)) {
    const res = await req(port, c.opt)
    const pass = ok(c.expect).includes(res.status)
    if (!pass) failed += 1
    const mark = pass ? '✅' : '❌'
    console.log(`${mark} ${c.name} → ${res.status}（期望 ${ok(c.expect).join('/')}）`)
  }

  console.log(`\n${failed === 0 ? '全部通过' : `${failed} 条失败`}（端口 ${port}）`)
  child.kill()
  process.exit(failed === 0 ? 0 : 1)
} catch (e) {
  console.error(`❌ 用例执行失败：${e.message}`)
  if (child) child.kill()
  process.exit(1)
}