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

/** 从活跃 store 收集本机快照 */
export function snapshotFromStores({ favorites, todos, history, preferences, sidebar }) {
  const d = {}
  if (favorites) d.favorites = [...favorites.favoriteIds]
  if (todos) d.todos = todos.todos
  const visits = (history && history.records) ? history.records.slice(0, 100) : []
  d.history = visits
  d.preferences = {
    theme: preferences?.theme,
    themePreset: preferences?.themePreset,
    searchEngine: preferences?.searchEngine,
    wallpaper: preferences?.wallpaper,
    wallpaperBlur: preferences?.wallpaperBlur
  }
  return d
}

/** 将云端快照应用回本地 stores（合并式，不覆盖本地已存在项） */
export function applySnapshotToStores(data, { favorites, todos, history, preferences }) {
  if (!data) return
  if (data.favorites && Array.isArray(data.favorites) && favorites) {
    data.favorites.forEach(id => favorites.add(id))
  }
  if (data.todos && Array.isArray(data.todos) && todos) {
    data.todos.forEach(t => todos.addRaw(t))
  }
  if (data.history && Array.isArray(data.history) && history) {
    data.history.forEach(r => history.addRawRecord(r))
  }
  if (data.preferences && preferences) {
    if (data.preferences.theme) preferences.theme = data.preferences.theme
    if (data.preferences.themePreset) preferences.setThemePreset(data.preferences.themePreset)
    if (data.preferences.searchEngine) preferences.setSearchEngine(data.preferences.searchEngine)
    if (data.preferences.wallpaper !== undefined) preferences.setWallpaper(data.preferences.wallpaper)
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