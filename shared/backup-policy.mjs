/**
 * 备份的省空间策略（纯函数 + 无 IO）。
 *
 * ## 为什么要重做（先看旧实现的空间浪费在哪）
 *
 * 旧备份每次恢复前把「整份 sites + 旁路」序列化成一个 JSON 文件（`pre-restore-*.json`），
 * 保留最近 20 份。三个浪费点：
 *
 *   1. **重复存同一份内容**：站点表在两次恢复之间常常完全没变，但仍然整份再存一遍；
 *   2. **不压缩**：JSON 里大量重复键名与中文描述，gzip 通常能压到 15%–25%；
 *   3. **按次数裁而不是按时间裁**：连续操作 20 次会把更早但更有价值的备份挤掉。
 *
 * 现在的做法是**内容寻址**：先算内容的 SHA-256，相同内容只落一份 blob；
 * blob 再 gzip + base64（存储层 body 是 TEXT，不能直接放二进制）；
 * 每次备份只写一个很小的 manifest，指向 blob。
 *
 * > 为什么不直接改成增量（只存 diff）：恢复链一旦中间断一份就整条失效，
 * > 而站点数据只有几百 KB。内容寻址在「不变时不涨」与「任何一份都能独立恢复」
 * > 之间取得平衡，代价只是多一个 blob 目录。
 *
 * ## 兼容
 *
 * 旧格式 `ops/backups/*.json` 仍然可读、可恢复、参与保留策略。
 * 新格式只新增 `blobs/` 与 `manifests/` 两个前缀，不修改旧对象。
 */
import { createHash } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'

export const BACKUP_DIR = 'ops/backups/'
export const BLOB_PREFIX = `${BACKUP_DIR}blobs/`
export const MANIFEST_PREFIX = `${BACKUP_DIR}manifests/`

/** manifest 保留上限（数量），与旧 BACKUP_KEEP 保持一致，避免磁盘占用突然变大 */
export const MANIFEST_KEEP = 20

/**
 * 分层保留参数：总数仍受 `MANIFEST_KEEP` 约束，但选择时优先覆盖时间跨度。
 * 最近 8 份逐次保留，其余名额给「每天最早一份」与「每周最早一份」。
 */
export const KEEP_POLICY = { recent: 8, daily: 14, weekly: 8 }

export function sha256(text) {
  return createHash('sha256').update(String(text)).digest('hex')
}

/**
 * 内容指纹：只覆盖**数据面**（站点表 + 分类），刻意不含 version / updatedAt。
 *
 * 为什么：同一份内容被不同端写入时 version 一定不同（每端各自 +1），
 * 若把 version 计入指纹，三端永远无法判定「已经一致」。
 */
export function contentFingerprint(sites, cloud) {
  const data = sites && typeof sites === 'object' ? sites : {}
  const stable = JSON.stringify({
    sites: Array.isArray(data.sites) ? data.sites : [],
    categories: Array.isArray(data.categories) ? data.categories : [],
    cloud: cloud && typeof cloud === 'object' ? cloud : {},
  })
  return sha256(stable)
}

/** 压缩后的文本形态（可直接写进 TEXT 列） */
export function packText(text) {
  const raw = Buffer.from(String(text), 'utf8')
  const gz = gzipSync(raw, { level: 9 })
  return {
    body: gz.toString('base64'),
    rawBytes: raw.length,
    storedBytes: gz.length,
  }
}

export function unpackText(body) {
  const gz = Buffer.from(String(body), 'base64')
  return gunzipSync(gz).toString('utf8')
}

/** blob pathname：内容寻址，同一份内容永远同一个名字 */
export function blobPathname(hash) {
  return `${BLOB_PREFIX}${String(hash)}.json.gz.b64`
}

/** manifest pathname：时间前缀，字典序即时间序；附内容短哈希防同毫秒撞名 */
export function manifestPathname(date = new Date(), hash = '') {
  const ts = date.toISOString().replace(/[:.]/g, '-')
  return `${MANIFEST_PREFIX}${ts}-${String(hash).slice(0, 8) || '00000000'}.json`
}

/** 从 manifest pathname 取时间；不符合规范返回 null */
export function parseManifestName(pathname) {
  const name = String(pathname || '').slice(String(pathname || '').lastIndexOf('/') + 1)
  const m = name.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(?:-[0-9a-f]{8})?\.json$/)
  if (!m) return null
  return {
    pathname,
    ts: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}Z`,
  }
}

function dayKey(ts) {
  return String(ts).slice(0, 10)
}

function weekKey(ts) {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return 'invalid'
  // ISO 周：以周四所在年份与周数为准
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/**
 * 选择要删除的 manifest。
 *
 * 程序：
 *   1. 最近 `recent` 份无条件保留；
 *   2. 其余按「每天最早一份」保留，最多 `daily` 天；
 *   3. 再按「每周最早一份」保留，最多 `weekly` 周；
 *   4. 总数超过 `keep` 时，从最旧的开始删（保证硬上限）。
 *
 * @param {{pathname:string, ts:string}[]} items 已解析的 manifest 清单（顺序不限）
 * @returns {string[]} 要删除的 pathname
 */
export function selectManifestsToPrune(items, { keep = MANIFEST_KEEP, policy = KEEP_POLICY } = {}) {
  const list = (Array.isArray(items) ? items : [])
    .filter(x => x && x.pathname && x.ts)
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
  if (list.length <= keep) return []

  const keepSet = new Set()
  for (const item of list.slice(0, Math.max(0, policy.recent))) keepSet.add(item.pathname)

  const daily = new Map()
  for (const item of list) {
    if (keepSet.has(item.pathname)) continue
    const k = dayKey(item.ts)
    if (!daily.has(k)) daily.set(k, [])
    daily.get(k).push(item)
  }
  for (const [, group] of [...daily.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, policy.daily)) {
    // 每天保留最早的一份：同一天里更早的快照代表当天更完整的起点
    const first = group[group.length - 1]
    if (first) keepSet.add(first.pathname)
  }

  const weekly = new Map()
  for (const item of list) {
    if (keepSet.has(item.pathname)) continue
    const k = weekKey(item.ts)
    if (!weekly.has(k)) weekly.set(k, [])
    weekly.get(k).push(item)
  }
  for (const [, group] of [...weekly.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, policy.weekly)) {
    const first = group[group.length - 1]
    if (first) keepSet.add(first.pathname)
  }

  // 硬上限：仍超过 keep 时，从最旧的开始删
  const kept = list.filter(x => keepSet.has(x.pathname))
  const overflow = kept.length - keep
  for (let i = 0; i < overflow; i += 1) keepSet.delete(kept[kept.length - 1 - i].pathname)

  return list.filter(x => !keepSet.has(x.pathname)).map(x => x.pathname)
}

/**
 * 从 manifest 清单算出「哪些 blob 仍被引用」。
 * 孤儿 blob 的判定要与「manifest 尚未写入」的窗口错开，所以调用方应只清理
 * 早于某个安全时间的 blob（见 api/backup.js 的 prune 实现）。
 */
export function referencedBlobs(manifests) {
  const refs = new Set()
  for (const m of Array.isArray(manifests) ? manifests : []) {
    if (m && m.sitesRef) refs.add(String(m.sitesRef))
    if (m && m.cloudRef) refs.add(String(m.cloudRef))
  }
  return refs
}