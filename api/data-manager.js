/**
 * 数据管理插件的数据面 —— 站点库体检、修复计划生成、导出。
 *
 * ## 为什么修复计划不直接写库
 *
 * 站点库只有一条写通道：`POST /api/sites`（CAS 条件写 + 写前快照 + `sanitizeSites` 门禁）。
 * 如果这里也写一份，就会绕过快照与并发保护，等于给「数据安全单点」开了第二个入口。
 * 所以本接口的 POST 只**算计划**：读权威数据 → 生成 `nextSites` → 原样返回，
 * 由前端确认后再走 `/api/sites` 落库。写路径的唯一性比少一次请求重要得多。
 *
 * ## 为什么读失败必须是 503
 *
 * 与 `api/sites.js` 同一条口径：SQLite 抖动 / 快照损坏都会被读成 `data: null`。
 * 如果把它当成「空库」，体检报告会显示 0 条站点，用户很可能据此执行修复，
 * 而修复是基于空数组生成的 —— 那是一次静默的数据抹除。宁可报错。
 *
 * ## 鉴权
 *
 * 体检报告暴露完整站点清单与运维指标，属于管理动作，GET 也要求 Bearer
 * （会话 token 或共享密钥），与 `/api/plugins` 一致。
 */
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { get, put, list, del } from '#store'
import { checkAuthHeader } from '../shared/auth.mjs'
import { resolveSiteStore } from '../shared/site-store.mjs'
import { CATEGORY_GROUPS } from '../shared/categories.mjs'
import { sanitizeSites } from '../shared/sanitize.mjs'
import {
  auditSites, buildFixPlan, categoryIndex,
  FIX_ACTIONS, AUDIT_FIELDS, LOW_CONFIDENCE,
} from '../shared/data-audit.mjs'
import { sitesToCsv, sliceSites, reportToMarkdown } from '../shared/data-report.mjs'
import {
  parseImportText, planImport, IMPORT_STRATEGIES, MAX_IMPORT_ROWS,
} from '../shared/data-import.mjs'
import { findDuplicateGroups, buildMergePlan, MERGE_FIELDS } from '../shared/data-merge.mjs'
import {
  summaryFromReport, appendHistory, sanitizeHistory, seriesOf, HISTORY_KEEP,
} from '../shared/data-history.mjs'

const PATHNAME = 'sites.json'

/** 存储 provider 与写路径保持同一个选择：站内固定 kv，不接受环境变量切换 */
const store = resolveSiteStore({ explicit: 'kv', ctx: { kv: { get, put, list, del }, pathname: PATHNAME } })

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
}

/** `req.body` 在 Vercel 下是对象、自建服务里可能是字符串（见 server/main.mjs 的 attachBody） */
function readJsonBody(req) {
  const b = req.body
  if (!b) return {}
  if (typeof b === 'object') return b
  try { return JSON.parse(String(b)) } catch { return {} }
}

/**
 * 定位图标目录。产物里是 `<ROOT>/icons`（public 被复制到根），源码树里是 `<ROOT>/public/icons`。
 * 两边都不存在时返回 null —— 资源检查降级为「未检查」，而不是误报 293 条缺失。
 */
function iconDir() {
  const candidates = [join(ROOT, 'public', 'icons'), join(ROOT, 'icons')]
  for (const dir of candidates) {
    if (existsSync(dir)) return dir
  }
  return null
}

/**
 * 构造图标存在性判定。站点里的 `icon` 形如 `icons/s1.webp`，按文件名比对即可 ——
 * 目录本身已经确定为 icons，再拼一次 `icons/icons/...` 只会永远判缺失。
 */
function iconChecker(dir) {
  if (!dir) return { iconExists: null, iconFiles: null }
  let files
  try { files = readdirSync(dir) } catch { return { iconExists: null, iconFiles: null } }
  const set = new Set(files)
  return {
    iconExists: (p) => {
      const name = String(p).replace(/^\/+/, '').replace(/^icons\//, '')
      return set.has(name)
    },
    iconFiles: files.map(f => `icons/${f}`),
  }
}

/**
 * 读权威站点数据。返回 `{ data, etag }`；读不出来抛错（由调用方回 503）。
 * 与 `api/sites.js` 的区别：这里**不做种子初始化** —— 体检不该产生任何写入。
 */
async function readSites() {
  const r = await store.read()
  return r
}

function categoriesOf(data) {
  if (data && Array.isArray(data.categories) && data.categories.length) return data.categories
  return CATEGORY_GROUPS
}

function buildReport(data, extra = {}) {
  const sites = data && Array.isArray(data.sites) ? data.sites : []
  const categories = categoriesOf(data)
  const dir = iconDir()
  const { iconExists, iconFiles } = iconChecker(dir)

  const report = auditSites(sites, {
    categories,
    now: Date.now(),
    iconExists,
    iconFiles: iconFiles || undefined,
    ...extra,
  })

  return {
    ok: true,
    version: Number(data && data.version) || 0,
    updatedAt: (data && data.updatedAt) || null,
    storedAt: data ? 'stored' : 'seed',
    categories,
    report,
    fieldCatalog: AUDIT_FIELDS,
    fixCatalog: FIX_ACTIONS,
    importCatalog: IMPORT_STRATEGIES,
    mergeFields: MERGE_FIELDS,
    limits: { maxImportRows: MAX_IMPORT_ROWS },
    thresholds: { lowConfidence: LOW_CONFIDENCE },
    resourcesChecked: Boolean(iconExists),
    at: new Date().toISOString(),
  }
}

/* ---------------- 导出 ---------------- */

function exportName(kind, stamp) {
  const d = new Date(stamp).toISOString().slice(0, 10)
  return `nav-sites-${kind}-${d}`
}

function sendJson(res, filename, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.status(200).json(payload)
}

function sendCsv(res, filename, csv) {
  // BOM：Excel 打开 UTF-8 CSV 不加 BOM 会显示乱码。纯函数层不写 BOM，传输层加。
  const body = '﻿' + csv
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('Content-Length', Buffer.byteLength(body, 'utf8'))
  // 自建服务只给 res 补了 status().json()，没有 .send()；CSV 走原生 end。
  res.statusCode = 200
  res.end(body)
}

function doExport(req, res, query, data) {
  const kind = String(query.export)
  const categoryId = query.categoryId ? String(query.categoryId) : ''
  const domain = query.domain ? String(query.domain) : ''
  const sites = Array.isArray(data && data.sites) ? data.sites : []
  const sliced = sliceSites(sites, { categoryId: categoryId || undefined, domain: domain || undefined })
  const stamp = Date.now()
  const suffix = categoryId ? `-${categoryId}` : domain ? `-${domain}` : ''

  if (kind === 'csv') {
    return sendCsv(res, `${exportName('export', stamp)}${suffix}.csv`, sitesToCsv(sliced))
  }

  if (kind === 'json') {
    return sendJson(res, `${exportName('export', stamp)}${suffix}.json`, {
      ok: true,
      kind: 'navigator-sites-export',
      schema: 1,
      exportedAt: new Date(stamp).toISOString(),
      slice: { categoryId: categoryId || null, domain: domain || null },
      count: sliced.length,
      version: Number(data && data.version) || 0,
      categories: categoriesOf(data),
      sites: sliced,
    })
  }

  res.status(400).json({ ok: false, error: `不支持的导出格式：${kind}（只支持 json / csv）` })
}

/**
 * 体检报告导出：Markdown 供人读与留档，JSON 供程序再加工。
 *
 * 与 `?export=` 的区别：那边导出的是**站点数据**，这边导出的是**体检结论**。
 * 两者都走同一个鉴权与 no-store，但文件名前缀不同，避免在下载目录里混淆。
 */
function doReport(res, query, data) {
  const kind = String(query.report)
  const full = buildReport(data)
  const meta = { version: full.version, updatedAt: full.updatedAt, storedAt: full.storedAt }
  const stamp = Date.now()

  if (kind === 'json') {
    return sendJson(res, `${exportName('report', stamp)}.json`, {
      ok: true,
      kind: 'navigator-sites-report',
      schema: 1,
      exportedAt: new Date(stamp).toISOString(),
      ...meta,
      report: full.report,
    })
  }

  if (kind === 'markdown' || kind === 'md') {
    const text = reportToMarkdown(full.report, meta)
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${exportName('report', stamp)}.md"`)
    res.setHeader('Content-Length', Buffer.byteLength(text, 'utf8'))
    res.statusCode = 200
    res.end(text)
    return
  }

  res.status(400).json({ ok: false, error: `不支持的报告格式：${kind}（只支持 markdown / json）` })
}

/* ---------------- 历史 ---------------- */

const HISTORY_PATH = 'ops/data-manager-history.json'

async function readHistory() {
  try {
    const blob = await get(HISTORY_PATH, { access: 'private', useCache: false })
    if (!blob || !blob.stream) return []
    const j = JSON.parse(await new Response(blob.stream).text())
    return sanitizeHistory(j && j.items)
  } catch {
    // 历史读不出来不该让面板打不开 —— 它只是趋势，不是数据面
    return []
  }
}

async function writeHistory(items) {
  await put(HISTORY_PATH, JSON.stringify({
    schema: 1,
    updatedAt: new Date().toISOString(),
    items,
  }), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  })
}

/* ---------------- 导入计划 ---------------- */

/** 计划里只回摘要，完整对象走 payload —— 否则 300 条导入会返回两遍全量数据 */
function briefSite(s) {
  return { id: s.id, name: s.name, url: s.url, categoryId: s.categoryId }
}

/**
 * 导入预检与计划：解析文件 → 逐行诊断 → 冲突处理 → 生成 nextSites。
 * 与修复计划一样，本函数**不写库**。
 */
function doImportPlan(res, body, data) {
  const text = typeof body.text === 'string' ? body.text : ''
  if (!text.trim()) {
    res.status(400).json({ ok: false, error: '缺少导入内容（text 为空）' })
    return
  }

  const parsed = parseImportText(text, { format: String(body.format || 'auto') })
  const fatal = parsed.diagnostics.filter(d => d.level === 'error')
  if (fatal.length) {
    res.status(400).json({ ok: false, error: fatal[0].message, diagnostics: parsed.diagnostics })
    return
  }

  const strategy = String(body.strategy || 'skip')
  if (!IMPORT_STRATEGIES.some(s => s.key === strategy)) {
    res.status(400).json({ ok: false, error: `未知的冲突策略：${strategy}` })
    return
  }

  const categories = categoriesOf(data)
  const sites = Array.isArray(data && data.sites) ? data.sites : []

  const plan = planImport(sites, parsed.rows, {
    strategy,
    categoryIndex: categoryIndex(categories),
    now: Date.now(),
  })

  if (plan.blocked) {
    res.status(400).json({ ok: false, error: plan.diagnostics[0]?.message || '导入被拒绝' })
    return
  }

  // 兜底：导入结果必须能过站点表门禁，否则前端拿到也写不进去
  if (!sanitizeSites(plan.nextSites)) {
    res.status(500).json({ ok: false, error: '导入计划产生的站点表不合法，已拒绝（未做任何改动）' })
    return
  }

  res.status(200).json({
    ok: true,
    mode: 'import',
    format: parsed.format,
    strategy,
    baseVersion: Number(data && data.version) || 0,
    baseUpdatedAt: (data && data.updatedAt) || null,
    stats: plan.stats,
    adds: plan.adds.map(briefSite),
    updatesTotal: plan.updates.length,
    /**
     * 覆盖条目带回字段级 diff。上限 200 条 × 每条 12 个字段 ——
     * 超出部分前端已能通过统计知道存在，但不必为一份 3000 条的导入付传输代价。
     */
    updates: plan.updates.slice(0, 200).map(u => ({
      id: u.id,
      name: u.name,
      incomingName: u.incomingName,
      reason: u.reason,
      fieldCount: u.fields ? u.fields.length : 0,
      fields: (u.fields || []).slice(0, 12),
    })),
    skips: plan.skips.slice(0, 200),
    skipsTotal: plan.skips.length,
    invalid: plan.invalid.slice(0, 100),
    diagnostics: plan.diagnostics.slice(0, 100),
    // 前端拿它走 POST /api/sites；分类表原样带回，避免那次写入把分类清空
    payload: { sites: plan.nextSites, categories },
    at: new Date().toISOString(),
  })
}

/* ---------------- 合并计划 ---------------- */

/**
 * 重复站点合并计划。
 *
 * 这是**唯一会减少站点条数**的操作，因此接口层明确返回 `removedSites`，
 * 前端必须在确认页里把「将减少 N 条」显示出来。计划本身仍不写库。
 */
function doMergePlan(res, body, data) {
  const sites = Array.isArray(data && data.sites) ? data.sites : []
  const choices = (body.choices && typeof body.choices === 'object') ? body.choices : {}

  const plan = buildMergePlan(sites, { choices, now: Date.now() })

  if (!plan.nextSites.length) {
    res.status(400).json({ ok: false, error: '合并结果为空，已拒绝（本操作不允许清空站点库）' })
    return
  }
  if (!sanitizeSites(plan.nextSites)) {
    res.status(500).json({ ok: false, error: '合并结果不合法，已拒绝（未做任何改动）' })
    return
  }

  res.status(200).json({
    ok: true,
    mode: 'merge',
    baseVersion: Number(data && data.version) || 0,
    baseUpdatedAt: (data && data.updatedAt) || null,
    stats: plan.stats,
    groups: plan.groups,
    merges: plan.merges,
    mergeFields: MERGE_FIELDS,
    payload: { sites: plan.nextSites, categories: categoriesOf(data) },
    at: new Date().toISOString(),
  })
}

/* ---------------- 记录趋势 ---------------- */

/**
 * 记录一次体检摘要。
 *
 * 摘要由**服务端**从当前权威数据算出，不接受前端传入的数字 ——
 * 否则历史曲线可以被一次构造请求写坏，而它是用来判断「数据有没有变好」的。
 */
async function doRecordHistory(res, data) {
  try {
    const full = buildReport(data)
    const entry = summaryFromReport(full.report, { version: full.version })
    const existing = await readHistory()
    const r = appendHistory(existing, entry)
    if (r.added) await writeHistory(r.items)

    res.status(200).json({
      ok: true,
      mode: 'history',
      added: r.added,
      reason: r.reason,
      count: r.items.length,
      items: r.items,
      entry,
      series: seriesOf(r.items, 'issueCount'),
      at: new Date().toISOString(),
    })
  } catch (e) {
    res.status(503).json({ ok: false, error: '历史写入失败：' + String((e && e.message) || e) })
  }
}

/* ---------------- handler ---------------- */

export default async function handler(req, res) {
  noStore(res)

  const auth = checkAuthHeader(req)
  if (!auth.ok) { res.status(auth.code).json({ ok: false, error: auth.error }); return }

  const query = (req.query && typeof req.query === 'object') ? req.query : {}

  let stored
  try {
    stored = await readSites()
  } catch (e) {
    console.error('[data-manager] read failed:', String(e && e.message || e))
    res.status(503).json({
      ok: false,
      error: '站点库读取失败，已拒绝生成报告（不会把读取故障当成空库）',
      degraded: true,
    })
    return
  }

  const data = stored.data

  if (req.method === 'GET') {
    if (query.export !== undefined) return doExport(req, res, query, data)
    if (query.report !== undefined) return doReport(res, query, data)

    // ?history=1：体检趋势点（摘要，不含逐条清单）
    if (query.history === '1') {
      const items = await readHistory()
      return res.status(200).json({
        ok: true,
        keep: HISTORY_KEEP,
        count: items.length,
        items,
        series: seriesOf(items, String(query.metric || 'issueCount')),
        at: new Date().toISOString(),
      })
    }

    // ?duplicates=1：只取重复分组（合并向导用），不跑完整报告
    if (query.duplicates === '1') {
      const sites = Array.isArray(data && data.sites) ? data.sites : []
      const groups = findDuplicateGroups(sites)
      return res.status(200).json({
        ok: true,
        count: groups.length,
        groups: groups.slice(0, 100),
        truncated: groups.length > 100,
        mergeFields: MERGE_FIELDS,
        at: new Date().toISOString(),
      })
    }

    // ?summary=1：只要汇总数字（仪表盘卡片用），不返回逐条缺失清单
    if (query.summary === '1') {
      const full = buildReport(data)
      const r = full.report
      return res.status(200).json({
        ok: true,
        version: full.version,
        updatedAt: full.updatedAt,
        total: r.total,
        issueCount: r.issueCount,
        lowConfidence: r.inference.lowConfidence.length,
        orphanCategories: r.orphanCategories.length,
        duplicateUrls: r.duplicates.urls.length,
        duplicateNames: r.duplicates.names.length,
        missingIcons: r.resources.iconMissing.length,
        emptyCategories: r.emptyCategories.length,
        at: full.at,
      })
    }

    return res.status(200).json(buildReport(data))
  }

  if (req.method === 'POST') {
    const body = readJsonBody(req)
    const mode = String(body.mode || 'plan')

    if (mode === 'import') return doImportPlan(res, body, data)
    if (mode === 'merge') return doMergePlan(res, body, data)
    if (mode === 'history') return doRecordHistory(res, data)

    if (mode !== 'plan') {
      res.status(400).json({ ok: false, error: `不支持的模式：${mode}（本接口只生成计划，写入请走 /api/sites）` })
      return
    }

    const actions = (body.actions && typeof body.actions === 'object') ? body.actions : {}
    const reassign = (body.reassign && typeof body.reassign === 'object') ? body.reassign : {}
    const markManual = Array.isArray(body.markManual) ? body.markManual : []
    const scope = (body.scope && typeof body.scope === 'object') ? body.scope : null

    // 计划同样需要分类白名单：孤儿分类重指派只能指到已登记的分类
    const categories = categoriesOf(data)
    const allowed = new Set()
    for (const g of categories) for (const c of g.categories || []) allowed.add(String(c.id))
    const badTargets = Object.entries(reassign).filter(([, v]) => !allowed.has(String(v)))
    if (badTargets.length) {
      res.status(400).json({
        ok: false,
        error: '重指派目标不是已登记的分类',
        rejected: badTargets.map(([id, v]) => ({ id, categoryId: v })),
      })
      return
    }

    // 范围里的分类同样要过白名单：写一个不存在的分类只会得到一份「零变更」计划
    if (scope && scope.categoryId && !allowed.has(String(scope.categoryId))) {
      res.status(400).json({ ok: false, error: `作用范围的分类未登记：${scope.categoryId}` })
      return
    }

    const { iconExists } = iconChecker(iconDir())
    const sites = Array.isArray(data && data.sites) ? data.sites : []
    const plan = buildFixPlan(sites, {
      actions,
      reassign,
      markManual,
      iconExists,
      scope,
      now: Date.now(),
    })

    // 兜底：本插件不删除站点。任何让条数减少的计划都视为实现错误，拒绝下发。
    if (plan.nextSites.length !== sites.length) {
      res.status(500).json({ ok: false, error: '修复计划改变了站点条数，已拒绝（本接口不删除站点）' })
      return
    }

    return res.status(200).json({
      ok: true,
      mode: 'plan',
      baseVersion: Number(data && data.version) || 0,
      baseUpdatedAt: (data && data.updatedAt) || null,
      ...plan,
      // 前端拿它走 POST /api/sites；分类表原样带回，避免那次写入把分类清空
      payload: { sites: plan.nextSites, categories },
      at: new Date().toISOString(),
    })
  }

  res.status(405).json({ ok: false, error: 'Method not allowed' })
}
