/**
 * 按域名散列出一个稳定颜色 —— 从 `shared/site-infer.mjs` 拆出来的**独立小模块**。
 *
 * ## 为什么要拆
 *
 * `site-infer.mjs` 有 700+ 行，而这里只有两个小函数。拆开前 `siteDraft.js`（在首屏
 * 静态依赖图里：autoAdd → 搜索框）为了拿一个 `hashColor` 就得把整个推断引擎拖进入口
 * chunk —— 更糟的是，一旦有别处**动态** import site-infer（自动补全的本地兜底正是这么
 * 做的），rollup 会因为「同一模块既有静态引用又有动态引用」而把整个模块提升进首屏，
 * 实测首屏 591.6 → 608.4 KiB，越过 600 KiB 预算。
 *
 * 拆开后：`siteDraft.js` 只引这个 ~30 行的小模块，site-infer 只剩
 * `services/localMeta.js` 的动态 import 一条到达路径，稳稳落在异步 chunk 里。
 * 守卫：`test-bundle` 的 LAZY_PARTS 里有 site-infer 的点名断言。
 */

/** HSL → #rrggbb（hashColor 专用；小写十六进制，无 alpha） */
function hslToHex(h, s, l) {
  const f = n => {
    const k = (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0')
  }
  return '#' + f(0) + f(8) + f(4)
}

/** 无任何品牌色线索时按域名散列出一个稳定颜色，同一站点每次结果一致 */
export function hashColor(seed) {
  const s = String(seed || 'site')
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return hslToHex(Math.abs(h) % 360, 0.58, 0.46)
}
