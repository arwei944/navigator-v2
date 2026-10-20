/**
 * 云端 → 本地实时镜像同步（支持「本地离线」期间的变化补齐）。
 *
 * ## 核心问题：为什么普通轮询不够
 *
 * 「实时同步」最直觉的做法是本机定时拉全量、比对 etag。它有一个致命缺口：
 * **本机关机的那段时间没有任何人在观察**。那段窗口里云端发生的变化，
 * 要么永久丢失，要么只能靠事后一次全量重拉补救 —— 而全量重拉
 * 既不知道「哪里变了」，数据大时也不可接受。
 *
 * 所以这里的前提是**云端自己记账**（`server/store.mjs` 的 `changes` 表，
 * 与对象写入同事务落盘），本地按 `seq` 游标追赶。本机离线 3 天还是 3 分钟，
 * 恢复后都从上次的游标继续，一条变化都不会少。
 *
 * ## 镜像的语义
 *
 * 本地 `mirror/` 是云端对象的**只读副本**，不是工作副本：
 *   - 它记录每个对象的 `etag / size / 内容`，外加一个 `_cursor`（已追到的 seq）
 *   - **绝不回写云端** —— 同步是单向的，回写会让「镜像」变成第二个真相源
 *   - 需要写入云端时走既有发布链路（它有自己的 CAS 与校验）
 *
 * ## 两种失败必须区别对待
 *
 * 1. **网络/平台故障**：本次同步失败，游标不推进。下次重试会从同一位置继续，
 *    幂等，不会丢数据。
 * 2. **游标被裁剪**（`truncated`）：日志保留有上限，本地落后太多时中间那段
 *    永远补不回来。这时必须显式降级为**全量对齐**，并把这件事记进状态 ——
 *    最坏的失败是回一个空数组让调用方以为「没有变化」。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { ROOT, loadEnv, getAdminKey } from '../core/env.mjs'

/** 镜像根目录（gitignore 内，本机磁盘）。
 *  可用 `NAV_MIRROR_DIR` 覆盖 —— 门禁并行执行时需要各自的目录，
 *  否则两个实例会互相 rmSync 对方的镜像（实测 EPERM 崩掉）；
 *  生产上也受益：可以把镜像放到别的磁盘。 */
export const MIRROR_DIR = process.env.NAV_MIRROR_DIR || join(ROOT, 'backups', 'mirror')

/** 游标与状态文件 */
const STATE_FILE = '_state.json'

/** 单次追赶最多拉多少页，防止异常情况下无限循环 */
const MAX_PAGES = 200

/**
 * 把 curl 的失败消息压成一句可展示的短文本，并抹掉任何凭据。
 *
 * 为什么必须做：`execFile` 抛错时 `e.message` 是**完整命令行**，
 * 里面有 `-H "Authorization: Bearer <密钥>"`。原样返回等于把共享密钥
 * 写进 `_state.json`、审计日志和控制台面板 —— 实测确认过这条泄露路径。
 */
function redactError(e) {
  const msg = String(e?.message || e)
  const code = e?.code || ''
  // 只保留「什么类型的失败」，不保留命令行。
  //
  // 优先按 curl 的**退出码**判定，而不是匹配消息文本：
  // 实测 `execFile` 的 message 只是 `Command failed: <整条命令行>`，
  // 里面除了我们自己的 `--proxy` 参数外没有任何错误原因 —— 靠文本匹配
  // 会把「连接被拒绝」误报成「代理不可用」（踩过）。
  // 退出码是 curl 的稳定契约，见 curl(1) EXIT CODES。
  const byCode = {
    5: '代理解析失败',
    6: '域名解析失败',
    7: '连接被拒绝或不可达',
    28: '超时',
    35: 'TLS 握手失败',
    52: '服务端无响应',
    56: '接收数据失败',
  }
  if (code != null && byCode[code]) return byCode[code]

  // 没有退出码时才回落到文本判定
  if (/timeout|ETIMEDOUT|Operation timed out/i.test(msg)) return '超时'
  if (/ECONNREFUSED|Connection refused/i.test(msg)) return '连接被拒绝'
  if (/ENOTFOUND|Could not resolve/i.test(msg)) return '域名解析失败'
  return code != null ? `curl 退出码 ${code}` : '请求失败'
}

/** 云端地址：优先环境变量，否则用发布通道给出的地址 */
async function resolveBase() {
  loadEnv()
  const explicit = String(process.env.NAV_SITE_URL || '').trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  const { resolvePublisher } = await import('../../../../shared/publisher.mjs')
  return String(resolvePublisher().siteUrl || '').replace(/\/+$/, '')
}

/**
 * 统一的云端请求。返回 `{ ok, status, json, error }`，**从不抛网络错误**。
 *
 * 为什么用 `curl.exe` 而不是 `fetch`：发布沙箱的网关会改写 `Authorization` 头，
 * 必须 `Authorization` + `X-Nav-Key` 双头并发（见 shared/auth.mjs#bearerOf）。
 * 项目里打云端的既有代码全是这个口径，这里保持一致，不引入第二套。
 */
async function callCloud(path, { timeoutSec = 30 } = {}) {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const pExecFile = promisify(execFile)
  let base, key
  try {
    base = await resolveBase()
    // 凭据统一走 `getAdminKey()` —— 与发布链路同一个来源。
    // 自己再读一遍 process.env 会让「控制台看到的密钥」和「实际用的密钥」
    // 变成两套（实测踩过：面板显示已配置，同步却一直 mismatch）。
    key = String(getAdminKey() || '').trim()
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
  if (!base) return { ok: false, error: '缺少云端地址（NAV_SITE_URL 或发布通道 siteUrl）' }
  if (!key) return { ok: false, error: '缺少 SITES_ADMIN_KEY' }

  const { resolveProxyUrl } = await import('../../../../shared/proxy.mjs')
  const proxy = await resolveProxyUrl()
  const via = proxy ? ['--proxy', proxy] : []
  try {
    const { stdout } = await pExecFile('curl.exe', [
      ...via,
      '-s', '--max-time', String(timeoutSec),
      '-w', '\n%{http_code}',
      `${base}${path}`,
      '-H', `Authorization: Bearer ${key}`,
      '-H', `X-Nav-Key: ${key}`,
    ], { maxBuffer: 32 * 1024 * 1024 })
    const idx = stdout.lastIndexOf('\n')
    const body = idx >= 0 ? stdout.slice(0, idx) : stdout
    const status = Number((idx >= 0 ? stdout.slice(idx + 1) : '0').trim()) || 0
    let json = null
    try { json = JSON.parse(body) } catch { /* 非 JSON 响应（网关错误页） */ }
    return { ok: status >= 200 && status < 300, status, json, raw: body }
  } catch (e) {
    // curl 非零退出：网络不可达 / 超时 / 代理拒绝。**不抛**，交给调用方决定是否推进游标。
    //
    // 错误信息必须脱敏：`execFile` 的失败消息里带着完整命令行，
    // 而命令行里有 `-H Authorization: Bearer <密钥>` —— 实测原样透出会把
    // 共享密钥写进日志、审计、面板。这里只保留错误类型与目标地址。
    return { ok: false, error: `网络请求失败（${redactError(e)}）` }
  }
}

/* ---------------- 本地状态 ---------------- */

function ensureDir() {
  mkdirSync(MIRROR_DIR, { recursive: true })
}

export function readState() {
  ensureDir()
  const p = join(MIRROR_DIR, STATE_FILE)
  if (!existsSync(p)) {
    return {
      cursor: 0,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: null,
      lastApplied: 0,
      lastFullResyncAt: null,
      truncatedEvents: 0,
      runs: 0,
      failures: 0,
    }
  }
  try { return JSON.parse(readFileSync(p, 'utf-8')) } catch {
    // 状态文件坏掉时不能直接归零：那会让游标回到 0，触发一次全量重拉。
    // 但这比「假装已同步」安全 —— 全量重拉最多是多做一次功，不会丢数据。
    return {
      cursor: 0, lastAttemptAt: null, lastSuccessAt: null, lastError: '状态文件损坏，已重置游标',
      lastApplied: 0, lastFullResyncAt: null, truncatedEvents: 0, runs: 0, failures: 0,
    }
  }
}

function writeState(st) {
  ensureDir()
  writeFileSync(join(MIRROR_DIR, STATE_FILE), JSON.stringify(st, null, 2), 'utf-8')
}

/** 对象名 → 本地文件路径。`/` 保留成目录层级，便于人眼查看 */
function objectPath(pathname) {
  const safe = String(pathname).replace(/\.\.(\/|\\|$)/g, '_').replace(/^\/+/, '')
  return join(MIRROR_DIR, 'objects', safe)
}

/** 读本地镜像里某个对象的 etag（没有则 null） */
function localEtag(pathname) {
  const p = objectPath(pathname)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf-8')).etag || null } catch { return null }
}

function writeObject(pathname, etag, size, body, at) {
  const p = objectPath(pathname)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify({ pathname, etag, size, at, body }, null, 2), 'utf-8')
}

function removeObject(pathname) {
  const p = objectPath(pathname)
  if (existsSync(p)) rmSync(p, { force: true })
}

/* ---------------- 同步主流程 ---------------- */

/**
 * 拉取一个对象的内容。走 `GET /api/backup?meta=1` 拿不到单对象，
 * 所以用 `/api/sites?snapshot=` 之类的专用端点不可行 —— 这里用备份导出端点
 * 里的通用对象读取：`GET /api/backup?object=<pathname>`（见 api/backup.js）。
 */
async function fetchObject(pathname) {
  const r = await callCloud(`/api/backup?object=${encodeURIComponent(pathname)}`, { timeoutSec: 60 })
  if (!r.ok || !r.json || r.json.ok !== true) {
    return { ok: false, error: r.error || (r.json && r.json.error) || `HTTP ${r.status}` }
  }
  return { ok: true, body: r.json.body, etag: r.json.etag || null, size: r.json.size ?? null, at: r.json.uploadedAt || null }
}

/**
 * 执行一次同步。
 *
 * @param {object} opts
 * @param {boolean} opts.force 忽略游标，从 0 开始全量对齐
 * @returns {Promise<object>} 结果摘要；**失败时 `ok: false` 且游标不推进**
 */
export async function syncOnce({ force = false, maxPages = MAX_PAGES } = {}) {
  const st = readState()
  st.lastAttemptAt = new Date().toISOString()

  const startCursor = force ? 0 : Number(st.cursor) || 0
  let cursor = startCursor
  let applied = 0
  let removed = 0
  let pages = 0
  let sawTruncated = false

  try {
    // 每页最多 500 条，最多 MAX_PAGES 页；hasMore 由服务端给出
    for (; pages < maxPages; pages++) {
      const r = await callCloud(`/api/changes?since=${cursor}&limit=500`, { timeoutSec: 60 })
      if (!r.ok || !r.json || r.json.ok !== true) {
        throw new Error(r.error || (r.json && r.json.error) || `HTTP ${r.status}`)
      }
      const data = r.json

      // 关键边界：日志为空，但本地镜像也是空的 —— 这通常是**首次同步**，
      // 或者云端是在「变更日志上线之前」就有数据的。
      //
      // 这种情况下 `items` 是空的，流程会「成功」返回 applied=0，
      // 调用方看到 ok:true 会以为同步完成，实际本地一个对象都没有。
      // 这是最坏的一种静默失败（实测在线上第一次跑就命中了：
      // 云端 9 个对象、head=0，同步报成功、镜像为空）。
      //
      // 所以：日志为空且本地为空时，直接降级为全量对齐。
      if (pages === 0 && (data.items || []).length === 0 && data.head === 0 && !hasLocalObjects()) {
        sawTruncated = true
        break
      }

      // 游标落后于日志保留区间：中间那段补不回来了，必须降级为全量对齐
      if (data.truncated) {
        sawTruncated = true
        break
      }

      for (const it of data.items || []) {
        // 删除事件：本地也删掉，并推进游标
        if (it.op === 'del') {
          if (existsSync(objectPath(it.pathname))) { removeObject(it.pathname); removed++ }
          cursor = it.seq
          continue
        }
        // 内容没变（etag 相同）：只需推进游标，不必下载
        if (it.etag && localEtag(it.pathname) === it.etag) {
          cursor = it.seq
          continue
        }
        const got = await fetchObject(it.pathname)
        if (!got.ok) {
          // 单对象拉取失败：**不推进游标**，下次从这条重试。
          // 推进了就会永久跳过这个对象，而且是静默的。
          throw new Error(`拉取 ${it.pathname} 失败：${got.error}`)
        }
        writeObject(it.pathname, got.etag || it.etag, got.size ?? it.size, got.body, got.at || it.at)
        applied++
        cursor = it.seq
      }

      if (!data.hasMore) break
    }

    // 落后太多：直接全量对齐（把游标设为当前 head 之前的对象全部重拉）
    if (sawTruncated) {
      const full = await fullAlign()
      if (!full.ok) throw new Error(`全量对齐失败：${full.error}`)
      applied += full.applied
      removed += full.removed
      cursor = full.head
      st.lastFullResyncAt = new Date().toISOString()
      st.truncatedEvents = (Number(st.truncatedEvents) || 0) + 1
    }

    st.cursor = cursor
    st.lastApplied = applied
    st.lastSuccessAt = new Date().toISOString()
    st.lastError = null
    st.runs = (Number(st.runs) || 0) + 1
    writeState(st)

    return {
      ok: true,
      applied,
      removed,
      cursor,
      from: startCursor,
      pages: pages + 1,
      fullResync: sawTruncated,
    }
  } catch (e) {
    // 失败：游标**保持不动**（不是写回 startCursor，而是根本没写 cursor）
    st.lastError = String(e?.message || e)
    st.failures = (Number(st.failures) || 0) + 1
    // 注意：这里要保留上一次成功的 cursor，不能覆盖成局部变量
    writeState({ ...st, cursor: Number(readState().cursor) || 0 })
    return { ok: false, error: st.lastError, cursor: Number(readState().cursor) || 0 }
  }
}

/**
 * 全量对齐：游标被裁剪时的降级路径。
 *
 * 用云端备份导出端点的对象清单（`GET /api/backup?meta=1`）拿到全部对象名，
 * 逐个比对 etag，只拉变化的。**同时删除本地有、云端没有的对象** ——
 * 否则「云端删了但本地还留着」会长期存在，镜像就不是镜像了。
 */
export async function fullAlign() {
  const r = await callCloud('/api/backup?objects=1', { timeoutSec: 60 })
  if (!r.ok || !r.json || r.json.ok !== true) {
    return { ok: false, error: r.error || (r.json && r.json.error) || `HTTP ${r.status}` }
  }
  const remote = Array.isArray(r.json.objects) ? r.json.objects : []
  const remoteMap = new Map(remote.map(o => [o.pathname, o]))
  let applied = 0
  let removed = 0

  for (const o of remote) {
    if (localEtag(o.pathname) === o.etag) continue
    const got = await fetchObject(o.pathname)
    if (!got.ok) return { ok: false, error: `拉取 ${o.pathname} 失败：${got.error}` }
    writeObject(o.pathname, got.etag || o.etag, got.size ?? o.size, got.body, got.at)
    applied++
  }

  // 云端已不存在 → 本地也要删
  const objRoot = join(MIRROR_DIR, 'objects')
  if (existsSync(objRoot)) {
    for (const p of walk(objRoot)) {
      const rel = p.slice(objRoot.length + 1).replace(/\\/g, '/')
      if (!remoteMap.has(rel)) { rmSync(p, { force: true }); removed++ }
    }
  }

  // 游标推进到当前 head。日志为空时 head=0 —— 这是**正确**的：
  // 全量对齐已经把现有对象都拉下来了，之后的增量靠新写入产生的 seq 追。
  // 但要注意：这时不能把「本地已有对象」误判成「同步完成」，
  // 所以 `applied` 必须如实反映这次实际拉了多少。
  const info = await callCloud('/api/changes?info=1', { timeoutSec: 30 })
  const head = info.ok && info.json ? Number(info.json.head) || 0 : 0
  return { ok: true, applied, removed, head }
}

/** 本地镜像里是否已有对象（用于判断「首次同步」） */
function hasLocalObjects() {
  const objRoot = join(MIRROR_DIR, 'objects')
  if (!existsSync(objRoot)) return false
  try { return walk(objRoot).length > 0 } catch { return false }
}

/** 递归列出目录下的文件（只用于清理孤儿对象） */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/** 状态摘要：面板与 CLI 共用 */
export function status() {
  const st = readState()
  const objRoot = join(MIRROR_DIR, 'objects')
  let objects = 0
  let bytes = 0
  if (existsSync(objRoot)) {
    for (const p of walk(objRoot)) {
      objects++
      try { bytes += statSync(p).size } catch { /* 竞态删除 */ }
    }
  }
  return {
    dir: MIRROR_DIR,
    cursor: Number(st.cursor) || 0,
    objects,
    bytes,
    lastAttemptAt: st.lastAttemptAt,
    lastSuccessAt: st.lastSuccessAt,
    lastError: st.lastError,
    lastApplied: st.lastApplied || 0,
    lastFullResyncAt: st.lastFullResyncAt,
    truncatedEvents: st.truncatedEvents || 0,
    runs: st.runs || 0,
    failures: st.failures || 0,
  }
}

/** 读本地镜像里的某个对象（供 CLI / 面板查看） */
export function readObject(pathname) {
  const p = objectPath(pathname)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf-8')) } catch { return null }
}

/** 列出本地镜像的对象清单 */
export function listObjects(limit = 200) {
  const objRoot = join(MIRROR_DIR, 'objects')
  if (!existsSync(objRoot)) return []
  return walk(objRoot)
    .slice(0, limit)
    .map(p => {
      const rel = p.slice(objRoot.length + 1).replace(/\\/g, '/')
      let meta = {}
      try { meta = JSON.parse(readFileSync(p, 'utf-8')) } catch { /* 坏文件也列出来 */ }
      return { pathname: rel, etag: meta.etag || null, size: meta.size ?? null, at: meta.at || null }
    })
}
