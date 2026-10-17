/**
 * 搜索历史（localStorage 持久化）。
 *
 * 站点的记忆是「点击次数」（见 search.js 的 clickTier），而搜索框本身没有记忆 ——
 * 昨天找过、今天要再找的同一条，得重新想一遍关键词。这里记的是「你搜过什么」，
 * 不是「你点过什么」：聚焦搜索框、还没输入时把最近几条摆出来，一键回填。
 *
 * 什么不记：
 *   · 以命令前缀（> @ /）开头的输入不是「搜索」，是操作 —— 记下来也没有回填价值；
 *   · 过长的串（几乎都是误粘贴）不记。
 * 去重按大小写不敏感：`GitHub` 与 `github` 是同一条，重复搜索只把它置顶。
 */

const KEY = 'nav-search-history'

/** 最多保留几条。太多会把下拉塞满，反而挡住在找的东西 */
export const HISTORY_MAX = 8

/** 命令前缀：这些输入是操作而非检索（与 useOmniBox 的前缀约定一致） */
const PREFIX_RE = /^[>@/]/

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(raw) ? raw.filter(q => typeof q === 'string' && q.trim()).slice(0, HISTORY_MAX) : []
  } catch {
    // 坏数据（手改过 / 旧格式）当作没有，绝不因它让搜索框起不来
    return []
  }
}

/** 读取最近搜索（最新在前）。任何情况下都返回数组，不抛 */
export function loadSearchHistory() {
  return read()
}

/**
 * 记住一次搜索。
 * @param {string} q 原始输入
 * @returns {string[]} 更新后的历史（最新在前）
 */
export function rememberSearch(q) {
  const s = String(q ?? '').trim()
  if (!s || s.length > 60 || PREFIX_RE.test(s)) return read()
  const lower = s.toLowerCase()
  // 置顶 + 去重（大小写不敏感）：重复搜同一个词不会在列表里出现两次
  const next = [s, ...read().filter(x => x.toLowerCase() !== lower)].slice(0, HISTORY_MAX)
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* 隐私模式 / 配额满：不记也能用 */ }
  return next
}

/** 清空历史，返回空数组 */
export function clearSearchHistory() {
  try { localStorage.removeItem(KEY) } catch { /* 忽略 */ }
  return []
}
