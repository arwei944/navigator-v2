/**
 * localStorage 安全写入包装。
 *
 * 配额溢出（Safari 无痕模式、存储写满、隐私设置）时 `setItem` 会抛
 * `QuotaExceededError`。不接住它的代价**远大于一次存储失败本身**：
 *
 *   - `recordVisit` 里 `saveOverlay()` 抛错 → 下一行 `clicksStore.record(id)` 直接不执行，
 *     这一次点击彻底不计入云端口径；异常还会冒泡到卡片点击事件。
 *   - `deleteSite` 里 `saveOverlay()` 抛错 → 后面的 `saveTrash()` 也不执行：
 *     视图已经删掉了（rebuild 已跑），但墓碑没落盘、回收站也没写入 ——
 *     刷新后站点复活，而回收站里根本找不到它。
 *
 * 统一从这里走，写入失败降级为「内存态仍然正确 + 控制台告警」，绝不打断业务流程。
 */

const warned = new Set()

export function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value)
    return true
  } catch (e) {
    // 同一 key 只告警一次，避免每次点击都刷屏
    if (!warned.has(key)) {
      warned.add(key)
      console.warn(`[storage] 写入 ${key} 失败（${e?.name || e}）。本次改动只存在于内存中，刷新后会丢失。`)
    }
    return false
  }
}

export function safeRemoveItem(key) {
  try {
    localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}
