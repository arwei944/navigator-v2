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

/* ---- 4. 返回手势协同（App.vue：用原生返回关抽屉，而不是自实现边缘手势）---- */
{
  const app = read('src/App.vue')
  ok(/addEventListener\(\s*'popstate'/.test(app), 'App.vue 监听 popstate（消费原生返回以关闭抽屉）')
  ok(/history\.pushState\(\s*\{\s*navDrawer/.test(app), '抽屉打开时压一条哨兵历史记录')
  ok(/drawerClosedByPop/.test(app), "区分「popstate 关闭」与「UI 关闭」，避免多退一次历史")
  ok(/safeMatchMedia\(\s*MOBILE_QUERY\)|matchMedia\(\s*'\(max-width:\s*768px\)'/.test(app),
    '只在窄屏压历史（桌面侧栏常驻，不该被牵连）')
  // 反模式：自实现边缘 touch 手势会与浏览器原生返回抢事件
  ok(!/touchstart[\s\S]{0,80}clientX\s*<\s*30/.test(app), '没有自实现左缘滑动返回（会与原生手势冲突）')
}

/* ---- 报告 ---- */
console.log(`\n移动端触摸目标守卫（F4）：${pass} 通过，${failures.length} 失败`)
if (failures.length) {
  for (const f of failures) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('  ✓ 全部通过')
