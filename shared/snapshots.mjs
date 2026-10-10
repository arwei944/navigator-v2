/**
 * 云端数据快照的命名与保留策略（纯函数，无 IO）。
 *
 * 为什么需要它：Blob 上的 sites.json 用 `allowOverwrite: true` 覆盖写，没有对象版本控制，
 * 一旦写坏就是永久丢失。因此每次写入前先把「将被覆盖的当前数据」另存为快照，
 * 形成一条可回退的链。这里只负责命名与裁剪规则，读写由 api/sites.js 与控制台各自实现。
 *
 * 命名：sites-data.snapshots/<6位零填充 version>-<ISO 时间>-<6位随机>.json
 * version 零填充是关键 —— 这样 pathname 的字典序 == 时间序，
 * 否则 v9 会排在 v10 之后，按字典序裁剪会误删最新快照。
 * 末尾的随机后缀见 `snapshotPathname` 的注释（防同毫秒并写互相覆盖）。
 */
import { randomBytes } from 'node:crypto'

export const SNAPSHOT_PREFIX = 'sites-data.snapshots/'

/** 保留最近 N 份快照；超出部分在每次写入后裁剪 */
export const SNAPSHOT_KEEP = 20

/** 6 位随机后缀，够短到不影响可读性，又足以让同毫秒的两次写入互不覆盖 */
function randomSuffix() {
  return randomBytes(3).toString('hex')
}

/**
 * 由 version 与时间生成快照 pathname。
 *
 * 为什么末尾还要一段随机后缀：命名里原本只有 `version + 毫秒级时间`，而快照是
 * **回滚的唯一兜底** —— 两个并发的写入如果落在同一毫秒（同一 version 的回滚与被回滚
 * 就可能这样），后写会把前一份**用于回滚的快照本身**覆盖掉，兜底当场失效。
 * 加后缀之后每次写入必有独立名字，代价只是快照名长 7 个字符。
 *
 * 保持「字典序 == 时间序」这条性质不被破坏：后缀只在前缀完全相同时才参与比较，
 * 所以 `sortSnapshotsNewestFirst` 的语义不变。
 *
 * @param {number} version
 * @param {Date} [date]
 * @param {string} [rand] 仅供测试注入，保证命名可复现
 */
export function snapshotPathname(version, date = new Date(), rand) {
  const v = String(Math.max(0, Number(version) || 0)).padStart(6, '0')
  const ts = date.toISOString().replace(/[:.]/g, '-')
  return `${SNAPSHOT_PREFIX}${v}-${ts}-${rand || randomSuffix()}.json`
}

/** 反解快照 pathname；不符合命名规范（含非快照对象）返回 null */
export function parseSnapshotName(pathname) {
  const raw = String(pathname || '')
  const name = raw.slice(raw.lastIndexOf('/') + 1)
  // 后缀可选：早期写入的快照没有它，回滚目标列表必须仍能列出那些历史快照
  const m = name.match(/^(\d{6})-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(?:-([0-9a-z]{2,12}))?\.json$/)
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