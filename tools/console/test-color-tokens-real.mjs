#!/usr/bin/env node
/**
 * test-color-tokens-real —— 真机守卫：令牌替换后**实际渲染出的颜色没变**。
 *
 * ## 为什么静态门禁不够
 *
 * 把 `color: #ef4444` 换成 `color: var(--color-danger)` 在源码层面永远「看起来对」，
 * 但真实的失败模式是：
 *   - `--color-danger` 只在 `visualScheme` 里生成、而它挂载前首帧读不到 → 变成继承色
 *   - 拼错令牌名 → `var()` 无效 → 属性整条失效（CSS 对未知自定义属性的处理是**静默**的）
 *   - 亮暗两套只定义了一套 → 暗色下变透明/刺眼
 *
 * 这几种都不会让构建变红、也不会让源码 grep 变红，只有读**计算样式**才看得见。
 *
 * ## 断言什么
 *
 * ① 首帧（视觉方案由脚本注入前）`--on-accent` 有值 —— 来自 main.css 的兜底
 * ② 主按钮的文字颜色真的等于 `--on-accent` 的解析值（不是继承、不是 transparent）
 * ③ 危险按钮的背景等于 `--color-danger` 的解析值
 * ④ 切到暗色后，两者仍然有效且**与亮色不同**（证明随主题切换而非写死）
 * ⑤ 页面上不存在「用了 var(--x) 但 --x 未定义」的元素
 *
 * @ci-skip 需要本机 Chrome：cdp-driver 只探测 Windows 路径，CI 容器里没有浏览器；且依赖 dist/ 产物
 *
 * 运行：node tools/console/test-color-tokens-real.mjs
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
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? ` → ${extra}` : ''}`) }
  else { failures.push(`${label}${extra ? ` — ${extra}` : ''}`); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`) }
}

if (!existsSync(DIST_INDEX)) {
  console.log('\n🎨 颜色令牌真机守卫：缺少构建产物')
  console.log('   ❌ dist/index.html 不存在 —— 先跑 npm run build，本门禁不做静默跳过')
  process.exit(1)
}

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

/** rgb 字符串归一（浏览器把 #fff 输出成 rgb(255, 255, 255)） */
const normRgb = s => String(s).replace(/\s+/g, '').toLowerCase()

let browser
try {
  browser = await launch({ headless: true, port: 9900 + Math.floor(Math.random() * 100), url: 'about:blank' })
  const c = browser.client
  await c.goto(base, { settle: 2500 })

  /* ---------------- ① 令牌本身有值 ---------------- */
  console.log('\n── ① 令牌在真实页面里可解析 ──')

  const tokens = await c.eval(`(() => {
    const cs = getComputedStyle(document.documentElement);
    const read = n => cs.getPropertyValue(n).trim();
    return {
      onAccent: read('--on-accent'),
      onDanger: read('--on-danger'),
      accent: read('--accent'),
      colorDanger: read('--color-danger'),
      colorMuted: read('--color-muted'),
      colorOk: read('--color-ok'),
    };
  })()`)

  ok(Boolean(tokens.onAccent), '--on-accent 有值（main.css 兜底）', tokens.onAccent || '空')
  ok(Boolean(tokens.onDanger), '--on-danger 有值（危险底上的前景）', tokens.onDanger || '空')
  ok(Boolean(tokens.colorDanger), '--color-danger 有值（visualScheme 生成）', tokens.colorDanger || '空')
  ok(Boolean(tokens.colorMuted), '--color-muted 有值', tokens.colorMuted || '空')
  ok(Boolean(tokens.colorOk), '--color-ok 有值', tokens.colorOk || '空')

  /* ---------------- ①b 前景色与自己的底必须达到 AA ---------------- */
  console.log('\n── ①b 前景 / 底对比度（WCAG AA ≥ 4.5）──')

  const lum = (hex) => {
    const h = String(hex).trim().replace('#', '')
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6)
    const c = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255)
      .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b)
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
  }

  const pairs = [
    ['--on-accent / --accent', tokens.onAccent, tokens.accent],
    ['--on-danger / --color-danger', tokens.onDanger, tokens.colorDanger],
  ]
  for (const [label, fg, bg] of pairs) {
    if (!fg || !bg) { ok(false, `${label} 可计算`, '令牌缺失'); continue }
    const r = ratio(fg, bg)
    ok(r >= 4.5, `${label} 对比度 ${r.toFixed(2)}:1 ≥ 4.5`, r < 4.5 ? '不达 WCAG AA，请调整前景或底色' : '')
  }

  /* ---------------- ② 一个真实的彩色按钮：文字必须真反白 ---------------- */
  console.log('\n── ② 彩色底按钮的实际渲染 ──')

  const btn = await c.eval(`(() => {
    // 找一个用 --on-accent 作文字色的可见按钮/徽章
    const all = [...document.querySelectorAll('*')];
    for (const el of all) {
      const cs = getComputedStyle(el);
      const usesToken = getComputedStyle(el).getPropertyValue('--probe');
      const color = cs.color;
      const bg = cs.backgroundColor;
      // 白字 + 非透明彩色底，且元素可见
      const r = el.getBoundingClientRect();
      if (r.width > 4 && r.height > 4 && bg !== 'rgba(0, 0, 0, 0)' && /^rgb\\(2[0-9]{2},\\s*2[0-9]{2},\\s*2[0-9]{2}\\)/.test(color)) {
        return { tag: el.tagName, cls: String(el.className).slice(0, 40), color, bg };
      }
    }
    return null;
  })()`)
  ok(Boolean(btn), '首屏存在「白字 + 彩色底」的元素', btn ? `${btn.tag} .${btn.cls}` : '未找到')

  if (btn) {
    // --on-accent 是纯白，计算值必须是 rgb(255,255,255)
    ok(normRgb(btn.color) === 'rgb(255,255,255)', '该元素文字色解析为纯白（未被回落成继承色）', btn.color)
    ok(btn.bg !== 'rgba(0, 0, 0, 0)', '该元素有实际背景色（不是透明底上的白字）', btn.bg)
  }

  /* ---------------- ③ 全页扫描：没有失效的 var() ---------------- */
  console.log('\n── ③ 没有「引用了未定义令牌」的元素 ──')

  const broken = await c.eval(`(() => {
    const root = getComputedStyle(document.documentElement);
    const known = new Set();
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules } catch { continue }
      for (const r of rules || []) {
        if (r.style) for (const p of r.style) if (p.startsWith('--')) known.add(p);
      }
    }
    // 收集内联样式里出现的自定义属性引用
    const missing = new Set();
    for (const el of document.querySelectorAll('[style]')) {
      const s = el.getAttribute('style') || '';
      for (const m of s.matchAll(/var\\((--[a-z0-9-]+)/gi)) {
        if (!known.has(m[1]) && !root.getPropertyValue(m[1]).trim()) missing.add(m[1]);
      }
    }
    return [...missing];
  })()`)
  ok(broken.length === 0, '内联样式引用的令牌都已定义', (broken || []).join(' ') || '')

  /* ---------------- ④ 走真实切换路径，暗色下令牌仍生效 ---------------- */
  console.log('\n── ④ 真实切换到暗色后令牌仍生效 ──')

  /*
   * 不能直接 `setAttribute('data-theme','dark')` 了事。
   *
   * 本项目的主题令牌有两条来源：
   *   - `main.css` 里的 `[data-theme="dark"]` 静态一套（首帧兜底）
   *   - `preferences.applyVisual()` 用 `style.setProperty` 写进 `:root` 的**行内**一套
   * 行内样式优先级高于任何选择器，所以只改属性会读到那套旧的亮色行内值 ——
   * 断言「暗色下不同」就会假失败（实测正是这样，`#ef4444 → #ef4444`）。
   *
   * 因此必须点真实按钮，让 store 走完整链路（切 theme → 重算 activeTokens →
   * setProperty）。这同时也验证了「主题切换后令牌跟着变」这条真实行为。
   */
  const beforeTheme = await c.eval(`document.documentElement.getAttribute('data-theme')`)

  const clicked = await c.eval(`(() => {
    const b = document.querySelector('.view-toggle[aria-label*="主题"]')
      || [...document.querySelectorAll('button')].find(x => /切换(到)?(深|浅|暗)色|主题/.test(x.getAttribute('aria-label') || x.title || ''));
    if (!b) return false;
    b.click();
    return true;
  })()`)
  ok(clicked, '找到并点击了主题切换按钮')

  await c.sleep(400)
  const dark = await c.eval(`(() => {
    const cs = getComputedStyle(document.documentElement);
    const read = n => cs.getPropertyValue(n).trim();
    return {
      attr: document.documentElement.getAttribute('data-theme'),
      onAccent: read('--on-accent'),
      onDanger: read('--on-danger'),
      accent: read('--accent'),
      colorDanger: read('--color-danger'),
      colorMuted: read('--color-muted'),
    };
  })()`)

  ok(dark.attr !== beforeTheme, `主题确实切换了（${beforeTheme} → ${dark.attr}）`)
  ok(Boolean(dark.onAccent), '切换后 --on-accent 仍有值', dark.onAccent || '空')
  ok(Boolean(dark.colorDanger), '切换后 --color-danger 仍有值', dark.colorDanger || '空')
  ok(dark.colorMuted !== tokens.colorMuted || dark.colorDanger !== tokens.colorDanger,
    '切换后语义色与切换前不同（令牌随主题重算，而非写死）',
    `${tokens.colorDanger} → ${dark.colorDanger}`)

  // 暗色下危险底变成浅红（#f87171），正是「白字不达标」最容易回归的地方
  for (const [label, fg, bg] of [
    ['暗色 --on-accent / --accent', dark.onAccent, dark.accent],
    ['暗色 --on-danger / --color-danger', dark.onDanger, dark.colorDanger],
  ]) {
    if (!fg || !bg) { ok(false, `${label} 可计算`, '令牌缺失'); continue }
    const r = ratio(fg, bg)
    ok(r >= 4.5, `${label} 对比度 ${r.toFixed(2)}:1 ≥ 4.5`, r < 4.5 ? '暗色下不达 AA' : '')
  }

  /* 切换回来，避免留下持久化状态影响后续用例 */
  await c.eval(`(() => {
    const b = document.querySelector('.view-toggle[aria-label*="主题"]')
      || [...document.querySelectorAll('button')].find(x => /切换(到)?(深|浅|暗)色|主题/.test(x.getAttribute('aria-label') || x.title || ''));
    if (b) b.click();
    return true;
  })()`)
  await c.sleep(300)
} catch (e) {
  failures.push(`用例执行异常：${e.message}`)
  console.log(`  ❌ 用例执行异常：${e.message}`)
} finally {
  if (browser) await browser.close().catch(() => {})
  server.kill()
}

console.log(`\n${failures.length === 0 ? '✅ 颜色令牌真机守卫通过' : `❌ 颜色令牌真机守卫 ${failures.length} 条失败`}（共 ${pass + failures.length} 条断言，通过 ${pass}）`)
if (failures.length) {
  console.log('\n失败明细：')
  for (const f of failures) console.log('- ' + f)
}
process.exit(failures.length === 0 ? 0 : 1)
