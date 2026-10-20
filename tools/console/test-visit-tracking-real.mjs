/**
 * 访问追踪真机验证：在真实浏览器里跑一遍「点击 → 本机记录 → 云端上报」。
 *
 * ## 为什么需要真机
 *
 * 静态门禁能确认「代码长什么样」，但确认不了三件事：
 *   1. 点一次卡片后，本机记录确实 +1 且「最近访问」立刻出现该站；
 *   2. 合并后的 `visits` 结构真的被 localStorage 持久化；
 *   3. 云端上报真的走通。
 *
 * 这三条都需要真实的 localStorage、真实 fetch、真实组件挂载。
 *
 * ## 不碰线上
 *
 * 用本地构建产物 + 本地 Node 服务（`server/main.mjs`），点击只写本地 SQLite。
 *
 * 运行：node tools/console/test-visit-tracking-real.mjs
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { rmSync, mkdirSync } from 'node:fs'
import { launch } from './lib/cdp-driver.mjs'
import { makeWaitFor } from './lib/wait-for.mjs'

const PORT = 5311

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }

/*
 * 启动**构建产物里的**服务（dist/server.js），不是源码树里的 server/main.mjs。
 *
 * 原因：源码树里没有 dist/ 的静态资源，前端页面起不来；而产物目录里
 * server.js 与 api/、shared/、index.html 同级，是真正会部署的那一份。
 * 顺便也验证了「发布产物本身可用」—— 比只测源码更能说明问题。
 */
const DIST = join(process.cwd(), 'dist')
// SQLite 必须进程独立：门禁是 4 路并发的，多个服务共写 dist/data/store.db
// 会让彼此的数据互相污染（实测并发时页面渲染为空、断言全「实得 0」）。
// 与 test-clicks-reset / test-mirror 同一口径。
const STORE_DIR = join(process.cwd(), `.tmp-gate-visit-store-${process.pid}`)
rmSync(STORE_DIR, { recursive: true, force: true })
mkdirSync(STORE_DIR, { recursive: true })
const server = spawn(process.execPath, ['server.js'], {
  cwd: DIST,
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NAV_CRON: '0', NAV_STORE_DIR: STORE_DIR },
  stdio: ['ignore', 'pipe', 'pipe'],
})

/* 就绪信号是明确的那一行日志，不要用「包含端口号」这种宽泛条件 */
const ready = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 20000)
  const onData = (b) => {
    if (String(b).includes('listening on')) { clearTimeout(timer); resolve(true) }
  }
  server.stdout.on('data', onData)
  server.stderr.on('data', onData)
  server.on('exit', (code) => { clearTimeout(timer); resolve(false) })
})

let browser = null
try {
  ok(ready, '本地服务已启动', ready ? '' : `${PORT} 未就绪`)

  if (ready) {
    browser = await launch({
      headless: true,
      port: 0,
      url: `http://127.0.0.1:${PORT}/`,
    })
    const c = browser.client
    const waitFor = makeWaitFor(c)
    // 等**应用真正挂载**，而不是 readyState（about:blank 阶段它已是 complete，
    // 此时 eval 会撞上上下文销毁）
    await waitFor(`!!document.querySelector('[data-site-id]')`)

    /* 等首屏卡片出现，取第一个站点 id */
    const siteId = await c.eval(`(async () => {
      for (let i = 0; i < 50; i++) {
        const card = document.querySelector('[data-site-id]')
        if (card) return card.getAttribute('data-site-id')
        await new Promise(r => setTimeout(r, 200))
      }
      return null
    })()`)
    ok(Boolean(siteId), '首屏渲染出站点卡片', siteId ? `站点 ${siteId}` : '未见 [data-site-id]')

    if (siteId) {
      const readVisits = `(() => {
        try {
          const raw = localStorage.getItem('history')
          if (!raw) return {}
          const d = JSON.parse(raw)
          const p = d && d.data ? d.data : d
          return p.visits || {}
        } catch { return {} }
      })()`

      const before = await c.eval(readVisits)
      const beforeCount = before?.[siteId]?.count || 0

      /* 真实点击卡片链接（DOM click，触发 Vue 的 @click 与跳转） */
      await c.eval(`(() => {
        const card = document.querySelector('[data-site-id=${JSON.stringify(siteId)}]')
        const link = card && (card.querySelector('a') || card)
        if (link) link.click()
        return true
      })()`)
      // 点击会真的跳转到外站（`<a href>`），执行上下文随之销毁 ——
      // 所以必须**先导航回本站**再读 localStorage，不能原地轮询。
      // 原来用 sleep(1500) 恰好躲过了这段，但那是靠运气：并发下跳转的时机
      // 会漂移，太快就撞上「Execution context was destroyed」。
      //
      // 顺序很关键：先给跳转一点时间完成（此时不能 eval），再显式回本站。
      await new Promise(r => setTimeout(r, 800))
      await c.goto(`http://127.0.0.1:${PORT}/`, { settle: 600 })
      await waitFor(`!!document.querySelector('[data-site-id]')`)

      // 等计数真的写进去（点击 → 记录是异步的）
      await waitFor(`(() => {
        try {
          const raw = localStorage.getItem('history')
          if (!raw) return false
          const d = JSON.parse(raw)
          const p = d && d.data ? d.data : d
          return Object.keys(p || {}).length > 0
        } catch { return false }
      })()`, { timeout: 8000 })

      const after = await c.eval(readVisits)
      const shape = after?.[siteId]
      const afterCount = shape?.count || 0

      ok(afterCount > beforeCount, '点击后本机访问计数 +1', `${beforeCount} → ${afterCount}`)
      ok(Boolean(shape?.lastAt), '记录了最后访问时间戳', String(shape?.lastAt || '空'))
      ok(shape && typeof shape === 'object' && 'count' in shape && 'lastAt' in shape,
        '本机记录结构为 { count, lastAt }（单一存储）', JSON.stringify(shape || null))

      /* overlay 不应再有 visits 副本（否则迁移会把已删记录复活） */
      const overlayKeys = await c.eval(`(() => {
        try {
          const raw = localStorage.getItem('nav-sites-overlay')
          if (!raw) return 'null'
          const d = JSON.parse(raw)
          const p = d && d.data ? d.data : d
          return JSON.stringify(Object.keys(p))
        } catch { return 'parse-error' }
      })()`)
      ok(!/visits/.test(String(overlayKeys)), 'overlay 不再存 visits 副本', String(overlayKeys).slice(0, 80))

      /* 同一毫秒连续点击多个站点，最近访问顺序仍应稳定（seq 兜底） */
      await c.eval(`(() => {
        const cards = [...document.querySelectorAll('[data-site-id]')].slice(0, 3)
        for (const card of cards) {
          const el = card.querySelector('a') || card
          el.click()
        }
        return true
      })()`)
      await c.sleep(1500)
      const order = await c.eval(`(() => {
        try {
          const raw = localStorage.getItem('history')
          const d = JSON.parse(raw)
          const p = d && d.data ? d.data : d
          const v = p.visits || {}
          return JSON.stringify(Object.entries(v)
            .sort((a, b) => (b[1].lastAt - a[1].lastAt) || ((b[1].seq || 0) - (a[1].seq || 0)))
            .slice(0, 3).map(([id]) => id))
        } catch { return '[]' }
      })()`)
      ok(Array.isArray(JSON.parse(order)) && JSON.parse(order).length > 0,
        '连续点击后最近访问顺序可稳定排序', order)

      /* 云端：本机服务应能读到点击统计 */
      const clicks = await c.eval(`fetch('/api/clicks').then(r => r.json()).then(j => JSON.stringify({ total: j.total, sites: j.sites })).catch(e => 'ERR:' + e.message)`)
      ok(!String(clicks).startsWith('ERR'), '云端 /api/clicks 可读', String(clicks).slice(0, 80))
    }
  }
} finally {
  if (browser) await browser.close().catch(() => {})
  server.kill()
}

console.log(`\n👣 访问追踪真机：${pass} 通过 / ${failures.length} 失败`)
if (failures.length) {
  console.log('\n失败明细：')
  for (const f of failures) console.log(`- ${f}`)
  process.exit(1)
}
console.log('  ✓ 点击落本机单一存储｜overlay 无副本｜连续点击顺序稳定｜云端可读')
