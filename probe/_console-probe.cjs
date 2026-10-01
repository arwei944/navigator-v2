/* 本地运维控制台 UI 实测：用本机 playwright-core 驱动真实 Chromium，
 * 逐个面板采集渲染结果与控制台报错，产出 JSON 报告。
 * 只读式探查（含一次「全部已读」低风险点击），不触发删除 / 发布 / 清空。
 *
 * 用法: node probe/_console-probe.cjs [url] [outJson]
 */
const fs = require('node:fs')
const path = require('node:path')

const PW = 'C:/work/test/circle/node_modules/.pnpm/playwright-core@1.62.1/node_modules/playwright-core'
const { chromium } = require(PW)

const URL_BASE = process.argv[2] || 'http://127.0.0.1:5175/'
const OUT = process.argv[3] || path.join(__dirname, '_console-probe.json')

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/

const report = { url: URL_BASE, errors: [], panels: {}, clicks: [] }

async function panelText(page, id) {
  return page.evaluate((pid) => {
    const p = document.getElementById(pid)
    if (!p) return null
    return { active: p.classList.contains('active'), text: (p.innerText || '').replace(/\s+\n/g, '\n').trim().slice(0, 1200) }
  }, id)
}

;(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-background-timer-throttling', '--no-sandbox', '--mute-audio'],
  })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.route('**/*', (route) => {
    const u = route.request().url()
    if (LOCAL.test(u) || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:')) return route.continue()
    return route.abort()
  })

  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error') report.errors.push(`console: ${m.text()}`) })
  page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`))
  page.on('requestfailed', (r) => {
    const u = r.url()
    if (LOCAL.test(u)) report.errors.push(`reqfail: ${r.method()} ${u} ${r.failure()?.errorText}`)
  })

  await page.goto(URL_BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(1500)

  report.tabs = await page.$$eval('.tab', els => els.map(e => ({ panel: e.dataset.panel, label: e.innerText.trim() })))
  report.badge = await page.$eval('#notify-badge', e => ({ text: e.textContent, hidden: e.hidden })).catch(() => null)

  /* 通知面板 */
  await page.click('.tab[data-panel="notify"]')
  await page.waitForTimeout(1200)
  report.panels.notify = {
    ...(await panelText(page, 'panel-notify')),
    summary: await page.$eval('#notify-summary', e => e.innerText.trim()).catch(() => null),
    rows: await page.$$eval('#notify-list .notify-row', els => els.map(e => e.innerText.replace(/\n/g, ' | ').trim())).catch(() => []),
    badge: await page.$eval('#notify-badge', e => ({ text: e.textContent, hidden: e.hidden })).catch(() => null),
    kinds: await page.$$eval('#notify-kind option', els => els.map(e => e.innerText)).catch(() => []),
    severities: await page.$$eval('#notify-severity option', els => els.map(e => e.innerText)).catch(() => []),
  }

  /* 一次低风险点击：全部已读 */
  const readAll = await page.$('#btn-notify-readall')
  if (readAll) {
    await readAll.click()
    await page.waitForTimeout(1200)
    report.clicks.push({
      action: '全部已读',
      badgeAfter: await page.$eval('#notify-badge', e => ({ text: e.textContent, hidden: e.hidden })).catch(() => null),
      summaryAfter: await page.$eval('#notify-summary', e => e.innerText.trim()).catch(() => null),
    })
  }

  /* 历史面板 */
  await page.click('.tab[data-panel="history"]')
  await page.waitForTimeout(1200)
  report.panels.history = await panelText(page, 'panel-history')

  /* 同步面板：发布历史 */
  await page.click('.tab[data-panel="sync"]')
  await page.waitForTimeout(1500)
  report.panels.sync = {
    ...(await panelText(page, 'panel-sync')),
    pubhistSummary: await page.$eval('#pubhist-summary', e => e.innerText.trim()).catch(() => null),
    pubhistRows: await page.$$eval('#pubhist-list .audit-row', els => els.map(e => e.innerText.replace(/\n/g, ' | ').trim())).catch(() => []),
    pubhistTriggers: await page.$$eval('#pubhist-trigger option', els => els.map(e => e.innerText)).catch(() => []),
    snapRows: await page.$$eval('#snapshot-list .snap-row', els => els.length).catch(() => 0),
  }

  /* 站点面板 + 批量入口
   * 列表渲染要等 /api/sites/list 与 /api/sync/status 双双返回（后者起 git 子进程，偶发偏慢），
   * 固定 timeout 会采到空列表 —— 改为等首个 .site-row 出现，采到真实行数再继续。 */
  await page.click('.tab[data-panel="sites"]')
  await page.waitForSelector('#site-list .site-row', { timeout: 20000 }).catch(() => {})
  report.panels.sites = {
    ...(await panelText(page, 'panel-sites')),
    rows: await page.$$eval('#site-list .site-row', els => els.length).catch(() => 0),
  }
  await page.click('#btn-sites-select')
  await page.waitForTimeout(600)
  const boxes = await page.$$('#site-list .site-row input[type=checkbox]')
  report.panels.sites.batchCardVisible = await page.$eval('#sites-batch-card', e => !e.hidden).catch(() => null)
  report.panels.sites.batchOps = await page.$$eval('#batch-op option', els => els.map(e => e.innerText)).catch(() => [])
  report.panels.sites.checkboxCount = boxes.length
  if (boxes.length >= 2) {
    await boxes[0].check()
    await boxes[1].check()
    await page.waitForTimeout(400)
    report.panels.sites.batchCount = await page.$eval('#batch-count', e => e.innerText.trim()).catch(() => null)
    const prev = await page.$('#btn-batch-preview')
    if (prev) {
      await prev.click()
      await page.waitForTimeout(2000)
      report.panels.sites.batchPreview = await page.$eval('#batch-preview', e => e.innerText.trim().slice(0, 400)).catch(() => null)
      report.panels.sites.batchResult = await page.$eval('#batch-result', e => e.innerText.trim()).catch(() => null)
    }
    await page.click('#btn-batch-clear').catch(() => {})
    await page.waitForTimeout(400)
    report.panels.sites.batchCountAfterClear = await page.$eval('#batch-count', e => e.innerText.trim()).catch(() => null)
  }

  await page.screenshot({ path: path.join(__dirname, '_console-shot.png'), fullPage: false }).catch(() => {})

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
  console.log('REPORT ->', OUT)
  console.log('tabs:', report.tabs.map(t => t.label).join(' / '))
  console.log('badge:', JSON.stringify(report.badge))
  console.log('notify rows:', report.panels.notify.rows.length, '| summary:', report.panels.notify.summary)
  console.log('notify kinds:', report.panels.notify.kinds.join(','))
  console.log('after readall:', JSON.stringify(report.clicks[0]?.badgeAfter), report.clicks[0]?.summaryAfter)
  console.log('history panel len:', (report.panels.history?.text || '').length)
  console.log('pubhist summary:', report.panels.sync.pubhistSummary)
  console.log('pubhist rows:', report.panels.sync.pubhistRows.length, '| triggers:', report.panels.sync.pubhistTriggers.join(','))
  for (const r of report.panels.sync.pubhistRows) console.log('   ' + r)
  console.log('snap rows:', report.panels.sync.snapRows)
  console.log('sites rows:', report.panels.sites.rows, '| checkboxes:', report.panels.sites.checkboxCount, '| batchOps:', (report.panels.sites.batchOps || []).join('/'))
  console.log('batch card visible:', report.panels.sites.batchCardVisible, '| count:', report.panels.sites.batchCount, '| after clear:', report.panels.sites.batchCountAfterClear)
  console.log('batch preview:', report.panels.sites.batchPreview)
  console.log('batch result:', report.panels.sites.batchResult)
  console.log('errors:', report.errors.length)
  for (const e of report.errors.slice(0, 10)) console.log('  ' + e)

  await browser.close()
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1) })