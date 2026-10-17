/**
 * 移动端触摸目标守卫（F4）：零依赖、静态检查。
 *
 * 守的是移动端最容易退化、又最影响手感的两条硬线：
 *   · 触摸目标 ≥44px（WCAG 2.5.5）—— 指腹点得中，不是「图标画多大」而是「命中区多大」；
 *   · Safe Area（`env(safe-area-inset-*)`）—— 刘海屏 / 底部横条的机型上不被切掉。
 * 这两项一旦被后来的样式改动覆盖，肉眼在桌面浏览器里看不出来，所以要钉住。
 *
 * 运行：node tools/console/test-mobile.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }

/** 取出某个选择器的 CSS 块（首个 `{...}`） */
function block(src, selector) {
  const i = src.indexOf(selector)
  if (i === -1) return ''
  const s = src.indexOf('{', i)
  const e = src.indexOf('}', s)
  return s === -1 || e === -1 ? '' : src.slice(s + 1, e)
}
/** 块里的宽 / 高数值（px），取 min-* 优先 */
function sizeOf(cssBlock) {
  const w = /min-width\s*:\s*(\d+)px/.exec(cssBlock) || /width\s*:\s*(?:calc\(\s*)?(\d+)px/.exec(cssBlock)
  const h = /min-height\s*:\s*(\d+)px/.exec(cssBlock) || /height\s*:\s*(?:calc\(\s*)?(\d+)px/.exec(cssBlock)
  return { w: w ? Number(w[1]) : 0, h: h ? Number(h[1]) : 0 }
}

const MIN_TAP = 44

/* ---- 1. MobileHeader 汉堡按钮 ---- */
{
  const src = read('src/components/MobileHeader.vue')
  const s = sizeOf(block(src, '.hamburger'))
  ok(s.w >= MIN_TAP, `MobileHeader 汉堡按钮宽 ≥${MIN_TAP}px`, `实得 ${s.w}px`)
  ok(s.h >= MIN_TAP, `MobileHeader 汉堡按钮高 ≥${MIN_TAP}px`, `实得 ${s.h}px`)
  ok(/env\(safe-area-inset-top\)/.test(src), 'MobileHeader 处理顶部安全区')
}

/* ---- 2. MobileDetailDrawer 关闭按钮 + 手势 ---- */
{
  const src = read('src/components/MobileDetailDrawer.vue')
  const s = sizeOf(block(src, '.detail-sheet-close'))
  ok(s.w >= MIN_TAP, `抽屉关闭按钮宽 ≥${MIN_TAP}px`, `实得 ${s.w}px`)
  ok(s.h >= MIN_TAP, `抽屉关闭按钮高 ≥${MIN_TAP}px`, `实得 ${s.h}px`)
  ok(/env\(safe-area-inset-bottom\)/.test(src), '抽屉处理底部安全区')
  ok(/@touchend/.test(src), '抽屉拖拽条绑定了手势（下滑关闭）')
}

/* ---- 3. MobileTabBar 底部栏 ---- */
{
  const src = read('src/components/MobileTabBar.vue')
  const s = sizeOf(block(src, '.mobile-tabbar'))
  ok(s.h >= MIN_TAP, `底部栏高 ≥${MIN_TAP}px（tab 命中区随之达标）`, `实得 ${s.h}px`)
  ok(/env\(safe-area-inset-bottom\)/.test(src), '底部栏处理底部安全区')
}

/* ---- 报告 ---- */
console.log(`\n移动端触摸目标守卫（F4）：${pass} 通过，${failures.length} 失败`)
if (failures.length) {
  for (const f of failures) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('  ✓ 全部通过')
