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
      import('../server/content-insights-store.mjs'),
      import('../server/content-insights.mjs'),
      import('../server/content-analytics.mjs'),
      import('../server/content-cron.mjs'),
    ]).then(([store, fetch, process, insightsStore, insights, analytics, cron]) => ({
      ...store, ...fetch, ...process, ...insightsStore, ...insights, ...analytics, ...cron,
    }))
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
      if (query.insights !== undefined) {
        res.status(200).json({ ok: true, ...mods.getInsights({ hours: Number(query.hours) || 24 }) })
        return
      }
      if (query.graph !== undefined) {
        res.status(200).json({
          ok: true,
          ...mods.graphView({ hours: Number(query.hours) || 168, maxNodes: Number(query.nodes) || 40 }),
        })
        return
      }
      if (query.impact !== undefined) {
        res.status(200).json({
          ok: true,
          ...mods.impactEvents({
            domain: String(query.domain || ''),
            hours: Number(query.hours) || 24,
            limit: Number(query.limit) || 20,
          }),
        })
        return
      }
      if (query.reports !== undefined) {
        res.status(200).json({
          ok: true,
          items: mods.listReports({ type: String(query.type || 'weekly'), limit: Number(query.limit) || 12 }),
        })
        return
      }
      if (query.report !== undefined) {
        const type = String(query.report || 'weekly')
        const report = query.id ? mods.getReport(String(query.id)) : mods.latestReport(type)
        res.status(200).json({ ok: true, report })
        return
      }
      if (query.feedback !== undefined) {
        res.status(200).json({
          ok: true,
          ...mods.feedbackView({
            targetType: String(query.targetType || ''),
            targetId: String(query.targetId || ''),
            limit: Number(query.limit) || 50,
          }),
        })
        return
      }
      if (query.entities !== undefined) {
        res.status(200).json({
          ok: true,
          entities: mods.topEntities({ hours: Number(query.hours) || 24, limit: Number(query.limit) || 20 }),
          catalog: mods.allEntities().slice(0, 200),
        })
        return
      }
      if (query.entity) {
        const id = String(query.entity)
        const items = mods.entityEntries(id, { limit: Number(query.limit) || 50 })
        res.status(200).json({
          ok: true, items, count: items.length, neighbors: mods.entityNeighbors(id),
        })
        return
      }
      if (query.alerts !== undefined) {
        res.status(200).json({
          ok: true,
          items: mods.listAlerts({ limit: Number(query.limit) || 20, unreadOnly: String(query.unread || '') === '1' }),
          keywords: mods.getAlertKeywords(),
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
        // 事件卡直接带影响分与实体，避免前端逐条再请求
        try {
          const assessed = new Map(
            mods.impactEvents({ domain: String(query.domain || ''), hours: 24 * 30, limit: 80 })
              .items.map(x => [x.id, x]),
          )
          for (const item of items) {
            const hit = assessed.get(item.id)
            if (!hit) continue
            item.impact = hit.impact
            item.entities = hit.entities
            item.actions = hit.actions
          }
        } catch { /* 影响分析失败不影响事件列表 */ }
        res.status(200).json({ ok: true, items, count: items.length })
        return
      }
      if (query.event) {
        const event = mods.getEvent(String(query.event))
        if (!event) { res.status(404).json({ ok: false, error: '事件不存在' }); return }
        res.status(200).json({ ok: true, event: { ...event, entities: mods.eventEntities(event.id) } })
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
      const q = String(query.q || '').trim()
      const domain = String(query.domain || '')
      const categoryId = String(query.categoryId || '')
      let items = null
      let hasMore = false

      // 有查询词时优先走倒排索引（可解释、支持中文 2-gram）；无词项时回退 LIKE
      if (q) {
        const searched = mods.searchEntries({ q, domain, categoryId, limit: limit + 1 })
        if (searched) {
          items = searched
          hasMore = items.length > limit
        }
      }
      if (!items) {
        items = mods.listEntries({
          domain,
          categoryId,
          sourceId: String(query.sourceId || ''),
          q,
          unread: String(query.unread || '') === '1',
          saved: String(query.saved || '') === '1',
          limit: limit + 1,
          before: Number(query.before) || 0,
        })
        hasMore = items.length > limit
      }

      const page = hasMore ? items.slice(0, limit) : items
      const entityMap = mods.entitiesForEntries(page.map(i => i.id))
      for (const item of page) item.entities = entityMap.get(item.id) || []
      res.status(200).json({
        ok: true,
        items: page,
        hasMore,
        stats: mods.stats(),
        processing: mods.processingStats(),
        llm: mods.llmAvailable(),
        translation: mods.translationAvailable(),
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

      if (action === 'alert-read') {
        const changed = mods.markAlertsRead(body?.ids || [])
        res.status(200).json({ ok: true, changed })
        return
      }

      if (action === 'set-keywords') {
        const keywords = mods.setAlertKeywords(body?.keywords || [])
        res.status(200).json({ ok: true, keywords })
        return
      }

      if (action === 'credibility') {
        const value = mods.setCredibility(String(body?.id || ''), body?.value)
        res.status(200).json({ ok: true, credibility: value })
        return
      }

      if (action === 'insights') {
        const r = await mods.refreshInsights()
        res.status(200).json({ ok: true, ...r })
        return
      }

      if (action === 'feedback') {
        const r = mods.applyFeedback({
          targetType: String(body?.targetType || 'entry'),
          targetId: String(body?.targetId || body?.id || ''),
          action: String(body?.feedback || body?.verb || ''),
          note: String(body?.note || ''),
        })
        res.status(200).json({ ok: true, ...r })
        return
      }

      if (action === 'report') {
        const report = await mods.ensureWeeklyReport({ force: Boolean(body?.force) })
        res.status(200).json({ ok: true, report })
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
          intervalMin: body?.intervalMin,
          enabled: body?.enabled,
        })
        if (body?.credibility !== undefined) mods.setCredibility(source.id, body.credibility)
        res.status(200).json({ ok: true, source: mods.getSource(source.id) })
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