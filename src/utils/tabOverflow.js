/**
 * 顶部标签的溢出计算：装不下的模块收进「更多」，而不是被滚出可视区。
 *
 * 为什么抽成纯函数：这里决定「哪些模块看得见」。算错不是变丑 ——
 * 是模块从界面上消失（桌面端 1440 屏上，中间区只有约 900px，13 个标签本来就装不下，
 * 靠横向滚动意味着最后 5 个模块常年躲在滚动条外面）。
 */

// 「更多」按钮的占位宽度。刻意定成固定宽度（而不是按文案自适应）：
// 标签在「更多」和「⋯ 当前模块名」之间切换，自适应该宽度会导致
// 「按钮变宽 → 可见标签变少 → 文案又变回去」的来回抖动。
export const MORE_BTN_WIDTH = 104

/**
 * @param {number[]} widths 各标签的占位宽度（含左侧分隔线与外边距）
 * @param {number} available 可用宽度（容器宽 − 左右内边距）
 * @param {number} moreWidth 「更多」按钮占位宽度
 * @returns {number} 可见标签数量；等于 widths.length 表示不需要「更多」
 */
export function computeVisibleCount(widths, available, moreWidth = MORE_BTN_WIDTH) {
  const list = Array.isArray(widths) ? widths : []
  if (!list.length) return 0

  const avail = Number(available) || 0
  const total = list.reduce((s, w) => s + (Number(w) || 0), 0)

  // 全都装得下：不显示「更多」，把宽度全留给标签
  if (total <= avail) return list.length

  const budget = avail - (Number(moreWidth) || 0)
  // 极端窄：budget 还不够放一个标签时，也得留一个 —— 整条只剩「更多」等于没有导航
  if (budget <= 0) return 1

  let used = 0
  let n = 0
  for (const w of list) {
    const x = Number(w) || 0
    if (used + x > budget) break
    used += x
    n++
  }
  return Math.max(1, n)
}
