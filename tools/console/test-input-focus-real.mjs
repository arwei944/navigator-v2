#!/usr/bin/env node
/**
 * test-input-focus-real —— 真机按键守卫：搜索框逐字符输入不得失焦。
 *
 * ## 为什么静态检查不够
 *
 * 2026-10 出现过一个只有真机能抓到的缺陷：`commandScore(c, q)` 漏传评分上下文，
 * `commandResults` 在 render 期间抛 `Cannot destructure property 'matchAny' of 'undefined'`，
 * Vue 把搜索框整棵子树卸掉重挂 → 输入框失焦 → 用户输入 `github` 只有 `g` 进得去。
 *
 * 构建全绿、静态门禁全绿、Vue SSR 门禁全绿 —— 因为**异常只在那条 computed 真正被求值时**发生，
 * 而它的触发条件是「用户真的敲了一个字符」。所以这一条必须用真实浏览器、真实键盘事件。
 *
 * ## 为什么用 CDP 而不是 Playwright
 *
 * 项目零额外依赖；而这里只需要三件事：启动 Chrome、发真实按键、读 DOM。
 * `Input.dispatchKeyEvent` 是浏览器进程级输入，会走完整
 * keydown → beforeinput → input → keyup 链路并真实移动焦点 —— 用 JS 派发 input 事件
 * 是抓不到「组件被卸载导致失焦」的（派发事件不会让焦点丢失）。
 *
 * ## 前置条件
 *
 * 需要一个已经构建好的站点。门禁自己起服务（端口 0 由系统分配），不依赖外部进程：
 *   - 构建产物缺失 → 直接失败并提示先 `npm run build`（不静默跳过）
 *   - 找不到 Chrome/Edge → 明确失败，不伪装通过
 *
 * 运行：node tools/console/test-input-focus-real.mjs
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { launch } from './lib/cdp-driver.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DIST_INDEX = join(ROOT, 'dist', 'index.html')

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) pass++
  else failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}

if (!existsSync(DIST_INDEX)) {
  console.log('\n⌨️  真机输入守卫：缺少构建产物')
  console.log('   ❌ dist/index.html 不存在 —— 先跑 npm run build，本门禁不做静默跳过')
  process.exit(1)
}

/* 用 dist 起一个最小静态服务：只服务构建产物。
   不依赖开发服务器 —— vite dev 不提供 /api/*，首屏会退化到兜底数据，
   而这条门禁要验证的正是「真实数据下输入首字符会不会炸」。 */
const server = spawn(process.execPath, [join(ROOT, 'tools/console/lib/static-server.mjs'), join(ROOT, 'dist')], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
})
const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('静态服务启动超时')), 15000)
  server.stdout.on('data', b => {
    const m = String(b).match(/static on (\d+)/)
    if (m) { clearTimeout(timer); resolve(Number(m[1])) }
  })
  server.on('error', reject)
})
const base = `http://127.0.0.1:${port}/`

let browser
try {
  browser = await launch({ headless: true, port: 9800 + Math.floor(Math.random() * 100), url: 'about:blank' })
  const c = browser.client
  await c.goto(base, { settle: 2500 })

  const hasInput = await c.eval(`Boolean(document.querySelector('.unified-search-input'))`)
  ok(hasInput, '首屏渲染出全能搜索框')
  if (!hasInput) throw new Error('搜索框未渲染，无法继续')

  /* 记录 render 期间的异常：这才是「输入即失焦」的直接证据 */
  await c.eval(`(() => {
    window.__gateErr = [];
    const oe = console.error;
    console.error = (...a) => { window.__gateErr.push(a.map(String).join(' ').slice(0, 300)); oe.apply(console, a) };
    window.addEventListener('error', e => window.__gateErr.push('ERROR: ' + e.message));
    return true;
  })()`)

  await c.focus('.unified-search-input')
  ok((await c.activeSelector()).includes('unified-search-input'), '搜索框可获得焦点')

  /* 逐字符输入，每一步都验证「值在长、焦点没跑」 */
  const WORD = 'github'
  let lostAt = null
  for (let i = 0; i < WORD.length; i++) {
    await c.type(WORD[i], { delay: 0 })
    await c.sleep(90)
    const st = await c.eval(`(() => {
      const el = document.querySelector('.unified-search-input');
      return { val: el ? el.value : null, focused: document.activeElement === el };
    })()`)
    if (!st.focused || st.val !== WORD.slice(0, i + 1)) { lostAt = { i: i + 1, ch: WORD[i], ...st }; break }
  }
  ok(!lostAt, '逐字符输入全程保持焦点', lostAt ? `第 ${lostAt.i} 个字符「${lostAt.ch}」后失焦，输入值=${lostAt.val}` : '')

  const errs = await c.eval('window.__gateErr')
  ok(Array.isArray(errs) && errs.length === 0, '输入过程中无 render 异常', (errs || []).slice(0, 2).join(' | '))

  /* 输入必须真的驱动检索：URL 同步 + 结果收敛 */
  await c.sleep(500)
  const search = await c.eval('location.search')
  ok(search.includes('q=github'), '输入同步到 URL（q=github）', search)
  const cards = await c.eval(`document.querySelectorAll('.site-card').length`)
  ok(cards >= 0 && cards < 300, '结果从 300 条收敛', `当前 ${cards} 条`)

  /* 下拉要能展开：这是「首字符即失焦」事故里最先崩掉的那一块 */
  const suggestions = await c.eval(`Boolean(document.querySelector('.search-suggestions'))`)
  ok(suggestions, '输入后全能下拉正常展开')

  /* 清空后焦点与建议都应复位，防止修复把「永久聚焦」写死 */
  const input2 = await c.eval(`(() => {
    const el = document.querySelector('.unified-search-input');
    if (!el) return null;
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
    return true;
  })()`)
  await c.sleep(400)
  ok(input2 === true, '清空搜索词后输入框仍可用')
  ok(await c.eval(`!document.querySelector('.search-suggestions')`), '空输入不展开下拉')
} catch (e) {
  failures.push('执行异常：' + (e?.message || e))
} finally {
  if (browser) await browser.close()
  try { server.kill('SIGKILL') } catch { /* 忽略 */ }
}

console.log(`\n⌨️  真机输入守卫：${pass} 通过 / ${failures.length} 失败`)
if (failures.length) {
  for (const f of failures) console.log(`   ❌ ${f}`)
  process.exit(1)
}
console.log('   ✅ 逐字符输入保持焦点 / 无 render 异常 / URL 同步 / 下拉展开')
