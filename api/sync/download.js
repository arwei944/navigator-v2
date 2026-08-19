import { kv } from '@vercel/kv'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const url = new URL(req.url, `https://${req.headers.host}`)
  const key = url.searchParams.get('key')

  if (!key) {
    res.status(400).json({ error: 'Missing key' })
    return
  }

  const data = await kv.get(`sync:${key}`)

  if (!data) {
    res.status(200).json({ data: null })
    return
  }

  res.status(200).json({ data })
}