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
try { db.exec('ALTER TABLE sources ADD COLUMN credibility REAL NOT NULL DEFAULT 1') } catch { /* 已存在 */ }
try { db.exec('ALTER TABLE sources ADD COLUMN interval_min REAL NOT NULL DEFAULT 20') } catch { /* 已存在 */ }
try { db.exec('ALTER TABLE entries ADD COLUMN insights_at INTEGER') } catch { /* 已存在 */ }
// 阶段 3 反馈闭环：隐藏的条目不进时间线/聚类；置顶的排在前面
try { db.exec('ALTER TABLE entries ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0') } catch { /* 已存在 */ }
try { db.exec('ALTER TABLE entries ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0') } catch { /* 已存在 */ }
for (const sql of [
  'ALTER TABLE entries ADD COLUMN content TEXT',
  'ALTER TABLE entries ADD COLUMN title_zh TEXT',
  'ALTER TABLE entries ADD COLUMN summary_zh TEXT',
  'ALTER TABLE entries ADD COLUMN why TEXT',
  'ALTER TABLE entries ADD COLUMN extract_status TEXT',
  'ALTER TABLE entries ADD COLUMN extract_at INTEGER',
  'ALTER TABLE entries ADD COLUMN extract_error TEXT',
  'ALTER TABLE entries ADD COLUMN llm_status TEXT',
  'ALTER TABLE entries ADD COLUMN llm_at INTEGER',
]) {
  try { db.exec(sql) } catch { /* 已存在 */ }
}
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id               TEXT PRIMARY KEY,
    title            TEXT NOT NULL,
    summary          TEXT NOT NULL DEFAULT '',
    domain           TEXT NOT NULL,
    category_id      TEXT NOT NULL,
    first_seen       INTEGER NOT NULL,
    last_seen        INTEGER NOT NULL,
    source_count     INTEGER NOT NULL DEFAULT 0,
    entry_count      INTEGER NOT NULL DEFAULT 0,
    heat             REAL NOT NULL DEFAULT 0,
    primary_entry_id TEXT,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
  )
`)
db.exec('CREATE INDEX IF NOT EXISTS idx_events_heat ON events(heat DESC)')
db.exec('CREATE INDEX IF NOT EXISTS idx_events_last ON events(last_seen DESC)')
db.exec(`
  CREATE TABLE IF NOT EXISTS event_entries (
    event_id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    PRIMARY KEY (event_id, entry_id)
  )
`)
db.exec(`
  CREATE TABLE IF NOT EXISTS digests (
    date       TEXT PRIMARY KEY,
    content_md TEXT NOT NULL,
    llm_status TEXT NOT NULL DEFAULT 'rule',
    created_at INTEGER NOT NULL
  )
`)
db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL,
    period_start INTEGER NOT NULL,
    period_end   INTEGER NOT NULL,
    content_md   TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'rule',
    created_at   INTEGER NOT NULL
  )
`)
db.exec('CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(type, created_at DESC)')

const nowIso = () => new Date().toISOString()

const stmtInsertSource = db.prepare(`
  INSERT OR IGNORE INTO sources
    (id, label, type, url, domain, category_id, weight, max_items, interval_min, enabled, next_fetch_at, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
`)
const stmtGetSource = db.prepare('SELECT * FROM sources WHERE id = ?')
const stmtAllSources = db.prepare('SELECT * FROM sources ORDER BY enabled DESC, id ASC')
const stmtDueSources = db.prepare('SELECT * FROM sources WHERE enabled = 1 AND next_fetch_at <= ? ORDER BY next_fetch_at ASC')
const stmtUpdateSource = db.prepare(`
  UPDATE sources SET label = ?, url = ?, domain = ?, category_id = ?, weight = ?, interval_min = ?, enabled = ?, updated_at = ?
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
    intervalMin: Number(row.interval_min) || 20,
    credibility: Number(row.credibility) || 1,
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

export function entryRow(row) {
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
    hidden: row.hidden === 1,
    pinned: row.pinned === 1,
    content: row.content || '',
    titleZh: row.title_zh || '',
    summaryZh: row.summary_zh || '',
    why: row.why || '',
    extractStatus: row.extract_status || '',
    extractAt: row.extract_at || null,
    extractError: row.extract_error || '',
    llmStatus: row.llm_status || '',
    llmAt: row.llm_at || null,
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
        Number(s.weight) || 1, Number(s.maxItems) || 60, Number(s.intervalMin) || 20, now, now,
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
      Number(input.weight) || 1, Number(input.maxItems) || 60, Number(input.intervalMin) || 20, now, now,
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
      Number(input.intervalMin ?? existing?.intervalMin ?? 20),
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
  saved = false, limit = 50, before = 0, includeHidden = false,
} = {}) {
  const where = []
  const params = []
  // 隐藏是「人工判定不相关」，默认不进时间线；恢复时显式 includeHidden
  if (!includeHidden) where.push('hidden = 0')
  if (domain) { where.push('domain = ?'); params.push(domain) }
  if (categoryId) { where.push('category_id = ?'); params.push(categoryId) }
  if (sourceId) { where.push('source_id = ?'); params.push(sourceId) }
  if (unread) where.push('read = 0')
  if (saved) where.push('saved = 1')
  if (q) { where.push('(title LIKE ? OR summary LIKE ?)'); params.push(`%${q}%`, `%${q}%`) }
  if (before) { where.push('published_at < ?'); params.push(Number(before)) }
  const sql = `SELECT * FROM entries ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY pinned DESC, published_at DESC, id DESC LIMIT ?`
  params.push(Math.max(1, Math.min(Number(limit) || 50, 200)))
  return db.prepare(sql).all(...params).map(entryRow)
}

export function getEntry(id) {
  return entryRow(db.prepare('SELECT * FROM entries WHERE id = ?').get(String(id)))
}

export function setEntryFlags(ids, { read, saved, hidden, pinned } = {}) {
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
      if (hidden !== undefined) {
        changed += Number(db.prepare('UPDATE entries SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, id).changes) || 0
      }
      if (pinned !== undefined) {
        changed += Number(db.prepare('UPDATE entries SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id).changes) || 0
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
  const hidden = db.prepare('SELECT COUNT(*) AS n FROM entries WHERE hidden = 1').get().n
  const pinned = db.prepare('SELECT COUNT(*) AS n FROM entries WHERE pinned = 1').get().n
  const today = db.prepare('SELECT COUNT(*) AS n FROM entries WHERE published_at >= ? AND hidden = 0').get(now - 86400000).n
  const sources = db.prepare('SELECT COUNT(*) AS n FROM sources WHERE enabled = 1').get().n
  const failing = db.prepare('SELECT COUNT(*) AS n FROM sources WHERE enabled = 1 AND fail_count > 0').get().n
  const lastFetch = db.prepare('SELECT MAX(last_fetch_at) AS t FROM sources').get().t
  const byDomain = db.prepare('SELECT domain, COUNT(*) AS n FROM entries GROUP BY domain').all()
  return {
    total, unread, saved, hidden, pinned, today, sources, failing,
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
  const ev = db.prepare('DELETE FROM events WHERE last_seen < ?').run(entryCut)
  db.prepare('DELETE FROM event_entries WHERE event_id NOT IN (SELECT id FROM events)').run()
  const dg = db.prepare('DELETE FROM digests WHERE date < ?').run(new Date(entryCut).toISOString().slice(0, 10))
  // 周报保留一年（周期性复盘用），比条目寿命长得多
  const rp = db.prepare('DELETE FROM reports WHERE created_at < ?').run(now - 365 * 86400000)
  // 实体边由 insights 重建；这里兜底清掉 30 天没再出现的边
  let edges = 0
  try {
    edges = Number(db.prepare('DELETE FROM entity_edges WHERE last_at < ?').run(now - 30 * 86400000).changes) || 0
  } catch { /* 表可能尚未创建 */ }
  return {
    entries: Number(e.changes) || 0,
    logs: Number(l.changes) || 0,
    events: Number(ev.changes) || 0,
    digests: Number(dg.changes) || 0,
    reports: Number(rp.changes) || 0,
    edges,
  }
}

export function setMeta(key, value) {
  db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(String(key), String(value))
}

export function getMeta(key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(String(key))
  return row ? row.value : null
}

/* ---------------- 阶段 1：正文、翻译、摘要、事件、简报 ---------------- */

export function entriesForExtraction({ limit = 20, hours = 48 } = {}) {
  const since = Date.now() - Math.max(1, hours) * 3600000
  return db.prepare(`
    SELECT * FROM entries
    WHERE published_at >= ? AND hidden = 0
      AND (extract_status IS NULL OR (extract_status = 'failed' AND (extract_at IS NULL OR extract_at < ?)))
    ORDER BY published_at DESC LIMIT ?
  `).all(since, Date.now() - 6 * 3600000, Math.max(1, Math.min(Number(limit) || 20, 100))).map(entryRow)
}

export function saveExtraction(id, { content = '', status = 'ok', error = '' } = {}) {
  db.prepare('UPDATE entries SET content = ?, extract_status = ?, extract_at = ?, extract_error = ? WHERE id = ?')
    .run(String(content || '').slice(0, 4000), String(status), Date.now(), String(error || '').slice(0, 200), String(id))
}

export function entriesForSummary({ limit = 20, hours = 72 } = {}) {
  const since = Date.now() - Math.max(1, hours) * 3600000
  return db.prepare(`
    SELECT * FROM entries
    WHERE published_at >= ? AND hidden = 0 AND llm_status IS NULL
    ORDER BY published_at DESC LIMIT ?
  `).all(since, Math.max(1, Math.min(Number(limit) || 20, 100))).map(entryRow)
}

export function saveTranslation(id, { titleZh = '', summaryZh = '' } = {}) {
  // 翻译不改变 llm_status：翻译后仍要进入 LLM 摘要队列
  db.prepare(`
    UPDATE entries SET title_zh = ?, summary_zh = CASE WHEN llm_status = 'ok' THEN summary_zh ELSE ? END
    WHERE id = ?
  `).run(String(titleZh || '').slice(0, 220), String(summaryZh || '').slice(0, 800), String(id))
}

export function saveSummary(id, { summaryZh = '', why = '', status = 'ok' } = {}) {
  db.prepare(`
    UPDATE entries SET summary_zh = ?, why = ?, llm_status = ?, llm_at = ? WHERE id = ?
  `).run(String(summaryZh || '').slice(0, 800), String(why || '').slice(0, 400), String(status), Date.now(), String(id))
}

export function recentEntriesForCluster({ hours = 72, limit = 500 } = {}) {
  const since = Date.now() - Math.max(1, hours) * 3600000
  return db.prepare(`
    SELECT * FROM entries WHERE published_at >= ? AND hidden = 0 ORDER BY published_at DESC LIMIT ?
  `).all(since, Math.max(1, Math.min(Number(limit) || 500, 1000))).map(entryRow)
}

/**
 * 重建时间窗口内的事件。窗口外的事件保留（它们不会再被重新聚类）。
 * @param {{id:string,title:string,summary:string,domain:string,categoryId:string,
 *          firstSeen:number,lastSeen:number,sourceCount:number,entryCount:number,
 *          heat:number,primaryEntryId:string,members:string[]}[]} events
 */
export function replaceEvents(events, windowStart) {
  const now = Date.now()
  db.exec('BEGIN')
  try {
    db.prepare('DELETE FROM event_entries WHERE event_id IN (SELECT id FROM events WHERE last_seen >= ?)').run(windowStart)
    db.prepare('DELETE FROM events WHERE last_seen >= ?').run(windowStart)
    const insEvent = db.prepare(`
      INSERT INTO events
        (id, title, summary, domain, category_id, first_seen, last_seen, source_count, entry_count, heat, primary_entry_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insLink = db.prepare('INSERT OR IGNORE INTO event_entries (event_id, entry_id) VALUES (?, ?)')
    for (const e of events) {
      insEvent.run(
        e.id, e.title, String(e.summary || '').slice(0, 1000), e.domain, e.categoryId,
        e.firstSeen, e.lastSeen, e.sourceCount, e.entryCount, e.heat, e.primaryEntryId || null, now, now,
      )
      for (const entryId of e.members || []) insLink.run(e.id, entryId)
    }
    db.exec('COMMIT')
  } catch (err) {
    try { db.exec('ROLLBACK') } catch { /* 忽略 */ }
    throw err
  }
  return events.length
}

function eventRow(row) {
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    domain: row.domain,
    categoryId: row.category_id,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    sourceCount: row.source_count,
    entryCount: row.entry_count,
    heat: Number(row.heat) || 0,
    primaryEntryId: row.primary_entry_id,
    primaryUrl: row.primary_url || '',
  }
}

export function listEvents({ domain = '', limit = 30, before = 0, since = 0 } = {}) {
  const where = []
  const params = []
  if (domain) { where.push('e.domain = ?'); params.push(domain) }
  if (before) { where.push('e.last_seen < ?'); params.push(Number(before)) }
  if (since) { where.push('e.last_seen >= ?'); params.push(Number(since)) }
  const sql = `
    SELECT e.*, en.url AS primary_url
    FROM events e LEFT JOIN entries en ON en.id = e.primary_entry_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY e.heat DESC, e.last_seen DESC LIMIT ?
  `
  params.push(Math.max(1, Math.min(Number(limit) || 30, 100)))
  return db.prepare(sql).all(...params).map(eventRow)
}

export function getEventEntries(eventId) {
  return db.prepare(`
    SELECT en.* FROM event_entries ee JOIN entries en ON en.id = ee.entry_id
    WHERE ee.event_id = ? ORDER BY en.published_at DESC
  `).all(String(eventId)).map(entryRow)
}

export function getEvent(id) {
  const row = db.prepare(`
    SELECT e.*, en.url AS primary_url FROM events e LEFT JOIN entries en ON en.id = e.primary_entry_id
    WHERE e.id = ?
  `).get(String(id))
  if (!row) return null
  return { ...eventRow(row), entries: getEventEntries(id) }
}

export function saveDigest(date, contentMd, llmStatus = 'rule') {
  db.prepare(`
    INSERT INTO digests (date, content_md, llm_status, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET content_md = excluded.content_md,
      llm_status = excluded.llm_status, created_at = excluded.created_at
  `).run(String(date), String(contentMd), String(llmStatus), Date.now())
}

export function getDigest(date) {
  const row = db.prepare('SELECT * FROM digests WHERE date = ?').get(String(date))
  return row ? { date: row.date, contentMd: row.content_md, llmStatus: row.llm_status, createdAt: row.created_at } : null
}

export function latestDigest() {
  const row = db.prepare('SELECT * FROM digests ORDER BY date DESC LIMIT 1').get()
  return row ? { date: row.date, contentMd: row.content_md, llmStatus: row.llm_status, createdAt: row.created_at } : null
}

export function processingStats() {
  const one = sql => Number(db.prepare(sql).get()?.n || 0)
  return {
    extract: {
      pending: one("SELECT COUNT(*) AS n FROM entries WHERE extract_status IS NULL AND hidden = 0"),
      ok: one("SELECT COUNT(*) AS n FROM entries WHERE extract_status = 'ok'"),
      failed: one("SELECT COUNT(*) AS n FROM entries WHERE extract_status = 'failed'"),
    },
    summary: {
      pending: one("SELECT COUNT(*) AS n FROM entries WHERE llm_status IS NULL AND hidden = 0"),
      ok: one("SELECT COUNT(*) AS n FROM entries WHERE llm_status = 'ok'"),
      translated: one("SELECT COUNT(*) AS n FROM entries WHERE llm_status = 'translated'"),
      fallback: one("SELECT COUNT(*) AS n FROM entries WHERE llm_status = 'fallback'"),
    },
    events: one('SELECT COUNT(*) AS n FROM events'),
    digests: one('SELECT COUNT(*) AS n FROM digests'),
  }
}

/* ---------------- 阶段 3：周报 ---------------- */

export function saveReport({ id, type = 'weekly', periodStart, periodEnd, contentMd, status = 'rule' }) {
  const now = Date.now()
  db.prepare(`
    INSERT INTO reports (id, type, period_start, period_end, content_md, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET content_md = excluded.content_md,
      status = excluded.status, created_at = excluded.created_at
  `).run(String(id), String(type), Number(periodStart) || now, Number(periodEnd) || now,
    String(contentMd), String(status), now)
  return getReport(id)
}

function reportRow(row) {
  if (!row) return null
  return {
    id: row.id,
    type: row.type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    contentMd: row.content_md,
    status: row.status,
    createdAt: row.created_at,
  }
}

export function getReport(id) {
  return reportRow(db.prepare('SELECT * FROM reports WHERE id = ?').get(String(id)))
}

export function latestReport(type = 'weekly') {
  return reportRow(db.prepare('SELECT * FROM reports WHERE type = ? ORDER BY period_end DESC LIMIT 1').get(String(type)))
}

export function listReports({ type = '', limit = 12 } = {}) {
  const sql = type
    ? 'SELECT * FROM reports WHERE type = ? ORDER BY period_end DESC LIMIT ?'
    : 'SELECT * FROM reports ORDER BY period_end DESC LIMIT ?'
  const params = type ? [String(type), Math.max(1, Math.min(Number(limit) || 12, 50))] : [Math.max(1, Math.min(Number(limit) || 12, 50))]
  return db.prepare(sql).all(...params).map(reportRow)
}

/** 环比用：区间内的新增条目数（默认不含隐藏） */
export function countEntriesBetween(from, to, { includeHidden = false } = {}) {
  const hidden = includeHidden ? '' : ' AND hidden = 0'
  return Number(db.prepare(`
    SELECT COUNT(*) AS n FROM entries
    WHERE published_at >= ? AND published_at < ?${hidden}
  `).get(Number(from) || 0, Number(to) || 0).n) || 0
}

seedSources()