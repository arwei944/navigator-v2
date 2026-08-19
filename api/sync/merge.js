import { kv } from '@vercel/kv'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = await new Response(req.body).json()
  const { key, localData } = body

  if (!key || !localData) {
    res.status(400).json({ error: 'Missing key or localData' })
    return
  }

  const remoteData = await kv.get(`sync:${key}`)

  if (!remoteData) {
    localData.updatedAt = new Date().toISOString()
    await kv.set(`sync:${key}`, localData)
    res.status(200).json({ data: localData, merged: false })
    return
  }

  const merged = {
    version: Math.max(remoteData.version || 1, localData.version || 1),
    updatedAt: new Date().toISOString(),
  }

  const collections = ['sites', 'favorites', 'todos', 'history']
  for (const col of collections) {
    const local = localData[col] || []
    const remote = remoteData[col] || []
    const mergedMap = new Map()

    for (const item of local) {
      mergedMap.set(item.id || JSON.stringify(item), { ...item })
    }
    for (const item of remote) {
      const id = item.id || JSON.stringify(item)
      if (mergedMap.has(id)) {
        const existing = mergedMap.get(id)
        if ((item.updatedAt || '') > (existing.updatedAt || '')) {
          mergedMap.set(id, { ...item })
        }
      } else {
        mergedMap.set(id, { ...item })
      }
    }

    merged[col] = Array.from(mergedMap.values())
  }

  merged.preferences = { ...(remoteData.preferences || {}), ...(localData.preferences || {}) }

  await kv.set(`sync:${key}`, merged)

  res.status(200).json({ data: merged, merged: true, updatedAt: merged.updatedAt })
}