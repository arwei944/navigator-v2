/**
 * 网格键盘导航的纯规则（v11）。
 *
 * 为什么单独抽成纯函数：「按方向键该去哪一格」极易写歪（行末右移、末行下移、
 * 焦点不在网格内时按方向键该干什么），而它又完全无副作用 —— 抽出来就能在 node 里
 * 穷举断言，不必为了测它开一个浏览器。组件只负责把算出来的下标落成 DOM 焦点。
 *
 * 三个刻意的取舍，改之前先想清楚：
 *
 *  1. **不换行**：行末按 → 停住，而不是跳到下一行行首。换行会让「我连按三下右」
 *     之后的位置变得难以预测；停住则用户永远知道自己在哪。
 *  2. **末行下移跳到最后一个**：最后一行常常是不满的（300 站 / 4 列 = 75 行整，
 *     但搜索结果几乎总是不满），此时按 ↓ 应当去到列表末尾而不是什么都不做。
 *     已经就在末行的，才真的不动。
 *  3. **Home / End 走整列的头尾，不是行首行尾**：行首行尾需要「当前行」概念，
 *     而列数在自适应布局下会随视口变化，同一按键的结果会漂移。整列头尾是稳定的。
 *
 * `cols` 由调用方给：瀑布流是 CSS 多栏布局，视觉列序与数组下标**不对应**，
 * 那种情况下调用方传 1，退化成上下线性移动 —— 错位的导航比没有导航更糟。
 */

export const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'])

/**
 * 算下一个下标。返回 `-1` 表示「这个键不由网格处理」（调用方应放行冒泡）。
 * 边界上返回**当前下标**表示「处理了但不动」—— 调用方据此 preventDefault，
 * 免得方向键顺手把页面滚走。
 */
export function nextIndex(current, key, { cols = 1, total = 0 } = {}) {
  if (!NAV_KEYS.has(key)) return -1

  const c = Math.max(1, Math.floor(Number(cols) || 1))
  const n = Math.max(0, Math.floor(Number(total) || 0))
  if (!n) return -1

  // 焦点不在网格内（初次按下 / 列表变短后越界）：从头开始，而不是什么都不做
  let i = Math.floor(Number(current))
  if (!Number.isFinite(i) || i < 0 || i >= n) {
    return key === 'End' ? n - 1 : 0
  }

  switch (key) {
    case 'ArrowLeft':
      return i % c === 0 ? i : i - 1
    case 'ArrowRight':
      // 行末，或已经是最后一张：都不动
      return (i % c === c - 1 || i === n - 1) ? i : i + 1
    case 'ArrowUp':
      return i - c >= 0 ? i - c : i
    case 'ArrowDown': {
      if (i + c < n) return i + c
      const lastRow = Math.floor((n - 1) / c)
      return Math.floor(i / c) < lastRow ? n - 1 : i
    }
    case 'Home':
      return 0
    case 'End':
      return n - 1
    default:
      return -1
  }
}

/**
 * 从 CSS 的 `grid-template-columns` 读实际列数。
 *
 * 为什么要读实测值而不是直接用 `gridCols` 令牌：自适应布局（`auto-fill minmax`）
 * 的实际列数取决于视口宽度，令牌只是最小宽度；用令牌算会让「按 ↓ 之后跳到的那张卡」
 * 与视觉上的正下方对不上。瀑布流（CSS 多栏）不是 grid，这里返回 1 退化为线性。
 */
export function columnsFromStyle(gridTemplateColumns) {
  const s = String(gridTemplateColumns || '')
  if (!s || s === 'none') return 1
  const cols = s.trim().split(/\s+/).filter(Boolean).length
  return cols > 0 ? cols : 1
}
