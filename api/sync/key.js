import { kv } from '@vercel/kv'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const crypto = globalThis.crypto
  const key = crypto.randomUUID()
  const now = new Date().toISOString()

  await kv.set(`sync:${key}`, {
    sites: [],
    favorites: [],
    todos: [],
    history: [],
    preferences: {},
    version: 1,
    createdAt: now,
    updatedAt: now,
  })

  res.status(200).json({ key, createdAt: now })
}