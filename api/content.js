/**
 * 内容动态接口。
 *
 *   GET  /api/content                 → 条目列表
 *   GET  /api/content?stats=1         → 统计
 *   GET  /api/content?sources=1       → 源清单 + 最近抓取日志
 *   GET  /api/content?entry=<id>      → 单条详情
 *   POST /api/content?action=refresh  → 触发抓取（默认异步，wait=1 时等待）
 *   POST /api/content?action=source   → 新增/编辑源
 *   POST /api/content?action=delete-source
 *   POST /api/content?action=read     → { ids, read }
 *   POST /api/content?action=save     → { ids, saved }
 *
 * ## 为什么依赖是惰性导入
 *
 * 内容模块依赖 `fast-xml-parser` 与 `node:sqlite`。部署产物只带源码、不带
 * `node_modules`，而 `server/main.mjs` 会在启动时 import 所有 `api/*.js`。
 * 顶层导入会让**整个线上服务**因为一个未启用的本地功能而起不来。
 * 因此这里只在真正收到请求时才加载内容模块；线上没启用时永远不会触发。
 */
import { checkAuthHeader } from '../shared/auth.mjs'

let modsPromise = null

function contentModules() {
  if (!modsPromise) {
    modsPromise = Promise.all([
      import('../server/content-store.mjs'),
      import('../server/content-fetch.mjs'),
      import('../server/content-process.mjs'),
      import('../server/content-cron.mjs'),
    ]).then(([store, fetch, process, cron]) => ({ ...store, ...fetch, ...process, ...cron }))
  }
  return modsPromise
}

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
}

async function readBody(req) {
  if (typeof req.body === 'string') return JSON.parse(req.body)
  if (req.body && typeof req.body.getReader === 'function') return new Response(req.body).json()
  return req.body || {}
}

function q(req) {
  return (req.query && typeof req.query === 'object') ? req.query : {}
}

export default async function handler(req, res) {
  noStore(res)

  let mods
  try {
    mods = await contentModules()
  } catch (e) {
    res.status(503).json({
      ok: false,
      error: `内容模块不可用（未安装依赖或未启用）：${String(e?.message || e)}`,
    })
    return
  }

  if (req.method === 'GET') {
    const query = q(req)
    try {
      if (query.stats !== undefined) {
        res.status(200).json({
          ok: true,
          stats: mods.stats(),
          scheduler: mods.getContentStatus(),
          processing: mods.processingStats(),
          llm: mods.llmAvailable(),
          translation: mods.translationAvailable(),
        })
        return
      }
      if (query.processing !== undefined) {
        res.status(200).json({
          ok: true,
          processing: mods.processingStats(),
          running: mods.isProcessing(),
          llm: mods.llmAvailable(),
          translation: mods.translationAvailable(),
          scheduler: mods.getContentStatus(),
        })
        return
      }
      if (query.events !== undefined) {
        const items = mods.listEvents({
          domain: String(query.domain || ''),
          limit: Number(query.limit) || 30,
          before: Number(query.before) || 0,
          since: Number(query.since) || 0,
        })
        res.status(200).json({ ok: true, items, count: items.length })
        return
      }
      if (query.event) {
        const event = mods.getEvent(String(query.event))
        if (!event) { res.status(404).json({ ok: false, error: '事件不存在' }); return }
        res.status(200).json({ ok: true, event })
        return
      }
      if (query.digest !== undefined) {
        const digest = query.date ? mods.getDigest(String(query.date)) : mods.latestDigest()
        res.status(200).json({ ok: true, digest })
        return
      }
      if (query.sources !== undefined) {
        res.status(200).json({
          ok: true,
          sources: mods.listSources(),
          fetches: mods.recentFetches(Number(query.fetches) || 20),
          scheduler: mods.getContentStatus(),
        })
        return
      }
      if (query.entry) {
        const entry = mods.getEntry(String(query.entry))
        if (!entry) { res.status(404).json({ ok: false, error: '条目不存在' }); return }
        res.status(200).json({ ok: true, entry })
        return
      }

      const limit = Math.max(1, Math.min(Number(query.limit) || 50, 200))
      const items = mods.listEntries({
        domain: String(query.domain || ''),
        categoryId: String(query.categoryId || ''),
        sourceId: String(query.sourceId || ''),
        q: String(query.q || '').trim(),
        unread: String(query.unread || '') === '1',
        saved: String(query.saved || '') === '1',
        limit: limit + 1,
        before: Number(query.before) || 0,
      })
      const hasMore = items.length > limit
      res.status(200).json({
        ok: true,
        items: hasMore ? items.slice(0, limit) : items,
        hasMore,
        stats: mods.stats(),
        scheduler: mods.getContentStatus(),
      })
      return
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) })
      return
    }
  }

  if (req.method === 'POST') {
    const auth = checkAuthHeader(req)
    if (!auth.ok) { res.status(auth.code).json({ ok: false, error: auth.error }); return }

    let body
    try { body = await readBody(req) } catch { res.status(400).json({ ok: false, error: 'Invalid JSON body' }); return }
    const query = q(req)
    const action = String(query.action || body?.action || '')

    try {
      if (action === 'refresh') {
        if (mods.isRefreshing()) { res.status(200).json({ ok: true, started: true, running: true }); return }
        const sourceIds = Array.isArray(body?.sourceIds) ? body.sourceIds.map(String) : []
        if (body?.wait) {
          const r = await mods.refreshSources({ sourceIds, force: sourceIds.length === 0 })
          res.status(200).json({ ok: true, ...r })
          return
        }
        mods.refreshSources({ sourceIds, force: sourceIds.length === 0 }).catch(() => {})
        res.status(200).json({ ok: true, started: true, running: true })
        return
      }

      if (action === 'process') {
        if (mods.isProcessing()) { res.status(200).json({ ok: true, started: true, running: true }); return }
        const opts = {
          extractLimit: Number(body?.extractLimit) || 12,
          summaryLimit: Number(body?.summaryLimit) || 12,
        }
        if (body?.wait) {
          const r = await mods.processContent(opts)
          res.status(200).json({ ok: true, ...r })
          return
        }
        mods.processContent(opts).catch(() => {})
        res.status(200).json({ ok: true, started: true })
        return
      }

      if (action === 'source') {
        const source = mods.upsertSource({
          id: body?.id,
          label: body?.label,
          type: body?.type,
          url: body?.url,
          domain: body?.domain,
          categoryId: body?.categoryId,
          weight: body?.weight,
          maxItems: body?.maxItems,
          enabled: body?.enabled,
        })
        res.status(200).json({ ok: true, source })
        return
      }

      if (action === 'delete-source') {
        const ok = mods.removeSource(String(body?.id || ''))
        res.status(ok ? 200 : 404).json({ ok, error: ok ? undefined : '源不存在' })
        return
      }

      if (action === 'read' || action === 'save') {
        const changed = mods.setEntryFlags(body?.ids, action === 'read'
          ? { read: Boolean(body?.read) }
          : { saved: Boolean(body?.saved) })
        res.status(200).json({ ok: true, changed })
        return
      }

      if (action === 'source-test') {
        const source = mods.getSource(String(body?.id || ''))
        if (!source) { res.status(404).json({ ok: false, error: '源不存在' }); return }
        const r = await mods.refreshSources({ sourceIds: [source.id], intervalMinutes: 20 })
        const first = r.results?.[0] || null
        res.status(200).json({ ok: true, result: first, totals: r.totals })
        return
      }

      res.status(400).json({ ok: false, error: `未知动作：${action || '(空)'}` })
      return
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) })
      return
    }
  }

  res.status(405).json({ ok: false, error: 'Method not allowed' })
}