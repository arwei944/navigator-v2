/**
 * 服务端审计落盘：追加条目、写站点变更明细、清理旧明细。
 *
 * ## 为什么单独成文件
 *
 * `api/auth.js` 早就有一份 `appendAudit`，站点写入要复用同一份结构。
 * 放在 `api/` 下不行 —— 路由表按目录派生，任何 `.js` 都会被当成端点并要求
 * default 导出。放 `server/`，构建时复制进产物，`api/*.js` 相对引用它。
 *
 * ## 读失败时不写
 *
 * 追加是「读全量 → 头插 → 写回」。如果读失败却按空数组继续写，
 * 会把现有 2000 条审计一次性覆盖成只剩新记录。审计是旁路，
 * 宁可这次不记，也不能丢历史。
 */
import { randomUUID } from 'node:crypto'
import { get, put, list, del } from '#store'
import { normalizeEntry } from '../shared/ops/audit-core.mjs'

export const AUDIT_PATH = 'ops/audit.json'
export const AUDIT_KEEP = 2000
export const DETAIL_PREFIX = 'ops/site-changes/'
export const DETAIL_KEEP = 50

async function readAudit() {
  const blob = await get(AUDIT_PATH, { access: 'private', useCache: false })
  if (!blob || !blob.stream) return []
  const data = JSON.parse(await new Response(blob.stream).text())
  return Array.isArray(data) ? data : []
}

/**
 * 追加一条或多条审计。
 * @param {object|object[]} entries
 * @returns {Promise<{ok:boolean, added?:number, error?:string}>}
 */
export async function appendAudit(entries) {
  const listIn = (Array.isArray(entries) ? entries : [entries]).filter(Boolean)
  if (!listIn.length) return { ok: true, added: 0 }
  let items
  try {
    items = await readAudit()
  } catch (e) {
    // 读不出来就跳过，绝不从空数组覆盖
    return { ok: false, added: 0, error: `读取现有审计失败：${String(e?.message || e)}` }
  }
  try {
    const next = [...listIn.map(normalizeEntry), ...items].slice(0, AUDIT_KEEP)
    await put(AUDIT_PATH, JSON.stringify(next), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    })
    return { ok: true, added: listIn.length }
  } catch (e) {
    return { ok: false, added: 0, error: String(e?.message || e) }
  }
}

/**
 * 站点批量变更的完整明细（审计里只留摘要与这个路径）。
 * @returns {Promise<string|null>} 明细 pathname；失败返回 null
 */
export async function writeSiteChangeDetail({ diff, actor, source }) {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const path = `${DETAIL_PREFIX}${stamp}-${randomUUID().slice(0, 8)}.json`
    await put(path, JSON.stringify({
      at: new Date().toISOString(),
      actor: String(actor || 'admin'),
      source: String(source || 'manual'),
      diff,
    }, null, 2), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: 'application/json',
    })
    await pruneDetails()
    return path
  } catch {
    return null
  }
}

/** 明细最多保留 DETAIL_KEEP 份；清理失败不影响本次写入 */
async function pruneDetails() {
  try {
    const { blobs } = await list({ prefix: DETAIL_PREFIX, limit: 500 })
    const names = (blobs || [])
      .map(b => String(b.pathname))
      .filter(p => p.endsWith('.json'))
      .sort()
    for (const p of names.slice(0, Math.max(0, names.length - DETAIL_KEEP))) {
      await del(p)
    }
  } catch { /* 旁路清理失败不影响主流程 */ }
}