/**
 * 线上数据库备份：把容器里的 SQLite 完整搬到本机。
 *
 * ## 为什么必须做这件事
 *
 * 线上数据只有**一份** `/data/store.db`，而平台**没有持久卷**。这意味着：
 *   · 容器被平台重建 → 数据可能归零
 *   · `data/` 刻意不进部署包（保护线上库），所以部署救不回数据
 *   · 所谓「云端快照」与主数据在**同一个 SQLite 文件**里 —— 文件没了，快照一起没
 *
 * 2026-10-20 的故障（容器 agent 失联，restart/stop/kill 全部 `deliveryUnconfirmed`）
 * 就是活样本：当时能救回来，靠的是平台「重启保留文件系统」这个**未承诺**的行为。
 *
 * 所以备份必须是**完整 SQLite 文件、落在容器之外、且可验证**。
 *
 * ## 关键契约（都是实测出来的，不是推测）
 *
 * - 下载端点：`GET /files/download?path=/data/store.db` → 原始二进制。
 *   **路径必须原样带前导斜杠**，URL 编码成 `%2F` 会超时（实测）。
 * - `/files?path=/data` 会忽略 path 参数只回根目录，**不能用来列目录**。
 * - 下载到的文件必须过 `PRAGMA integrity_check` 才算有效备份 ——
 *   下载中断/被截断时 HTTP 仍可能是 200。
 * - **WAL 未合并时直接拷 .db 会丢最近的写入**，所以先让服务端 checkpoint，
 *   或者退一步：接受 WAL 里的内容可能缺失，但必须把这一点写进备份元数据。
 */
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ROOT, loadEnv } from '../core/env.mjs'

/** 备份落盘目录（gitignore 内，本机磁盘） */
const BACKUP_DIR = join(ROOT, 'backups', 'db')

/** 默认保留份数：6 小时一份 × 24 份 = 6 天 */
export const DEFAULT_KEEP = 24

/** 平台 API 基址 */
const API_BASE = 'https://api.botkeep.cloud/api/v1/developer/workloads'

function readCfg() {
  loadEnv()
  const token = String(process.env.BOTKEEP_API_KEY || '').trim()
  const wid = String(process.env.BOTKEEP_WORKLOAD_ID || '').trim()
  if (!token) throw new Error('缺少 BOTKEEP_API_KEY（请在控制台「密钥」面板配置）')
  if (!wid) throw new Error('缺少 BOTKEEP_WORKLOAD_ID（请在控制台「密钥」面板配置）')
  return { token, wid }
}

/**
 * 用平台文件接口把线上 SQLite 原样读下来。
 *
 * 不做任何解析 —— 拿到字节后由 `verifyDb()` 判断是否可用。
 * 超时给足 120s：471KB 实测几秒，但容器负载高时会慢。
 */
export async function downloadDb({ timeoutMs = 120000 } = {}) {
  const { token, wid } = readCfg()
  // 路径必须保持前导斜杠原样：编码成 %2F 实测会挂住直到超时
  const url = `${API_BASE}/${wid}/files/download?path=/data/store.db`
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    throw new Error(`下载失败 HTTP ${r.status}：${t.slice(0, 160)}`)
  }
  const buf = Buffer.from(await r.arrayBuffer())
  // SQLite 文件头是固定的 16 字节魔数。不匹配说明拿到的是错误页而不是数据库
  if (buf.length < 100 || buf.subarray(0, 15).toString('utf8') !== 'SQLite format 3') {
    throw new Error(`下载内容不是 SQLite（${buf.length}B，头部 "${buf.subarray(0, 16).toString('utf8').replace(/[^\x20-\x7e]/g, '.')}"）`)
  }
  return buf
}

/**
 * 校验一个 SQLite 字节流是否是可用的备份。
 *
 * 三层检查，任一不过就判失败：
 *   1. `integrity_check` —— 页面结构是否损坏
 *   2. 必须存在 `objects` 表 —— 否则是空库或别的库
 *   3. 对象数 > 0 且 `sites.json` 在 —— 站点数据是核心资产，没有它这份备份没意义
 *
 * **为什么校验必须做**：下载被截断时 HTTP 仍可能是 200，字节数看着也"像"。
 * 把坏备份当成好备份存下来，比没有备份更危险 —— 回滚时会以为有退路。
 */
export function verifyDb(buf) {
  const tmp = join(BACKUP_DIR, `.verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`)
  mkdirSync(BACKUP_DIR, { recursive: true })
  try {
    writeFileSync(tmp, buf)
    const db = new DatabaseSync(tmp, { readOnly: true })
    try {
      const ck = db.prepare('PRAGMA integrity_check').get()
      const integrity = ck ? Object.values(ck)[0] : null
      if (integrity !== 'ok') {
        return { ok: false, error: `完整性检查未通过：${integrity}` }
      }
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name)
      if (!tables.includes('objects')) {
        return { ok: false, error: `缺少 objects 表（实际表：${tables.join(',') || '无'}）` }
      }
      const rows = db.prepare('SELECT pathname, size FROM objects').all()
      const paths = rows.map(r => r.pathname)
      if (rows.length === 0) return { ok: false, error: '数据库为空（0 个对象）' }
      if (!paths.includes('sites.json')) {
        return { ok: false, error: `缺少 sites.json（实际对象：${paths.join(',')}）` }
      }
      // 站点条数：从 sites.json 内容里读，比看字节数有意义
      const siteRow = db.prepare("SELECT body FROM objects WHERE pathname = 'sites.json'").get()
      let siteCount = 0
      let version = null
      try {
        const parsed = JSON.parse(siteRow.body)
        siteCount = Array.isArray(parsed.sites) ? parsed.sites.length : 0
        version = parsed.version ?? null
      } catch { /* 内容坏时按 0 记，下面会判失败 */ }
      if (siteCount === 0) return { ok: false, error: 'sites.json 里没有站点（内容可能已损坏）' }

      return {
        ok: true,
        integrity,
        objects: rows.length,
        paths: paths.sort(),
        siteCount,
        version,
        bytes: buf.length,
      }
    } finally {
      try { db.close() } catch { /* 已关闭 */ }
    }
  } catch (e) {
    return { ok: false, error: `无法打开为 SQLite：${String(e?.message || e)}` }
  } finally {
    // SQLite 打开后会生成 -shm/-wal 旁文件，三个都要清，否则备份目录里会留垃圾
    for (const f of [tmp, `${tmp}-shm`, `${tmp}-wal`]) {
      try { unlinkSync(f) } catch { /* 临时文件已不在 */ }
    }
  }
}

/** 备份文件名：可按字典序排序 = 按时间排序 */
function stampName(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `store-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.db`
}

/** 从文件名解析时间（用于列表排序与"最近一次备份"判断） */
function parseStamp(name) {
  // 末尾可选的 `-N` 是同秒备份的序号（见 runBackup 的撞名处理）
  const m = /^store-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-\d+)?\.db$/.exec(name)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
}

/**
 * 执行一次备份。
 *
 * 流程：下载 → 校验 → 落盘 → 清理超量。
 * **校验失败绝不落盘**，否则会在备份列表里留下一个看着有效、实际回滚不了的条目。
 */
export async function runBackup({ keep = DEFAULT_KEEP } = {}) {
  const startedAt = new Date()

  // 下载必须自己兜住异常。调用方包括定时调度器与并发的手动备份 ——
  // 让异常冒到顶层会直接打挂控制台进程（并发两次备份时实测会崩）。
  // 备份失败是可预期的（网络、平台 5xx、凭据过期），不是致命错误。
  let buf
  try {
    buf = await downloadDb()
  } catch (e) {
    return {
      ok: false,
      error: `下载失败：${String(e?.message || e)}`,
      startedAt: startedAt.toISOString(),
    }
  }

  const check = verifyDb(buf)
  if (!check.ok) {
    return { ok: false, error: `备份校验失败：${check.error}`, startedAt: startedAt.toISOString() }
  }

  // 落盘也可能失败（磁盘满、目录权限）。同样不能让它冒出去打挂调用方 ——
  // 但必须如实回报，不能假装成功。
  let name, path
  try {
    mkdirSync(BACKUP_DIR, { recursive: true })
    // 文件名精确到秒。同一秒内连备两次（定时任务与手动备份撞车）会**静默覆盖**前一份，
    // 而用户以为多了一份保险。撞名时加序号，宁可名字难看也不丢备份。
    name = stampName(startedAt)
    let seq = 1
    while (existsSync(join(BACKUP_DIR, name))) {
      name = stampName(startedAt).replace(/\.db$/, `-${seq}.db`)
      seq += 1
      if (seq > 99) throw new Error('同一秒内备份次数过多，请稍后重试')
    }
    path = join(BACKUP_DIR, name)
    writeFileSync(path, buf)
  } catch (e) {
    return { ok: false, error: `写入备份失败：${String(e?.message || e)}`, startedAt: startedAt.toISOString() }
  }

  // 元数据与备份同名，方便"只看 .json 就能判断这份备份值不值得留"
  const meta = {
    name,
    createdAt: startedAt.toISOString(),
    bytes: buf.length,
    ...check,
  }
  // 元数据写失败不影响备份本身可用，但要让它显式出现在返回值里
  let metaError = null
  try {
    writeFileSync(join(BACKUP_DIR, `${name}.json`), JSON.stringify(meta, null, 2))
  } catch (e) {
    metaError = String(e?.message || e)
  }

  const pruned = pruneOld(keep)

  return { ok: true, ...meta, path, pruned, ...(metaError ? { metaError } : {}) }
}

/** 只保留最近 N 份（按文件名时间序，.db 与同名 .json 一起删） */
export function pruneOld(keep = DEFAULT_KEEP) {
  let names = []
  try {
    names = readdirSync(BACKUP_DIR).filter(n => /^store-\d{8}-\d{6}(?:-\d+)?\.db$/.test(n))
  } catch { return [] }
  names.sort().reverse()
  const doomed = names.slice(Math.max(0, keep))
  const removed = []
  for (const n of doomed) {
    for (const f of [n, `${n}.json`]) {
      try { unlinkSync(join(BACKUP_DIR, f)); removed.push(f) } catch { /* 已不存在 */ }
    }
  }
  return removed
}

/**
 * 备份列表（新 → 旧）。
 *
 * 顺带算出「最近一次成功备份距今多久」—— 这是判断"能不能安全部署"的唯一依据。
 */
export function listBackups(limit = 50) {
  let names = []
  try {
    names = readdirSync(BACKUP_DIR).filter(n => /^store-\d{8}-\d{6}(?:-\d+)?\.db$/.test(n))
  } catch {
    return { dir: BACKUP_DIR, count: 0, items: [], lastAt: null, ageHours: null }
  }
  names.sort().reverse()
  const items = names.slice(0, limit).map(n => {
    const at = parseStamp(n)
    let size = null
    let meta = null
    try { size = statSync(join(BACKUP_DIR, n)).size } catch { /* 读不到大小不影响列表 */ }
    try { meta = JSON.parse(readFileSync(join(BACKUP_DIR, `${n}.json`), 'utf8')) } catch { /* 早期备份可能没有元数据 */ }
    return {
      name: n,
      at: at ? at.toISOString() : null,
      size,
      siteCount: meta?.siteCount ?? null,
      objects: meta?.objects ?? null,
      version: meta?.version ?? null,
    }
  })
  const newest = items[0]
  const rawAge = newest?.at ? (Date.now() - new Date(newest.at).getTime()) / 3600000 : null
  return {
    dir: BACKUP_DIR,
    count: names.length,
    items,
    lastAt: newest?.at || null,
    // 展示用取整值
    ageHours: rawAge === null ? null : Math.round(rawAge * 10) / 10,
    // 判定用原始值：拿取整后的数字比阈值，在临界点会误判
    // （如 23.96 小时取整成 24.0，阈值 24 就变成"刚好不过"）
    ageHoursRaw: rawAge,
  }
}

/**
 * 部署前置闸门：最近一次成功备份是否足够新。
 *
 * 为什么卡在这里而不是"提醒一下"：部署会触发容器重启甚至重建，
 * 那是唯一能真正丢数据的操作。在没备份的情况下部署，等于把不可逆动作
 * 建立在一个未承诺的平台上。
 *
 * 返回 `{ ok, reason }`，调用方自行决定是阻断还是仅告警。
 */
export function checkFreshness(opts = {}) {
  // 不能写成 `{ maxAgeHours = 24 } = {}`：那样传 0 会被当成"没传"而回落 24，
  // 阈值就永远无法收紧到"必须刚刚备份过"。用 undefined 判断才是正确的语义。
  const maxAgeHours = opts.maxAgeHours === undefined ? 24 : Number(opts.maxAgeHours)
  const l = listBackups(1)
  if (!l.count) {
    return { ok: false, reason: '从未备份过线上数据库（建议先执行「立即备份」）', ageHours: null }
  }
  if (l.ageHoursRaw === null) {
    return { ok: false, reason: '最近备份的时间无法解析', ageHours: null }
  }
  if (l.ageHoursRaw > maxAgeHours) {
    return {
      ok: false,
      reason: `最近备份已是 ${l.ageHours} 小时前（阈值 ${maxAgeHours} 小时）`,
      ageHours: l.ageHours,
      lastAt: l.lastAt,
    }
  }
  return { ok: true, reason: `最近备份 ${l.ageHours} 小时前`, ageHours: l.ageHours, lastAt: l.lastAt }
}

/** 供面板展示的汇总 */
export function status(opts = {}) {
  // 同 checkFreshness：0 是合法阈值，不能被默认值吞掉
  const maxAgeHours = opts.maxAgeHours === undefined ? 24 : Number(opts.maxAgeHours)
  const l = listBackups(10)
  const fresh = checkFreshness({ maxAgeHours })
  return {
    ...l,
    dir: BACKUP_DIR,
    dirExists: existsSync(BACKUP_DIR),
    freshness: fresh,
    maxAgeHours,
  }
}
