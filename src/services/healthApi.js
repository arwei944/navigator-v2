/**
 * 巡检健康面：`/api/health`（当前快照）与 `/api/health-history`（历史点）。
 *
 * 两者都是**公开只读**的聚合计数（不含站点明细）。此前页面侧各自裸 fetch，
 * `/api/...` 路径散落在组件里 —— 收进这里统一维护：接口改名只改一处。
 */

const HEALTH = '/api/health'
const HISTORY = '/api/health-history'

/**
 * 取当前巡检快照。返回原始响应对象（调用方按 `counts` / `updatedAt` 取值）；
 * 网络失败时抛出，由调用方决定错误文案。
 */
export async function fetchHealth() {
  return fetch(HEALTH, { headers: { Accept: 'application/json' } }).then(x => x.json())
}

/**
 * 取巡检历史点。**任何情况下返回数组、不抛** —— 没有历史时面板照常显示其余卡片。
 */
export async function fetchHealthHistory() {
  try {
    const res = await fetch(HISTORY)
    const j = await res.json().catch(() => ({}))
    return res.ok && j.ok ? (j.points || []) : []
  } catch {
    return []
  }
}
