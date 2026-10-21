#!/usr/bin/env node
/**
 * 升级数据保护：部署前备份 → 部署后校验 → 异常自动恢复。
 *
 * ## 为什么需要（不是重复部署脚本已有的保护）
 *
 * 部署包已经排除 `data/`，容器 restart 也会保留文件系统 —— 这两条挡住了
 * 「部署覆盖线上库」。但平台**没有持久卷**：容器一旦被平台重建（镜像更新、
 * 迁移、异常回收），`data/` 会连同站点库、审计日志、健康记录一起消失。
 * 部署路径本身救不回数据。
 *
 * 所以在每次升级前后各做一件事：
 *   1. 升级前把**数据面 + 运维面**完整拉到本地（`backups/upgrades/`）；
 *   2. 升级后逐项核对：站点条数不下降、version 不回退、升级前存在的站点 id
 *      一个都不能少、审计记录不减少。
 *   3. 核对失败时默认用升级前备份恢复（`--no-restore` 可关闭），
 *      恢复正常后再核对一次。
 *
 * ## 口径
 *
 * - 「不下降」允许新增（升级期间用户仍可能在添加站点）；
 * - 只看**身份与存在性**（id 集合、条数、version、审计条数），不比较内容，
 *   否则一次正常的编辑就会被误判成数据丢失；
 * - 备份同时包含 `ops/audit.json`、`ops/health.json`、`clicks.json`、
 *   `ops/publish-history.json`、`ops/notifications.json`，恢复时一并写回。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'backups', 'upgrades')
const DEFAULT_URL = 'https://navigator-v2.bot-keep.xyz'

function readKey() {
  if (process.env.SITES_ADMIN_KEY) return process.env.SITES_ADMIN_KEY.trim()
  try { return readFileSync(join(ROOT, 'data', 'admin-key.txt'), 'utf8').trim() } catch { return '' }
}

function targetUrl(url) {
  return String(url || process.env.DEPLOY_SITE_URL || DEFAULT_URL).replace(/\/+$/, '')
}

function headers(key) {
  return key
    ? { 'X-Nav-Key': key, Authorization: `Bearer ${key}`, Accept: 'application/json' }
    : { Accept: 'application/json' }
}

async function fetchJson(url, key, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { ...headers(key), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    signal: AbortSignal.timeout(opts.timeout || 30000),
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  return { ok: res.ok, status: res.status, data, text }
}

/** 审计记录条数：兼容数组、`{entries:[]}`、JSONL 与普通对象 */
export function auditCount(text) {
  if (!text) return 0
  try {
    const j = JSON.parse(text)
    if (Array.isArray(j)) return j.length
    if (j && Array.isArray(j.entries)) return j.entries.length
    if (j && Array.isArray(j.records)) return j.records.length
    if (j && typeof j === 'object') return Object.keys(j).length
  } catch {
    return String(text).split('\n').filter(Boolean).length
  }
  return 0
}

/** 升级前/后的快照摘要 */
export function summarize(backup, auditText, healthText) {
  const sites = Array.isArray(backup?.sites?.sites) ? backup.sites.sites : []
  return {
    at: new Date().toISOString(),
    version: Number(backup?.sites?.version) || 0,
    sites: sites.length,
    ids: sites.map(s => String(s?.id || '')).filter(Boolean),
    categories: Array.isArray(backup?.sites?.categories) ? backup.sites.categories.length : 0,
    auditEntries: auditCount(auditText),
    auditBytes: Buffer.byteLength(auditText || ''),
    healthBytes: Buffer.byteLength(healthText || ''),
    earliestCreatedAt: sites.reduce((min, s) => {
      const t = Number(s?.createdAt) || 0
      return t && (!min || t < min) ? t : min
    }, 0),
  }
}

/**
 * 核心判定（纯函数，可单测）。
 * @returns {{ok:boolean, reasons:string[]}}
 */
export function compareData(before, after) {
  const reasons = []
  if (!before || !after) return { ok: false, reasons: ['缺少升级前或升级后的快照'] }

  if (after.sites < before.sites) {
    reasons.push(`站点条数下降：${before.sites} → ${after.sites}`)
  }
  if (after.version < before.version) {
    reasons.push(`version 回退：${before.version} → ${after.version}`)
  }

  const afterIds = new Set(after.ids || [])
  const missing = (before.ids || []).filter(id => !afterIds.has(id))
  if (missing.length) {
    reasons.push(`升级前存在的站点丢失 ${missing.length} 条：${missing.slice(0, 8).join('、')}${missing.length > 8 ? '…' : ''}`)
  }

  if (after.auditEntries < before.auditEntries) {
    reasons.push(`审计记录减少：${before.auditEntries} → ${after.auditEntries}`)
  }

  return { ok: reasons.length === 0, reasons }
}

/**
 * 升级前抓基线。线上不可达 / 未配置密钥时返回 `{ok:false, skipped:true}`，
 * 不阻塞部署（首次发布本来就没有基线）。
 */
export async function captureBaseline({ url, key = readKey(), log = () => {} } = {}) {
  const base = targetUrl(url)
  if (!key) return { ok: false, skipped: true, reason: '未配置 SITES_ADMIN_KEY，跳过升级保护' }

  log(`\n· 升级前数据基线（${base}）`)
  try {
    const backup = await fetchJson(`${base}/api/backup`, key)
    if (!backup.ok || !backup.data || backup.data.kind !== 'navigator-backup') {
      return { ok: false, skipped: true, reason: `线上备份不可用（HTTP ${backup.status}）` }
    }
    const audit = await fetchJson(`${base}/api/backup?object=ops/audit.json`, key)
    const health = await fetchJson(`${base}/api/backup?object=ops/health.json`, key)
    const auditText = typeof audit.data?.body === 'string' ? audit.data.body : ''
    const healthText = typeof health.data?.body === 'string' ? health.data.body : ''
    const summary = summarize(backup.data, auditText, healthText)

    mkdirSync(OUT_DIR, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const path = join(OUT_DIR, `${stamp}-before.json`)
    writeFileSync(path, JSON.stringify({
      kind: 'nav-upgrade-baseline',
      at: new Date().toISOString(),
      url: base,
      summary,
      backup: backup.data,
      auditText,
      healthText,
    }, null, 2), 'utf8')

    log(`  ✓ 已备份：${summary.sites} 条 · v${summary.version} · 审计 ${summary.auditEntries} 条`)
    log(`  存档 ${path}`)
    return { ok: true, url: base, key, summary, backup: backup.data, auditText, healthText, path }
  } catch (e) {
    return { ok: false, skipped: true, reason: `抓取基线失败：${String(e?.message || e)}` }
  }
}

/** 升级后核对 */
export async function verifyAfter(baseline, { log = () => {} } = {}) {
  if (!baseline || !baseline.ok) return { ok: true, skipped: true, reasons: [] }
  log('\n· 升级后数据核对')
  try {
    const backup = await fetchJson(`${baseline.url}/api/backup`, baseline.key)
    if (!backup.ok || !backup.data) {
      return { ok: false, reasons: [`读取升级后数据失败（HTTP ${backup.status}）`], after: null }
    }
    const audit = await fetchJson(`${baseline.url}/api/backup?object=ops/audit.json`, baseline.key)
    const health = await fetchJson(`${baseline.url}/api/backup?object=ops/health.json`, baseline.key)
    const after = summarize(
      backup.data,
      typeof audit.data?.body === 'string' ? audit.data.body : '',
      typeof health.data?.body === 'string' ? health.data.body : '',
    )
    const verdict = compareData(baseline.summary, after)
    if (verdict.ok) {
      log(`  ✓ 数据连续：${after.sites} 条 · v${after.version} · 审计 ${after.auditEntries} 条`)
    } else {
      for (const r of verdict.reasons) log(`  ⚠ ${r}`)
    }
    return { ok: verdict.ok, reasons: verdict.reasons, before: baseline.summary, after }
  } catch (e) {
    return { ok: false, reasons: [`核对失败：${String(e?.message || e)}`], after: null }
  }
}

/** 用升级前备份恢复（数据面 + 运维面） */
export async function restoreBaseline(baseline, { log = () => {} } = {}) {
  if (!baseline || !baseline.ok || !baseline.backup) {
    return { ok: false, error: '没有可用的升级前备份' }
  }
  log('\n· 数据核对未通过，按升级前备份恢复…')
  try {
    const res = await fetchJson(`${baseline.url}/api/backup`, baseline.key, {
      method: 'POST',
      body: JSON.stringify({ data: baseline.backup }),
      timeout: 60000,
    })
    if (!res.ok || !res.data?.ok) {
      return { ok: false, error: res.data?.error || `HTTP ${res.status}` }
    }
    log(`  ✓ 已恢复 v${res.data.restored?.version} · ${res.data.restored?.sites} 条`)
    const check = await verifyAfter(baseline, { log })
    return { ok: check.ok, restored: res.data.restored, verify: check }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}