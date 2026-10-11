/**
 * 全量备份与恢复（P5）。
 *
 * ## 为什么需要
 *
 * 发布沙箱的磁盘**没有 SLA** —— 被回收、被重建、迁移都是「随时可能」的事。
 * SQLite 抗得住进程被回收（每次请求一个新进程），但抗不住「整个沙箱没了」。
 * 所以数据必须有一个**可以随时拿走、也能随时放回去**的形态：一个 JSON 文件。
 *
 * ## 覆盖范围
 *
 *   - `sites.json`（站点表 + 分类 + 版本）—— 数据面，缺了就等于全站空了
 *   - `ops/audit.json` / `ops/publish-history.json` / `ops/notifications.json`（运维面）
 *   - `clicks.json` / `ops/health.json`（统计与巡检判定）
 *   不含会话数据（`session/*.json` 是各设备自己的便签，按 key 隔离，没有全局备份的意义）。
 *
 * ## 安全
 *
 *  - 读写都要鉴权（`checkAuthHeader`，即 X-Nav-Key / 会话 token / 共享密钥）。
 *  - 恢复前**先给当前数据拍一份快照**（`ops/backups/pre-restore-*.json`）——
 *    恢复操作本身就是一次覆盖写，没有回退路径的话它就是一次赌博。
 *  - 恢复内容必须过 `shared/sanitize.mjs` 这把尺子（空数组 / 缺 id / 重复 id 一律拒），
 *    与站点数据面用同一把 —— 站点表是全站渲染的唯一输入，坏结构会白屏。
 *  - version 单调递增：恢复出来的版本必须 **高于** 当前版本，否则客户端按
 *    「v <= cloudVersion 就不应用」判据会把这份数据当成旧快照忽略。
 */
import { get, put, list, del } from '#store'
import { checkAuthHeader } from '../shared/auth.mjs'
import { sanitizeSites, isSitesValid } from '../shared/sanitize.mjs'

const SITES_PATH = 'sites.json'
const CLOUDS_PATH = 'clicks.json'
const HEALTH_PATH = 'ops/health.json'
const AUDIT_PATH = 'ops/audit.json'
const HISTORY_PATH = 'ops/publish-history.json'
const NOTIFY_PATH = 'ops/notifications.json'
const BACKUP_DIR = 'ops/backups/'
const BACKUP_KEEP = 20

/** 备份里带走的键（顺序即恢复顺序：先数据面，后旁路） */
const CLOUD_KEYS = [CLOUDS_PATH, HEALTH_PATH, AUDIT_PATH, HISTORY_PATH, NOTIFY_PATH]

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
}

async function readJson(pathname) {
  const blob = await get(pathname, { access: 'private' })
  if (!blob || !blob.stream) return null
  try { return JSON.parse(await new Response(blob.stream).text()) } catch { return null }
}

async function writeJson(pathname, data) {
  await put(pathname, JSON.stringify(data), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  })
}

async function readBody(req) {
  if (typeof req.body === 'string') return JSON.parse(req.body)
  if (req.body && typeof req.body.getReader === 'function') return new Response(req.body).json()
  return req.body || {}
}

/** GET /api/backup → 导出全量备份（下载用） */
async function exportBackup(req, res) {
  const auth = checkAuthHeader(req)
  if (!auth.ok) { res.status(auth.code).json({ ok: false, error: auth.error }); return }

  const sites = await readJson(SITES_PATH)
  const cloud = {}
  for (const k of CLOUD_KEYS) {
    const v = await readJson(k)
    if (v) cloud[k] = v
  }

  res.setHeader('Content-Disposition', `attachment; filename="navigator-backup-${new Date().toISOString().slice(0, 10)}.json"`)
  res.status(200).json({
    ok: true,
    kind: 'navigator-backup',
    schema: 1,
    exportedAt: new Date().toISOString(),
    actor: auth.via || 'unknown',
    sites,
    cloud,
    // 体积提示（前端展示用）：没有也照样能用
    counts: {
      sites: sites && Array.isArray(sites.sites) ? sites.sites.length : 0,
      categories: sites && Array.isArray(sites.categories) ? sites.categories.length : 0,
      version: sites && Number(sites.version) || 0,
      cloudKeys: Object.keys(cloud).length,
    },
  })
}

/** POST /api/backup → 从备份恢复（先给当前数据拍快照，再覆盖写） */
async function restoreBackup(req, res) {
  const auth = checkAuthHeader(req)
  if (!auth.ok) { res.status(auth.code).json({ ok: false, error: auth.error }); return }

  let body
  try { body = await readBody(req) } catch { res.status(400).json({ ok: false, error: 'Invalid JSON body' }); return }

  const incoming = body && body.data
  if (!incoming || incoming.kind !== 'navigator-backup' || !incoming.sites) {
    res.status(400).json({ ok: false, error: '不是有效的备份文件（缺少 kind/sites）' })
    return
  }

  // 与站点数据面同一把尺子：坏结构绝不放行（站点表坏掉等于全站白屏）
  const list0 = Array.isArray(incoming.sites.sites) ? incoming.sites.sites : null
  if (!isSitesValid(list0)) {
    res.status(400).json({ ok: false, error: '备份里的站点数据不合法（空数组 / 缺 id·name·url / id 重复）（未做任何改动）' })
    return
  }

  // ① 先给当前数据拍快照 —— 恢复是一次覆盖写，没有回退路径就不能做
  const current = await readJson(SITES_PATH)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  await writeJson(`${BACKUP_DIR}pre-restore-${stamp}.json`, {
    at: new Date().toISOString(), kind: 'navigator-backup', schema: 1, sites: current, cloud: {},
  })
  await pruneBackups()

  // ② version 必须高于当前：客户端按「v <= cloudVersion 就不应用」判断
  const curVersion = Number(current && current.version) || 0
  const payload = {
    ...incoming.sites,
    sites: sanitizeSites(list0),
    version: Math.max(curVersion + 1, Number(incoming.sites.version) || 1),
  }
  await writeJson(SITES_PATH, payload)

  // ③ 旁路键：逐个写，坏的那个跳过（数据面已经恢复成功，不该被旁路拖垮）
  const restored = []
  const skipped = []
  for (const [k, v] of Object.entries(incoming.cloud || {})) {
    if (!CLOUD_KEYS.includes(k)) { skipped.push(k); continue }
    try { await writeJson(k, v); restored.push(k) } catch { skipped.push(k) }
  }

  res.status(200).json({
    ok: true,
    restored: { version: payload.version, sites: payload.sites.length, categories: (payload.categories || []).length },
    cloudRestored: restored.length,
    cloudSkipped: skipped,
    safetySnapshot: `${BACKUP_DIR}pre-restore-${stamp}.json`,
  })
}

/** 恢复前的安全快照只留最近若干份，免得把存储撑爆 */
async function pruneBackups() {
  try {
    const { blobs } = await list({ prefix: BACKUP_DIR, limit: 1000 })
    if (blobs.length <= BACKUP_KEEP) return
    const sorted = blobs.map(b => b.pathname).sort()
    for (const p of sorted.slice(0, sorted.length - BACKUP_KEEP)) await del(p)
  } catch { /* 清理失败不影响恢复本身 */ }
}

export default async function handler(req, res) {
  noStore(res)
  if (req.method === 'GET') return exportBackup(req, res)
  if (req.method === 'POST') return restoreBackup(req, res)
  res.status(405).json({ ok: false, error: 'Method not allowed' })
}