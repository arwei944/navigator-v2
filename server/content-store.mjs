/**
 * 内容动态的本地存储（独立 SQLite：`data/content.db`）。
 *
 * ## 为什么单独一个库
 *
 * 站点库 `store.db` 是三端同步与发布的权威数据；内容条目每天几百条、
 * 30 天就上万条，混进主库会让备份、快照、同步都变重。独立库还能独立清理，
 * 不影响站点数据。
 *
 * ## 只存摘要，不存全文
 *
 * `entries.summary` 是抽取后的纯文本（≤ 600 字），不保存原始 HTML/RSS。
 * 一是体积可控，二是避免把别人的全文长期落盘。
 */
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { entryFingerprint, classifyEntry, ttlCutoff, backoffDelayMs } from '../shared/content-core.mjs'
import { CONTENT_SOURCES, CONTENT_DEFAULTS } from '../shared/content-sources.mjs'

const DB_PATH = process.env.NAV_CONTENT_DB || join(process.cwd(), 'data', 'content.db')
mkdirSync(dirname(DB_PATH), { recursive: true })

export const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS sources (
    id             TEXT PRIMARY KEY,
    label          TEXT NOT NULL,
    type           TEXT NOT NULL,
    url            TEXT NOT NULL,
    domain         TEXT NOT NULL,
    category_id    TEXT NOT NULL,
    weight         REAL NOT NULL DEFAULT 1,
    max_items      INTEGER NOT NULL DEFAULT 60,
    enabled        INTEGER NOT NULL DEFAULT 1,
    etag           TEXT,
    last_modified  TEXT,
    last_fetch_at  INTEGER,
    last_success_at INTEGER,
    fail_count     INTEGER NOT NULL DEFAULT 0,
    last_error     TEXT,
    next_fetch_at  INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  )
`)
db.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    id           TEXT PRIMARY KEY,
    source_id    TEXT NOT NULL,
    guid         TEXT NOT NULL,
    url          TEXT NOT NULL,
    title        TEXT NOT NULL,
    summary      TEXT NOT NULL DEFAULT '',
    author       TEXT NOT NULL DEFAULT '',
    published_at INTEGER NOT NULL,
    fetched_at   INTEGER NOT NULL,
    fingerprint  TEXT NOT NULL,
    domain       TEXT NOT NULL,
    category_id  TEXT NOT NULL,
    score        REAL NOT NULL DEFAULT 0,
    read         INTEGER NOT NULL DEFAULT 0,
    saved        INTEGER NOT NULL DEFAULT 0,
    UNIQUE(source_id, guid)
  )
`)
db.exec('CREATE INDEX IF NOT EXISTS idx_entries_pub ON entries(published_at DESC)')
db.exec('CREATE INDEX IF NOT EXISTS idx_entries_domain ON entries(domain, published_at DESC)')
db.exec('CREATE INDEX IF NOT EXISTS idx_entries_fp ON entries(fingerprint)')
db.exec('CREATE INDEX IF NOT EXISTS idx_entries_read ON entries(read, published_at DESC)')
db.exec(`
  CREATE TABLE IF NOT EXISTS fetch_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id   TEXT NOT NULL,
    at          INTEGER NOT NULL,
    status      TEXT NOT NULL,
    http_status INTEGER,
    bytes       INTEGER,
    duration_ms INTEGER,
    added       INTEGER,
    error       TEXT
  )
`)
db.exec('CREATE INDEX IF NOT EXISTS idx_fetch_source ON fetch_log(source_id, at DESC)')
db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)')
// 已有库补列（CREATE TABLE IF NOT EXISTS 不会修改旧表）
try { db.exec('ALTER TABLE sources ADD COLUMN max_items INTEGER NOT NULL DEFAULT 60') } catch { /* 已存在 */ }

const nowIso = () => new Date().toISOString()

const stmtInsertSource = db.prepare(`
  INSERT OR IGNORE INTO sources
    (id, label, type, url, domain, category_id, weight, max_items, enabled, next_fetch_at, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
`)
const stmtGetSource = db.prepare('SELECT * FROM sources WHERE id = ?')
const stmtAllSources = db.prepare('SELECT * FROM sources ORDER BY enabled DESC, id ASC')
const stmtDueSources = db.prepare('SELECT * FROM sources WHERE enabled = 1 AND next_fetch_at <= ? ORDER BY next_fetch_at ASC')
const stmtUpdateSource = db.prepare(`
  UPDATE sources SET label = ?, url = ?, domain = ?, category_id = ?, weight = ?, enabled = ?, updated_at = ?
  WHERE id = ?
`)
const stmtDeleteSource = db.prepare('DELETE FROM sources WHERE id = ?')
const stmtEntryByFp = db.prepare('SELECT id, source_id FROM entries WHERE fingerprint = ? LIMIT 1')
const stmtInsertEntry = db.prepare(`
  INSERT OR IGNORE INTO entries
    (id, source_id, guid, url, title, summary, author, published_at, fetched_at, fingerprint, domain, category_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const stmtInsertLog = db.prepare(`
  INSERT INTO fetch_log (source_id, at, status, http_status, bytes, duration_ms, added, error)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)

function sourceRow(row) {
  if (!row) return null
  return {
    id: row.id,
    label: row.label,
    type: row.type,
    url: row.url,
    domain: row.domain,
    categoryId: row.category_id,
    weight: Number(row.weight) || 1,
    maxItems: Number(row.max_items) || 60,
    enabled: row.enabled === 1,
    etag: row.etag || '',
    lastModified: row.last_modified || '',
    lastFetchAt: row.last_fetch_at || null,
    lastSuccessAt: row.last_success_at || null,
    failCount: Number(row.fail_count) || 0,
    lastError: row.last_error || '',
    nextFetchAt: row.next_fetch_at || 0,
  }
}

function entryRow(row) {
  if (!row) return null
  return {
    id: row.id,
    sourceId: row.source_id,
    url: row.url,
    title: row.title,
    summary: row.summary,
    author: row.author,
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
    fingerprint: row.fingerprint,
    domain: row.domain,
    categoryId: row.category_id,
    score: Number(row.score) || 0,
    read: row.read === 1,
    saved: row.saved === 1,
  }
}

/** 首次启动写入内置源；已存在的源保留用户改过的启停/权重/游标 */
export function seedSources(list = CONTENT_SOURCES) {
  const now = Date.now()
  let added = 0
  db.exec('BEGIN')
  try {
    for (const s of list) {
      const r = stmtInsertSource.run(
        s.id, s.label, s.type, s.url, s.domain, s.categoryId,
        Number(s.weight) || 1, Number(s.maxItems) || 60, now, now,
      )
      added += Number(r.changes) || 0
    }
    db.exec('COMMIT')
  } catch (e) {
    try { db.exec('ROLLBACK') } catch { /* 忽略 */ }
    throw e
  }
  return added
}

export function listSources() {
  return stmtAllSources.all().map(sourceRow)
}

export function getSource(id) {
  return sourceRow(stmtGetSource.get(String(id)))
}

export function dueSources(now = Date.now()) {
  return stmtDueSources.all(now).map(sourceRow)
}

export function upsertSource(input) {
  const id = String(input?.id || '').trim()
  if (!id) throw new Error('源 id 不能为空')
  const existing = getSource(id)
  const now = Date.now()
  if (!existing) {
    const r = stmtInsertSource.run(
      id, String(input.label || id), String(input.type || 'rss'), String(input.url || ''),
      String(input.domain || 'ai-work'), String(input.categoryId || 'learning'),
      Number(input.weight) || 1, now, now,
    )
    if (!Number(r.changes)) throw new Error('源已存在')
  }
  if (existing || input.label) {
    stmtUpdateSource.run(
      String(input.label || existing?.label || id),
      String(input.url || existing?.url || ''),
      String(input.domain || existing?.domain || 'ai-work'),
      String(input.categoryId || existing?.categoryId || 'learning'),
      Number(input.weight ?? existing?.weight ?? 1),
      input.enabled === undefined ? (existing?.enabled === false ? 0 : 1) : (input.enabled ? 1 : 0),
      now, id,
    )
  }
  return getSource(id)
}

export function removeSource(id) {
  const r = stmtDeleteSource.run(String(id))
  return Number(r.changes) > 0
}

/**
 * 写入一批条目。跨源同指纹只保留首见的一条 —— 阶段 0 先保证列表干净；
 * 阶段 1 的事件聚类会把多源报道重新合并展示。
 */
export function insertEntries(source, entries) {
  const now = Date.now()
  let added = 0
  db.exec('BEGIN')
  try {
    for (const raw of Array.isArray(entries) ? entries : []) {
      if (!raw || !raw.title) continue
      // 只保留 30 天内的条目：避免「先插入再清理」制造虚假的新增/清理数字
      if ((Number(raw.publishedAt) || now) < ttlCutoff(CONTENT_DEFAULTS.entryTtlDays, now)) continue
      const classification = classifyEntry(raw, source)
      const fp = entryFingerprint(raw)
      if (stmtEntryByFp.get(fp)) continue
      const id = createHash('sha256').update(`${source.id}\n${raw.guid}`).digest('hex').slice(0, 24)
      const r = stmtInsertEntry.run(
        id, source.id, String(raw.guid || raw.url || raw.title),
        String(raw.url || ''), String(raw.title), String(raw.summary || ''),
        String(raw.author || ''), Number(raw.publishedAt) || now, now,
        fp, classification.domain, classification.categoryId,
      )
      added += Number(r.changes) || 0
    }
    db.exec('COMMIT')
  } catch (e) {
    try { db.exec('ROLLBACK') } catch { /* 忽略 */ }
    throw e
  }
  return added
}

/** 抓取结果回写：成功清失败计数，失败按阶梯退避 */
export function recordFetch({ source, status, httpStatus = null, bytes = 0, durationMs = 0, added = 0, error = '', intervalMinutes = CONTENT_DEFAULTS.intervalMinutes }) {
  const now = Date.now()
  const ok = status === 'ok' || status === 'not-modified' || status === 'empty'
  db.exec('BEGIN')
  try {
    if (ok) {
      db.prepare(`
        UPDATE sources SET last_fetch_at = ?, last_success_at = ?, fail_count = 0,
          last_error = '', next_fetch_at = ?, updated_at = ?
        WHERE id = ?
      `).run(now, now, now + Math.max(1, intervalMinutes) * 60000, now, source.id)
    } else {
      const fails = (Number(source.fail_count) || 0) + 1
      db.prepare(`
        UPDATE sources SET last_fetch_at = ?, fail_count = ?, last_error = ?,
          next_fetch_at = ?, updated_at = ?
        WHERE id = ?
      `).run(now, fails, String(error || '').slice(0, 300), now + backoffDelayMs(fails), now, source.id)
    }
    stmtInsertLog.run(source.id, now, status, httpStatus, bytes, durationMs, added, String(error || '').slice(0, 300))
    db.exec('COMMIT')
  } catch (e) {
    try { db.exec('ROLLBACK') } catch { /* 忽略 */ }
    throw e
  }
}

/** 条件请求游标（ETag / Last-Modified） */
export function saveSourceCursor(id, { etag = null, lastModified = null } = {}) {
  db.prepare('UPDATE sources SET etag = ?, last_modified = ?, updated_at = ? WHERE id = ?')
    .run(etag || null, lastModified || null, Date.now(), String(id))
}

export function listEntries({
  domain = '', categoryId = '', sourceId = '', q = '', unread = false,
  saved = false, limit = 50, before = 0,
} = {}) {
  const where = []
  const params = []
  if (domain) { where.push('domain = ?'); params.push(domain) }
  if (categoryId) { where.push('category_id = ?'); params.push(categoryId) }
  if (sourceId) { where.push('source_id = ?'); params.push(sourceId) }
  if (unread) where.push('read = 0')
  if (saved) where.push('saved = 1')
  if (q) { where.push('(title LIKE ? OR summary LIKE ?)'); params.push(`%${q}%`, `%${q}%`) }
  if (before) { where.push('published_at < ?'); params.push(Number(before)) }
  const sql = `SELECT * FROM entries ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY published_at DESC, id DESC LIMIT ?`
  params.push(Math.max(1, Math.min(Number(limit) || 50, 200)))
  return db.prepare(sql).all(...params).map(entryRow)
}

export function getEntry(id) {
  return entryRow(db.prepare('SELECT * FROM entries WHERE id = ?').get(String(id)))
}

export function setEntryFlags(ids, { read, saved } = {}) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean)
  if (!list.length) return 0
  let changed = 0
  db.exec('BEGIN')
  try {
    for (const id of list) {
      if (read !== undefined) {
        changed += Number(db.prepare('UPDATE entries SET read = ? WHERE id = ?').run(read ? 1 : 0, id).changes) || 0
      }
      if (saved !== undefined) {
        changed += Number(db.prepare('UPDATE entries SET saved = ? WHERE id = ?').run(saved ? 1 : 0, id).changes) || 0
      }
    }
    db.exec('COMMIT')
  } catch (e) {
    try { db.exec('ROLLBACK') } catch { /* 忽略 */ }
    throw e
  }
  return changed
}

export function stats(now = Date.now()) {
  const total = db.prepare('SELECT COUNT(*) AS n FROM entries').get().n
  const unread = db.prepare('SELECT COUNT(*) AS n FROM entries WHERE read = 0').get().n
  const saved = db.prepare('SELECT COUNT(*) AS n FROM entries WHERE saved = 1').get().n
  const today = db.prepare('SELECT COUNT(*) AS n FROM entries WHERE published_at >= ?').get(now - 86400000).n
  const sources = db.prepare('SELECT COUNT(*) AS n FROM sources WHERE enabled = 1').get().n
  const failing = db.prepare('SELECT COUNT(*) AS n FROM sources WHERE enabled = 1 AND fail_count > 0').get().n
  const lastFetch = db.prepare('SELECT MAX(last_fetch_at) AS t FROM sources').get().t
  const byDomain = db.prepare('SELECT domain, COUNT(*) AS n FROM entries GROUP BY domain').all()
  return {
    total, unread, saved, today, sources, failing,
    lastFetchAt: lastFetch || null,
    byDomain: Object.fromEntries(byDomain.map(r => [r.domain, r.n])),
    dbPath: DB_PATH,
    updatedAt: nowIso(),
  }
}

export function recentFetches(limit = 20) {
  return db.prepare(`
    SELECT l.*, s.label FROM fetch_log l LEFT JOIN sources s ON s.id = l.source_id
    ORDER BY l.at DESC LIMIT ?
  `).all(Math.max(1, Math.min(Number(limit) || 20, 100))).map(r => ({
    sourceId: r.source_id,
    label: r.label || r.source_id,
    at: r.at,
    status: r.status,
    httpStatus: r.http_status,
    bytes: r.bytes,
    durationMs: r.duration_ms,
    added: r.added,
    error: r.error || '',
  }))
}

/** 30 天条目 / 7 天抓取日志 */
export function prune(now = Date.now()) {
  const entryCut = ttlCutoff(CONTENT_DEFAULTS.entryTtlDays, now)
  const logCut = now - CONTENT_DEFAULTS.logTtlDays * 86400000
  const e = db.prepare('DELETE FROM entries WHERE published_at < ?').run(entryCut)
  const l = db.prepare('DELETE FROM fetch_log WHERE at < ?').run(logCut)
  return { entries: Number(e.changes) || 0, logs: Number(l.changes) || 0 }
}

export function setMeta(key, value) {
  db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(String(key), String(value))
}

export function getMeta(key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(String(key))
  return row ? row.value : null
}

seedSources()