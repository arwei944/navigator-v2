/**
 * 发布历史落盘：把每次一键发布的结果整体存为 JSONL。
 *
 * 与审计的分工：审计记「谁在何时做了什么动作」，发布历史记「这一整条流水线的结果」——
 * 哪一步失败、耗时多久、云端版本推进到几、当次数据快照是谁。前者查责，后者查版本与回退。
 *
 * 记录结构来自 shared/ops/publish-history.mjs，与线上后台同源，
 * 保证两端能在同一套 UI 里对比同一段历史。
 *
 * 硬约束：写入失败绝不阻断发布 —— 历史是旁路，不能因为它没写成功就让发布失败。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.mjs'
import {
  HISTORY_KEEP, TRIGGERS, normalizeRecord, filterRecords,
  summarizeRecords, sortRecords, prunableRecords,
} from '../../../shared/ops/publish-history.mjs'

const DATA_DIR = join(ROOT, 'tools', 'console', '.data')
const FILE = join(DATA_DIR, 'publish-history.jsonl')

function readAll() {
  let text = ''
  try { text = readFileSync(FILE, 'utf-8') } catch { return [] }
  const out = []
  for (const line of text.split('\n')) {
    const raw = line.trim()
    if (!raw) continue
    try { out.push(JSON.parse(raw)) } catch { /* 跳过写坏的行 */ }
  }
  return out
}

function writeAll(items) {
  mkdirSync(DATA_DIR, { recursive: true })
  const tmp = FILE + '.tmp'
  writeFileSync(tmp, items.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf-8')
  renameSync(tmp, FILE)
}

/**
 * 追加一条发布记录。整文件重写而非原地追加，因为超过 HISTORY_KEEP 需要裁掉旧记录，
 * 而 JSONL 里删中间行只能靠重写（记录量小，成本可忽略）。
 */
export function append(input) {
  try {
    const record = normalizeRecord(input)
    const items = sortRecords([...readAll(), record])
    const drop = new Set(prunableRecords(items, HISTORY_KEEP))
    writeAll(items.filter(r => !drop.has(r.id)))
    return record
  } catch {
    return null
  }
}

/** 发布历史查询：新 → 旧，附概览统计与触发来源字典 */
export function list({ ok = '', trigger = '', q = '', limit = 30 } = {}) {
  const items = sortRecords(readAll())
  const matched = filterRecords(items, { ok, trigger, q })
  return {
    total: items.length,
    matched: matched.length,
    summary: summarizeRecords(items),
    triggers: TRIGGERS,
    items: matched.slice(0, Math.max(1, Math.min(Number(limit) || 30, 200))),
  }
}

export const HISTORY_FILE = FILE