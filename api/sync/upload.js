import { kv } from '@vercel/kv'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = await new Response(req.body).json()
  const { key, data } = body

  if (!key || !data) {
    res.status(400).json({ error: 'Missing key or data' })
    return
  }

  data.updatedAt = new Date().toISOString()
  await kv.set(`sync:${key}`, data)

  res.status(200).json({ success: true, updatedAt: data.updatedAt })
}