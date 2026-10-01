/**
 * 操作审计日志：把「谁在何时做了什么、结果如何」落盘为 JSONL。
 *
 * 为什么需要它：jobs 事件只在内存里，控制台一重启就全没了，
 * 答不了「上次是谁放行的、放行了什么、为什么被拒」。审计是持久层，与发布门禁形成闭环。
 *
 * 两条硬约束：
 *  ① 写入失败绝不阻断主流程 —— 审计是旁路，不能因为它没写成功就让发布失败；
 *  ② 只记录「已发生的事实」，不记录将要发生的事 —— 预演/预检这类只读动作按只读结果记录。
 *
 * 存储：.data/audit.jsonl（活跃文件），超过 MAX_BYTES 自动轮转到 .data/audit-archive/。
 * 之所以不用月度文件：控制台是单人本地工具，按体积轮转比按月更贴合实际写入量。
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.mjs'
import { AUDIT_ACTIONS, normalizeEntry, filterEntries, summarizeEntries, actionLabel } from '../../../shared/ops/audit-core.mjs'

const DATA_DIR = join(ROOT, 'tools', 'console', '.data')
const ACTIVE = join(DATA_DIR, 'audit.jsonl')
const ARCHIVE_DIR = join(DATA_DIR, 'audit-archive')
const MAX_BYTES = 2 * 1024 * 1024
const MAX_ARCHIVES = 20
const SCAN_LINE_CAP = 20000

/** 动作目录来自内核（与线上后台同源），控制台不再自维护一份，避免同一动作两种叫法 */
export const ACTIONS = AUDIT_ACTIONS

export { actionLabel }

function rotateIfNeeded() {
  let size = 0
  try { size = statSync(ACTIVE).size } catch { return }
  if (size < MAX_BYTES) return
  try {
    mkdirSync(ARCHIVE_DIR, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    renameSync(ACTIVE, join(ARCHIVE_DIR, `audit-${stamp}.jsonl`))
    const files = readdirSync(ARCHIVE_DIR).filter(n => /^audit-.*\.jsonl$/.test(n)).sort()
    for (const name of files.slice(0, Math.max(0, files.length - MAX_ARCHIVES))) {
      try { renameSync(join(ARCHIVE_DIR, name), join(ARCHIVE_DIR, `${name}.deleted`)) } catch { /* 清理失败不阻断 */ }
    }
  } catch { /* 轮转失败不影响本次写入 */ }
}

/**
 * 记录一条审计。返回是否写入成功，但调用方不需要处理失败 —— 审计是旁路。
 * @param {{action:string,target?:string,result?:'ok'|'fail'|'rejected',detail?:string,actor?:string}} entry
 */
export function record({ action, target = '', result = 'ok', detail = '', actor = 'console' } = {}) {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    rotateIfNeeded()
    appendFileSync(ACTIVE, `${JSON.stringify(normalizeEntry({ action, target, result, detail, actor }))}\n`, 'utf-8')
    return true
  } catch {
    return false
  }
}

function activeFile() {
  try { return [ACTIVE, ...readdirSync(ARCHIVE_DIR).filter(n => /^audit-.*\.jsonl$/.test(n)).sort().reverse().map(n => join(ARCHIVE_DIR, n))] } catch { return [ACTIVE] }
}

/** 从新到旧读入审计条目；按 SCAN_LINE_CAP 限制扫描量，避免归档很多时拖慢面板 */
function readAll() {
  const out = []
  for (const file of activeFile()) {
    let text = ''
    try { text = readFileSync(file, 'utf-8') } catch { continue }
    const lines = text.split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const raw = lines[i].trim()
      if (!raw) continue
      try { out.push(JSON.parse(raw)) } catch { /* 跳过写坏的行 */ }
      if (out.length >= SCAN_LINE_CAP) return out
    }
  }
  return out
}

/** 审计查询：按动作 / 结果 / 关键词过滤，返回新 → 旧 */
export function list({ limit = 200, action = '', result = '', q = '' } = {}) {
  const items = filterEntries(readAll(), { action, result, q })
  return { total: items.length, items: items.slice(0, Math.max(1, Math.min(Number(limit) || 200, 2000))) }
}

/** 概览统计：总数 / 失败数 / 最近一次放行，供概览面板使用 */
export function summary() {
  return summarizeEntries(readAll())
}

export const AUDIT_FILE = ACTIVE