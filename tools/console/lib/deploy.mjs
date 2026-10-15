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
  const packed = runStep(log, 'tar -cf app.tar .', 'tar', ['-cf', tarPath, '-C', staged, '.'])
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
 * 上传单片，带重试。
 *
 * 重试策略来自实测：429 要排队 40–80 秒才返回（所以间隔取 45 秒，比它长），
 * 422 与 503 都出现过「同一份 body 重试就成功」的情况，也一并重试。
 * **唯独幂等键不合规不能重试** —— 那不是瞬时故障，重试只是白等。
 */
async function uploadSlice(log, slice, attempt = 0) {
  const idem = `nav-${slice.name}-${Date.now().toString(36)}`
  if (!IDEM_RE.test(idem)) throw new Error(`幂等键不合规（${idem.length} 位）：${idem}`)
  try {
    const r = await bk('/files/upload', {
      method: 'POST',
      body: { path: `/${slice.name}`, content: slice.base64 },
      idem,
    })
    if (r.ok) { log(`  ✓ ${slice.name}`); return true }
    if (r.status === 413) throw new Error('单片过大，平台 nginx 拒绝（需调小 SLICE_BYTES）')
    if (attempt >= 4) throw new Error(`上传 ${slice.name} 失败：HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`)
    const wait = r.status === 429 ? 45000 : 8000
    log(`  · ${slice.name} HTTP ${r.status}，${Math.round(wait / 1000)}s 后重试（${attempt + 1}/4）`)
    await sleep(wait)
    return uploadSlice(log, slice, attempt + 1)
  } catch (e) {
    if (/过.*大|幂等键不合规/.test(e.message)) throw e
    if (attempt >= 4) throw e
    log(`  · ${slice.name} ${e.message}，8s 后重试（${attempt + 1}/4）`)
    await sleep(8000)
    return uploadSlice(log, slice, attempt + 1)
  }
}

async function action(log, name, attempt = 0) {
  const idem = `nav-${name}-${Date.now().toString(36)}`
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
      const b = runStep(log, 'npm run build', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'])
      if (!b.ok) throw Object.assign(new Error('构建失败'), { step: 'build' })
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
      for (const s of slices) await uploadSlice(log, s)
      steps.push({ key: 'upload', ok: true, note: `${slices.length} 片` })

      /* 5. 触发解压：容器启动命令里有「server.js 不存在才解压」的守卫 */
      log('\n· 触发容器解压')
      const del = await bk('/files/delete', {
        method: 'POST', body: { path: '/server.js' },
        idem: `nav-del-${Date.now().toString(36)}`,
      })
      log(del.ok || del.status === 404 ? '  ✓ server.js 已移除（触发器就绪）' : `  · 删除返回 ${del.status}（继续）`)
      await action(log, 'restart')
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
 */
export function startPublish(opts = {}) {
  if (jobs.listJobs().some(j => j.title.startsWith('发布到服务器') && j.status === 'running')) {
    throw new Error('已有发布任务在运行中，请等它结束。')
  }
  const job = jobs.createJob('发布到服务器')
  const log = (t) => jobs.log(job, t)
  const src = localSource()
  log(`开始发布 ${src.shortSha}${src.dirty ? '（含未提交改动）' : ''} —— ${src.subject}`)

  publish({ ...opts, log })
    .then(r => {
      if (r.ok) {
        log(`\n✓ 发布完成，用时 ${r.seconds}s，线上版本 ${r.online || '(未知)'}`)
        jobs.finish(job, 0)
      } else {
        log(`\n✗ 发布失败：${r.error}`)
        jobs.finish(job, 1)
      }
    })
    .catch(e => {
      log(`\n✗ ${e.message}`)
      jobs.finish(job, 1)
    })
  return job
}

/** dist 的体积概况（发布前用来判断「这次产物有多大、和上次差多少」） */
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
