/**
 * 发布到自有服务器（BotKeep）的编排。
 *
 * ## 为什么发布动作在本地控制台、而不是站内后台
 *
 * 站点产物里只有**构建结果**，没有源码，也没有平台的发布凭据。要让「线上那个站」
 * 自己给自己发布，就必须把凭据塞进公开的前端产物 —— 拿安全换方便，不做。
 * 所以职责切开：站内后台只**看**（`/api/deploy-status` 自述版本与状态），
 * 本地控制台才**做**（这个模块）。
 *
 * ## 这套流程是踩出来的，几个约束不能想当然
 *
 * - **平台的上传通道装不下这个站点**：它的 ZIP 通道限制「≤200 文件 / ≤5 MB / 不支持
 *   二进制」，而产物是 400 文件 / 9 MB / 270 个二进制图标。可行路径是 tar 打包后
 *   **切片**上传，再让容器启动时自己 `cat` 合并解压。所以这里传的是 tar 分片，
 *   而不是一个 zip。
 * - **幂等键必须 16–64 位字母数字加 `-`/`_`**。写短了服务端回 422，而这条错误看起来
 *   像瞬时故障，会被无脑重试吞掉（实测白等过 9 分钟）。所以这里先自校验长度与字符集，
 *   不合格直接抛，不进入重试。
 * - **429 不是「立刻拒绝」**：请求会排 40–80 秒才回来。重试间隔必须比它长，
 *   否则重试本身也在排队，越堆越多。
 * - **`data/` 绝不能进包**：那里有管理密钥与本机 SQLite。带上等于把本机测试数据
 *   盖到线上、顺手清空站点库。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { ROOT, loadEnv } from './env.mjs'
import * as jobs from './jobs.mjs'

const DIST = join(ROOT, 'dist')
const ENV_FILE = join(ROOT, '.env.local')
const HISTORY_FILE = join(ROOT, 'tools', 'console', '.deploy-history.json')

/** 分片名。必须与容器 startCommand 里 `cat` 的那串一致（默认 a.paa…a.paz） */
const SLICE_NAMES = 'abcdefghijklmnopqrstuvwxyz'.split('').map(c => `a.pa${c}`)
/** 单片的 base64 上限约 5,333,336 字符 ≈ 3.81 MiB 原始字节。留余量按 3.5 MiB 切 */
const SLICE_BYTES = Math.floor(3.5 * 1024 * 1024)
const IDEM_RE = /^[A-Za-z0-9_-]{16,64}$/
/** 断点续传：记录「这一轮分片是否已传完」，让失败重跑时跳过已完成的阶段 */
const CHECKPOINT_FILE = join(ROOT, 'tools', 'console', '.deploy-checkpoint.json')

/**
 * 幂等键自校验。**必须区分「长度不对」与「字符不对」** ——
 * 早先只回一句「不合规（18 位）」，而 18 位明明在 16–64 区间里：
 * 真正的原因是分片名 `a.paa` 里的那个点。错误信息指错方向比不报还费时间。
 */
function idemProblem(idem) {
  if (idem.length < 16 || idem.length > 64) return `长度 ${idem.length} 不在 16–64 之间`
  if (!/^[A-Za-z0-9_-]+$/.test(idem)) return '含非法字符（只允许字母、数字、- 与 _）'
  return ''
}

/** 分片名里的点等字符要换掉才能进幂等键（`a.paa` → `a-paa`） */
function idemFor(parts) {
  return ['nav', ...parts]
    .map(p => String(p).replace(/[^A-Za-z0-9_-]/g, '-'))
    .join('-')
    .slice(0, 64)
}

/* ---------------- 凭据 ---------------- */

export function credentials() {
  loadEnv()
  return {
    key: process.env.BOTKEEP_API_KEY || process.env.BK_KEY || '',
    workloadId: process.env.BOTKEEP_WORKLOAD_ID || process.env.BK_WID || '',
  }
}

export function credentialsSummary() {
  const c = credentials()
  return {
    hasKey: Boolean(c.key),
    // 只回后 4 位：面板要能确认「配的是哪一把」，但不能把 key 交给前端
    keyTail: c.key ? c.key.slice(-4) : '',
    workloadId: c.workloadId,
    envFileExists: existsSync(ENV_FILE),
  }
}

/** 把凭据写进 .env.local（该文件已被 gitignore；控制台只监听 127.0.0.1） */
export function saveCredentials({ key, workloadId }) {
  loadEnv()
  let text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : ''
  const upsert = (name, value) => {
    if (!value) {
      // 允许清空，但保持文件整洁：删掉整行
      text = text.split(/\r?\n/).filter(l => !new RegExp(`^${name}=`).test(l)).join('\n')
      return
    }
    const line = `${name}=${value}`
    const re = new RegExp(`^${name}=.*$`, 'm')
    text = re.test(text) ? text.replace(re, line) : (text.replace(/\s*$/, '') + '\n' + line + '\n')
  }
  if (key !== undefined) upsert('BOTKEEP_API_KEY', String(key).trim())
  if (workloadId !== undefined) upsert('BOTKEEP_WORKLOAD_ID', String(workloadId).trim())
  writeFileSync(ENV_FILE, text)
  // 让本次进程立刻生效，不必重启控制台
  if (key !== undefined) process.env.BOTKEEP_API_KEY = String(key).trim()
  if (workloadId !== undefined) process.env.BOTKEEP_WORKLOAD_ID = String(workloadId).trim()
  return credentialsSummary()
}

/* ---------------- 版本 ---------------- */

function git(cmd) {
  try {
    return execFileSync('git', cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch { return '' }
}

/** 本地源码的版本（与「上次构建的版本」不是一回事，两个都要看） */
export function localSource() {
  const sha = git(['rev-parse', 'HEAD'])
  return {
    sha,
    shortSha: sha ? sha.slice(0, 7) : '',
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    dirty: git(['status', '--porcelain']).length > 0,
    subject: git(['log', '-1', '--pretty=%s']),
  }
}

export function localBuild() {
  try {
    const j = JSON.parse(readFileSync(join(DIST, 'build-info.json'), 'utf8'))
    const ageMin = Math.round((Date.now() - Date.parse(j.builtAt)) / 60000)
    return { available: true, ...j, ageMin }
  } catch {
    return { available: false }
  }
}

function apiBase() {
  const { workloadId } = credentials()
  if (!workloadId) throw new Error('未配置 workload id（BOTKEEP_WORKLOAD_ID）')
  return `https://api.botkeep.cloud/api/v1/developer/workloads/${workloadId}`
}

async function bk(pathname, { method = 'GET', body, idem, timeout = 120000 } = {}) {
  const { key } = credentials()
  if (!key) throw new Error('未配置 BotKeep API key（BOTKEEP_API_KEY）')
  const headers = { Authorization: `Bearer ${key}`, Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (idem) headers['Idempotency-Key'] = idem
  const res = await fetch(`${apiBase()}${pathname}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, ok: res.ok, json }
}

/** 线上这台机器自述的状态（走它自己的公开接口，不经过平台 API） */
export async function remoteStatus(url) {
  const target = String(url || process.env.DEPLOY_SITE_URL || 'https://navigator-v2.bot-keep.xyz').replace(/\/+$/, '')
  try {
    const res = await fetch(`${target}/api/deploy-status`, { signal: AbortSignal.timeout(15000) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok || !j.ok) return { available: false, url: target, error: `接口返回 ${res.status}` }
    return { available: true, url: target, ...j }
  } catch (e) {
    return { available: false, url: target, error: e.name === 'TimeoutError' ? '连不上（超时）' : '连不上' }
  }
}

/** 本地源码 / 上次构建 / 线上 —— 三者对齐情况 */
export async function deployStatus({ url } = {}) {
  const source = localSource()
  const build = localBuild()
  const remote = await remoteStatus(url)

  const same = (a, b) => Boolean(a && b) && String(a).slice(0, 7) === String(b).slice(0, 7)
  return {
    source,
    build,
    remote,
    credentials: credentialsSummary(),
    drift: {
      // 「构建了但没发布」：本地构建比线上新
      buildAheadOfRemote: build.available && remote.available && !same(build.sha, remote.version?.sha),
      // 「改了但没构建」：没构建过、提交号对不上、或**这两次快照的脏净状态不同**
      // （源码现在脏而构建时是干净的 → 构建之后又改过东西）
      sourceAheadOfBuild: !build.available
        || !same(source.sha, build.sha)
        || (source.dirty && !build.dirty),
    },
  }
}

/* ---------------- 发布历史 ---------------- */

export function history(limit = 20) {
  try {
    const list = JSON.parse(readFileSync(HISTORY_FILE, 'utf8'))
    return Array.isArray(list) ? list.slice(0, limit) : []
  } catch { return [] }
}

function recordHistory(entry) {
  const list = history(50)
  list.unshift(entry)
  try {
    mkdirSync(dirname(HISTORY_FILE), { recursive: true })
    writeFileSync(HISTORY_FILE, JSON.stringify(list.slice(0, 50), null, 2) + '\n')
  } catch { /* 历史写不进去不该让发布失败 */ }
}

/* ---------------- 打包 ---------------- */

function runStep(log, label, command, args, opts = {}) {
  log(`\n$ ${label}`)
  try {
    const out = execFileSync(command, args, {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024, ...opts,
    }).toString()
    if (out.trim()) log(out.trim().split('\n').slice(-40).join('\n'))
    return { ok: true, out }
  } catch (e) {
    const out = String(e.stdout || '') + String(e.stderr || '')
    if (out.trim()) log(out.trim().split('\n').slice(-40).join('\n'))
    // 连 stdout/stderr 都没有时（spawn 层面就失败了，比如 Windows 上跑 .cmd），
    // 至少把退出码与原因说出来 —— 否则日志里只剩一句「构建失败」，无从下手
    if (!out.trim()) log(`  （无输出：${e.message}${e.status != null ? ` / exit ${e.status}` : ''}）`)
    return { ok: false, error: e.message, out }
  }
}

/**
 * 把 dist/ 打成 tar 并切片。
 *
 * 用 tar 而不是 zip：产物里有 270 个二进制图标，而平台的 ZIP 通道明确不支持二进制。
 * tar 只是把文件按字节串起来，不对内容做任何假设。
 */
async function packSlices(log) {
  const work = join(tmpdir(), `nav-deploy-${Date.now()}`)
  const staged = join(work, 'stage')
  mkdirSync(staged, { recursive: true })

  // 复制 dist → staging，**排除 data/**
  const skip = new Set(['data'])
  const copyDir = (from, to) => {
    mkdirSync(to, { recursive: true })
    for (const e of readdirSync(from, { withFileTypes: true })) {
      if (skip.has(e.name)) continue
      const src = join(from, e.name)
      const dst = join(to, e.name)
      if (e.isDirectory()) copyDir(src, dst)
      else writeFileSync(dst, readFileSync(src))
    }
  }
  if (!existsSync(DIST)) throw new Error('没有 dist/，先构建')
  copyDir(DIST, staged)
  if (existsSync(join(staged, 'data'))) throw new Error('打包时 data/ 没有被排除（这会覆盖线上站点库）')

  const tarName = 'app.tar'
  const tarPath = join(work, tarName)
  /**
   * 用**相对路径**（cwd 设在 work，tar 写 `app.tar`、从 `stage` 取内容）：
   * GNU tar 会把 `C:\...` 里的 `C:` 当成 rsh 的远程主机语法（"Cannot connect to C:"）。
   * 传绝对 Windows 路径必挂，`--force-local` 也不是所有版本都有 —— 相对路径最稳。
   */
  const packed = runStep(log, 'tar -cf app.tar -C stage .', 'tar', ['-cf', tarName, '-C', 'stage', '.'], { cwd: work })
  if (!packed.ok) throw new Error('打包失败：' + packed.error)

  const buf = readFileSync(tarPath)
  log(`包体 ${(buf.length / 1048576).toFixed(2)} MiB`)

  const slices = []
  for (let i = 0, off = 0; off < buf.length; i++, off += SLICE_BYTES) {
    const chunk = buf.subarray(off, Math.min(off + SLICE_BYTES, buf.length))
    if (i >= SLICE_NAMES.length) throw new Error(`分片超过 ${SLICE_NAMES.length} 片，需要调整容器启动命令`)
    slices.push({ name: SLICE_NAMES[i], base64: chunk.toString('base64'), bytes: chunk.length })
  }
  log(`切成 ${slices.length} 片：${slices.map(s => `${s.name} ${(s.bytes / 1048576).toFixed(2)}M`).join('、')}`)
  return { work, slices }
}

/* ---------------- 上传 ---------------- */

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/**
 * 单片的重试上限。平台在忙的时候会连续拒（422/503/超时都是同一件事的不同马甲），
 * 4 次不够用（实测连续五六次都见过）；每片之间还要排队，所以给到 6 次。
 */
const MAX_ATTEMPTS = 6

/**
 * 上传单片，带重试。
 *
 * 重试策略来自实测：429 要排队 40–80 秒才返回（所以间隔取 45 秒，比它长），
 * 422 与 503 都出现过「同一份 body 重试就成功」的情况，也一并重试。
 * **唯独幂等键不合规不能重试** —— 那不是瞬时故障，重试只是白等。
 */
async function uploadSlice(log, slice, attempt = 0, retryKey) {
  /**
   * 命中「未确认」类失败（503 / 409 pending）时**不传 retryKey**，即换新键重试 ——
   * 详见下方 unconfirmed 处的说明。其余情况复用同一个键，那才是幂等的本意。
   */
  const idem = retryKey || idemFor([slice.name, Date.now().toString(36)])
  const bad = idemProblem(idem)
  if (bad) throw new Error(`幂等键不合规（${bad}）：${idem}`)
  try {
    const r = await bk('/files/upload', {
      method: 'POST',
      // 字段名是 `data`（不是 content）：写错时服务端回**422**，
      // 而 422 看起来像瞬时故障，会被重试逻辑吞掉六轮 —— 白等好几分钟才失败
      body: { path: `/${slice.name}`, data: slice.base64 },
      idem,
      // 上传 3.5 MiB 分片（base64 后约 4.7 MB）在平台要排队，实测会超过 120 秒。
      // 超时过短会让「上传中的请求」被本地掐断，然后无谓地重头再来一遍。
      timeout: 300000,
    })
    if (r.ok) { log(`  ✓ ${slice.name}`); return true }
    const detail = JSON.stringify(r.json || {}).slice(0, 220)
    if (r.status === 413) throw new Error('单片过大，平台 nginx 拒绝（需调小 SLICE_BYTES）')

    /**
     * 目标位置已有同名文件时平台回 409（要显式确认替换）。重试没有意义 ——
     * 得先把它删掉再传。这一步很常见：上一次发布的同名分片就留在那儿。
     * 不计入 attempt：这不是一次失败，只是需要先清理。
     */
    if (r.status === 409 && /already exists/i.test(detail)) {
      log(`  · ${slice.name} 已存在，先删除再上传`)
      try {
        await deleteFiles([`/${slice.name}`])
      } catch { /* 删不掉就让下一次 409 再试 */ }
      await sleep(5000)
      // 必须换**新的幂等键**：这个键刚才已经用过了，平台会按幂等语义回放那次 409
      return uploadSlice(log, slice, attempt + 1)
    }

    /**
     * 请求体**字段**不对时不要重试：服务端会把哪个字段多了、哪个少了列出来
     * （`extra_forbidden` / `missing`），这是代码问题不是负载问题，重试一万次也一样。
     * 早先这类 422 被当成瞬时故障，六轮各等 30 秒后才失败，日志里还只有「HTTP 422」。
     */
    const fields = r.json?.fields
    if (r.status === 422 && Array.isArray(fields) && fields.some(f => /missing|extra_forbidden|invalid/i.test(String(f?.type)))) {
      throw new Error(`请求体字段不合规（不可重试）：${detail}`)
    }

    if (attempt >= MAX_ATTEMPTS) throw new Error(`上传 ${slice.name} 失败：HTTP ${r.status} ${detail}`)
    /**
     * 非 429 的错误也等 30 秒：平台对写操作是**统一排队**的，422/503 这类
     * 看起来像瞬时故障的响应，实测也是「等一轮再发就好了」。
     * 早先只等 8 秒，等于在队列里原地反复插队，既慢又更容易再被拒。
     */
    const wait = r.status === 429 ? 45000 : 30000
    // 重试日志必须带上响应体：不然「HTTP 422」这五个字什么信息都没有
    log(`  · ${slice.name} HTTP ${r.status} ${detail}，${Math.round(wait / 1000)}s 后重试（${attempt + 1}/${MAX_ATTEMPTS}）`)
    await sleep(wait)
    /**
     * 「未确认」类失败**必须换新键**重试 —— 复用同一个键会死循环：
     *   503 说的是「未假定成功」（那次请求可能已在平台侧入队，也可能没有）；
     *   紧随其后的 409「previous request is pending or unconfirmed」是平台按幂等语义
     *   **回放那个悬而未决的键**，再用它重试只会一直拿到同一个 409，直到耗尽重试次数。
     * 实测踩过：a.paa 成功、a.pab 首次 503，之后六轮全是 409，整个发布卡死在第二步。
     * 换新键等价于「当作一次新上传」，同名文件若已在位会回 409 already exists ——
     * 那个分支会先删再传，是收敛的。
     */
    const unconfirmed = r.status === 503 || (r.status === 409 && /pending or unconfirmed/i.test(detail))
    return uploadSlice(log, slice, attempt + 1, unconfirmed ? undefined : idem)
  } catch (e) {
    if (/过.*大|幂等键不合规|不可重试/.test(e.message)) throw e
    if (attempt >= MAX_ATTEMPTS) throw e
    // 超时/网络类错误也要等够：平台的写入通道是**排队**的，立刻重试只会再排一次队。
    // 同样换新键：本地超时的那一刻，请求多半已经发出去且可能已被平台受理。
    log(`  · ${slice.name} ${e.message}，30s 后重试（${attempt + 1}/${MAX_ATTEMPTS}）`)
    await sleep(30000)
    return uploadSlice(log, slice, attempt + 1)
  }
}

/**
 * 删除容器里的文件（可批量）。
 *
 * 端点与字段都**不是**凭直觉能猜对的那几个，这里把踩过的全记下来：
 *   · `POST /files/delete {path}`       → 404（这个端点不存在）
 *   · `POST /file-action {path,name}`   → 那是**重命名**，`name` 是新文件名；
 *                                          当成删除用时服务端回 409「A file already exists
 *                                          at the destination」——因为目标就是它自己
 *   · `POST /files/batch {action,paths}` → ✅ `{action:'delete', paths:[...]}`，一次可删多个
 *
 * 这类「端点猜错」的代价特别大：404/409 很容易被当成「本来就没有」吞掉，
 * 于是「删了」这个动作一次都没发生，而后续每一步都还照常往下走 ——
 * 最终表现为「发布全绿、线上还是旧版本」。
 */
async function deleteFiles(paths) {
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean)
  if (!list.length) return { ok: true, status: 200, json: { skipped: true } }
  const r = await bk('/files/batch', {
    method: 'POST',
    body: { action: 'delete', paths: list },
    idem: idemFor(['batch', Date.now().toString(36)]),
  })
  /**
   * 平台对「要删的东西不在」回 **404 `The file or folder no longer exists`** ——
   * 注意这不是「端点不存在」，而是**意图已经达成**。把它当失败处理会引发一连串误判：
   * 清理步骤报错 → 上传撞 409 → 重试 → 白等。
   * 另外这条 404 是**整批**返回的：一批里混了一个不存在的路径，整批都不执行。
   * 所以调用方要先按真实文件列表过滤（见 publish 里的清理步骤）。
   */
  if (r.status === 404 && /no longer exists/i.test(JSON.stringify(r.json || {}))) {
    return { ...r, ok: true, alreadyGone: true }
  }
  return r
}

/** 根目录下的实际文件名集合（用于「只删存在的」，避免整批 404） */
async function listRoot() {
  try {
    const r = await bk('/files?path=/')
    if (!r.ok) return null
    const list = Array.isArray(r.json) ? r.json : []
    return new Set(list.map(x => String(x.path || x.name || '')))
  } catch {
    return null
  }
}

async function action(log, name, attempt = 0) {
  const idem = idemFor([name, Date.now().toString(36)])
  try {
    const r = await bk('/actions', { method: 'POST', body: { action: name }, idem })
    if (r.ok || r.status === 202) { log(`  ✓ ${name} 已入队`); return r }
    if (attempt >= 3) throw new Error(`${name} 失败：HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`)
    log(`  · ${name} HTTP ${r.status}，30s 后重试`)
    await sleep(30000)
    return action(log, name, attempt + 1)
  } catch (e) {
    if (attempt >= 3) throw e
    log(`  · ${name} ${e.message}，30s 后重试`)
    await sleep(30000)
    return action(log, name, attempt + 1)
  }
}

/* ---------------- 断点续传 ---------------- */

/**
 * 上传是这个流程里**最慢也最容易被打断**的一段：平台上写操作要排队，429 实测
 * 40–80 秒才返回，4 片排下来好几分钟；中途某片失败（平台抽风、网络抖动、手动中断）
 * 前面的就白传了 —— 实测踩过一次白等 9 分钟。
 *
 * 所以把「这一轮的分片指纹 + 是否传完」落盘。重跑同一份 dist 时若指纹一致，
 * 直接跳到触发解压那一步。指纹用「分片名 + 字节数」：产物一变指纹就变，
 * 绝不会拿旧断点去跳过一次**内容已经变了**的新构建（那会导致线上跑的是半新半旧的包）。
 */
export function sliceFingerprint(slices) {
  return (slices || []).map(s => `${s.name}:${s.bytes}`).join(',')
}

/** 只有「指纹一致 + 上一轮确实传完 + 是同一个 workload」三者都满足才允许跳过上传 */
export function shouldResumeUpload(checkpoint, fingerprint, workloadId) {
  if (!checkpoint || !checkpoint.uploaded) return false
  if (!fingerprint || checkpoint.fingerprint !== fingerprint) return false
  if (workloadId && checkpoint.workloadId && checkpoint.workloadId !== workloadId) return false
  return true
}

function readCheckpoint() {
  try { return JSON.parse(readFileSync(CHECKPOINT_FILE, 'utf-8')) } catch { return null }
}
function writeCheckpoint(obj) {
  try { writeFileSync(CHECKPOINT_FILE, JSON.stringify(obj, null, 2), 'utf-8') } catch { /* 断点记录失败不阻塞发布 */ }
}
function clearCheckpoint() {
  try { rmSync(CHECKPOINT_FILE, { force: true }) } catch { /* 同上 */ }
}

/* ---------------- 主流程 ---------------- */

/**
 * 完整发布：构建 → 门禁 → 打包 → 上传 → 触发解压 → 线上验证。
 *
 * @param {object} o
 * @param {(s:string)=>void} o.log 实时日志
 * @param {boolean} [o.skipBuild] 跳过构建（复用现有 dist）
 * @param {string} [o.url] 线上地址
 */
export async function publish({ log = () => {}, skipBuild = false, url } = {}) {
  const started = Date.now()
  const source = localSource()

  if (!credentials().key) throw new Error('未配置 BotKeep API key —— 先在「发布」面板里填一次（写入 .env.local）')
  if (!credentials().workloadId) throw new Error('未配置 workload id')

  const steps = []

  try {
    /* 1. 构建 */
    if (skipBuild) {
      log('· 跳过构建（复用现有 dist）')
      steps.push({ key: 'build', ok: true, skipped: true })
    } else {
      log('· 构建产物')
      /**
       * Windows 上必须走 shell：`npm` 是 `npm.cmd`（批处理），而 Node 从 v18.20/20.12 起
       * 出于安全考虑**禁止** execFile 直接执行 .cmd/.bat（会抛 EINVAL，且不带任何输出）。
       * 参数是这里写死的（'run','build'），没有拼接外部输入，所以 shell 不引入注入面。
       */
      const win = process.platform === 'win32'
      // 整条命令作为 command、args 留空：`shell:true` 配 args 会触发 DEP0190
      // （Node 警告参数不会转义、只是拼接），而这里本来就只需要一条固定命令
      const b = win
        ? runStep(log, 'npm run build', 'npm run build', [], { shell: true })
        : runStep(log, 'npm run build', 'npm', ['run', 'build'])
      if (!b.ok) throw Object.assign(new Error(`构建失败：${b.error}`), { step: 'build' })
      steps.push({ key: 'build', ok: true })
    }

    /* 2. 发布门禁：产物必须新于源码、完整性可校验 */
    log('\n· 发布门禁')
    const gate = runStep(log, 'node scripts/deploy-cloud.mjs --check', process.execPath,
      [join(ROOT, 'scripts', 'deploy-cloud.mjs'), '--check'])
    // 门禁脚本不支持 --check 时（旧版）不阻塞发布，但要把实情写进日志
    steps.push({ key: 'gate', ok: gate.ok, note: gate.ok ? '' : '门禁未通过或脚本不支持 --check' })
    if (!gate.ok) log('  ⚠ 门禁未通过 —— 继续发布，但请自行确认产物有效性')

    /* 3. 打包切片 */
    log('\n· 打包')
    const { work, slices } = await packSlices(log)
    steps.push({ key: 'pack', ok: true, note: `${slices.length} 片` })

    try {
      /* 4. 上传 */
      log('\n· 上传分片')
      /**
       * 上传前把**这一批分片名 + 几个可能的残留**一次性删干净，再统一上传。
       *
       * 两个理由：
       *  1. 平台的上传遇到同名文件回 409「already exists」，得先删再传；
       *     而删除有生效延迟（实测紧随其后的上传仍可能撞 409），所以批量删完再等一会儿。
       *  2. 容器启动命令用通配 `cat a.pa?` 合并分片 —— 上次若切得更多，残留片会被
       *     一起合进包里，包直接损坏，表现为「解压完还是跑旧版本」。
       *
       * 用 batch 端点一次删完：写操作在这个平台是要排队的，能少一次是一次。
       */
      const ck = readCheckpoint()
      const fingerprint = sliceFingerprint(slices)
      if (shouldResumeUpload(ck, fingerprint, credentials().workloadId)) {
        log(`  · 断点续传：这 ${slices.length} 片上一轮已传完且指纹一致，跳过上传`)
        steps.push({ key: 'upload', ok: true, skipped: true, note: '断点续传' })
      } else {
      const staleList = SLICE_NAMES.slice(slices.length, slices.length + 3)
      const wantPaths = [...slices.map(s => `/${s.name}`), ...staleList.map(n => `/${n}`)]
      // 只删**实际存在**的：批量删除是整批语义，混进一个不存在的路径会让整批都不执行
      const present = await listRoot()
      const clearList = present ? wantPaths.filter(p => present.has(p)) : wantPaths
      if (clearList.length) {
        try {
          const r = await deleteFiles(clearList)
          log(`  · 清理分片位 ${clearList.join('、')}（HTTP ${r.status}）`)
        } catch (e) {
          log(`  · 清理分片失败（${e.message}），继续尝试上传`)
        }
        await sleep(5000)
      } else {
        log('  · 没有需要清理的旧分片')
      }
      for (const s of slices) await uploadSlice(log, s)
      writeCheckpoint({
        fingerprint,
        workloadId: credentials().workloadId,
        slices: slices.map(s => s.name),
        uploaded: true,
        ts: Date.now(),
      })
      steps.push({ key: 'upload', ok: true, note: `${slices.length} 片` })
      }

      /* 5. 触发解压：容器启动命令里有「server.js 不存在才解压」的守卫 */
      log('\n· 触发容器解压')

      /**
       * 先确认容器的启动命令认得出**这一批**分片。
       *
       * 这里踩过一次大坑：启动命令里把分片名一个个写死（`cat a.paa a.pab a.pac a.pad`），
       * 而某次产物变小只切了 3 片 —— `cat` 因为第 4 个文件不存在而失败，
       * `&&` 后面的解压整条不执行，容器**若无其事地继续跑旧版本**。
       * 现象是「发布全绿、线上还是旧的」，而且没有任何报错。通配 `a.pa?` 就没有这个问题。
       */
      try {
        const wl = await bk('')
        const cmd = String(wl.json?.startCommand || '')
        if (cmd && !/a\.pa\?/.test(cmd)) {
          log('  ⚠ 容器的启动命令没有用通配 a.pa?，分片数一变就会解压失败（且不报错）')
          log('    建议改为：test -f server.js || (cat a.pa? > a.tar && tar -xf a.tar && rm -f a.pa? a.tar); node server.js')
        }
      } catch { /* 读不到详情不影响发布 */ }

      const del = await deleteFiles(['/server.js'])
      log(del.ok ? '  ✓ server.js 已移除（解压触发器就绪）' : `  ⚠ 没能移除 server.js（HTTP ${del.status}）—— 容器会继续跑旧版本`)
      await action(log, 'restart')
      // 解压触发已发出 → 这一轮的分片不再需要，断点记录清掉（避免下次误用它跳过上传）
      clearCheckpoint()
      steps.push({ key: 'restart', ok: true })

      /* 6. 线上验证：等到线上自述的 sha 与新构建一致 */
      log('\n· 等待线上就绪并验证版本')
      const target = (url || process.env.DEPLOY_SITE_URL || 'https://navigator-v2.bot-keep.xyz').replace(/\/+$/, '')
      const want = localBuild().sha || source.sha
      let seen = null
      for (let i = 0; i < 40; i++) {
        await sleep(6000)
        const r = await remoteStatus(target)
        if (r.available) {
          seen = r
          if (String(r.version?.sha || '') === want) {
            log(`  ✓ 线上已是最新版本 ${String(want).slice(0, 7)}`)
            steps.push({ key: 'verify', ok: true })
            break
          }
          log(`  · 线上仍在跑 ${String(r.version?.sha || '(未知)').slice(0, 7)}，继续等…`)
        } else {
          log(`  · ${r.error || '暂不可达'}，继续等…`)
        }
        if (i === 39) {
          log(`  ⚠ 等待超时：线上版本仍不是 ${String(want).slice(0, 7)}`)
          steps.push({ key: 'verify', ok: false, note: '等待超时' })
          return finish({ ok: false, error: '线上验证未通过（版本未更新）', steps, started, source, seen })
        }
      }
      return finish({ ok: true, steps, started, source, seen })
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  } catch (e) {
    log(`\n✗ ${e.message}`)
    return finish({ ok: false, error: e.message, steps, started, source })
  }
}

function finish({ ok, error, steps, started, source, seen }) {
  const entry = {
    at: new Date().toISOString(),
    ok,
    error: error || '',
    sha: source.sha,
    shortSha: source.shortSha,
    subject: source.subject,
    seconds: Math.round((Date.now() - started) / 1000),
    steps,
    online: seen?.version?.shortSha || '',
  }
  recordHistory(entry)
  return entry
}

/**
 * 以「任务」形式启动发布：前端拿 jobId 走 SSE 看实时日志
 * （构建、上传、重启、验证全是分钟级动作，没有流就只能干等）。
 *
 * ## 多端点（N2）
 *
 * `opts.endpoints` 收**已解析的端点对象数组** —— 解析由调用方用
 * `endpoints.mjs#resolveEndpoints` 完成，未知 id 在那一步就报错，不会静默少发一个端点。
 *
 * 只要显式给了端点就走 `publishAll`，**包括只给一个**：`publish()` 是按环境变量
 * （BOTKEEP_* / DEPLOY_SITE_URL）决定发到哪的，单选一个镜像站却走 `publish()`
 * 会把镜像站的选择悄悄丢掉、把默认端点发出去，而且全程不报错。
 * `publishAll` 对单元素数组同样正确（它会临时把 env 切到该端点再恢复）。
 *
 * 不传 `endpoints` 的旧调用者维持原样直接 `publish()` —— 多端点是加法，不是替换。
 */
export function startPublish(opts = {}) {
  if (jobs.listJobs().some(j => j.title.startsWith('发布到服务器') && j.status === 'running')) {
    throw new Error('已有发布任务在运行中，请等它结束。')
  }
  const job = jobs.createJob('发布到服务器')
  const log = (t) => jobs.log(job, t)
  const src = localSource()
  const eps = Array.isArray(opts.endpoints) ? opts.endpoints.filter(Boolean) : []
  const head = `开始发布 ${src.shortSha}${src.dirty ? '（含未提交改动）' : ''}`

  if (eps.length > 1) log(`${head} —— ${eps.length} 个端点：${eps.map(e => e.label || e.id).join('、')}`)
  else if (eps.length === 1) log(`${head} —— 端点「${eps[0].label || eps[0].id}」（${eps[0].url || '默认'}）`)
  else log(`${head} —— ${src.subject}`)

  const run = eps.length
    ? publishAll({ log, skipBuild: Boolean(opts.skipBuild), endpoints: eps }).then(r => {
      // 失败不静默：哪个端点挂了、为什么挂，逐条点名进日志，退出码非零
      const bad = r.results.filter(x => !x.ok)
      if (!bad.length) log(`\n✓ ${r.results.length} 个端点全部发布完成`)
      else log(`\n✗ ${bad.length}/${r.results.length} 个端点失败：${bad.map(x => `${x.endpoint} —— ${x.error}`).join('；')}`)
      jobs.finish(job, bad.length ? 1 : 0)
    })
    : publish({ ...opts, log }).then(r => {
      if (r.ok) {
        log(`\n✓ 发布完成，用时 ${r.seconds}s，线上版本 ${r.online || '(未知)'}`)
        jobs.finish(job, 0)
      } else {
        log(`\n✗ 发布失败：${r.error}`)
        jobs.finish(job, 1)
      }
    })

  run.catch(e => {
    log(`\n✗ ${e.message}`)
    jobs.finish(job, 1)
  })
  return job
}

/** dist 的体积概况（发布前用来判断「这次产物有多大、和上次差多少」） */
/** 环境变量恢复：原值为 undefined 时必须 delete，否则会把它写成字符串 "undefined" */
function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

/** 临时把 BOTKEEP_* / DEPLOY_SITE_URL 切到某个端点，返回恢复函数 */
function applyEndpointEnv(ep) {
  if (!ep) return () => {}
  const saved = {
    apiKey: process.env.BOTKEEP_API_KEY,
    bkKey: process.env.BK_KEY,
    workload: process.env.BOTKEEP_WORKLOAD_ID,
    bkWorkload: process.env.BK_WID,
    siteUrl: process.env.DEPLOY_SITE_URL,
  }
  if (ep.key) { process.env.BOTKEEP_API_KEY = ep.key; process.env.BK_KEY = ep.key }
  if (ep.workloadId) { process.env.BOTKEEP_WORKLOAD_ID = ep.workloadId; process.env.BK_WID = ep.workloadId }
  if (ep.url) process.env.DEPLOY_SITE_URL = ep.url
  return () => {
    restoreEnv('BOTKEEP_API_KEY', saved.apiKey)
    restoreEnv('BK_KEY', saved.bkKey)
    restoreEnv('BOTKEEP_WORKLOAD_ID', saved.workload)
    restoreEnv('BK_WID', saved.bkWorkload)
    restoreEnv('DEPLOY_SITE_URL', saved.siteUrl)
  }
}

/**
 * 多端点发布（N2）：对每个端点依次跑一遍 `publish`。
 *
 * ## 为什么用「临时切环境变量」而不是给 publish 加参数
 *
 * `publish` 内部对 `BOTKEEP_API_KEY` / `BOTKEEP_WORKLOAD_ID` / `DEPLOY_SITE_URL`
 * 有 5 处以上直接依赖（credentials / bk / listRoot / deleteFiles / 验证目标）。
 * 逐个改成传参既要穿透整条调用链（bk ← uploadSlice ← publish），又极易漏掉一处 ——
 * 漏掉的那个端点就会用**上一个端点的凭据**发出去，而且不报错。
 * 临时切换 + `finally` 恢复，把风险收在一个函数里，且完全不改 publish 本身。
 *
 * ## 一个端点失败不阻断其余
 *
 * 多端点场景下「部分成功」比「全停」有用：主站发好了、镜像站挂了，不该让主站白跑一趟。
 * 每个端点的结果都如实进 `results`，调用方自行决定如何处置。
 *
 * @param {{log?:Function, skipBuild?:boolean, endpoints?:object[]}} opts
 *   endpoints 为端点对象数组（见 endpoints.mjs 的 resolveEndpoints）；空则等价单端点。
 */
export async function publishAll({ log = () => {}, skipBuild = false, endpoints } = {}) {
  const list = Array.isArray(endpoints) && endpoints.length ? endpoints : [null]
  const results = []
  for (let i = 0; i < list.length; i++) {
    const ep = list[i]
    const label = ep ? `${ep.label || ep.id}（${ep.url}）` : '默认端点'
    log(`\n===== 端点 ${i + 1}/${list.length}：${label} =====`)
    const restore = applyEndpointEnv(ep)
    try {
      // 第一个端点构建，其余复用同一份 dist —— 多端点不该重复构建
      const r = await publish({ log, skipBuild: skipBuild || i > 0, url: ep?.url })
      results.push({ endpoint: ep?.id || 'default', ok: true, result: r })
    } catch (e) {
      const error = String(e?.message || e)
      log(`✗ 端点「${label}」发布失败：${error}`)
      results.push({ endpoint: ep?.id || 'default', ok: false, error })
    } finally {
      restore()
    }
  }
  return { ok: results.every(r => r.ok), results }
}

export function distSize() {
  let bytes = 0, files = 0
  const walk = (d) => {
    let entries
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) { walk(p); continue }
      try { bytes += statSync(p).size; files++ } catch { /* 跳过读不到的 */ }
    }
  }
  walk(DIST)
  return { bytes, files }
}
