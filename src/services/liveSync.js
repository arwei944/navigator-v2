/**
 * 个人数据的自动上行：备注 / 便利贴一改，防抖后推一次云端。
 *
 * ## 为什么只推这两个字段
 *
 * `/api/session` 的写入是**字段级合并**，只传 `{siteNotes, notes}` 不会动到收藏、
 * 待办、历史与偏好。反过来若整份快照都推，就会把「本机某字段较旧」覆盖掉云端的较新值 ——
 * 那正是手动上传按钮该干的事（用户明确点了「以本机为准」），而不是自动同步该干的。
 *
 * ## 失败为什么静默
 *
 * 自动同步发生在用户打字之后，任何弹窗都是打扰；而且没有 key 是常态（大部分用户
 * 不开会话同步）。所以：没 key 直接不推，失败进入 30s 冷却，期间不再重试。
 * 需要立刻同步时用设置里的手动按钮，那里有明确的成功/失败反馈。
 */
import { watch } from 'vue'
import { getStoredKey, pushSession } from '@/services/session'

const COOLDOWN_MS = 30_000

export function startLiveSync(stores, { debounce = 5000 } = {}) {
  const { siteNotes, notes } = stores || {}
  if (!siteNotes || !notes) return () => {}

  let timer = null
  let cooldownUntil = 0
  let pending = false
  let stopped = false

  function schedule() {
    if (stopped || !getStoredKey()) return
    clearTimeout(timer)
    timer = setTimeout(flush, debounce)
  }

  async function flush() {
    timer = null
    if (stopped) return
    const key = getStoredKey()
    if (!key) return
    // 后台标签页与断网状态都先攒着，回到前台 / 联网时补推
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { pending = true; return }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { pending = true; return }
    if (Date.now() < cooldownUntil) return
    try {
      await pushSession(key, {
        siteNotes: siteNotes.exportSnapshot(),
        notes: notes.exportSnapshot()
      })
    } catch {
      cooldownUntil = Date.now() + COOLDOWN_MS
    }
  }

  const stops = [
    watch(() => siteNotes.entries, schedule),
    watch(() => notes.entries, schedule)
  ]

  function onResume() {
    if (!pending) return
    pending = false
    schedule()
  }

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onResume)
  if (typeof window !== 'undefined') window.addEventListener('online', onResume)

  return function stop() {
    stopped = true
    clearTimeout(timer)
    stops.forEach(fn => fn())
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onResume)
    if (typeof window !== 'undefined') window.removeEventListener('online', onResume)
  }
}
