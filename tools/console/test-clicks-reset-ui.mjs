/**
 * 点击清空按钮的真机验证：登录后台 → 找到按钮 → 点击 → 数据归零。
 *
 * ## 为什么需要这层
 *
 * `test-clicks-reset` 验证的是 API 契约（鉴权、清空、GET 同步为空），
 * 但它**碰不到 UI**：按钮是否渲染、是否绑定对了事件、登录态是否真的带上，
 * 这些都只有真实浏览器能确认。
 *
 * ## 登录态怎么来
 *
 * 用临时口令哈希启动服务，走真实登录流程换 session token。
 * 这条路径顺便验证了「后台按钮不依赖共享密钥」——
 * 而那正是这个按钮存在的理由（线上共享密钥是平台托管的只写 secret）。
 *
 * 运行：node tools/console/test-clicks-reset-ui.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch } from './lib/cdp-driver.mjs'
import { makeWaitFor } from './lib/wait-for.mjs'

const PORT = 5323
const ROOT = process.cwd()
const DIST = join(ROOT, 'dist')
const TEST_PASSWORD = 'test-pass-123'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }

if (!existsSync(join(DIST, 'server.js'))) {
  console.error('\n❌ 缺少 dist/server.js —— 先跑 npm run build')
  process.exit(1)
}

/*
 * 临时数据目录（SQLite 走 NAV_STORE_DIR）+ 临时口令哈希。
 *
 * 口令哈希的路径在 server/main.mjs 里硬编码为 `ROOT/data/`，没有环境变量可覆盖 ——
 * 所以这里临时写进 `dist/data/`，并在 finally 里删掉。
 * 前提是原本没有该文件（有的话说明线上/本地已配登录，不该被测试覆盖）。
 * 若已存在则**跳过**而不是覆盖：多一道保护，避免测试把真实口令哈希冲掉。
 */
const storeDir = await mkdtemp(join(tmpdir(), 'nav-reset-ui-'))
const { hashPassword } = await import('../../shared/auth.mjs')
const HASH_PATH = join(DIST, 'data', 'admin-password-hash.txt')
const hadRealHash = existsSync(HASH_PATH)
if (!hadRealHash) await writeFile(HASH_PATH, hashPassword(TEST_PASSWORD), 'utf8')

const server = spawn(process.execPath, ['server.js'], {
  cwd: DIST,
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NAV_CRON: '0', NAV_STORE_DIR: storeDir },
  stdio: ['ignore', 'pipe', 'pipe'],
})

const ready = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 20000)
  const onData = (b) => { if (String(b).includes('listening on')) { clearTimeout(timer); resolve(true) } }
  server.stdout.on('data', onData)
  server.stderr.on('data', onData)
  server.on('exit', () => { clearTimeout(timer); resolve(false) })
})

const base = `http://127.0.0.1:${PORT}`
let browser = null
try {
  ok(ready, '服务已启动', ready ? '' : `${PORT} 未就绪`)

  if (ready) {
    /* 先用管理密钥造数据（登录流程走另一条，这里不依赖它） */
    const seeded = await fetch(`${base}/api/clicks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clicks: [{ id: 's1', n: 7 }, { id: 's2', n: 3 }] }),
    }).then(r => r.json()).catch(() => null)
    ok(seeded?.total === 10, '准备了 10 次点击数据', `total=${seeded?.total}`)

    browser = await launch({ headless: true, port: 0, url: `${base}/` })
    const c = browser.client
    // 等**应用真正挂载**，而不是 readyState。
    // `document.readyState === 'complete'` 太弱：about:blank 阶段它就已经是
    // complete，此时 `fetch('/api/auth')` 会因上下文切换而抛
    // 「Execution context was destroyed」。判据要落在应用自己的 DOM 上。
    const waitFor = makeWaitFor(c)
    await waitFor(`location.pathname === '/' && !!document.querySelector('#app, .app-layout, [data-site-id]')`)

    /* 真实登录：走 POST /api/auth 换 token，写进 localStorage 的会话槽位 */
    const login = await c.eval(`(async () => {
      const r = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', username: 'admin', password: ${JSON.stringify(TEST_PASSWORD)} }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) return { ok: false, status: r.status, error: j.error || '' }
      localStorage.setItem('nav_admin_token', j.token)
      if (j.expiresAt) localStorage.setItem('nav_admin_token_exp', String(j.expiresAt))
      return { ok: true }
    })()`)
    ok(login?.ok, '后台登录成功（口令换会话 token）', JSON.stringify(login))

    /* 打开后台洞察页 */
    // 用 goto 而不是 pushState：首屏未渲染完时 pushState 只改 URL，
    // Vue 路由不会重新解析（详见 test-domain-flow 里同一条注释）。
    await c.goto(`${base}/admin`, { settle: 600 })
    // 等按钮真的出现（后台页是懒加载的，2 秒在并发下不够）
    await waitFor(`[...document.querySelectorAll('button')].some(x => /清空统计|清空中/.test(x.textContent || ''))`)

    const btn = await c.eval(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => /清空统计|清空中/.test(x.textContent || ''))
      if (!b) return { found: false, buttons: [...document.querySelectorAll('button')].slice(0,8).map(x => (x.textContent||'').trim().slice(0,12)) }
      return { found: true, text: b.textContent.trim(), disabled: b.disabled }
    })()`)
    ok(btn?.found, '后台洞察页出现「清空统计」按钮', btn?.found ? btn.text : JSON.stringify(btn?.buttons || []))

    if (btn?.found) {
      /* 点击前自动确认对话框（window.confirm 在无头环境会挂起，先覆盖掉） */
      await c.eval(`window.__confirmCalls = []; window.confirm = (msg) => { window.__confirmCalls.push(msg); return true }`)

      await c.eval(`(() => {
        const b = [...document.querySelectorAll('button')].find(x => /清空统计|清空中/.test(x.textContent || ''))
        if (b) b.click()
        return true
      })()`)
      await c.sleep(2500)

      const confirmMsg = await c.eval(`(window.__confirmCalls || [])[0] || ''`)
      ok(/不可撤销/.test(String(confirmMsg)), '点击后弹出二次确认（明确提示不可撤销）', String(confirmMsg).slice(0, 60))

      /* 服务端应已归零 */
      const after = await fetch(`${base}/api/clicks`).then(r => r.json()).catch(() => null)
      ok(after?.total === 0, '点击后服务端统计归零', `total=${after?.total}`)
    }
  }
} finally {
  if (browser) await browser.close().catch(() => {})
  server.kill()
  await rm(storeDir, { recursive: true, force: true }).catch(() => {})
  // 只删自己创建的那个；原本存在的（真实口令哈希）绝不碰
  if (!hadRealHash) { try { await unlink(HASH_PATH) } catch { /* 已不存在 */ } }
}

console.log(`\n🖱️  清空按钮真机：${pass} 通过 / ${failures.length} 失败`)
if (failures.length) {
  console.log('\n失败明细：')
  for (const f of failures) console.log(`- ${f}`)
  process.exit(1)
}
console.log('  ✓ 登录态可见按钮｜二次确认提示不可撤销｜点击后统计归零')
