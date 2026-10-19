/**
 * 本地数据版本化与迁移。
 * 目的：为 localStorage 持久化的 store 数据附加 schema 版本号，未来结构变更时
 * 在 MIGRATIONS 注册迁移函数即可平滑升级，避免旧结构数据读取异常/丢失。
 *
 * 使用方式：
 *  - Pinia (pinia-plugin-persistedstate)：persist: versionedPersist('key'[, ['field',...]])
 *  - 手动持久化（如数组数据）：encodeStored(data) / decodeStored(key, raw, fallback)
 */
export const STORE_VERSION = 3
export const V_KEY = '__navDataVersion'

/**
 * 迁移表：key -> [[fromVersion, upgradeFn], ...]
 * upgradeFn(state) 接收旧版本对象，返回升级后的对象（可改造字段结构）。
 */
const MIGRATIONS = {
  // v1 时期 versionedPersist 把字段过滤项写成了 pick（插件只认 paths），过滤被静默忽略，
  // 整份 state 都落了盘 —— 连右侧详情面板的折叠态 rightCollapsed 也被持久化，
  // 于是「折叠一次 → 永久收起」。这里把历史遗留的瞬态字段清掉，回到默认展开。
  sidebar: [[1, (old) => {
    const next = { ...old }
    delete next.rightCollapsed
    delete next.open
    delete next.hoveredSite
    return next
  }]],

  /*
   * v2 → v3：把「访问记录」从两份存储收敛成一份。
   *
   * 旧结构：`records: [{ siteId, timestamp }, ...]`（按 siteId 去重、最新在前）。
   * 新结构：`visits: { [siteId]: { count, lastAt } }`。
   *
   * 旧结构里**没有 count**（次数存在 overlay 的 visits 里，是另一个 key）。
   * 这里只能先把历史记录转成 `count: 1`，真实计数由 history store 首启动时
   * 从 overlay 合并补齐 —— 跨 key 的合并不可能在一个迁移函数里完成。
   */
  history: [[2, (old) => {
    const raw = Array.isArray(old?.records) ? old.records : []
    const visits = {}
    for (const r of raw) {
      const id = r?.siteId
      if (id === undefined || id === null || id === '') continue
      const ts = typeof r.timestamp === 'number' ? r.timestamp : new Date(r.timestamp).getTime()
      const lastAt = Number.isFinite(ts) ? ts : Date.now()
      const key = String(id)
      // 同一站点若有多条（旧数据未去重），保留最晚时间、计数累加
      const prev = visits[key]
      visits[key] = prev
        ? { count: prev.count + 1, lastAt: Math.max(prev.lastAt, lastAt) }
        : { count: 1, lastAt }
    }
    return { ...old, visits, records: undefined }
  }]],
}

function stripVersion(d) {
  if (!d || typeof d !== 'object') return d || {}
  const { [V_KEY]: _v, ...rest } = d
  return rest
}

function applyMigrations(key, data, curVersion) {
  const steps = MIGRATIONS[key] || []
  let next = data
  for (let from = curVersion; from < STORE_VERSION; from++) {
    const fn = steps.find(s => s[0] === from)
    if (fn) next = fn[1](next)
  }
  return next
}

function currentVersion(d) {
  return d && typeof d === 'object' ? (Number(d[V_KEY]) || 0) : 0
}

/** 供 pinia-plugin-persistedstate 使用的对象形式 persist 配置 */
export function versionedPersist(key, paths) {
  const cfg = {
    key,
    serializer: {
      serialize: state => JSON.stringify({ ...state, [V_KEY]: STORE_VERSION }),
      deserialize: raw => {
        let d
        try { d = JSON.parse(raw) } catch { return {} }
        return applyMigrations(key, stripVersion(d), currentVersion(d))
      }
    }
  }
  // 插件（v3）的字段过滤配置项名是 paths，不是 pick —— 写成 pick 会被静默忽略，
  // 整份 state（含瞬态字段）都会落盘。这里必须用 paths。
  if (Array.isArray(paths) && paths.length) cfg.paths = paths
  return cfg
}

/** 手动持久化：序列化（数组/标量数据用 {[V_KEY], data} 包装） */
export function encodeStored(data) {
  return JSON.stringify({ [V_KEY]: STORE_VERSION, data })
}

/** 手动持久化：读取并迁移，失败返回 fallback */
export function decodeStored(key, raw, fallback) {
  try {
    if (!raw) return fallback
    const d = JSON.parse(raw)
    const payload = d && typeof d === 'object' && d && 'data' in d ? d.data : d
    return applyMigrations(key, payload, currentVersion(d))
  } catch {
    return fallback
  }
}