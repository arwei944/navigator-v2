/**
 * 阶段 2 的洞察存储：实体、倒排检索、事件实体、告警、来源可信度。
 *
 * 与 `content-store.mjs` 共用同一个 `content.db`，但独立成文件控制体量。
 * 依赖方向是单向的：这里 import content-store 的 `db` / `entryRow`；
 * content-store 不反向 import，避免循环。
 */
import { createHash } from 'node:crypto'
import { db, entryRow } from './content-store.mjs'
import { tokenize } from '../shared/content-text.mjs'
import { extractEntities } from '../shared/content-entities.mjs'
import { buildEntityEdges, entityGraph } from '../shared/content-graph.mjs'

db.exec(`
  CREATE TABLE IF NOT EXISTS entities (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'unknown',
    first_seen INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL,
    count      INTEGER NOT NULL DEFAULT 0
  )
`)
db.exec(`
  CREATE TABLE IF NOT EXISTS entity_mentions (
    entity_id TEXT NOT NULL,
    entry_id  TEXT NOT NULL,
    at        INTEGER NOT NULL,
    PRIMARY KEY (entity_id, entry_id)
  )
`)
db.exec('CREATE INDEX IF NOT EXISTS idx_mentions_at ON entity_mentions(at)')
db.exec('CREATE INDEX IF NOT EXISTS idx_mentions_entry ON entity_mentions(entry_id)')
db.exec(`
  CREATE TABLE IF NOT EXISTS event_entities (
    event_id  TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    count     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (event_id, entity_id)
  )
`)
db.exec(`
  CREATE TABLE IF NOT EXISTS entry_terms (
    entry_id TEXT NOT NULL,
    term     TEXT NOT NULL,
    PRIMARY KEY (entry_id, term)
  )
`)
db.exec('CREATE INDEX IF NOT EXISTS idx_terms_term ON entry_terms(term)')
db.exec(`
  CREATE TABLE IF NOT EXISTS alerts (
    id         TEXT PRIMARY KEY,
    type       TEXT NOT NULL,
    severity   TEXT NOT NULL DEFAULT 'medium',
    title      TEXT NOT NULL,
    detail     TEXT NOT NULL DEFAULT '',
    entity_id  TEXT,
    entry_id   TEXT,
    created_at INTEGER NOT NULL,
    read       INTEGER NOT NULL DEFAULT 0
  )
`)
db.exec('CREATE INDEX IF NOT EXISTS idx_alerts_at ON alerts(created_at DESC)')
// 阶段 3：实体共现边（无向图，a < b 规范化）
db.exec(`
  CREATE TABLE IF NOT EXISTS entity_edges (
    a       TEXT NOT NULL,
    b       TEXT NOT NULL,
    co      INTEGER NOT NULL DEFAULT 0,
    sources INTEGER NOT NULL DEFAULT 0,
    weight  REAL NOT NULL DEFAULT 0,
    last_at INTEGER NOT NULL,
    PRIMARY KEY (a, b)
  )
`)
db.exec('CREATE INDEX IF NOT EXISTS idx_edges_weight ON entity_edges(weight DESC)')
// 阶段 3：人工反馈（隐藏/置顶/不相关/重要）
db.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    id          TEXT PRIMARY KEY,
    target_type TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    action      TEXT NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
  )
`)
db.exec('CREATE INDEX IF NOT EXISTS idx_feedback_target ON feedback(target_type, target_id)')

const stmtUpsertEntity = db.prepare(`
  INSERT INTO entities (id, name, kind, first_seen, last_seen, count)
  VALUES (?, ?, ?, ?, ?, 1)
  ON CONFLICT(id) DO UPDATE SET last_seen = MAX(last_seen, excluded.last_seen), count = count + 1
`)
const stmtMention = db.prepare('INSERT OR IGNORE INTO entity_mentions (entity_id, entry_id, at) VALUES (?, ?, ?)')
const stmtTerm = db.prepare('INSERT OR IGNORE INTO entry_terms (entry_id, term) VALUES (?, ?)')
const stmtMarkIndexed = db.prepare('UPDATE entries SET insights_at = ? WHERE id = ?')

/** 增量建立倒排索引与实体提及；每条只处理一次 */
export function syncInsights({ days = 7, limit = 2000 } = {}) {
  const since = Date.now() - Math.max(1, days) * 86400000
  const rows = db.prepare(`
    SELECT id, title, summary, content, published_at FROM entries
    WHERE published_at >= ? AND insights_at IS NULL
    ORDER BY published_at DESC LIMIT ?
  `).all(since, Math.max(1, Math.min(Number(limit) || 2000, 5000)))

  let terms = 0
  let mentions = 0
  db.exec('BEGIN')
  try {
    for (const row of rows) {
      const tokens = [...new Set(tokenize(`${row.title} ${row.summary || ''} ${String(row.content || '').slice(0, 1200)}`))]
        .slice(0, 300)
      for (const token of tokens) {
        stmtTerm.run(row.id, token)
        terms += 1
      }
      const list = extractEntities(`${row.title} ${row.summary || ''}`)
      for (const entity of list) {
        stmtUpsertEntity.run(entity.id, entity.name, entity.kind, row.published_at, row.published_at)
        stmtMention.run(entity.id, row.id, row.published_at)
        mentions += 1
      }
      stmtMarkIndexed.run(Date.now(), row.id)
    }
    db.exec('COMMIT')
  } catch (e) {
    try { db.exec('ROLLBACK') } catch { /* 忽略 */ }
    throw e
  }
  return { scanned: rows.length, terms, mentions }
}

/** 把事件与其成员条目的实体关联起来（全量重建，事件量小） */
export function linkEventEntities() {
  db.exec('DELETE FROM event_entities')
  db.exec(`
    INSERT OR REPLACE INTO event_entities (event_id, entity_id, count)
    SELECT ee.event_id, em.entity_id, COUNT(DISTINCT em.entry_id)
    FROM event_entries ee
    JOIN entity_mentions em ON em.entry_id = ee.entry_id
    GROUP BY ee.event_id, em.entity_id
  `)
  return Number(db.prepare('SELECT COUNT(*) AS n FROM event_entities').get().n) || 0
}

export function eventEntities(eventId) {
  return db.prepare(`
    SELECT en.id, en.name, en.kind, ee.count
    FROM event_entities ee JOIN entities en ON en.id = ee.entity_id
    WHERE ee.event_id = ? ORDER BY ee.count DESC, en.name ASC
  `).all(String(eventId)).map(r => ({ id: r.id, name: r.name, kind: r.kind, count: r.count }))
}

/** 列表页批量附加实体（避免每条一次查询） */
export function entitiesForEntries(entryIds = []) {
  const ids = (entryIds || []).filter(Boolean)
  const map = new Map()
  if (!ids.length) return map
  const placeholders = ids.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT em.entry_id, en.id, en.name, en.kind
    FROM entity_mentions em JOIN entities en ON en.id = em.entity_id
    WHERE em.entry_id IN (${placeholders})
    ORDER BY en.name ASC
  `).all(...ids)
  for (const row of rows) {
    if (!map.has(row.entry_id)) map.set(row.entry_id, [])
    map.get(row.entry_id).push({ id: row.id, name: row.name, kind: row.kind })
  }
  return map
}

/**
 * 基于倒排索引的检索；返回 null 表示「没有可用词项，调用方应回退 LIKE」。
 */
export function searchEntries({ q = '', domain = '', categoryId = '', since = 0, limit = 50 } = {}) {
  const terms = [...new Set(tokenize(q))].slice(0, 12)
  if (!terms.length) return null
  const placeholders = terms.map(() => '?').join(',')
  const where = [`et.term IN (${placeholders})`, 'e.hidden = 0']
  const params = [...terms]
  if (domain) { where.push('e.domain = ?'); params.push(domain) }
  if (categoryId) { where.push('e.category_id = ?'); params.push(categoryId) }
  if (since) { where.push('e.published_at >= ?'); params.push(Number(since)) }
  params.push(Math.max(1, Math.min(Number(limit) || 50, 200)))

  const hits = db.prepare(`
    SELECT et.entry_id, COUNT(*) AS c
    FROM entry_terms et JOIN entries e ON e.id = et.entry_id
    WHERE ${where.join(' AND ')}
    GROUP BY et.entry_id
    ORDER BY c DESC, MAX(e.published_at) DESC
    LIMIT ?
  `).all(...params)
  if (!hits.length) return []

  const ids = hits.map(h => h.entry_id)
  const order = new Map(ids.map((id, i) => [id, i]))
  const rows = db.prepare(`SELECT * FROM entries WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
  return rows.map(entryRow).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
}

export function topEntities({ hours = 24, limit = 20 } = {}) {
  const since = Date.now() - Math.max(1, hours) * 3600000
  return db.prepare(`
    SELECT en.id, en.name, en.kind, COUNT(DISTINCT em.entry_id) AS c,
           COUNT(DISTINCT e.source_id) AS sources, MAX(em.at) AS latest
    FROM entity_mentions em
    JOIN entities en ON en.id = em.entity_id
    JOIN entries e ON e.id = em.entry_id
    WHERE em.at >= ? AND e.hidden = 0
    GROUP BY en.id ORDER BY c DESC, latest DESC LIMIT ?
  `).all(since, Math.max(1, Math.min(Number(limit) || 20, 100))).map(r => ({
    id: r.id, name: r.name, kind: r.kind, count: r.c, sources: r.sources, latestAt: r.latest,
  }))
}

export function entityEntries(entityId, { limit = 50 } = {}) {
  return db.prepare(`
    SELECT e.* FROM entity_mentions em JOIN entries e ON e.id = em.entry_id
    WHERE em.entity_id = ? AND e.hidden = 0 ORDER BY e.published_at DESC LIMIT ?
  `).all(String(entityId), Math.max(1, Math.min(Number(limit) || 50, 200))).map(entryRow)
}

export function allEntities() {
  return db.prepare('SELECT id, name, kind, count FROM entities ORDER BY count DESC').all()
    .map(r => ({ id: r.id, name: r.name, kind: r.kind, count: r.count }))
}

/** 趋势计算需要的输入 */
export function trendInputs({ days = 7 } = {}) {
  const since = Date.now() - Math.max(1, days) * 86400000
  const entries = db.prepare(`
    SELECT id, published_at, source_id, domain, category_id, title, summary
    FROM entries WHERE published_at >= ? AND hidden = 0 ORDER BY published_at DESC
  `).all(since).map(r => ({
    id: r.id,
    publishedAt: r.published_at,
    sourceId: r.source_id,
    domain: r.domain,
    categoryId: r.category_id,
    title: r.title,
    summary: r.summary,
  }))
  const mentions = db.prepare(`
    SELECT em.entity_id, em.entry_id, em.at, e.source_id
    FROM entity_mentions em JOIN entries e ON e.id = em.entry_id
    WHERE em.at >= ? AND e.hidden = 0
  `).all(since)
    .map(r => ({ entityId: r.entity_id, entryId: r.entry_id, at: r.at, sourceId: r.source_id }))
  const names = new Map(db.prepare('SELECT id, name, kind FROM entities').all().map(r => [r.id, { name: r.name, kind: r.kind }]))
  return { entries, mentions, names }
}

/** 保存告警；同一天同类同对象只留一条 */
export function saveAlerts(list = [], { now = Date.now() } = {}) {
  const day = new Date(now).toISOString().slice(0, 10)
  const ins = db.prepare(`
    INSERT OR IGNORE INTO alerts (id, type, severity, title, detail, entity_id, entry_id, created_at, read)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
  `)
  let added = 0
  const fresh = []
  db.exec('BEGIN')
  try {
    for (const alert of list) {
      const key = String(alert.key || `${alert.type}:${alert.title}`)
      const id = createHash('sha256').update(`${key}:${day}`).digest('hex').slice(0, 20)
      const changes = Number(ins.run(
        id, alert.type, alert.severity || 'medium', String(alert.title || '').slice(0, 200),
        String(alert.detail || '').slice(0, 500), alert.entityId || null, alert.entryId || null, now,
      ).changes) || 0
      added += changes
      if (changes) fresh.push({ ...alert, id, createdAt: now })
    }
    db.exec('COMMIT')
  } catch (e) {
    try { db.exec('ROLLBACK') } catch { /* 忽略 */ }
    throw e
  }
  // 告警只保留最近 500 条
  db.prepare('DELETE FROM alerts WHERE id NOT IN (SELECT id FROM alerts ORDER BY created_at DESC LIMIT 500)').run()
  return { added, fresh }
}

export function listAlerts({ limit = 20, unreadOnly = false } = {}) {
  const sql = `SELECT * FROM alerts ${unreadOnly ? 'WHERE read = 0' : ''} ORDER BY created_at DESC LIMIT ?`
  return db.prepare(sql).all(Math.max(1, Math.min(Number(limit) || 20, 100))).map(r => ({
    id: r.id, type: r.type, severity: r.severity, title: r.title, detail: r.detail,
    entityId: r.entity_id, entryId: r.entry_id, createdAt: r.created_at, read: r.read === 1,
  }))
}

export function markAlertsRead(ids = []) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean)
  if (!list.length) return 0
  const stmt = db.prepare('UPDATE alerts SET read = 1 WHERE id = ?')
  let changed = 0
  for (const id of list) changed += Number(stmt.run(id).changes) || 0
  return changed
}

export function setCredibility(sourceId, value) {
  const n = Math.max(0.2, Math.min(2, Number(value) || 1))
  db.prepare('UPDATE sources SET credibility = ?, updated_at = ? WHERE id = ?').run(n, Date.now(), String(sourceId))
  return n
}

export function credibilityMap() {
  return new Map(db.prepare('SELECT id, credibility FROM sources').all().map(r => [r.id, Number(r.credibility) || 1]))
}

export function failingSources({ threshold = 3 } = {}) {
  return db.prepare('SELECT id, label, fail_count, last_error FROM sources WHERE enabled = 1 AND fail_count >= ?')
    .all(Number(threshold) || 3)
    .map(r => ({ id: r.id, label: r.label, failCount: r.fail_count, error: r.last_error || '' }))
}

/* ---------------- 阶段 3：图谱 ---------------- */

/** 建边与图谱共用的输入；隐藏条目不参与 */
export function graphInputs({ days = 7, limit = 3000 } = {}) {
  const since = Date.now() - Math.max(1, days) * 86400000
  const mentions = db.prepare(`
    SELECT em.entity_id, em.entry_id, em.at, e.source_id
    FROM entity_mentions em JOIN entries e ON e.id = em.entry_id
    WHERE em.at >= ? AND e.hidden = 0
    ORDER BY em.at DESC LIMIT ?
  `).all(since, Math.max(1, Math.min(Number(limit) || 3000, 8000)))
    .map(r => ({ entityId: r.entity_id, entryId: r.entry_id, at: r.at, sourceId: r.source_id }))
  const names = new Map(
    db.prepare('SELECT id, name, kind FROM entities').all().map(r => [r.id, { name: r.name, kind: r.kind }]),
  )
  return { mentions, names }
}

/** 全量重建共现边（边数量小，重建比增量更不容易漂移） */
export function rebuildEntityEdges({ days = 7, minCo = 2 } = {}) {
  const { mentions } = graphInputs({ days, limit: 6000 })
  const edges = buildEntityEdges({ mentions, minCo, limit: 800 })
  db.exec('BEGIN')
  try {
    db.exec('DELETE FROM entity_edges')
    const ins = db.prepare(`
      INSERT OR REPLACE INTO entity_edges (a, b, co, sources, weight, last_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const edge of edges) {
      ins.run(edge.a, edge.b, edge.co, edge.sources, edge.weight, edge.lastAt || Date.now())
    }
    db.exec('COMMIT')
  } catch (e) {
    try { db.exec('ROLLBACK') } catch { /* 忽略 */ }
    throw e
  }
  return { mentions: mentions.length, edges: edges.length }
}

export function graphData({ hours = 168, maxNodes = 40, minCo = 2 } = {}) {
  const { mentions, names } = graphInputs({ days: Math.max(1, Number(hours) / 24), limit: 6000 })
  return entityGraph({ mentions, names, maxNodes, minCo })
}

export function entityNeighbors(entityId, { limit = 12 } = {}) {
  const id = String(entityId)
  return db.prepare(`
    SELECT CASE WHEN a = ? THEN b ELSE a END AS other, co, sources, weight, last_at
    FROM entity_edges WHERE a = ? OR b = ?
    ORDER BY weight DESC LIMIT ?
  `).all(id, id, id, Math.max(1, Math.min(Number(limit) || 12, 50))).map(row => {
    const meta = db.prepare('SELECT name, kind FROM entities WHERE id = ?').get(row.other) || {}
    return {
      id: row.other,
      name: meta.name || row.other,
      kind: meta.kind || 'unknown',
      co: row.co,
      sources: row.sources,
      weight: row.weight,
      lastAt: row.last_at,
    }
  })
}

/* ---------------- 阶段 3：人工反馈 ---------------- */

export function addFeedback({ targetType = 'entry', targetId, action, note = '' } = {}) {
  const type = String(targetType || 'entry')
  const id = String(targetId || '')
  const act = String(action || '')
  if (!id || !act) throw new Error('反馈缺少目标或动作')
  const createdAt = Date.now()
  const fid = createHash('sha256')
    .update(`${type}:${id}:${act}:${createdAt}:${Math.random()}`)
    .digest('hex').slice(0, 20)
  db.prepare(`
    INSERT INTO feedback (id, target_type, target_id, action, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(fid, type, id, act, String(note || '').slice(0, 200), createdAt)
  return { id: fid, targetType: type, targetId: id, action: act, note: String(note || ''), createdAt }
}

export function listFeedback({ targetType = '', targetId = '', limit = 50 } = {}) {
  const where = []
  const params = []
  if (targetType) { where.push('target_type = ?'); params.push(String(targetType)) }
  if (targetId) { where.push('target_id = ?'); params.push(String(targetId)) }
  params.push(Math.max(1, Math.min(Number(limit) || 50, 200)))
  return db.prepare(`
    SELECT * FROM feedback ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC LIMIT ?
  `).all(...params).map(r => ({
    id: r.id,
    targetType: r.target_type,
    targetId: r.target_id,
    action: r.action,
    note: r.note,
    createdAt: r.created_at,
  }))
}

/**
 * 反馈 → 来源权重系数。
 * 「重要」加分、「不相关」减分，夹在 0.5–1.8 之间，避免几次点击就把一个源打死。
 */
export function feedbackScoreMap() {
  const rows = db.prepare(`
    SELECT CASE WHEN f.target_type = 'source' THEN f.target_id ELSE e.source_id END AS source_id,
           f.action, COUNT(*) AS n
    FROM feedback f
    LEFT JOIN entries e ON f.target_type = 'entry' AND e.id = f.target_id
    WHERE f.target_type IN ('entry', 'source')
    GROUP BY source_id, f.action
  `).all()
  const map = new Map()
  for (const row of rows) {
    if (!row.source_id) continue
    let score = map.get(row.source_id) ?? 1
    if (row.action === 'important') score += 0.1 * Math.min(5, Number(row.n) || 0)
    if (row.action === 'irrelevant') score -= 0.15 * Math.min(5, Number(row.n) || 0)
    map.set(row.source_id, score)
  }
  for (const [id, score] of map) {
    map.set(id, Math.max(0.5, Math.min(1.8, Math.round(score * 100) / 100)))
  }
  return map
}