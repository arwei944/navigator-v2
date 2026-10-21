/**
 * 三端同步运行器：本地库 ↔ BotKeep ↔ Vercel。
 *
 * ## 为什么放在 server/ 而不是 tools/
 *
 * 生产产物（`dist/`）只包含 `server/`、`api/`、`shared/`。同步要在后台面板点一下就能跑，
 * 所以运行器必须随产物走；放在 `tools/console/` 下线上根本没有这个文件。
 *
 * ## 谁是「主」
 *
 * 不设固定主端。每次同步先读三端，按 `shared/sync-core.mjs` 的规则选内容最新的一份，
 * 再推给落后的端。这样任何一端都可以是写入入口（本地面板、线上后台、导入），
 * 不需要人为切换主库。
 *
 * ## 三条安全线
 *
 *   1. **空库不参与选主，也绝不外推**：读失败或站点为空时只记录不可达，
 *      不会出现「本地空的 → 把线上覆盖成空库」。
 *   2. **只推落后端**：内容比自己新的端不在 actions 里，不可能被覆盖。
 *   3. **写前由目标端做 CAS 与快照**：同步不新开写通道，仍走 `POST /api/sites`。
 *
 * ## 为什么默认不自动跑
 *
 * 三端同时开定时器会变成三个写者互相推。默认关闭，只在本机显式设置
 * `NAV_SYNC_ENABLED=1` 时由 `server/main.mjs` 启动调度器；线上两端永远只被动接收。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { planSync, syncFingerprint } from '../shared/sync-core.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
/**
 * 状态目录默认落在**进程工作目录**下的 `backups/sync`。
 *
 * 不能按模块位置推导：源码直跑时 HERE 是 `shared/`，产物里是 `dist/shared/`，
 * 会得到 `backups/` 与 `dist/backups/` 两份互不相认的历史 —— 面板看到自动同步
 * 从来没跑过，CLI 却能看到。工作目录在两种启动方式下都是仓库根（或部署根）。
 */
const STATE_DIR = process.env.NAV_SYNC_STATE_DIR || join(process.cwd(), 'backups', 'sync')
const STATE_FILE = join(STATE_DIR, '_state.json')
const HISTORY_KEEP = 100
const FETCH_TIMEOUT_MS = Number(process.env.NAV_SYNC_TIMEOUT_MS) || 12000

/**
 * 权威端：默认 BotKeep。空字符串表示回到「自动选最新」。
 *
 * 这是产品口径，不是技术默认值：线上真实数据在 BotKeep，任何自动选主都可能
 * 因为某一端的一次误写把权威数据覆盖掉。要改必须显式配置。
 */
export function resolveAuthority(env = process.env) {
  const raw = env.NAV_SYNC_AUTHORITY
  if (raw === undefined) return 'botkeep'
  return String(raw).trim()
}

/** 目标端有、权威端没有的站点（这些会在写入时被移除，必须先归档） */
export function diffRemoved(targetSites, winnerSites) {
  const keep = new Set((Array.isArray(winnerSites) ? winnerSites : []).map(s => String(s?.id || '')))
  return (Array.isArray(targetSites) ? targetSites : [])
    .filter(s => s && s.id && !keep.has(String(s.id)))
}

/** 端点清单：默认三端；`NAV_SYNC_ENDPOINTS` 可按 id 覆盖或追加 */
export function resolveTargets(env = process.env) {
  const base = [
    {
      id: 'local',
      label: '本地库',
      url: String(env.NAV_SYNC_LOCAL_URL || `http://127.0.0.1:${env.PORT || env.SERVER_PORT || 3000}`).replace(/\/+$/, ''),
      role: 'origin',
    },
    {
      id: 'botkeep',
      label: 'BotKeep',
      url: String(env.NAV_SYNC_BOTKEEP_URL || env.DEPLOY_SITE_URL || 'https://navigator-v2.bot-keep.xyz').replace(/\/+$/, ''),
      role: 'cloud',
    },
    {
      // 第二个线上平台。Vercel 于 2026-10-11 被平台停用（全站 402），
      // 现役回退通道是 WorkBuddy；Vercel 仅在显式配置地址时才加入清单。
      id: 'workbuddy',
      label: 'WorkBuddy',
      url: String(env.NAV_SYNC_WORKBUDDY_URL || 'https://nav-dashboard-19166.app.workbuddy.host').replace(/\/+$/, ''),
      role: 'cloud',
    },
  ]

  const vercelUrl = String(env.NAV_SYNC_VERCEL_URL || env.VERCEL_PROJECT_PRODUCTION_URL || '').replace(/\/+$/, '')
  if (vercelUrl) {
    base.push({ id: 'vercel', label: 'Vercel', url: vercelUrl, role: 'cloud' })
  }

  const raw = env.NAV_SYNC_ENDPOINTS
  if (raw) {
    try {
      const extra = JSON.parse(raw)
      for (const item of Array.isArray(extra) ? extra : []) {
        if (!item || !item.id || !item.url) continue
        const normalized = {
          id: String(item.id),
          label: String(item.label || item.id),
          url: String(item.url).replace(/\/+$/, ''),
          role: String(item.role || 'cloud'),
        }
        const idx = base.findIndex(b => b.id === normalized.id)
        if (idx >= 0) base[idx] = { ...base[idx], ...normalized }
        else base.push(normalized)
      }
    } catch { /* 配置写坏时退回默认三端，不让同步整体不可用 */ }
  }

  // 未配置 URL 的端保留在清单里并标出来，而不是静默消失 ——
  // 面板要能告诉用户「Vercel 还没配地址」，而不是让第三端凭空不见。
  return base.map(t => ({ ...t, configured: Boolean(t.url) }))
}

function adminKey() {
  return String(process.env.SITES_ADMIN_KEY || '').trim()
}

async function fetchJson(url, { key = '', timeout = FETCH_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(url, {
      headers: {
        ...(key ? { 'X-Nav-Key': key, Authorization: `Bearer ${key}` } : {}),
        Accept: 'application/json',
      },
      signal: ctrl.signal,
    })
    const text = await res.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = null }
    return { ok: res.ok, status: res.status, data, text: res.ok ? '' : text.slice(0, 200) }
  } finally {
    clearTimeout(timer)
  }
}

/** 本地端在服务未启动时的只读兜底：直接读同一个 SQLite 对象 */
async function readLocalStore() {
  try {
    // 三种布局都要能定位到 store.mjs：
    //   源码直跑 shared/ → ../server/store.mjs；产物 shared/ → ../store.mjs；测试也可能放同目录
    const candidates = [
      join(HERE, 'store.mjs'),
      join(HERE, '..', 'store.mjs'),
      join(HERE, '..', 'server', 'store.mjs'),
    ]
    const found = candidates.find(p => existsSync(p))
    if (!found) return null
    const mod = await import(pathToFileURL(found).href)
    const blob = await mod.get('sites.json', { access: 'private', useCache: false })
    if (!blob || !blob.stream) return null
    return JSON.parse(await new Response(blob.stream).text())
  } catch {
    return null
  }
}

/**
 * 写入前把「将被移除的目标端站点」完整存到本地。
 *
 * 权威模式下，本地 / WorkBuddy 上曾经添加、但 BotKeep 没有的站点会在同步后消失。
 * 直接删掉等于把历史操作记录一起抹掉；这里先落一份完整 JSON（含 id、分类、
 * 创建时间、访问计数），需要时可以按 id 恢复或重新导入。
 */
export function archiveRemoved(targetId, removed, winnerTarget) {
  if (!Array.isArray(removed) || !removed.length) return { count: 0, path: null }
  try {
    const dir = join(STATE_DIR, 'removed')
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const path = join(dir, `${String(targetId)}-${stamp}.json`)
    writeFileSync(path, JSON.stringify({
      at: new Date().toISOString(),
      target: String(targetId),
      authority: String(winnerTarget?.id || ''),
      authorityVersion: Number(winnerTarget?.data?.version) || 0,
      count: removed.length,
      sites: removed,
    }, null, 2), 'utf8')
    return { count: removed.length, path }
  } catch (e) {
    return { count: removed.length, path: null, error: String(e?.message || e) }
  }
}

async function readTarget(target, key = '') {
  if (!target.configured) {
    return { ...target, ok: false, error: '未配置地址', data: null, fetchedAt: new Date().toISOString() }
  }
  try {
    /**
     * 优先读完整对象（`/api/backup?object=sites.json`）：它带 **categories**，
     * 而公开的 `/api/sites` 只回 version/sites/updatedAt。
     * 分类表参与内容指纹，否则「站点相同、分类不同」会被误判为已一致。
     * 该接口要鉴权；失败时回退公开读，不让分类同步拖垮整次同步。
     */
    if (key) {
      try {
        const full = await fetchJson(`${target.url}/api/backup?object=sites.json`, { key })
        if (full.ok && full.data && typeof full.data.body === 'string') {
          const parsed = JSON.parse(full.data.body)
          if (parsed && Array.isArray(parsed.sites)) {
            return { ...target, ok: true, error: null, data: parsed, fetchedAt: new Date().toISOString(), via: 'object' }
          }
        }
      } catch { /* 对象接口失败/超时 → 继续走公开读，不能因此把整端判成不可达 */ }
    }
    const r = await fetchJson(`${target.url}/api/sites`)
    if (r.ok && r.data && Array.isArray(r.data.sites)) {
      return { ...target, ok: true, error: null, data: r.data, fetchedAt: new Date().toISOString() }
    }
    // 本地端兜底：服务没起来时直接读库（只读，不写）
    if (target.id === 'local') {
      const data = await readLocalStore()
      if (data && Array.isArray(data.sites)) {
        return { ...target, ok: true, error: null, data, fetchedAt: new Date().toISOString(), via: 'sqlite' }
      }
    }
    return {
      ...target,
      ok: false,
      error: r.status ? `HTTP ${r.status}${r.text ? `：${r.text}` : ''}` : '读取失败',
      data: null,
      fetchedAt: new Date().toISOString(),
    }
  } catch (e) {
    if (target.id === 'local') {
      const data = await readLocalStore()
      if (data && Array.isArray(data.sites)) {
        return { ...target, ok: true, error: null, data, fetchedAt: new Date().toISOString(), via: 'sqlite' }
      }
    }
    return { ...target, ok: false, error: String(e?.message || e), data: null, fetchedAt: new Date().toISOString() }
  }
}

/**
 * 写入前合并目标端的「本地状态」。
 *
 * 巡检在每端独立跑：同一批站点在两个平台上可能一个已归档、一个还没被判定失效。
 * 若整条替换，同步会把目标端刚归档的站点重新放出来，下一轮巡检又归档回去 ——
 * 形成永远对不齐的震荡。所以这三类字段以**目标端现值**为准，只同步业务内容。
 *
 * 代价：一端的「手工归档 / 置顶」不会传播到另一端。这是有意的 ——
 * 它们本来就是各设备/各平台的视图状态，不是站点目录内容。
 */
export function withLocalState(winnerData, targetData) {
  const localById = new Map(
    (Array.isArray(targetData?.sites) ? targetData.sites : []).map(s => [String(s?.id || ''), s]),
  )
  const sites = (Array.isArray(winnerData?.sites) ? winnerData.sites : []).map(site => {
    const local = localById.get(String(site?.id || ''))
    if (!local) return site
    const merged = { ...site }
    if (local.archived === true) merged.archived = true
    if (local.pinned === true) merged.pinned = true
    // 访问计数取两端较大值：既保留目标端已有的历史，也不把权威端更大的计数写小
    merged.visitCount = Math.max(Number(site.visitCount) || 0, Number(local.visitCount) || 0)
    return merged
  })
  return { ...winnerData, sites }
}

async function writeTarget(target, data, key) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await fetch(`${target.url}/api/sites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { 'X-Nav-Key': key, Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({ sites: data.sites, categories: data.categories }),
    }).catch(e => ({ ok: false, status: 0, text: async () => String(e?.message || e) }))
    const text = await res.text().catch(() => '')
    let body = null
    try { body = text ? JSON.parse(text) : null } catch { body = null }
    // 只回摘要：目标端 POST /api/sites 的响应里带完整站点表（100 KB+），
    // 原样塞进同步结果会让状态文件与接口响应瞬间膨胀到无法阅读。
    const brief = body
      ? {
          version: Number(body.version) || null,
          sites: Array.isArray(body.sites) ? body.sites.length : null,
          snapshot: body.snapshot?.pathname || null,
        }
      : null
    if (res.ok) return { ok: true, status: res.status, body: brief }
    // 409：读与写之间目标被改过。重新读一次，若内容已一致就算成功，否则重试。
    if (res.status === 409 && attempt === 0) {
      const again = await readTarget(target, key)
      if (again.ok && syncFingerprint(again.data) === syncFingerprint(data)) {
        return { ok: true, status: 200, body: { reconciled: true } }
      }
      await new Promise(r => setTimeout(r, 300))
      continue
    }
    return { ok: false, status: res.status, error: (body && body.error) || text.slice(0, 200) }
  }
  return { ok: false, status: 409, error: '连续冲突，已放弃本次写入' }
}

function emptyState() {
  return {
    enabled: process.env.NAV_SYNC_ENABLED === '1',
    intervalSec: Number(process.env.NAV_SYNC_INTERVAL_SEC) || 30,
    lastRun: null,
    lastResult: null,
    history: [],
  }
}

export function readState() {
  try {
    const raw = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    return { ...emptyState(), ...raw }
  } catch {
    return emptyState()
  }
}

function writeState(state) {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    const tmp = `${STATE_FILE}.tmp`
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
    renameSync(tmp, STATE_FILE)
  } catch { /* 状态写不进去不能影响同步本身 */ }
}

/**
 * 执行一次同步。
 *
 * @param {{dryRun?:boolean, trigger?:string}} [opts]
 */
export async function runSync(opts = {}) {
  const targets = resolveTargets()
  const key = adminKey()
  const started = Date.now()
  const read = await Promise.all(targets.map(t => readTarget(t, key)))
  const authorityId = resolveAuthority()
  const plan = planSync(read, { authority: authorityId })

  /**
   * `plan.winner` 是**摘要**（给面板用，不含 sites 数组）。
   * 写入必须回到原始读取结果取 `data` —— 拿摘要去写会把空对象推给目标端，
   * 被 `sanitizeSites` 拦成 400（实测踩过）。
   */
  const winnerTarget = plan.winner ? read.find(t => t.id === plan.winner.id) : null

  if (plan.authorityUnavailable) {
    const result = {
      ok: false,
      error: `权威端 ${authorityId} 不可达或没有站点数据；本轮不执行任何写入`,
      plan,
      results: [],
      seconds: Math.round((Date.now() - started) / 10) / 100,
    }
    record(result, opts.trigger || 'manual')
    return result
  }

  if (!plan.winner || !winnerTarget || !Array.isArray(winnerTarget.data?.sites)) {
    const result = {
      ok: false,
      error: '没有可用的站点数据（不执行任何写入）',
      plan,
      results: [],
      seconds: Math.round((Date.now() - started) / 10) / 100,
    }
    record(result, opts.trigger || 'manual')
    return result
  }

  if (opts.dryRun) {
    return {
      ok: true,
      dryRun: true,
      plan,
      results: [],
      seconds: Math.round((Date.now() - started) / 10) / 100,
    }
  }

  const results = []
  for (const action of plan.actions) {
    const target = read.find(t => t.id === action.id)
    if (!target) continue
    if (!target.configured) {
      results.push({ id: action.id, ok: false, error: '未配置地址' })
      continue
    }
    if (!key) {
      results.push({ id: action.id, ok: false, error: '未配置 SITES_ADMIN_KEY，无法写入' })
      continue
    }
    try {
      /**
       * 先归档「目标端有、权威端没有」的站点，再覆盖。
       * 顺序不能反：写入失败时归档还在，写入成功时归档也已落盘。
       */
      const removed = diffRemoved(target.data?.sites, winnerTarget.data?.sites)
      const archive = archiveRemoved(action.id, removed, winnerTarget)
      const payload = withLocalState(winnerTarget.data, target.data)
      const r = await writeTarget(target, payload, key)
      results.push({
        id: action.id,
        label: action.label,
        reason: action.reason,
        ...r,
        removed: archive.count,
        archivePath: archive.path,
        archiveError: archive.error || null,
      })
    } catch (e) {
      results.push({ id: action.id, ok: false, error: String(e?.message || e) })
    }
  }

  // 写后复核：以「重新读回来的内容」为准，而不是相信写入返回
  const afterRead = await Promise.all(targets.map(t => readTarget(t, key)))
  const after = planSync(afterRead)

  const result = {
    ok: results.every(r => r.ok) && after.consistent,
    plan,
    results,
    after: {
      consistent: after.consistent,
      winner: after.winner,
      targets: after.targets,
    },
    seconds: Math.round((Date.now() - started) / 10) / 100,
  }
  record(result, opts.trigger || 'manual')
  return result
}

function record(result, trigger) {
  const state = readState()
  const at = new Date().toISOString()
  const entry = {
    at,
    trigger,
    ok: Boolean(result.ok),
    error: result.error || null,
    authority: result.plan?.authority || null,
    winner: result.plan?.winner?.id || null,
    winnerVersion: result.plan?.winner?.version || null,
    actions: (result.plan?.actions || []).map(a => a.id),
    written: (result.results || []).filter(r => r.ok).map(r => r.id),
    failed: (result.results || []).filter(r => !r.ok).map(r => ({ id: r.id, error: r.error || `HTTP ${r.status}` })),
    conflicts: result.plan?.conflicts || [],
    diverged: result.plan?.diverged || [],
    unreachable: result.plan?.unreachable || [],
    // 被覆盖掉的目标端独有站点：数量与本地归档路径，便于事后恢复
    removed: (result.results || []).reduce((n, r) => n + (Number(r.removed) || 0), 0),
    archived: (result.results || []).filter(r => r.archivePath).map(r => ({
      id: r.id, count: Number(r.removed) || 0, path: r.archivePath,
    })),
    seconds: result.seconds || 0,
  }
  state.lastRun = at
  state.lastResult = entry
  state.history = [entry, ...(Array.isArray(state.history) ? state.history : [])].slice(0, HISTORY_KEEP)
  writeState(state)
}

/** 面板读取：状态 + 端点清单（不含密钥） */
export function status() {
  const state = readState()
  /**
   * 是否开启要反映**实际调度器**，不能只看状态文件里的旧值：
   * 用 `NAV_SYNC_ENABLED=1` 启动时状态文件可能还是 `enabled:false`，
   * 面板会显示「未开启」而定时器其实在跑（实测踩过）。
   */
  const envEnabled = process.env.NAV_SYNC_ENABLED === '1'
  return {
    ...state,
    authority: resolveAuthority(),
    enabled: Boolean(timer) || envEnabled || state.enabled === true,
    intervalSec: Number(process.env.NAV_SYNC_INTERVAL_SEC) || state.intervalSec,
    targets: resolveTargets().map(t => ({
      id: t.id,
      label: t.label,
      url: t.url,
      role: t.role,
      configured: t.configured,
    })),
    hasAdminKey: Boolean(adminKey()),
  }
}

/** 运行中标记：定时器与手动触发共用，避免两路同时写同一批端点 */
let running = false
let timer = null

export async function runSyncExclusive(opts = {}) {
  if (running) return { ok: false, error: '已有一次同步正在进行' }
  running = true
  try {
    return await runSync(opts)
  } finally {
    running = false
  }
}

/**
 * 启动定时同步（仅在显式开启时）。
 * 线上两端不应该跑这个：三个写者互推没有收益，只会放大冲突。
 */
export function startSchedule() {
  if (timer) return { started: false, reason: '已在运行' }
  const state = readState()
  const enabled = process.env.NAV_SYNC_ENABLED === '1' || state.enabled === true
  if (!enabled) return { started: false, reason: '未开启' }
  const sec = Math.max(5, Number(process.env.NAV_SYNC_INTERVAL_SEC) || state.intervalSec || 30)
  timer = setInterval(() => {
    runSyncExclusive({ trigger: 'schedule' }).catch(() => { /* 下一轮再试 */ })
  }, sec * 1000)
  if (typeof timer.unref === 'function') timer.unref()
  return { started: true, intervalSec: sec }
}

export function stopSchedule() {
  if (!timer) return { stopped: false }
  clearInterval(timer)
  timer = null
  return { stopped: true }
}