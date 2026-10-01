/* 用本机 playwright-core + ms-playwright 的 chromium 驱动探针页。
 * 探针页自身会把报告 POST 给收集器（127.0.0.1:4599），这里额外把页面日志落盘做交叉核对。
 *
 * 两个坑：
 * 1) 应用会对 300+ 个站外域名发起探活，站外请求一律 abort，只放行本机。
 * 2) 无头渲染器跑满 30 个 iframe 会 OOM 崩（Target crashed）；默认改用真实窗口，
 *    并把它挪到屏幕外，既不打扰人也不受后台节流影响。
 *    需要无头时设 HEADLESS=1。 */
const fs = require('node:fs')
const path = require('node:path')

const PW = 'C:/work/test/circle/node_modules/.pnpm/playwright-core@1.62.1/node_modules/playwright-core'
const { chromium } = require(PW)

const URL_BASE = process.argv[2] || 'http://localhost:5173/probe/_measure.html'
const OUT_TXT = process.argv[3] || path.join(__dirname, '_probe-run.txt')
const TIMEOUT = Number(process.argv[4] || 420000)
const HEADLESS = process.env.HEADLESS === '1'

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/

;(async () => {
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=CalculateNativeWinOcclusion',
      '--window-position=-32000,-32000',
      '--window-size=1400,1000',
      '--mute-audio',
      '--js-flags=--max-old-space-size=3072'
    ]
  })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })

  await ctx.route('**/*', (route) => {
    const u = route.request().url()
    if (LOCAL.test(u) || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:')) {
      return route.continue()
    }
    return route.abort()
  })

  const page = await ctx.newPage()
  page.on('crash', () => console.log('[PAGE CRASH]'))
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  browser.on('disconnected', () => console.log('[BROWSER DISCONNECTED]'))

  const url = URL_BASE + (URL_BASE.includes('?') ? '&' : '?') + 't=' + Date.now()
  console.log('GOTO ' + url + '  headless=' + HEADLESS)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })

  // 注意：waitForFunction 的第二个位置参数是 arg，不是 options，必须显式传 null
  await page.waitForFunction(() => {
    const t = document.getElementById('out')?.textContent || ''
    return t.includes('POSTED') || t.includes('POST-SKIP')
  }, null, { timeout: TIMEOUT, polling: 1500 })

  const text = await page.evaluate(() => document.getElementById('out').textContent)
  fs.writeFileSync(OUT_TXT, text, 'utf8')
  const lines = text.split('\n')
  console.log('=== LOG LEN ' + text.length + ' lines=' + lines.length + ' ===')
  console.log(lines.slice(0, 4).join('\n'))
  console.log('  ...')
  console.log(lines.slice(-6).join('\n'))
  const fails = lines.filter((l) => /CASE-FAIL|POST-SKIP|SW-CLEAR-FAIL|SEED-FAIL/.test(l))
  console.log('=== ABNORMAL ' + fails.length + ' ===')
  for (const f of fails) console.log('  ' + f)
  await browser.close()
})().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1) })