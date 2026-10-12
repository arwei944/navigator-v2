/**
 * 撤销栈：批量操作改错了，5 秒内能一键改回来。
 *
 * ## 为什么单独一个 store
 *
 * 改分类 / 加用途 / 置顶 / 归档**都不进回收站** —— 以前的出路是「改错了就改不回来」。
 * 这是数据安全缺口，不是锦上添花。
 *
 * ## 纪律
 *
 * - **走 session，不进站点表**：站点表是云端单一权威、会被发布冲掉，
 *   撤销栈是「这一台设备上刚刚发生的一次操作」，没有跨设备的意义
 *   （与备注 / 便签同一条纪律）。
 * - **不 import sites store**：撤销要把补丁写回站点，而 sites 要 import 本 store
 *   来入栈 —— 双向 import 会成环。所以写回通过参数注入（见 `pop()` 的用法）。
 * - **惰性清理**：`push` 时顺手清过期步，不起定时器。沙箱里 setInterval 不触发，
 *   请求驱动是唯一可靠的时机。
 *
 * 内核（入栈裁剪 / 过期 / 反向补丁）在 `utils/undoCore.mjs`，纯函数可穷举测试。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { decodeStored, encodeStored } from '@/utils/storeVersioning'
import { safeSetItem } from '@/utils/safeStorage'
import { UNDO_MAX, UNDO_TTL, makeStep, pushUndo, dropExpired, topStep } from '@/utils/undoCore'

const KEY = 'nav-undo-v1'

export const useUndoStore = defineStore('undo', () => {
  const steps = ref(decodeStored(KEY, safeGet(), []))

  function safeGet() {
    try { return localStorage.getItem(KEY) } catch { return null }
  }
  function persist() {
    // 只留未过期的：刷新后早就不在撤销窗口内的步骤没有意义
    try { safeSetItem(KEY, encodeStored(dropExpired(steps.value))) } catch { /* 配额满就丢，不影响撤销本身 */ }
  }

  /**
   * 入栈一步。`ops` 是「恢复用」的补丁（`utils/undoCore.mjs#undoPatches` 的产物），
   * **不是**本次应用的补丁 —— 方向别搞反。
   */
  function push({ label, ops, kind = 'patch', ttl = UNDO_TTL }) {
    const step = makeStep({ label, ops, kind, ttl, now: Date.now() })
    // 顺手清过期：不起定时器，push 就是最自然的清理时机
    steps.value = pushUndo(dropExpired(steps.value), step)
    persist()
    return step
  }

  /**
   * 按 id 取出一步并从栈里移除。
   *
   * 撤销按钮要撤的是**它自己那一次**，不是「此刻的最新一次」——
   * 提示会停留几秒，期间用户完全可能又做了别的批量操作，
   * 那时栈顶已经换人，按栈顶弹就会撤错东西。
   */
  function take(id) {
    const idx = steps.value.findIndex(s => s && s.id === id)
    if (idx === -1) return null
    const [step] = steps.value.splice(idx, 1)
    persist()
    return step
  }

  /** 取栈顶（Ctrl+Z 路径）：没有就返回 null，由调用方决定怎么提示 */
  function pop() {
    const top = topStep(steps.value)
    return top ? take(top.id) : null
  }

  /** 仅供测试 / 调试：清空 */
  function clear() {
    steps.value = []
    persist()
  }

  const hasUndo = computed(() => steps.value.length > 0)

  return { steps, push, take, pop, clear, hasUndo, UNDO_MAX, UNDO_TTL }
})
