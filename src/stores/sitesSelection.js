/**
 * 批量选择集的状态机 —— 纯逻辑，不依赖 Vue。
 *
 * ## 为什么要单独成型
 *
 * 「批量模式」与「拖拽模式」是互斥的，选择集又是跨分类存活的。这两条规则凑在
 * 组件里时，每加一个入口（右键菜单、工具栏、快捷键）就得各自记得「进批量要关拖拽」
 * 和「切分类要收敛选择集」—— 漏掉任何一处都会造出「删了看不见的站」这类事故。
 *
 * 这里把规则收成一个对象：所有变更都返回**新的选择集**，调用方只负责赋值。
 * 于是「规则只有一份」是结构保证，不靠自觉。
 */

/** 切换批量模式：退出时清空选择；进入时关闭拖拽（两者互斥） */
export function toggleBatchMode({ batchMode, dragEnabled, selectedIds }) {
  const nextBatch = !batchMode
  return {
    batchMode: nextBatch,
    dragEnabled: nextBatch ? false : dragEnabled,
    selectedIds: nextBatch ? selectedIds : new Set(),
  }
}

/** 切换拖拽模式：进入时关闭批量并清空选择（两者互斥） */
export function toggleDragMode({ batchMode, dragEnabled, selectedIds }) {
  const nextDrag = !dragEnabled
  return {
    dragEnabled: nextDrag,
    batchMode: nextDrag ? false : batchMode,
    selectedIds: nextDrag ? new Set() : selectedIds,
  }
}

/** 勾选 / 取消勾选一条。始终返回新 Set（响应式要看到引用变化） */
export function toggleSelection(selectedIds, id) {
  const next = new Set(selectedIds)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/**
 * 把选择集收敛到「当前看得见的站点」。
 *
 * 为什么必须有：选择集是跨分类存活的。在 A 分类选了 3 个站，再切到 B 分类点「批量删除」，
 * 会删掉 3 个用户此刻根本看不见的站 —— 这是这套交互里最伤人的一种误操作，
 * 而且删完还能在回收站里看到，用户会一头雾水。
 *
 * 选择集为空时直接返回**同一个引用**：这是绝大多数时刻的状态，不该为它新建 Set。
 * @param {Set<string>} selectedIds
 * @param {string[]} visibleIds
 * @returns {Set<string>} 原引用（无需收敛）或新的收敛结果
 */
export function pruneSelectionSet(selectedIds, visibleIds) {
  if (!selectedIds.size) return selectedIds
  const visible = new Set(visibleIds)
  let dropped = false
  const next = new Set()
  for (const id of selectedIds) {
    if (visible.has(id)) next.add(id)
    else dropped = true
  }
  return dropped ? next : selectedIds
}
