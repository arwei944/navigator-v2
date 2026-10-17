/**
 * 无障碍（a11y）守卫（F3）：零依赖、静态检查、不联网。
 *
 * 这里守的是**能静态判定、且容易在后续迭代中悄悄退化**的那几条 —— 不是完整 a11y 审计
 * （那需要真机 + 读屏 + 人工核对）。挑这些是因为它们此前恰恰缺着或散着：
 *   · 全局 `:focus-visible` —— 键盘用户看不见焦点（此前全局一条都没有）；
 *   · 全局 `prefers-reduced-motion` 兜底 —— 此前只有 6 个组件各自写了 @media；
 *   · skip link —— 键盘/读屏用户无法跳过导航直达主内容；
 *   · `<html lang>` —— 读屏的语种判定依据；
 *   · 每个 `<img>` 必须有 `alt`（含显式空 alt，表示装饰图）。
 *
 * 运行：node tools/console/test-a11y.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/* ---- 1. <html lang> ---- */
{
  const html = read('index.html')
  ok(/<html[^>]*\blang\s*=\s*["'][^"']+["']/.test(html), 'index.html 的 <html> 声明了 lang')
}

/* ---- 2. 全局焦点可见 ---- */
{
  const css = read('src/styles/main.css')
  ok(/:focus-visible/.test(css), '全局样式定义了 :focus-visible 焦点环')
  ok(/outline\s*:/.test(css), ':focus-visible 用 outline 提供可见焦点')
}

/* ---- 3. 全局 reduced-motion 兜底 ---- */
{
  const css = read('src/styles/main.css')
  ok(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/.test(css), '全局样式有 prefers-reduced-motion 兜底')
}

/* ---- 4. skip link + 主内容锚点 ---- */
{
  const app = read('src/App.vue')
  ok(/class="skip-link"/.test(app), 'App.vue 有 skip-link')
  ok(/href="#main"/.test(app), 'skip-link 指向 #main')
  ok(/<main[^>]*\bid="main"/.test(app), '主内容区有 id="main"（skip-link 的落点）')
  const css = read('src/styles/main.css')
  ok(/\.skip-link/.test(css), 'skip-link 有样式（否则一直可见或一直不可见）')
}

/* ---- 5. 每个 <img> 都有 alt ---- */
{
  const vueFiles = walk(join(ROOT, 'src')).filter(f => f.endsWith('.vue'))
  let total = 0
  const missing = []
  for (const f of vueFiles) {
    const src = readFileSync(f, 'utf8')
    // 去掉模板注释，避免注释里的 <img> 造成误报
    const clean = src.replace(/<!--[\s\S]*?-->/g, '')
    const tags = clean.match(/<img\b[^>]*>/g) || []
    for (const t of tags) {
      total++
      if (!/\balt\s*=/.test(t)) missing.push(f.replace(ROOT, '').replace(/\\/g, '/'))
    }
  }
  ok(total > 0, '扫描到 <img> 标签（否则检查无意义）')
  ok(missing.length === 0, '每个 <img> 都有 alt 属性', missing.length ? `缺 alt：${[...new Set(missing)].join('、')}` : '')
}

/* ---- 6. 交互控件有可访问名（抽样信息，不硬失败）---- */
{
  const vueFiles = walk(join(ROOT, 'src', 'components')).filter(f => f.endsWith('.vue'))
  const total = vueFiles.length
  const withAria = vueFiles.filter(f => /aria-label|aria-labelledby/.test(readFileSync(f, 'utf8'))).length
  // 只做信息性统计：覆盖率不设硬阈值（不少控件靠可见文本即可访问，不该误报）
  console.log(`  · 组件 aria-label 覆盖：${withAria}/${total}（信息性，不作门禁）`)
}

/* ---- 报告 ---- */
console.log(`\n无障碍守卫（F3）：${pass} 通过，${failures.length} 失败`)
if (failures.length) {
  for (const f of failures) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('  ✓ 全部通过')
