/**
 * 筛选条第二行的取数规则：常用标签优先，已选中的永远留在行内。
 *
 * 为什么要抽成纯函数：这里决定「哪些标签在第二行看得见」，也是最容易悄悄出问题
 * 的地方 —— 已选中的标签一旦被挤出可视区，用户就看不见自己选了什么，只会以为
 * 筛选失灵（本项目已经栽过同类跟头）。纯函数才能被纯 node 测试锁住。
 */

// 第二行最多显示几个标签。取 8 是因为再多的桌面端一行放不下、
// 窄屏就得滑很久；其余的走「更多」面板。
export const INLINE_MAX = 8

/**
 * 挑出第二行要显示的标签。
 *
 * @param {Array<{id:string,count:number}>} chips 候选：当前方向下的全部标签
 * @param {Array<{id:string,count:number}>} pinned 必显示的：已选中的分类 / 用途，按传入顺序排在最前
 * @param {number} max 行内最多几个（硬上限，pinned 也受它约束）
 * @returns {Array} 不超过 max 个、无重复的标签
 */
export function pickInlineChips(chips, pinned = [], max = INLINE_MAX) {
  const out = []
  const seen = new Set()

  const push = (c) => {
    if (!c || seen.has(c.id) || out.length >= max) return
    seen.add(c.id)
    out.push(c)
  }

  for (const p of pinned) push(p)

  // 计数相同时按原有顺序（Array#sort 稳定）：否则每次刷新换一批标签，
  // 用户刚记住的位置就失效了
  const rest = (chips || [])
    .map((c, i) => ({ c, i }))
    .filter(x => x.c && !seen.has(x.c.id))
    .sort((a, b) => (b.c.count || 0) - (a.c.count || 0) || a.i - b.i)

  for (const { c } of rest) push(c)
  return out
}
