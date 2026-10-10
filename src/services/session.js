/**
 * 会话数据同步服务（替代失效的 KV 云同步）
 * 基于 /api/session + Blob 存储，用 session key 作为多设备隔离与同步标识。
 * key 仅存于浏览器的 localStorage（nav-session-key），不上传服务器明文校验密钥之外。
 *
 * key 一律走 `Authorization: Bearer`，不走 query string —— query 会进 Vercel 函数日志、
 * CDN 日志、浏览器历史与 Referer，而它是这份数据的唯一凭证。服务端已停用旧的 `?key=`。
 */
const API = '/api/session'
const KEY_KEY = 'nav-session-key'

export function getStoredKey() {
  return localStorage.getItem(KEY_KEY) || ''
}
export function storeKey(k) {
  if (k) localStorage.setItem(KEY_KEY, k)
  else localStorage.removeItem(KEY_KEY)
}

function authHeaders(key, extra) {
  return { Authorization: `Bearer ${key || ''}`, ...(extra || {}) }
}

/**
 * 同步字段注册表。
 *
 * 以前是「收集快照」与「回填本地」两处各写一遍字段名，加一个字段要改两处，
 * 漏改一处就变成「推上去了但拉不回来」—— 这种半边同步最难查，因为两端都不报错。
 * 现在只登记一次：get 负责收集、apply 负责回填，缺失的 store 自行跳过
 * （例如没开会话同步时 siteNotes 尚未创建）。
 */
const SYNC_FIELDS = [
  {
    key: 'favorites',
    get: ({ favorites }) => (favorites ? [...favorites.favoriteIds] : undefined),
    apply: (value, { favorites }) => {
      if (favorites && Array.isArray(value)) value.forEach(id => favorites.add(id))
    }
  },
  {
    key: 'todos',
    get: ({ todos }) => (todos ? todos.todos : undefined),
    apply: (value, { todos }) => {
      if (todos && Array.isArray(value)) value.forEach(t => todos.addRaw(t))
    }
  },
  {
    key: 'history',
    get: ({ history }) => (history ? history.records.slice(0, 100) : undefined),
    apply: (value, { history }) => {
      if (history && Array.isArray(value)) value.forEach(r => history.addRawRecord(r))
    }
  },
  {
    key: 'preferences',
    get: ({ preferences }) => (preferences ? {
      theme: preferences.theme,
      themePreset: preferences.themePreset,
      searchEngine: preferences.searchEngine,
      wallpaper: preferences.wallpaper,
      wallpaperBlur: preferences.wallpaperBlur
    } : undefined),
    apply: (value, { preferences }) => {
      if (!value || !preferences) return
      if (value.theme) preferences.theme = value.theme
      if (value.themePreset) preferences.setThemePreset(value.themePreset)
      if (value.searchEngine) preferences.setSearchEngine(value.searchEngine)
      if (value.wallpaper !== undefined) preferences.setWallpaper(value.wallpaper)
    }
  },
  {
    key: 'siteNotes',
    get: ({ siteNotes }) => (siteNotes ? siteNotes.exportSnapshot() : undefined),
    apply: (value, { siteNotes }) => {
      if (siteNotes && value && typeof value === 'object') siteNotes.applyRemote(value)
    }
  },
  {
    key: 'notes',
    get: ({ notes }) => (notes ? notes.exportSnapshot() : undefined),
    apply: (value, { notes }) => {
      if (notes && value && typeof value === 'object') notes.applyRemote(value)
    }
  }
]

/** 从活跃 store 收集本机快照 */
export function snapshotFromStores(stores) {
  const out = {}
  for (const field of SYNC_FIELDS) {
    try {
      const v = field.get(stores)
      if (v !== undefined && v !== null) out[field.key] = v
    } catch {
      // 单个 store 出问题不该让整次同步失败（其余字段照常推送）
    }
  }
  return out
}

/** 将云端快照应用回本地 stores（合并式，不覆盖本地已存在项） */
export function applySnapshotToStores(data, stores) {
  if (!data || typeof data !== 'object') return
  for (const field of SYNC_FIELDS) {
    const value = data[field.key]
    if (value === undefined || value === null) continue
    try {
      field.apply(value, stores)
    } catch {
      // 同上：一条字段坏掉不影响其余字段落地
    }
  }
}

export async function fetchSession(key) {
  const r = await fetch(API, { cache: 'no-store', headers: authHeaders(key) })
  if (!r.ok) throw new Error('读取会话失败 (' + r.status + ')')
  return r.json()
}

export async function pushSession(key, data) {
  const r = await fetch(API, {
    method: 'POST',
    headers: authHeaders(key, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ data })
  })
  if (!r.ok) throw new Error('写入会话失败 (' + r.status + ')')
  return r.json()
}
