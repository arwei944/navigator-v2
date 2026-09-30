import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { get, put, list, del } from '@vercel/blob'
import { SNAPSHOT_PREFIX, SNAPSHOT_KEEP, snapshotPathname, parseSnapshotName, prunableSnapshots, isSnapshotPathname } from '../shared/snapshots.mjs'

// 数据真相源：Vercel Blob 上的 sites.json（运行时权威数据）。
// 以下 SEED_SITES 仅作为 Blob 为空时的本地兜底，由 scripts/publish.mjs 保持与 Blob 同步，
// 不做每天都写入。本地 api/sites-data.json 是 SEED + 发布源。
const SEED_SITES = JSON.parse(
  readFileSync(fileURLToPath(new URL('./sites-data.json', import.meta.url)), 'utf-8')
)

const PATHNAME = 'sites.json'

async function readStored() {
  // useCache:false 绕过 Blob CDN 缓存：发布后首次读取即拿到最新版本，
  // 否则 publish.mjs 的一致性轮询要 1~4 次才收敛
  const blob = await get(PATHNAME, { access: 'private', useCache: false })
  if (!blob || !blob.stream) return null
  const text = await new Response(blob.stream).text()
  return JSON.parse(text)
}

/** 读取任意 pathname 的 JSON 对象（快照读取用） */
async function readJsonAt(pathname) {
  const blob = await get(pathname, { access: 'private', useCache: false })
  if (!blob || !blob.stream) return null
  const text = await new Response(blob.stream).text()
  return JSON.parse(text)
}

/**
 * 把「即将被覆盖的当前数据」另存为快照。
 * 失败不抛给调用方：快照是安全网，不该反过来阻断发布；但必须把结果回报给调用方，
 * 让控制台/CLI 能显式提醒「这次发布没有快照兜底」。
 */
async function writeSnapshot(data) {
  try {
    const pathname = snapshotPathname(data.version)
    await put(pathname, JSON.stringify(data), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    })
    return { ok: true, pathname }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

/** 裁剪超出保留份数的旧快照；失败同样不阻断主流程 */
async function pruneSnapshots() {
  try {
    const { blobs } = await list({ prefix: SNAPSHOT_PREFIX, limit: 1000 })
    const doomed = prunableSnapshots(blobs.map(b => b.pathname), SNAPSHOT_KEEP)
    if (doomed.length) await del(doomed)
    return { ok: true, deleted: doomed.length }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

function readBody(req) {
  if (typeof req.body === 'string') return JSON.parse(req.body)
  if (req.body && typeof req.body.getReader === 'function') return new Response(req.body).json()
  return Promise.resolve(req.body || {})
}

/** 鉴权：写操作与快照读取都要求 Bearer <SITES_ADMIN_KEY> */
function authorized(req) {
  const adminKey = process.env.SITES_ADMIN_KEY
  if (!adminKey) return { ok: false, code: 500, error: 'SITES_ADMIN_KEY not configured' }
  const auth = (req.headers && req.headers.authorization) || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth.trim()
  if (token !== adminKey) return { ok: false, code: 401, error: 'Unauthorized' }
  return { ok: true }
}

function noStore(res) {
  // 关键：禁止 CDN 缓存，确保每次轮询都回源读最新数据，实现真正的实时热更新
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const snapshotsQuery = req.query && req.query.snapshots
    const singleQuery = req.query && req.query.snapshot

    // 快照清单 / 单份快照内容：运维面数据，要求鉴权
    if (snapshotsQuery || singleQuery) {
      noStore(res)
      const auth = authorized(req)
      if (!auth.ok) { res.status(auth.code).json({ error: auth.error }); return }
      try {
        if (singleQuery) {
          const pathname = String(singleQuery)
          if (!isSnapshotPathname(pathname)) { res.status(400).json({ error: '非法快照名称' }); return }
          const data = await readJsonAt(pathname)
          if (!data) { res.status(404).json({ error: '快照不存在' }); return }
          res.status(200).json({ ...data, snapshot: pathname })
          return
        }
        const { blobs } = await list({ prefix: SNAPSHOT_PREFIX, limit: 1000 })
        const snapshots = blobs
          .map(b => {
            const meta = parseSnapshotName(b.pathname)
            return meta ? { ...meta, size: b.size, uploadedAt: b.uploadedAt } : null
          })
          .filter(Boolean)
          .sort((a, b) => (a.pathname < b.pathname ? 1 : -1))
        res.status(200).json({ keep: SNAPSHOT_KEEP, count: snapshots.length, snapshots })
      } catch (e) {
        res.status(500).json({ error: String(e?.message || e) })
      }
      return
    }

    noStore(res)
    try {
      const data = await readStored()
      if (data && Array.isArray(data.sites) && data.sites.length > 0) {
        res.status(200).json(data)
        return
      }
    } catch {
      // 未存储或读取失败时使用本地种子兜底
    }

    const seeded = {
      version: 1,
      sites: SEED_SITES,
      updatedAt: new Date().toISOString()
    }
    await put(PATHNAME, JSON.stringify(seeded), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true
    })
    res.status(200).json(seeded)
    return
  }

  if (req.method === 'POST') {
    const auth = authorized(req)
    if (!auth.ok) { res.status(auth.code).json({ error: auth.error }); return }

    let body
    try {
      body = await readBody(req)
    } catch {
      res.status(400).json({ error: 'Invalid JSON body' })
      return
    }

    let prev = null
    try { prev = await readStored() } catch { /* 首次写入，无前值 */ }
    const prevVersion = prev && prev.version ? Number(prev.version) : 0

    /* ---- 回滚：把指定快照写回主 pathname，version 继续递增（不回退计数） ---- */
    if (body.action === 'rollback') {
      const pathname = String(body.snapshot || '')
      if (!isSnapshotPathname(pathname)) { res.status(400).json({ error: '非法快照名称' }); return }
      let snapshot
      try {
        snapshot = await readJsonAt(pathname)
      } catch (e) {
        res.status(404).json({ error: `读取快照失败：${String(e?.message || e)}` })
        return
      }
      if (!snapshot || !Array.isArray(snapshot.sites) || snapshot.sites.length === 0) {
        res.status(400).json({ error: '快照内容无效或为空' })
        return
      }
      // 回滚本身也要可撤销：先把「回滚前的当前数据」存一份
      const safety = prev ? await writeSnapshot(prev) : { ok: true, pathname: null }
      const data = {
        version: prevVersion + 1,
        sites: snapshot.sites,
        updatedAt: new Date().toISOString(),
        restoredFrom: pathname,
        restoredAt: new Date().toISOString(),
      }
      await put(PATHNAME, JSON.stringify(data), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
      })
      const pruned = await pruneSnapshots()
      res.status(200).json({
        ...data,
        snapshot: safety,
        previousVersion: prevVersion,
        pruned,
      })
      return
    }

    /* ---- 常规热更新：写入前先给当前数据落快照 ---- */
    const { sites } = body
    if (!Array.isArray(sites) || sites.length === 0) {
      res.status(400).json({ error: 'Invalid sites payload' })
      return
    }

    const version = prevVersion + 1
    const snapshot = prev ? await writeSnapshot(prev) : { ok: true, pathname: null, skipped: '无前值可快照' }
    const data = {
      version,
      sites,
      updatedAt: new Date().toISOString()
    }
    await put(PATHNAME, JSON.stringify(data), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    })
    const pruned = await pruneSnapshots()
    res.status(200).json({ ...data, snapshot, pruned })
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}