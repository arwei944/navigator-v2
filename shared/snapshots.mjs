/**
 * 云端数据快照的命名与保留策略（纯函数，无 IO）。
 *
 * 为什么需要它：Blob 上的 sites.json 用 `allowOverwrite: true` 覆盖写，没有对象版本控制，
 * 一旦写坏就是永久丢失。因此每次写入前先把「将被覆盖的当前数据」另存为快照，
 * 形成一条可回退的链。这里只负责命名与裁剪规则，读写由 api/sites.js 与控制台各自实现。
 *
 * 命名：sites-data.snapshots/<6位零填充 version>-<ISO 时间>.json
 * version 零填充是关键 —— 这样 pathname 的字典序 == 时间序，
 * 否则 v9 会排在 v10 之后，按字典序裁剪会误删最新快照。
 */

export const SNAPSHOT_PREFIX = 'sites-data.snapshots/'

/** 保留最近 N 份快照；超出部分在每次写入后裁剪 */
export const SNAPSHOT_KEEP = 20

/** 由 version 与时间生成快照 pathname */
export function snapshotPathname(version, date = new Date()) {
  const v = String(Math.max(0, Number(version) || 0)).padStart(6, '0')
  const ts = date.toISOString().replace(/[:.]/g, '-')
  return `${SNAPSHOT_PREFIX}${v}-${ts}.json`
}

/** 反解快照 pathname；不符合命名规范（含非快照对象）返回 null */
export function parseSnapshotName(pathname) {
  const raw = String(pathname || '')
  const name = raw.slice(raw.lastIndexOf('/') + 1)
  const m = name.match(/^(\d{6})-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.json$/)
  if (!m) return null
  return {
    pathname: raw,
    version: Number(m[1]),
    ts: `${m[2]}T${m[3]}:${m[4]}:${m[5]}.${m[6]}Z`,
  }
}

/** 是否是我们管理的快照对象（防止误删同前缀下的其他文件） */
export function isSnapshotPathname(pathname) {
  return String(pathname || '').startsWith(SNAPSHOT_PREFIX) && parseSnapshotName(pathname) !== null
}

/** 只保留快照、按「新 → 旧」排序 */
export function sortSnapshotsNewestFirst(items) {
  return [...items]
    .map(it => (typeof it === 'string' ? parseSnapshotName(it) : it))
    .filter(Boolean)
    .sort((a, b) => (a.pathname < b.pathname ? 1 : a.pathname > b.pathname ? -1 : 0))
}

/**
 * 需要删除的快照 pathname 列表：保留最新的 keep 份，其余裁掉。
 * 只接受合法快照名，避免把同前缀下的无关对象一起删掉。
 */
export function prunableSnapshots(pathnames, keep = SNAPSHOT_KEEP) {
  const valid = sortSnapshotsNewestFirst(pathnames.filter(isSnapshotPathname))
  return valid.slice(Math.max(0, keep)).map(s => s.pathname)
}