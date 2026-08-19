const API_BASE = '/api/sync'

function getStoredKey() {
  try {
    return localStorage.getItem('nav-sync-key')
  } catch {
    return null
  }
}

function setStoredKey(key) {
  try {
    localStorage.setItem('nav-sync-key', key)
  } catch {
    // ignore
  }
}

function getLastSync() {
  try {
    return localStorage.getItem('nav-sync-last')
  } catch {
    return null
  }
}

function setLastSync(time) {
  try {
    localStorage.setItem('nav-sync-last', time)
  } catch {
    // ignore
  }
}

export function getSyncKey() {
  return getStoredKey()
}

export function hasSyncKey() {
  return !!getStoredKey()
}

export async function generateKey() {
  const res = await fetch(`${API_BASE}/key`)
  if (!res.ok) throw new Error('Failed to generate sync key')
  const data = await res.json()
  setStoredKey(data.key)
  setLastSync(data.createdAt)
  return data.key
}

export function setKey(key) {
  setStoredKey(key)
}

export function clearKey() {
  try {
    localStorage.removeItem('nav-sync-key')
    localStorage.removeItem('nav-sync-last')
  } catch {
    // ignore
  }
}

export async function collectSnapshot() {
  // Collect all data from localStorage
  const stores = ['sites', 'favorites', 'todos', 'history', 'preferences']
  const snapshot = {
    sites: [],
    favorites: [],
    todos: [],
    history: [],
    preferences: {},
    version: 1,
    updatedAt: new Date().toISOString(),
  }

  for (const store of stores) {
    try {
      const raw = localStorage.getItem(store)
      if (raw) {
        const parsed = JSON.parse(raw)
        // Pinia persist stores data under the store key
        // It might be wrapped in a state object
        const state = parsed.state || parsed
        snapshot[store] = Array.isArray(state) ? state : (state.data || state.records || state)
        if (store === 'preferences' && state && typeof state === 'object' && !Array.isArray(state)) {
          snapshot.preferences = state
        }
      }
    } catch {
      // skip
    }
  }

  return snapshot
}

export async function mergeSnapshot(key) {
  const snapshot = await collectSnapshot()
  const res = await fetch(`${API_BASE}/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, localData: snapshot }),
  })
  if (!res.ok) throw new Error('Merge failed')
  const result = await res.json()
  setLastSync(result.updatedAt)
  return result.data
}

export async function uploadSnapshot(key) {
  const snapshot = await collectSnapshot()
  const res = await fetch(`${API_BASE}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, data: snapshot }),
  })
  if (!res.ok) throw new Error('Upload failed')
  const result = await res.json()
  setLastSync(result.updatedAt)
  return result
}

export async function downloadSnapshot(key) {
  const res = await fetch(`${API_BASE}/download?key=${encodeURIComponent(key)}`)
  if (!res.ok) throw new Error('Download failed')
  const result = await res.json()
  return result.data
}

export async function applySnapshot(data) {
  if (!data) return

  // Map cloud data back to localStorage stores
  const storeMap = {
    'sites': { key: 'sites', transform: (d) => ({ state: Array.isArray(d) ? d : (d.sites || d.data || []) }) },
    'favorites': { key: 'favorites', transform: (d) => ({ state: { ids: d } }) },
    'todos': { key: 'todos', transform: (d) => ({ state: { items: d } }) },
    'history': { key: 'history', transform: (d) => ({ state: { records: d } }) },
    'preferences': { key: 'preferences', transform: (d) => ({ state: d }) },
  }

  for (const [field, config] of Object.entries(storeMap)) {
    if (data[field]) {
      try {
        const wrapped = config.transform(data[field])
        localStorage.setItem(config.key, JSON.stringify(wrapped))
      } catch {
        // skip
      }
    }
  }
}