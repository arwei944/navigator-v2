/**
 * 浏览器同步的临时工作区接口。
 *
 *   GET    /api/ingest                  → 批次列表（摘要）
 *   GET    /api/ingest?batch=<id>       → 单批详情
 *   GET    /api/ingest?categories=1     → 分类表（扩展端下拉用）
 *   POST   /api/ingest                  → 新建批次（body: {items:[...], dryRun?}）
 *   POST   /api/ingest/preview          → 只规范化、不落盘（扩展端预览）
 *   POST   /api/ingest/promote          → 选中条目写入主库
 *   DELETE /api/ingest?batch=<id>       → 丢弃整批
 *
 * ## 边界（这是本接口最重要的约束）
 *
 * `POST /api/ingest` 只写 `staging/` 前缀，**永远不碰 sites.json**。
 * 只有 `promote` 会写主库，且走与 `api/sites.js` 相同的 CAS + 写前快照 + 校验。
 * 这样「浏览器里有几千条历史」不会因为一次误点把线上站点表冲掉。
 *
 * ## 为什么 promote 不转发到 /api/sites
 *
 * 转发需要服务知道自己的外网地址和密钥，部署形态一多就会在某个环境里失效。
 * 这里直接使用同一个存储 provider 与同一把 `sanitizeSites` 尺子，
 * 语义与 `/api/sites` 对齐，但少一次自请求。
 */
import { get, put, list, del, BlobPreconditionFailedError } from '#store'
import { resolveSiteStore } from '../shared/site-store.mjs'
import { checkAuthHeader } from '../shared/auth.mjs'
import { sanitizeSites } from '../shared/sanitize.mjs'
import { CATEGORY_GROUPS } from '../shared/categories.mjs'
import {
  buildBatch, mergeBatchInto, summarizeBatch,
  isAllowedCategory, categoryColor,
} from '../shared/ingest-core.mjs'

const store = resolveSiteStore({
  explicit: 'kv',
  ctx: { kv: { get, put, list, del }, pathname: 'sites.json' },
})

const STAGING_PREFIX = 'staging/'
const MAX_ITEMS = 2000
const MAX_BYTES = 2 * 1024 * 1024
const BATCH_ID_RE = /^batch-[0-9A-Za-z._-]{1,80}$/

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
}

async function readBody(req) {
  if (typeof req.body === 'string') return JSON.parse(req.body)
  if (req.body && typeof req.body.getReader === 'function') return new Response(req.body).json()
  return req.body || {}
}

async function readMain() {
  const { data, etag } = await store.read()
  return { data, etag }
}

function categoriesOf(main) {
  return Array.isArray(main?.categories) && main.categories.length ? main.categories : CATEGORY_GROUPS
}

function batchPath(id) {
  return `${STAGING_PREFIX}${id}.json`
}

async function readBatch(id) {
  if (!BATCH_ID_RE.test(String(id || ''))) return null
  try {
    return await store.readAt(batchPath(id))
  } catch {
    return null
  }
}

async function writeBatch(batch) {
  await put(batchPath(batch.id), JSON.stringify(batch), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  })
}

async function listBatches() {
  const { blobs } = await list({ prefix: STAGING_PREFIX, limit: 200 })
  const items = []
  for (const b of blobs || []) {
    if (!String(b.pathname).endsWith('.json')) continue
    const id = String(b.pathname).slice(STAGING_PREFIX.length, -5)
    if (!BATCH_ID_RE.test(id)) continue
    try {
      const batch = await store.readAt(String(b.pathname))
      if (batch && batch.kind === 'nav-ingest-batch') items.push(summarizeBatch(batch))
    } catch { /* 单批坏掉不影响列表 */ }
  }
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return items
}

function clampItems(items) {
  if (!Array.isArray(items)) return { ok: false, error: 'items 必须是数组' }
  if (!items.length) return { ok: false, error: 'items 不能为空' }
  if (items.length > MAX_ITEMS) {
    return { ok: false, error: `单批最多 ${MAX_ITEMS} 条（收到 ${items.length} 条），请分批同步` }
  }
  const bytes = Buffer.byteLength(JSON.stringify(items), 'utf8')
  if (bytes > MAX_BYTES) {
    return { ok: false, error: `单批请求体超过 ${Math.round(MAX_BYTES / 1024 / 1024)} MB，请减少条目或分批` }
  }
  return { ok: true }
}

export default async function handler(req, res) {
  noStore(res)

  const auth = checkAuthHeader(req)
  if (!auth.ok) { res.status(auth.code).json({ ok: false, error: auth.error }); return }

  const query = (req.query && typeof req.query === 'object') ? req.query : {}
  /**
   * 动作走 query 而不是子路径：`server/main.mjs` 的路由表是
   * `api/<name>.js ↔ /api/<name>` 派生的，`/api/ingest/promote` 会直接 404；
   * 而且适配层传给 handler 的对象里没有 `req.url`。
   */
  const action = String(query.action || '')

  /* ---------------- 读 ---------------- */
  if (req.method === 'GET') {
    try {
      const { data } = await readMain()
      const categories = categoriesOf(data)

      if (query.categories !== undefined) {
        res.status(200).json({
          ok: true,
          groups: categories,
          flat: categories.flatMap(g => (g.categories || []).map(c => ({
            id: c.id, label: c.label, groupId: g.id, groupLabel: g.label, dotColor: c.dotColor,
          }))),
        })
        return
      }

      if (query.batch) {
        const batch = await readBatch(String(query.batch))
        if (!batch) { res.status(404).json({ ok: false, error: '批次不存在' }); return }
        res.status(200).json({ ok: true, batch })
        return
      }

      const batches = await listBatches()
      res.status(200).json({
        ok: true,
        count: batches.length,
        batches,
        categories,
        limits: { maxItems: MAX_ITEMS, maxBytes: MAX_BYTES },
      })
      return
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) })
      return
    }
  }

  /* ---------------- 新建 / 预览 ---------------- */
  if (req.method === 'POST' && action !== 'promote') {
    let body
    try { body = await readBody(req) } catch { res.status(400).json({ ok: false, error: 'Invalid JSON body' }); return }
    const check = clampItems(body?.items)
    if (!check.ok) { res.status(400).json({ ok: false, error: check.error }); return }

    try {
      const { data } = await readMain()
      const categories = categoriesOf(data)
      const batch = buildBatch(body.items, {
        categories,
        existingSites: Array.isArray(data?.sites) ? data.sites : [],
        limit: MAX_ITEMS,
      })

      /**
       * 扩展端在保存前就会改分类。这里把覆盖应用回站点对象，
       * 否则「在扩展里选了分类、存进工作区又变回建议值」。
       * 键优先用归一化 URL（扩展端与服务端算法一致），兼容直接用 key。
       */
      const overrides = (body?.categoryOverrides && typeof body.categoryOverrides === 'object')
        ? body.categoryOverrides
        : {}
      if (Object.keys(overrides).length) {
        for (const item of batch.items) {
          const cat = overrides[item.url] || overrides[item.key]
          if (cat && isAllowedCategory(cat, categories)) {
            item.site.categoryId = cat
            item.site.color = categoryColor(cat, categories)
          }
        }
      }

      // preview 只回结果，不落盘：扩展端「先看看会得到什么」不该产生垃圾批次
      const preview = body?.dryRun === true || action === 'preview'
      if (!preview) {
        batch.meta = {
          client: String(body?.client || 'browser-extension').slice(0, 60),
          note: String(body?.note || '').slice(0, 200),
        }
        await writeBatch(batch)
      }
      res.status(200).json({ ok: true, persisted: !preview, batch })
      return
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) })
      return
    }
  }

  /* ---------------- 提升入主库 ---------------- */
  if (req.method === 'POST' && action === 'promote') {
    let body
    try { body = await readBody(req) } catch { res.status(400).json({ ok: false, error: 'Invalid JSON body' }); return }

    const batch = await readBatch(String(body?.batchId || ''))
    if (!batch) { res.status(404).json({ ok: false, error: '批次不存在' }); return }

    let main
    try {
      main = await readMain()
    } catch (e) {
      // 读失败绝不当空库：否则下一步会用「当前批次」覆盖掉整张站点表
      res.status(503).json({ ok: false, error: `读取主库失败（未做任何改动）：${String(e?.message || e)}` })
      return
    }
    const prev = main.data
    const prevVersion = Number(prev?.version) || 0
    const currentSites = Array.isArray(prev?.sites) ? prev.sites : []
    const categories = categoriesOf(prev)

    // 分类覆盖只接受登记过的 id，避免前端/扩展传入不存在的分类把下拉框打空
    const overrides = {}
    for (const [key, catId] of Object.entries(body?.categoryOverrides || {})) {
      if (isAllowedCategory(catId, categories)) overrides[key] = catId
    }

    const merged = mergeBatchInto(currentSites, batch, {
      keys: body?.keys,
      strategy: body?.strategy,
      categoryOverrides: overrides,
    })
    if (!merged.promoted.length) {
      res.status(200).json({ ok: true, noop: true, stats: merged.stats, batch: summarizeBatch(batch) })
      return
    }
    if (!sanitizeSites(merged.sites)) {
      res.status(400).json({ ok: false, error: '合并后的站点表未通过校验（未做任何改动）' })
      return
    }

    const snapshot = prev ? await store.writeSnapshot(prev) : { ok: true, pathname: null }
    const next = {
      version: prevVersion + 1,
      sites: merged.sites,
      updatedAt: new Date().toISOString(),
    }
    if (Array.isArray(prev?.categories) && prev.categories.length) next.categories = prev.categories

    try {
      await store.write(next, main.etag ? { ifMatch: main.etag } : { createOnly: true })
    } catch (e) {
      if (e instanceof BlobPreconditionFailedError) {
        res.status(409).json({ ok: false, error: '主库在你处理期间被其他写入更新，请刷新后重试', reason: 'precondition-failed' })
        return
      }
      throw e
    }

    // 批次状态：选中并成功写入的条目标 promoted，其余保持 pending
    const promotedSet = new Set(merged.promoted)
    for (const item of batch.items || []) {
      if (promotedSet.has(item.key)) item.status = 'promoted'
    }
    const pending = (batch.items || []).filter(i => i.status === 'pending').length
    batch.status = pending === 0 ? 'promoted' : 'partially-promoted'
    batch.updatedAt = new Date().toISOString()
    batch.lastPromote = {
      at: batch.updatedAt,
      added: merged.stats.added,
      updated: merged.stats.updated,
      skipped: merged.stats.skipped,
      version: next.version,
    }
    await writeBatch(batch).catch(() => { /* 状态回写失败不影响主库已写入的数据 */ })
    await store.pruneSnapshots().catch(() => {})

    res.status(200).json({
      ok: true,
      version: next.version,
      stats: merged.stats,
      snapshot,
      batch: summarizeBatch(batch),
    })
    return
  }

  /* ---------------- 丢弃 ---------------- */
  if (req.method === 'DELETE') {
    const id = String(query.batch || '')
    if (!BATCH_ID_RE.test(id)) { res.status(400).json({ ok: false, error: '批次 id 非法' }); return }
    try {
      await del(batchPath(id))
      res.status(200).json({ ok: true, deleted: id })
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) })
    }
    return
  }

  res.status(405).json({ ok: false, error: 'Method not allowed' })
}