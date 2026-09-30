/**
 * 站点数据管理：本地 api/sites-data.json 的增删改 + 元信息抓取 + 图标下载 + 云端实时同步。
 *
 * 沿用的项目约定：
 * - id 前缀沿用该分类既有站点的字母前缀，序号全局递增（s12 → s13）
 * - sortOrder 取全局最大值 +1，保持跨分类递增序列
 * - url 只存域名（与 AddSiteModal 一致），去协议 / 查询串 / 尾斜杠
 * - 写盘保持 2 空格缩进 + 末尾换行，避免产生无关 diff
 * - 网络请求一律走 curl.exe（本机 Node fetch 不走系统代理）
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ROOT, getAdminKey } from './env.mjs'
import { readSites, readCategoryMeta, categoryGroups, hostOf } from './data.mjs'
import { inferSite, decodeHtmlBytes, pickThemeColor, manifestHref, manifestThemeColor, BLOCKED_WARNING } from '../../../shared/site-infer.mjs'
import { diffSites } from './changes.mjs'
import * as jobs from './jobs.mjs'
import * as git from './git.mjs'
import { SITE_URL, fetchCloud } from './sync.mjs'

const pExecFile = promisify(execFile)

const SITES_FILE = 'api/sites-data.json'
const ICON_DIR = 'public/icons'
const PAYLOAD_FILE = 'tmp-console-payload.json'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

const EDITABLE = ['name', 'url', 'desc', 'categoryId', 'color', 'initial', 'icon', 'sortOrder']

/* ---------------- 读写 ---------------- */

function sitesPath() { return join(ROOT, SITES_FILE) }

export function loadSites() {
  try { return readSites() } catch { return [] }
}

/** 原子写：临时文件 + rename，避免写一半崩溃损坏数据文件 */
function saveSites(list) {
  const tmp = sitesPath() + '.tmp'
  writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n', 'utf-8')
  renameSync(tmp, sitesPath())
}

/* ---------------- id / url 规范化 ---------------- */

/** 只保留域名：去协议、去查询串与尾斜杠（与 AddSiteModal 的落库口径一致） */
export function normalizeUrl(input) {
  let raw = String(input || '').trim()
  if (!raw) throw new Error('请填写站点地址')
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw
  let u
  try { u = new URL(raw) } catch { throw new Error(`站点地址无法解析：${input}`) }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('仅支持 http/https 地址')
  return u.hostname
}

/**
 * 抓取目标：保留用户填写的路径与协议，与线上 api/metadata.js 口径一致。
 * 落库仍只存域名（normalizeUrl），但抓取要带路径 —— SPA 子页与带路径的站点
 * 只有访问原地址才拿得到真实标题，一律抓根域名会退化成按域名猜。
 */
export function toTarget(input) {
  const raw = String(input || '').trim()
  if (!raw) throw new Error('请填写站点地址')
  return /^https?:\/\//i.test(raw) ? raw : 'https://' + raw
}

function letterPrefix(categoryId, sites) {
  const counts = new Map()
  for (const s of sites) {
    if (s.categoryId !== categoryId) continue
    const m = String(s.id || '').match(/^[a-z]+/)
    if (m) counts.set(m[0], (counts.get(m[0]) || 0) + 1)
  }
  if (counts.size) {
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
  }
  // 新分类：用分类名首字母，若已被别的分类占用则追加 x 直到唯一
  const taken = new Set()
  for (const s of sites) {
    if (s.categoryId === categoryId) continue
    const m = String(s.id || '').match(/^[a-z]+/)
    if (m) taken.add(m[0])
  }
  let p = String(categoryId).toLowerCase().replace(/[^a-z]/g, '').slice(0, 4) || 'x'
  while (taken.has(p)) p += 'x'
  return p
}

function nextId(categoryId, sites) {
  const prefix = letterPrefix(categoryId, sites)
  const re = new RegExp('^' + prefix + '(\\d+)$')
  let max = 0
  for (const s of sites) {
    const m = String(s.id || '').match(re)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return prefix + (max + 1)
}

function nextSortOrder(sites) {
  return sites.reduce((n, s) => Math.max(n, Number(s.sortOrder) || 0), 0) + 1
}

/* ---------------- 列表 / 分类 ---------------- */

const LIST_FIELDS = ['id', 'name', 'url', 'desc', 'categoryId', 'icon', 'color', 'initial', 'sortOrder', 'createdAt']

export function list({ q = '', category = '' } = {}) {
  const all = loadSites()
  const meta = readCategoryMeta()
  const kw = String(q).trim().toLowerCase()

  let items = all
  if (category) items = items.filter(s => s.categoryId === category)
  if (kw) {
    items = items.filter(s =>
      String(s.name).toLowerCase().includes(kw) ||
      String(s.url).toLowerCase().includes(kw) ||
      String(s.desc || '').toLowerCase().includes(kw) ||
      String(s.id).toLowerCase() === kw
    )
  }

  const pick = s => {
    const out = {}
    for (const k of LIST_FIELDS) out[k] = s[k]
    out.categoryLabel = meta[s.categoryId]?.label || s.categoryId
    out.categoryColor = meta[s.categoryId]?.color || '#64748b'
    out.known = Boolean(meta[s.categoryId])
    return out
  }

  const sorted = [...items].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || (b.sortOrder || 0) - (a.sortOrder || 0))

  return {
    total: all.length,
    matched: items.length,
    sites: sorted.map(pick),
    categories: categoryGroups(),
  }
}

/** 单个站点（编辑表单用，含未在列表暴露的字段） */
export function getSite(id) {
  const site = loadSites().find(s => s.id === id)
  if (!site) throw new Error(`站点不存在：${id}`)
  return site
}

/* ---------------- 增 / 改 / 删 ---------------- */

/** dryRun=true 时只做全部校验并返回将写入的条目，不落盘（CLI --dry-run 复用同一套规则，避免预演与实写口径漂移） */
export function addSite(input = {}, { dryRun = false } = {}) {
  const sites = loadSites()
  const meta = readCategoryMeta()

  const name = String(input.name || '').trim()
  const desc = String(input.desc || '').trim()
  const categoryId = String(input.categoryId || '').trim()
  const url = normalizeUrl(input.url)

  if (!name) throw new Error('请填写站点名称')
  if (!desc) throw new Error('请填写站点描述')
  if (!meta[categoryId]) throw new Error(`未登记的分类：${categoryId || '(空)'}`)

  const host = hostOf(url)
  const dup = sites.find(s => hostOf(s.url) === host)
  if (dup) throw new Error(`该域名已收录：${dup.id} ${dup.name}（如需变更请编辑该站点，避免重复条目）`)

  const now = Date.now()
  const site = {
    id: nextId(categoryId, sites),
    name,
    url,
    desc,
    categoryId,
    color: String(input.color || meta[categoryId].color || '#64748b'),
    initial: String(input.initial || name.charAt(0).toUpperCase()),
    sortOrder: nextSortOrder(sites),
    visitCount: 0,
    createdAt: now,
    updatedAt: now,
  }
  if (input.icon) site.icon = input.icon

  if (dryRun) return site
  sites.push(site)
  saveSites(sites)
  return site
}

export function updateSite(id, patch = {}, { dryRun = false } = {}) {
  const sites = loadSites()
  const idx = sites.findIndex(s => s.id === id)
  if (idx === -1) throw new Error(`站点不存在：${id}`)
  const site = sites[idx]
  const meta = readCategoryMeta()

  const next = { ...site }
  for (const k of EDITABLE) {
    if (patch[k] === undefined) continue
    next[k] = k === 'sortOrder' ? Number(patch[k]) : String(patch[k]).trim()
  }

  if (!next.name) throw new Error('站点名称不能为空')
  if (!next.desc) throw new Error('站点描述不能为空')
  if (!meta[next.categoryId]) throw new Error(`未登记的分类：${next.categoryId}`)
  if (typeof next.sortOrder !== 'number' || !Number.isFinite(next.sortOrder)) throw new Error('sortOrder 必须是数字')

  if (patch.url !== undefined) {
    next.url = normalizeUrl(patch.url)
    const host = hostOf(next.url)
    const dup = sites.find(s => s.id !== id && hostOf(s.url) === host)
    if (dup) throw new Error(`该域名已被 ${dup.id} ${dup.name} 收录`)
  }
  if (patch.categoryId !== undefined && !next.color) next.color = meta[next.categoryId].color

  next.updatedAt = Date.now()
  if (dryRun) return next
  sites[idx] = next
  saveSites(sites)
  return next
}

export function removeSite(id, { dryRun = false } = {}) {
  const sites = loadSites()
  const site = sites.find(s => s.id === id)
  if (!site) throw new Error(`站点不存在：${id}`)
  if (dryRun) return site
  saveSites(sites.filter(s => s.id !== id))
  return site
}

/* ---------------- 元信息抓取（curl.exe，走系统代理） ---------------- */

async function curlBuffer(url, { maxTime = 15, fail = true } = {}) {
  const args = ['-sSL', '--max-time', String(maxTime), '-A', UA, '-H', 'Accept-Language: zh-CN,zh;q=0.9']
  if (fail) args.push('-f')
  args.push(url)
  const { stdout } = await pExecFile('curl.exe', args, {
    encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  })
  return stdout
}

/** 内联 data: 图片解码为 Buffer；非 data: 或解码失败返回 null */
function decodeDataUri(uri) {
  const comma = uri.indexOf(',')
  if (comma < 0) return null
  const meta = uri.slice(5, comma)
  const payload = uri.slice(comma + 1)
  try {
    return /;base64/i.test(meta)
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8')
  } catch { return null }
}

/**
 * 抓取并推断标题 / 描述 / 图标 / 配色 / 分类建议 —— 只填一个网址就能补全全部字段。
 *
 * 推断逻辑在 shared/site-infer.mjs，与线上 api/metadata.js 同源；
 * 这里额外传入已收录站点与分类表，让「同族域名 / 品牌词命中」加权生效，
 * 并保证推荐出的 categoryId 一定是已登记分类（否则 addSite 会直接拒绝）。
 *
 * 抓不到页面（403 反爬、超时、空响应）不算失败：照常按域名与分类表产出一份草稿，
 * 并在 warning 里说明原因，让用户只需复核而不是从零手填。
 * 抓取目标保留路径，https 失败回退 http —— 与线上接口同一套策略。
 */
export async function fetchMeta(rawUrl) {
  const url = normalizeUrl(rawUrl)   // 落库口径：只留域名
  const target = toTarget(rawUrl)    // 抓取口径：保留路径
  let html = ''
  let rootHtml = ''
  let warning = ''

  const grab = async (t) => {
    const attempts = [t]
    if (t.startsWith('https://')) attempts.push('http://' + t.slice(8))
    let last = ''
    for (const a of attempts) {
      try {
        const buf = await curlBuffer(a)
        if (buf.length) return { html: decodeHtmlBytes(buf.subarray(0, 256 * 1024)), warning: '' }
        last = '目标站点返回空内容，已按域名推断，请复核名称与分类'
      } catch (e) {
        last = /exit code|curl/i.test(e.message)
          ? '目标站点拒绝抓取（可能被反爬拦截），已按域名推断，请复核名称与分类'
          : `抓取失败：${e.message}`
      }
    }
    return { html: '', warning: last }
  }

  // 贴的是子页时并行补抓主域名首页：落库口径永远是主域名，元信息也应以主域名为准，
  // 否则贴一个 /platform/windows 会把整站描述写成「51 款 Windows 客户端」。
  let rootTarget = ''
  try {
    const u = new URL(target)
    if (u.pathname && u.pathname !== '/') rootTarget = u.origin + '/'
  } catch { /* 地址异常时只用原目标 */ }

  const [pageR, rootR] = await Promise.all([
    grab(target),
    rootTarget ? grab(rootTarget) : Promise.resolve({ html: '', warning: '' }),
  ])
  html = pageR.html
  rootHtml = rootR.html
  // 子页抓不到但根页拿到了，就不算失败
  warning = html || rootHtml ? '' : pageR.warning

  // 品牌色只写在 webmanifest 里的站点：页面没有「可用」的 meta theme-color 时补抓 manifest 取 theme_color。
  // 判据是「可用」而非「存在」—— light #ffffff / dark #0a0b0d 这类声明两条都不可用，
  // 只判存在会跳过 manifest。manifest 抓不到不影响主流程。
  let manifestTheme = ''
  if (!pickThemeColor(html) && !pickThemeColor(rootHtml)) {
    let base = ''
    try { base = new URL(target).origin + '/' } catch { /* 地址异常时无从解析相对路径 */ }
    const mHref = base && (manifestHref(html, base) || (rootHtml ? manifestHref(rootHtml, base) : ''))
    if (mHref) {
      try {
        const buf = await curlBuffer(mHref, { maxTime: 10 })
        if (buf.length) manifestTheme = manifestThemeColor(decodeHtmlBytes(buf.subarray(0, 256 * 1024)))
      } catch { /* manifest 抓不到不影响主流程，色值退回其它来源 */ }
    }
  }

  const info = inferSite({
    html,
    rootHtml,
    manifestTheme,
    url: target,
    existingSites: loadSites(),
    categoryMeta: readCategoryMeta(),
  })
  // 挑战页返回 200，抓取层看不出异常：warning 必须盖过抓取层文案
  if (info.blocked) warning = BLOCKED_WARNING
  return { ...info, url, domain: url, warning }
}

/* ---------------- 图标下载 ---------------- */

function detectExt(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'png'
  if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01) return 'ico'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  if (buf.length >= 6 && buf.toString('latin1', 0, 4) === 'GIF8') return 'gif'
  if (buf.length >= 12 && buf.toString('latin1', 4, 12) === 'ftypavif') return 'avif'
  const head = buf.toString('latin1', 0, 200)
  if (head.includes('<svg') || head.includes('<?xml')) return 'svg'
  return 'bin'
}

/**
 * favicon.im 对查不到图标的域名会返回 200 + 灰色占位 SVG（灰圆 + 斜体 f），
 * 体积小、格式合法，若不识别会被当成真图标落盘。
 */
function isPlaceholderIcon(buf) {
  if (buf.length > 512) return false
  const text = buf.toString('utf8')
  return text.includes('<svg') && text.includes('#808080') && /<text[^>]*>\s*f\s*<\/text>/i.test(text)
}

/**
 * 下载图标到 public/icons/<id>.<ext> 并回写数据文件。
 * 来源依次为：页面声明的图标（含内联 data:image）→ /favicon.ico → favicon.im 兜底。
 * dryRun=true 时只解析来源候选，不下载、不落盘（CLI --dry-run 复用同一份来源顺序）。
 */
export async function downloadIcon(id, { faviconUrl = '', dryRun = false } = {}) {
  const sites = loadSites()
  const site = sites.find(s => s.id === id)
  if (!site) throw new Error(`站点不存在：${id}`)

  const host = hostOf(site.url)
  const candidates = []
  if (faviconUrl) candidates.push(faviconUrl)
  if (!candidates.length) {
    try {
      const m = await fetchMeta(site.url)
      if (m.faviconUrl) candidates.push(m.faviconUrl)
    } catch { /* 页面抓不到就直接走兜底来源 */ }
  }
  candidates.push(`https://${host}/favicon.ico`, `https://favicon.im/${host}?format=png&size=128`)

  if (dryRun) return { dryRun: true, icon: site.icon || null, candidates }

  const errors = []
  for (const c of candidates) {
    try {
      const buf = c.startsWith('data:') ? decodeDataUri(c) : await curlBuffer(c, { maxTime: 12 })
      if (!buf || !buf.length) throw new Error('空文件')
      if (isPlaceholderIcon(buf)) throw new Error('该来源无真实图标（返回占位图）')
      const ext = detectExt(buf)
      if (ext === 'bin') throw new Error('未知图标格式')
      mkdirSync(join(ROOT, ICON_DIR), { recursive: true })
      const rel = `icons/${id}.${ext}`
      // 扩展名变化时清掉旧图标，否则 public/icons 会留下孤儿文件并被一并提交
      if (site.icon && site.icon !== rel) {
        const stale = join(ROOT, ICON_DIR, basename(site.icon))
        if (existsSync(stale)) rmSync(stale, { force: true })
      }
      writeFileSync(join(ROOT, ICON_DIR, `${id}.${ext}`), buf)
      site.icon = rel
      site.updatedAt = Date.now()
      saveSites(sites)
      return { icon: rel, source: c, bytes: buf.length }
    } catch (e) {
      errors.push(`${c} → ${e.message}`)
    }
  }
  throw new Error(`图标抓取失败：${errors.join('；')}`)
}

/* ---------------- 云端数据同步 ---------------- */

export const DATA_SYNC_TITLE = '站点数据同步'

const STEP_DEFS = [
  { key: 'check', label: '数据差异检查' },
  { key: 'commit', label: '提交数据' },
  { key: 'push', label: '推送到远端' },
  { key: 'backup', label: '数据备份' },
  { key: 'validate', label: '数据门禁' },
  { key: 'hotupdate', label: '云端热更新' },
  { key: 'verify', label: '一致性验证' },
]
const TERMINAL = ['success', 'failed', 'skipped']

function mark(job, step, patch) {
  Object.assign(step, patch)
  if (patch.status === 'running' && !step.startedAt) step.startedAt = Date.now()
  if (TERMINAL.includes(patch.status)) {
    step.endedAt = Date.now()
    step.duration = step.startedAt ? step.endedAt - step.startedAt : 0
  }
  jobs.emitEvent(job, 'step', { ...step })
  return step
}

function runStep(job, command, cmdArgs, opts = {}) {
  return new Promise(resolve => {
    const child = jobs.run(job, command, cmdArgs, { ...opts, autoFinish: false })
    child.on('close', code => resolve(code ?? -1))
  })
}

function describeDiff(diff) {
  const parts = []
  if (diff.added.length) parts.push(`新增 ${diff.added.map(s => `${s.id} ${s.name}`).join('、')}`)
  if (diff.removed.length) parts.push(`移除 ${diff.removed.map(s => `${s.id} ${s.name}`).join('、')}`)
  if (diff.modified.length) parts.push(`更新 ${diff.modified.map(m => m.id).join('、')}`)
  return parts.join('；')
}

/** 由站点数据 diff 生成规范提交消息 */
function buildMessage(diff) {
  if (diff.added.length && !diff.removed.length && !diff.modified.length) {
    return `feat(sites): 新增 ${diff.added.map(s => s.name).join('、')}`
  }
  const parts = []
  if (diff.added.length) parts.push(`新增 ${diff.added.length} 个`)
  if (diff.removed.length) parts.push(`移除 ${diff.removed.length} 个`)
  if (diff.modified.length) parts.push(`更新 ${diff.modified.length} 个`)
  const type = diff.added.length ? 'feat' : 'chore'
  return `${type}(sites): ${parts.join('，') || '同步站点数据'}`
}

export function startDataSync({ commit = true, push = true, message = '' } = {}) {
  if (jobs.listJobs().some(j => j.title === DATA_SYNC_TITLE && j.status === 'running')) {
    throw new Error('已有数据同步任务在运行中，请等待完成或终止后再试。')
  }
  const job = jobs.createJob(DATA_SYNC_TITLE)
  const steps = STEP_DEFS.map(d => ({
    key: d.key, label: d.label, status: 'pending',
    startedAt: null, endedAt: null, duration: null, detail: '',
  }))
  job.steps = steps
  jobs.emitEvent(job, 'steps', steps.map(s => ({ ...s })))

  runSync(job, steps, { commit, push, message }).catch(e => {
    jobs.log(job, `同步异常：${e.message}`, 'stderr')
    for (const s of steps) if (s.status === 'running') mark(job, s, { status: 'failed', detail: e.message })
    for (const s of steps) if (s.status === 'pending') mark(job, s, { status: 'skipped', detail: '未执行' })
    jobs.finish(job, -1)
  })
  return job
}

async function runSync(job, steps, opts) {
  const byKey = k => steps.find(s => s.key === k)
  const step = (k, patch) => mark(job, byKey(k), patch)
  const fail = (k, detail) => {
    if (k) step(k, { status: 'failed', detail })
    for (const s of steps) if (s.status === 'pending') mark(job, s, { status: 'skipped', detail: '未执行' })
    jobs.log(job, `❌ 同步中止：${detail}`, 'stderr')
    jobs.finish(job, -1)
  }

  const local = loadSites()
  jobs.log(job, `开始站点数据同步 · 本地 ${local.length} 条 · ${new Date().toLocaleString('zh-CN')}`, 'info')

  /* 1. 数据差异检查 */
  step('check', { status: 'running' })
  const headText = await git.showFileAtHead(SITES_FILE).catch(() => null)
  let head = []
  try { head = headText ? JSON.parse(headText) : [] } catch { head = [] }
  const diff = diffSites(head, local)
  const summary = describeDiff(diff)
  step('check', {
    status: 'success',
    detail: summary || `与 HEAD 一致（${local.length} 条）`,
  })

  /* 2. 提交（仅提交数据文件与图标，不裹挟其他改动） */
  let st = null
  try { st = await git.getStatus() } catch { /* 非 git 仓库时跳过提交 */ }
  const commitPaths = st
    ? st.files.map(f => f.path).filter(p => p === SITES_FILE || p.startsWith('public/icons/'))
    : []

  if (!opts.commit) {
    step('commit', { status: 'skipped', detail: '已按选项跳过' })
    step('push', { status: 'skipped', detail: '已按选项跳过' })
  } else if (!st) {
    step('commit', { status: 'failed', detail: '当前目录不是 git 仓库' })
    return fail(null, '无法提交：当前目录不是 git 仓库')
  } else if (commitPaths.length === 0) {
    step('commit', { status: 'skipped', detail: '数据文件无未提交改动' })
    step('push', { status: 'skipped', detail: '无新提交可推送' })
  } else {
    const msg = String(opts.message || '').trim() || buildMessage(diff)
    step('commit', { status: 'running' })
    try {
      await git.stagePaths(commitPaths)
      const r = await git.commit(msg, commitPaths)
      jobs.log(job, `已提交 ${r.sha}：${msg}（${commitPaths.length} 个文件）`, 'success')
      step('commit', { status: 'success', detail: `${r.sha} · ${msg}` })
    } catch (e) {
      return fail('commit', e.message)
    }

    if (!opts.push) {
      step('push', { status: 'skipped', detail: '已按选项跳过' })
    } else if (!st.branch) {
      return fail('push', '当前处于 detached HEAD，无法推送')
    } else {
      step('push', { status: 'running' })
      const code = await runStep(job, 'git', ['push', 'origin', st.branch], {
        cwd: ROOT, env: { GIT_TERMINAL_PROMPT: '0' }, stderrMode: 'info', timeoutMs: 180000,
      })
      if (code !== 0) return fail('push', `git push 退出码 ${code}`)
      step('push', { status: 'success', detail: `origin/${st.branch}` })
    }
  }

  /* 3. 备份 */
  step('backup', { status: 'running' })
  try {
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    const dir = join(ROOT, 'backups')
    mkdirSync(dir, { recursive: true })
    copyFileSync(sitesPath(), join(dir, `sites-data-${ts}.json`))
    step('backup', { status: 'success', detail: `backups/sites-data-${ts}.json · ${local.length} 条` })
  } catch (e) {
    return fail('backup', e.message)
  }

  /* 4. 数据门禁 */
  step('validate', { status: 'running' })
  const vcode = await runStep(job, process.execPath, [join('scripts', 'validate-data.mjs')], {
    cwd: ROOT, stderrMode: 'info', timeoutMs: 60000,
  })
  if (vcode !== 0) return fail('validate', `schema 校验未通过（退出码 ${vcode}）`)
  step('validate', { status: 'success', detail: 'schema 通过' })

  /* 5. 云端热更新（与 publish.mjs 同一入口与鉴权方式） */
  const key = getAdminKey()
  if (!key) return fail('hotupdate', '缺少 SITES_ADMIN_KEY，无法写入云端（请配置 .env.local）')
  step('hotupdate', { status: 'running' })
  const payload = join(ROOT, PAYLOAD_FILE)
  try {
    writeFileSync(payload, JSON.stringify({ sites: local }), 'utf-8')
    const { stdout } = await pExecFile('curl.exe', [
      '-s', '--max-time', '120', '-X', 'POST', `${SITE_URL}/api/sites`,
      '-H', 'Content-Type: application/json',
      '-H', `Authorization: Bearer ${key}`,
      '--data-binary', '@' + payload,
    ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true })
    const j = JSON.parse(stdout)
    if (!Array.isArray(j.sites)) throw new Error(stdout.slice(0, 200) || '响应异常')
    job.cloudVersion = j.version
    jobs.log(job, `云端已更新：version=${j.version} count=${j.sites.length}`, 'success')
    step('hotupdate', { status: 'success', detail: `version ${j.version} · ${j.sites.length} 站点` })
  } catch (e) {
    return fail('hotupdate', `写入云端失败：${e.message}`)
  } finally {
    if (existsSync(payload)) rmSync(payload, { force: true })
  }

  /* 6. 一致性验证 */
  // 只比 count 会漏判：数据未变时旧版本同样满足 count，需同时确认版本号已推进到本次写入的版本
  const expectVersion = Number(job.cloudVersion) || 0
  step('verify', { status: 'running' })
  let converged = false
  let lastSeen = null
  for (let i = 1; i <= 5; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const c = await fetchCloud()
    if (!c.ok) {
      jobs.log(job, `poll ${i}: 读取失败 ${c.error}`, 'stderr')
      continue
    }
    lastSeen = c
    const countOk = c.count === local.length
    const versionOk = !expectVersion || Number(c.version) >= expectVersion
    jobs.log(job, `poll ${i}: count=${c.count} version=${c.version} withIcons=${c.withIcons}${countOk && versionOk ? ' ✓收敛' : ''}`)
    if (countOk && versionOk) {
      converged = true
      step('verify', { status: 'success', detail: `第 ${i} 次轮询 · 云端 ${c.count} 站点 · v${c.version}` })
      break
    }
  }
  if (!converged) {
    const got = lastSeen ? `云端 ${lastSeen.count} 站点 · v${lastSeen.version}` : '云端无响应'
    return fail('verify', `云端未收敛（本地 ${local.length} 条，期望 v${expectVersion}；${got}）`)
  }

  jobs.log(job, `✅ 站点数据已同步到云端（${local.length} 站点）`, 'success')
  jobs.finish(job, 0)
}