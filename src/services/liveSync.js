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
 *
 * ## 离线队列与重放（F8）
 *
 * 离线期间的改动记进持久队列（刷新不丢）。恢复在线后**由 `replayOffline` 负责重放**：
 * 成功才移出队列、失败保留并计数、冷却期间不消耗队列。
 *
 * 这里修过一个真实缺陷：原实现由 `onResume` 在**推送之前**就 `clearOffline()`，
 * 而 `flush` 撞上冷却时是直接 `return` —— 那批离线编辑于是被永久丢弃（队列没了、
 * pending 也清了）。现在**只有 push 真的成功才清**，冷却/离线一律保留队列并安排重试。
 * push 的内容是**当前完整快照**，服务端字段级浅合并 + 条目级 LWW 使其天然幂等。
 */
import { watch } from 'vue'
import { getStoredKey, pushSession } from '@/services/session'
import { enqueueEdit, loadOffline, replayOffline } from '@/utils/offlineQueue'

const COOLDOWN_MS = 30_000

export function startLiveSync(stores, { debounce = 5000 } = {}) {
  const { siteNotes, notes } = stores || {}
  if (!siteNotes || !notes) return () => {}

  let timer = null
  let retryTimer = null
  let cooldownUntil = 0
  let stopped = false
  // F8：启动时若持久队列里有「上次离线没推上去」的记录，直接进入待推状态 ——
  // 内存标记 pending 刷新即失，只靠它的话，断网刷新后再也想不起来还有一批没推。
  let pending = loadOffline().length > 0

  const snapshot = () => ({
    siteNotes: siteNotes.exportSnapshot(),
    notes: notes.exportSnapshot()
  })

  function schedule() {
    if (stopped || !getStoredKey()) return
    clearTimeout(timer)
    timer = setTimeout(flush, debounce)
  }

  /** 冷却结束后再试一次 —— 没有它，冷却期内恢复在线的那批永远等不到下一次机会 */
  function scheduleRetry() {
    if (stopped || !getStoredKey()) return
    clearTimeout(retryTimer)
    retryTimer = setTimeout(() => { if (!stopped && pending) schedule() }, COOLDOWN_MS + 500)
  }

  async function flush() {
    timer = null
    if (stopped) return
    const key = getStoredKey()
    if (!key) return
    // 后台标签页与断网状态都先攒着，回到前台 / 联网时补推
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { pending = true; return }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      pending = true
      // F8：持久入队 —— 「离线期间有改动没同步」落进 localStorage，刷新后仍能续上
      enqueueEdit({ kind: 'session', at: Date.now() })
      return
    }

    /**
     * 走统一的重放：`canSend` 把「冷却中」「已停止」表达成「不可发送」——
     * 此时 replayOffline 会 `deferred` 且**原样保留队列**，不再出现「清了队列却没推」。
     */
    const r = await replayOffline({
      canSend: () => !stopped && Date.now() >= cooldownUntil,
      push: async () => { await pushSession(key, snapshot()) }
    })

    if (r.deferred) { pending = true; scheduleRetry(); return }

    if (r.kept > 0 || r.dropped.length) {
      // 有失败：进入冷却，保留 pending 与剩余队列，冷却后重试
      cooldownUntil = Date.now() + COOLDOWN_MS
      pending = true
      scheduleRetry()
      if (r.dropped.length) {
        // 「可丢弃」不等于「静默丢弃」：重放到上限仍失败的条目留一条可回溯的告警
        try {
          console.warn('[liveSync] 离线编辑重放多次失败已丢弃：',
            r.dropped.map(d => `${d.kind}@${new Date(d.at).toISOString()} —— ${d.error}`).join('；'))
        } catch { /* 控制台不可用就忽略 */ }
      }
      return
    }

    // 全部成功：replayOffline 已把队列写空，这里只需清掉内存待推标记
    pending = false
  }

  const stops = [
    watch(() => siteNotes.entries, schedule),
    watch(() => notes.entries, schedule)
  ]

  function onResume() {
    if (stopped) return
    // **不再在这里 clearOffline()**：清队列由 flush 在 push 成功后负责。
    // 这里提前清，一旦 flush 撞上冷却就直接 return，那批编辑就永久丢了。
    if (pending || loadOffline().length) {
      pending = true
      schedule()
    }
  }

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onResume)
  if (typeof window !== 'undefined') window.addEventListener('online', onResume)

  return function stop() {
    stopped = true
    clearTimeout(timer)
    clearTimeout(retryTimer)
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onResume)
    if (typeof window !== 'undefined') window.removeEventListener('online', onResume)
    stops.forEach(fn => fn())
  }
}
