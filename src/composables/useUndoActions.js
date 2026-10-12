/**
 * 批量操作的「可撤销」外壳：把「快照原值 → 执行 → 入撤销栈 → 弹带撤销按钮的提示」收在一处。
 *
 * ## 为什么不是 sites.js 里的一个方法
 *
 * 撤销的**数据**部分（反向补丁、栈、过期）已经在 `utils/undoCore.mjs` + `stores/undo.js` 里，
 * 剩下这三件事横跨数据层（sites）与提示层（toast）。放进 sites store 会让一个数据 store
 * 开始依赖 toast —— 而项目既有纪律是「store 不改 UI、提示由组件发」。
 * 放进组件又会同时被 `CardsContainer`（批量栏）和 `App.vue`（Ctrl+Z）需要，
 * 于是收敛成组合式函数：调用方各自 `useUndoActions()`，逻辑只有一份。
 *
 * ## 为什么撤销提示的存活时间等于撤销窗口
 *
 * `duration: UNDO_TTL`（5 秒）与栈里的 `expiresAt` 是同一个数：提示还在，就一定能撤；
 * 提示消失，窗口也刚好过期。两者若不一致，就会出现「按钮还在但点了说撤不回来」
 * —— 那是比没有撤销更糟的体验。
 */
import { useSitesStore } from '@/stores/sites'
import { useToastStore } from '@/stores/toast'
import { useUndoStore } from '@/stores/undo'
import { undoPatches, topStep, UNDO_TTL } from '@/utils/undoCore'

export function useUndoActions() {
  const sitesStore = useSitesStore()
  const toastStore = useToastStore()
  const undoStore = useUndoStore()

  function arm({ label, ops, kind = 'patch', message }) {
    const step = undoStore.push({ label, ops, kind })
    toastStore.push({
      message: typeof message === 'function' ? message(ops.length) : message,
      tone: 'ok',
      actionLabel: '撤销',
      onAction: () => undoStep(step.id),
      duration: UNDO_TTL,
    })
    return step
  }

  /**
   * 可撤销的**补丁式**批量改动（改分类 / 置顶 / 归档 / 加用途）。
   *
   * `patch` 在这里只用来**指明要快照哪些字段名**，具体值由 `undoPatches` 从站点当前值读。
   * 所以「每站补丁各不相同」的加用途也走这里：传 `{ purposes: null }` 说明要恢复的字段，
   * 真正的执行逻辑交给 `forward`（它自己会跳过已有该用途的站）。
   *
   * `message` 可以直接给字符串，也可以给 `n => string` —— 后者能写进真实改动数，
   * 而**不是**选中数（两者在「部分站已是目标状态」时并不相等）。
   *
   * @returns {number} 实际改动的站点数（0 表示无事发生，也就不入栈、不提示）
   */
  function undoablePatch({ label, ids, patch, forward, message }) {
    const list = [...new Set(ids || [])]
    if (!list.length) return 0
    // 反向补丁必须在**执行之前**算：执行完原值就被覆盖了
    const ops = undoPatches(sitesStore.sites, list, patch)
    const n = forward ? forward(list) : sitesStore.batchUpdate(list, patch)
    if (!n) return 0
    arm({ label, ops, message: message || (k => `${label} · ${k} 个站点`) })
    return n
  }

  /**
   * 可撤销的删除。
   *
   * 删除**不走补丁**：站点已不在列表里，反向补丁没有「当前值」可快照。
   * 而回收站本就是删除的二次容器，撤销＝从里面取回，是既有能力（`restoreFromTrash`），
   * 不为它另造一套。所以这一步只记 id。
   *
   * `forward` 默认走批量删除；单站删除走 `deleteSite`（它额外做了「从选择集里摘掉」），
   * 两条路径的删除语义一致，撤回也都能经 `restoreFromTrash` 还原。
   */
  function undoableDelete({ ids, label = '删除', message, forward }) {
    const list = [...new Set(ids || [])]
    if (!list.length) return 0
    if (forward) forward(list)
    else sitesStore.batchDeleteToTrash(list)
    arm({
      label,
      ops: list.map(id => ({ id })),
      kind: 'restore',
      message: message || (k => `已把 ${k} 个站点移入回收站`),
    })
    return list.length
  }

  /**
   * 撤回指定一步。
   * 找不到（已过期 / 已被撤过 / 被更新的操作挤出栈）就**明说**，不静默失败 ——
   * 点了撤销却什么都没发生，用户只会以为是功能坏了。
   */
  function undoStep(id) {
    const step = undoStore.take(id)
    if (!step) {
      toastStore.push({ message: '这一步已经撤不回来了', tone: 'info', duration: 2500 })
      return 0
    }
    let n = 0
    if (step.kind === 'restore') {
      for (const o of step.ops) {
        sitesStore.restoreFromTrash(o.id)
        n++
      }
    } else {
      n = sitesStore.batchPatch(step.ops)
    }
    toastStore.push({ message: `已撤销「${step.label}」`, tone: 'info', duration: 2500 })
    return n
  }

  /** Ctrl/Cmd+Z：撤回最近一步。窗口内连按可逐步往回退。 */
  function undoLast() {
    const top = topStep(undoStore.steps)
    if (!top) {
      toastStore.push({ message: '没有可撤销的操作', tone: 'info', duration: 2000 })
      return 0
    }
    return undoStep(top.id)
  }

  return { undoablePatch, undoableDelete, undoStep, undoLast }
}
