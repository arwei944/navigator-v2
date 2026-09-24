/**
 * 本地数据版本化与迁移。
 * 目的：为 localStorage 持久化的 store 数据附加 schema 版本号，未来结构变更时
 * 在 MIGRATIONS 注册迁移函数即可平滑升级，避免旧结构数据读取异常/丢失。
 *
 * 使用方式：
 *  - Pinia (pinia-plugin-persistedstate)：persist: versionedPersist('key'[, ['field',...]])
 *  - 手动持久化（如数组数据）：encodeStored(data) / decodeStored(key, raw, fallback)
 */
export const STORE_VERSION = 1
export const V_KEY = '__navDataVersion'

/**
 * 迁移表：key -> [[fromVersion, upgradeFn], ...]
 * upgradeFn(state) 接收旧版本对象，返回升级后的对象（可改造字段结构）。
 * 未来结构变更时在此注册：
 *   MIGRATIONS['history'] = [[1, old => ({ ...old, newField: [] })]]
 */
const MIGRATIONS = {}

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
export function versionedPersist(key, pick) {
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
  if (Array.isArray(pick) && pick.length) cfg.pick = pick
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