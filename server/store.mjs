/**
 * Blob 同名同签名适配层 —— v9 数据回归的核心。
 *
 * ## 为什么存在
 *
 * 六个接口（sites/session/clicks/health/ops/auth）原先把数据存 Vercel Blob，团队被封后
 * 整块消失。排查确认它们需要的只是「可持久化存储 + 那五个符号」：
 * `get / put / list / del / BlobPreconditionFailedError`。
 * 这里用 Node 22 内置的 `node:sqlite` 提供同名同签名的实现，接口文件**只改一行 import**
 * —— 校验、快照、限流、CAS 等逻辑原样保留，`test-sites-cas` 等测试换 mock 目标后继续守护它们。
 *
 * ## 行为规格（与 Blob 逐条对齐，test-sites-cas 的假 Blob 就是验收标准）
 *
 * - `get(pathname)` → 无则 `null`；有则含 `.stream`（ReadableStream）与
 *   `.blob.etag / .etag` —— 调用方用 `new Response(blob.stream).text()` 读内容。
 * - `put(pathname, body, opts)`：
 *   - `ifMatch` 给出时，与当前 etag 不符 → **抛 BlobPreconditionFailedError**（调用方回 409）。
 *     这是防「read-modify-write 并发静默丢更新」的唯一闸门，绝不能弱化。
 *   - `allowOverwrite: false` 且对象已存在 → 抛错（宁可报错也不覆盖，P0-1 定下的口径）。
 *   - etag 每次成功写入都变化（调用方靠它实现条件请求/304）。
 * - `list({ prefix, limit })` → `{ blobs: [{ pathname, size, uploadedAt }] }`。
 * - `del(pathnames)` → 数组或单个字符串。
 *
 * ## 持久化与迁移
 *
 * - SQLite（WAL）落 `data/store.db`；目录可经 `NAV_STORE_DIR` 覆盖（测试用临时目录）。
 * - **首启迁移**：objects 表为空且 `../api/sites-data.json` 存在时，自动导入为 `sites.json`
 *   （version 1，与 api/sites.js 自己的种子路径同构）。客户端的 cloudVersion 只在内存里、
 *   刷新即归零，所以 version 1 会被正常应用，不存在「旧客户端拒绝新数据」的问题。
 */
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

export class BlobPreconditionFailedError extends Error {
  constructor(msg = 'The precondition in the request does not match') {
    super(msg)
    this.name = 'BlobPreconditionFailedError'
  }
}

const HERE = dirname(fileURLToPath(import.meta.url))
/** 测试用 NAV_STORE_DIR 指到临时目录；默认与数据目录同层（dist/data 或 server/data） */
const DATA_DIR = process.env.NAV_STORE_DIR || join(HERE, 'data')

mkdirSync(DATA_DIR, { recursive: true })

const db = new DatabaseSync(join(DATA_DIR, 'store.db'))
db.exec('PRAGMA journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS objects (
    pathname     TEXT PRIMARY KEY,
    etag         TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'application/json',
    body         TEXT NOT NULL,
    size         INTEGER NOT NULL,
    uploaded_at  TEXT NOT NULL
  )
`)

/* ---------------- 变更日志（离线追赶的基础） ----------------
 *
 * ## 为什么必须在云端记账
 *
 * 「本地离线时云端的变化也要能同步回来」这件事，靠本机轮询是做不到的：
 * 本机关机的那段时间没有任何人在观察，错过的变化就永久丢失。
 * 唯一可行的做法是**云端自己把每次变化记下来**，本机回来时按游标追赶。
 *
 * 所以日志必须和对象写入在**同一个事务**里落盘 —— 否则会出现
 * 「对象写成功但日志没记」，本地永远追不到这次变化，而且是静默的。
 *
 * ## 为什么不存 body
 *
 * 只存 `pathname / etag / size`，本地按 etag 判断要不要拉内容。
 * 存整份 body 会让日志体积和主数据同量级（sites.json 118 KB × 每次改动），
 * 而绝大多数变化本地只是需要知道「这个对象变了」。
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS changes (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    pathname   TEXT NOT NULL,
    op         TEXT NOT NULL,
    etag       TEXT,
    size       INTEGER,
    at         TEXT NOT NULL
  )
`)
db.exec('CREATE INDEX IF NOT EXISTS idx_changes_at ON changes (at)')

/** 日志保留上限。按每对象元数据约 120 字节算，50000 条 ≈ 6 MB，可接受 */
export const CHANGES_KEEP = 50000

const stmtChangeInsert = db.prepare(
  'INSERT INTO changes (pathname, op, etag, size, at) VALUES (?, ?, ?, ?, ?)'
)
const stmtChangesSince = db.prepare(
  'SELECT seq, pathname, op, etag, size, at FROM changes WHERE seq > ? ORDER BY seq ASC LIMIT ?'
)
const stmtChangeHead = db.prepare('SELECT COALESCE(MAX(seq), 0) AS head FROM changes')
const stmtChangeOldest = db.prepare('SELECT COALESCE(MIN(seq), 0) AS oldest FROM changes')
const stmtChangePrune = db.prepare(
  'DELETE FROM changes WHERE seq <= (SELECT seq FROM changes ORDER BY seq DESC LIMIT 1 OFFSET ?)'
)

const stmtGet = db.prepare('SELECT etag, content_type, body, size, uploaded_at FROM objects WHERE pathname = ?')
const stmtInsert = db.prepare(
  'INSERT INTO objects (pathname, etag, content_type, body, size, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)'
)
const stmtUpdate = db.prepare(
  'UPDATE objects SET etag = ?, content_type = ?, body = ?, size = ?, uploaded_at = ? WHERE pathname = ?'
)
const stmtDel = db.prepare('DELETE FROM objects WHERE pathname = ?')
const stmtAll = db.prepare('SELECT pathname, etag, size, uploaded_at FROM objects ORDER BY pathname')

const nowIso = () => new Date().toISOString()

/** 序列化入参：调用方传 JSON 字符串，也容忍 Buffer/其它（与 Blob 一样只收文本语义） */
function toText(body) {
  if (typeof body === 'string') return body
  if (Buffer.isBuffer(body)) return body.toString('utf8')
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8')
  return String(body)
}

export async function get(pathname, _opts = {}) {
  const row = stmtGet.get(String(pathname))
  if (!row) return null
  const blob = new Blob([row.body])
  return {
    ok: true,
    pathname: String(pathname),
    contentType: row.content_type,
    size: row.size,
    uploadedAt: row.uploaded_at,
    etag: row.etag,
    // sites.js 读 (blob.blob && blob.blob.etag) || blob.etag —— 两个位置都给，别让它拿到 undefined
    blob: { etag: row.etag, pathname: String(pathname), size: row.size, uploadedAt: row.uploaded_at },
    stream: blob.stream(),
  }
}

export async function put(pathname, body, opts = {}) {
  const key = String(pathname)
  const text = toText(body)
  const contentType = String(opts.contentType || 'application/json')
  const size = Buffer.byteLength(text)
  const uploadedAt = nowIso()

  // BEGIN IMMEDIATE：同进程内串行化「读 etag → 写」这一段，CAS 判断与落盘之间不插队。
  // node:sqlite 是同步 API，单线程下本就无交错；显式事务是为语义自洽与将来多进程留余地。
  db.exec('BEGIN IMMEDIATE')
  try {
    const cur = stmtGet.get(key)
    if (opts.ifMatch != null) {
      if (!cur || cur.etag !== opts.ifMatch) throw new BlobPreconditionFailedError()
    } else if (opts.allowOverwrite === false && cur) {
      throw new Error('This blob already exists')
    }
    const etag = randomUUID()
    if (cur) stmtUpdate.run(etag, contentType, text, size, uploadedAt, key)
    else stmtInsert.run(key, etag, contentType, text, size, uploadedAt)
    // 与对象写入同事务：漏记会让本地永久追不到这次变化，且是静默的
    stmtChangeInsert.run(key, cur ? 'put' : 'create', etag, size, uploadedAt)
    db.exec('COMMIT')
    return { pathname: key, etag, size, uploadedAt, contentType }
  } catch (e) {
    try { db.exec('ROLLBACK') } catch { /* 事务本就没开成功，忽略 */ }
    throw e
  }
}

export async function list({ prefix = '', limit = 1000 } = {}) {
  const blobs = stmtAll
    .all()
    .filter(r => !prefix || String(r.pathname).startsWith(prefix))
    .slice(0, Number(limit) || 1000)
    .map(r => ({ pathname: r.pathname, etag: r.etag, size: r.size, uploadedAt: r.uploaded_at }))
  return { blobs, hasMore: false, cursor: '' }
}

export async function del(pathnames) {
  const arr = Array.isArray(pathnames) ? pathnames : [pathnames]
  const at = nowIso()
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const p of arr) {
      const key = String(p)
      // 只有真的删掉了才记日志：不存在的对象不该产生一条「删除」事件，
      // 否则本地会收到一堆无意义的墓碑
      const cur = stmtGet.get(key)
      if (!cur) continue
      stmtDel.run(key)
      stmtChangeInsert.run(key, 'del', null, null, at)
    }
    db.exec('COMMIT')
  } catch (e) {
    try { db.exec('ROLLBACK') } catch { /* 同上 */ }
    throw e
  }
  return {}
}

/* ---------------- 变更日志读取 ---------------- */

/**
 * 按游标读取变更。`since = 0` 表示「从头开始」（首次同步）。
 *
 * 返回 `{ head, oldest, items, hasMore, truncated }`：
 * - `head`：当前最新序号，调用方存下来当游标
 * - `oldest`：日志里还留着的最早序号。**`since < oldest - 1` 说明游标已被裁剪**，
 *   中间那一段永远补不回来了 —— 必须显式告诉调用方，让它改走全量对齐，
 *   而不是让它以为「没有变化」。
 * - `truncated`：调用方传的 since 比 oldest 还老，本次返回的是不完整区间。
 */
export function readChanges({ since = 0, limit = 500 } = {}) {
  const head = Number(stmtChangeHead.get()?.head || 0)
  const oldest = Number(stmtChangeOldest.get()?.oldest || 0)
  const from = Math.max(0, Number(since) || 0)
  const rows = stmtChangesSince.all(from, Math.max(1, Math.min(Number(limit) || 500, 2000)))
  return {
    head,
    oldest,
    items: rows.map(r => ({
      seq: r.seq,
      pathname: r.pathname,
      op: r.op,
      etag: r.etag,
      size: r.size,
      at: r.at,
    })),
    hasMore: rows.length > 0 && rows[rows.length - 1].seq < head,
    // 缺口判据：since 之后的第一条现存记录，seq 必须正好是 since+1；
    // 也就是「现存最早记录」不能比 since+1 更晚。
    //
    // 写成 `oldest > since + 1` 而不是 `since < oldest - 1` 只是可读性选择 ——
    // 两者在整数域上完全等价（枚举验证过）。真正要防的是把边界写成
    // `oldest > since`（那样 since 紧邻 oldest 时会误报缺口），
    // 或写成 `since <= oldest`（那样会漏报一格）。
    truncated: oldest > 0 && oldest > from + 1,
  }
}

/** 裁剪日志到最近 `keep` 条。返回删除条数。 */
export function pruneChanges(keep = CHANGES_KEEP) {
  const n = Math.max(1, Number(keep) || CHANGES_KEEP)
  db.exec('BEGIN IMMEDIATE')
  try {
    stmtChangePrune.run(n)
    db.exec('COMMIT')
  } catch (e) {
    try { db.exec('ROLLBACK') } catch { /* 同上 */ }
    throw e
  }
  const oldest = Number(stmtChangeOldest.get()?.oldest || 0)
  const head = Number(stmtChangeHead.get()?.head || 0)
  return { kept: head - oldest + (oldest > 0 ? 1 : 0), oldest, head }
}

/** 供状态展示：日志规模与覆盖区间 */
export function changesInfo() {
  const head = Number(stmtChangeHead.get()?.head || 0)
  const oldest = Number(stmtChangeOldest.get()?.oldest || 0)
  const row = db.prepare('SELECT COUNT(*) AS n FROM changes').get()
  return { head, oldest, count: Number(row?.n || 0), keep: CHANGES_KEEP }
}

/** 供 HTTP 层做条件请求（If-None-Match → 304）：只读 etag，不搬 body */
export function etagOf(pathname) {
  const row = stmtGet.get(String(pathname))
  return row ? row.etag : null
}

/** 供测试与优雅关停用：WAL 检查点后关闭句柄（否则临时目录清理会 EBUSY） */
export function close() {
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch { /* 本就没开 WAL 事务时无害 */ }
  try { db.close() } catch { /* 已关闭时无害 */ }
}

/* ---------------- 首启迁移 ---------------- */

function seedIfNeeded() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM objects').get()
  if (count && count.n > 0) return
  const seedPath = resolve(HERE, '..', 'api', 'sites-data.json')
  if (!existsSync(seedPath)) return
  try {
    const sites = JSON.parse(readFileSync(seedPath, 'utf-8'))
    if (!Array.isArray(sites) || sites.length === 0) return
    const body = JSON.stringify({ version: 1, sites, updatedAt: nowIso() })
    // etag 要记真实值：本地靠它判断「内容有没有变」，记 null 会让它每次都重拉
    const etag = randomUUID()
    const at = nowIso()
    stmtInsert.run('sites.json', etag, 'application/json', body, Buffer.byteLength(body), at)
    // 迁移也是一次「对象出现」，必须记日志。
    // 漏了这条，本地镜像会看到「对象在、日志里没有」—— 它永远不知道要拉这份数据，
    // 而且没有任何报错能提示它。这正是实测中抓到的那次静默漏记。
    stmtChangeInsert.run('sites.json', 'create', etag, Buffer.byteLength(body), at)
    console.log(`[store] 首启迁移：已从 api/sites-data.json 导入 ${sites.length} 条站点（sites.json @ version 1）`)
  } catch (e) {
    // 迁移失败不阻断启动：api/sites.js 对「没有数据」有自己的种子路径
    console.error('[store] 首启迁移失败（交由接口侧种子兜底）:', String(e?.message || e))
  }
}

seedIfNeeded()
