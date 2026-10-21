/**
 * 后台键盘快捷键映射（纯数据 + 纯函数，可在 Node 侧直接断言）。
 *
 * 为什么单独一层：快捷键表会被三处用到 —— 后台的 keydown 处理、命令面板显示、
 * 以及「按了什么键」的说明文案。表散在各处，改一个键位就得同时改三份，迟早漂移。
 *
 * 采用 `g` 前缀序列（`g` 然后 `s`）而不是 Ctrl/Alt 组合：
 *   - 浏览器与操作系统已经占满了大部分 Ctrl/Cmd 组合（Ctrl+S 保存、Ctrl+P 打印…），
 *     抢过来要么被拦、要么得 preventDefault 掉用户的习惯；
 *   - 单字母序列不依赖修饰键，在中文输入法下也更稳（不触发输入法的组合）。
 * 代价是需要一个「前缀已按下」的短暂状态（1.2 秒内按第二个键才算数）。
 */

export const ADMIN_SHORTCUTS = [
  { keys: ['g', 'o'], tab: 'overview', label: '概览' },
  { keys: ['g', 'd'], tab: 'deploy', label: '部署' },
  { keys: ['g', 'l'], tab: 'plugins', label: '插件' },
  { keys: ['g', 's'], tab: 'sites', label: '站点管理' },
  { keys: ['g', 'c'], tab: 'categories', label: '分类体系' },
  { keys: ['g', 'm'], tab: 'data-manager', label: '数据管理' },
  { keys: ['g', 'x'], tab: 'sync', label: '三端同步' },
  { keys: ['g', 'w'], tab: 'data-ingest', label: '浏览器工作区' },
  { keys: ['g', 'p'], tab: 'publish', label: '云端发布' },
  { keys: ['g', 'k'], tab: 'snapshots', label: '快照与回滚' },
  { keys: ['g', 'h'], tab: 'history', label: '发布历史' },
  { keys: ['g', 'a'], tab: 'audit', label: '操作审计' },
  { keys: ['g', 'n'], tab: 'notify', label: '通知中心' },
  { keys: ['g', 'b'], tab: 'backup', label: '备份与恢复' },
  { keys: ['g', 'i'], tab: 'ai', label: 'AI 助手' },
]

/** 前缀键（需要它先按下，第二个键才有意义） */
export const SHORTCUT_PREFIX = 'g'

/** 前缀状态的有效期：超过这个时间没按第二个键，就当用户只是打了个 g */
export const PREFIX_TTL_MS = 1200

/**
 * 判断「前缀 + 第二个键」是否命中某条快捷键。
 * @returns {{keys:string[], tab:string, label:string}|null}
 */
export function matchShortcut(prefix, key, shortcuts = ADMIN_SHORTCUTS) {
  const p = String(prefix || '').toLowerCase()
  const k = String(key || '').toLowerCase()
  if (!p || !k) return null
  return shortcuts.find(s => s.keys[0] === p && s.keys[1] === k) || null
}

/**
 * 这次按键是否应当被后台吞掉（不作为输入）。
 *
 * 判据：焦点在输入控件里（input / textarea / contenteditable）、或按下了修饰键时，
 * 一律不响应 —— 否则用户在搜索框里打「gs」就会莫名跳面板。
 */
export function shouldIgnoreKey(event) {
  if (!event) return true
  if (event.ctrlKey || event.metaKey || event.altKey) return true
  const t = event.target
  if (!t) return false
  const tag = String(t.tagName || '').toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (t.isContentEditable) return true
  return false
}
