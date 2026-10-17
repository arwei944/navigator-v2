/**
 * 会话快照的字段级合并 —— 「同字段双方都改怎么办」的**唯一口径**（F8）。
 *
 * 放在 `shared/` 是有意的：服务端 `api/session.js` 与客户端（`utils/noteSync.js` 的
 * 条目级 LWW、`utils/offlineQueue.js` 的重放）都对它有假设，任何一边按自己的想象
 * 另写一套合并，多设备就会开始漂移。测试 `tools/console/test-session-merge.mjs`
 * 把「服务端浅合并 × 客户端 LWW」两层拼在一起断言端到端结果，改口径必须两边一起改。
 *
 * ## 完整冲突规则（两层各管一段，缺一层都会漂）
 *
 *   1. 顶层字段层（siteNotes / notes / favorites / history / prefs…）：值是**对象**时
 *      按 key 浅合并 `{...远端旧, ...客户端新}` —— 客户端传到的条目 key 覆盖远端同名 key，
 *      **没传的 key 原样保留**。只合并一层，不做深合并。
 *   2. 条目层（同一条目双方都改）：整条按 LWW 择一 —— 比 `updatedAt` → 相等比 `rev` →
 *      再相等取本地（`noteSync.js#mergeEntry`）。**不做属性级合并**：那是有意的取舍，
 *      「一边改文本、另一边整条删掉」这类组合做属性级合并会产生无法解释的中间态。
 *   3. 删除：一律留墓碑（deletedAt），**不能靠「不传它」** —— 浅合并下不传 = 保留远端
 *      那条，下次拉取后它就「复活」了。墓碑参与同一套时间比较（`noteSync.js#tombstone`）。
 *   4. 值不是对象（字符串 / 数字 / 布尔 / 数组）：整字段覆盖。
 *
 * ## 为什么没有 replace / 「整字段清空」通道
 *
 * 历史注释提过「客户端传 replace 标记的字段整覆盖」，但客户端从未传过、代码也从未实现
 * （会话数据只由 liveSync 推送，且总是整份快照）。「以本机为准」如果将来要做，应该是
 * 一个显式的新通道（并在两端同时实现 + 加一致性别），而不是悄悄给浅合并加语义。
 */

/**
 * 把客户端的 patch 合并进远端旧快照，返回**新对象**（不修改入参）。
 *
 * @param {object} prevData 远端旧快照的 data（可为 null / undefined）
 * @param {object} patch 客户端这次提交的字段（顶层 key）
 * @returns {object} 合并结果
 */
export function mergeSessionData(prevData, patch) {
  const merged = { ...(prevData || {}) }
  for (const [field, value] of Object.entries(patch || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      merged[field] = { ...((prevData && prevData[field]) || {}), ...value }
    } else {
      merged[field] = value
    }
  }
  return merged
}
