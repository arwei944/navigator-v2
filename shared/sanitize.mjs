/**
 * 站点表的结构校验：**前后端同一把尺子**。
 *
 * 为什么必须有：站点表是「前端全站渲染的唯一输入」。一次脏发布（空数组 / 元素缺 id /
 * 两条同 id）会让前端白屏，而且没有回退路径 —— 比拒绝这次发布严重得多。
 *
 * 判据刻意保持极简（id / name / url 三个非空字符串 + id 不重复），原因有二：
 *   1. 只校验「渲染与去重离不开的字段」。校验得越细，越容易把历史上合法的数据判死，
 *      而那会变成「发布被卡住但没人知道为什么」。
 *   2. 字段级的口径（分类白名单、用途词表、alias 冲突）属于**编辑期**的体检，
 *      在 `scripts/validate-data.mjs` 做；这里只做「能不能渲染」的门禁。
 *
 * 返回**原对象**（不复制）：调用方（`src/stores/sites.js` 的 rebuild）依赖对象身份
 * 做渲染复用，一旦这里造新对象，300 张卡的 memo 会全部失效。
 */

/** @returns {Array|null} 合法返回原数组（元素身份不变）；非法返回 null，调用方应保留上一版 */
export function sanitizeSites(list) {
  if (!Array.isArray(list) || list.length === 0) return null
  const seen = new Set()
  for (const raw of list) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    const url = typeof raw.url === 'string' ? raw.url.trim() : ''
    if (!id || !name || !url) return null
    if (seen.has(id)) return null
    seen.add(id)
  }
  return list
}

/** 只判合法性，不关心返回值 */
export function isSitesValid(list) {
  return sanitizeSites(list) !== null
}
