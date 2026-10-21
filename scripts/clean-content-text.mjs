#!/usr/bin/env node
/**
 * 一次性清洗内容库里的富文本残留（HTML 标签、&#x2F; 之类的实体）。
 *
 * 早期抓取把 HN 讨论文本原样存进了摘要，简报里会出现 `https:&#x2F;&#x2F;...`。
 * 解析层已经修好，这个脚本负责把存量条目也清一遍。
 *
 * 用法：node scripts/clean-content-text.mjs [--dry-run]
 */
import { db } from '../server/content-store.mjs'
import { stripHtml, truncate } from '../shared/content-core.mjs'

const dryRun = process.argv.includes('--dry-run')
const rows = db.prepare('SELECT id, title, summary, title_zh, summary_zh, content, why FROM entries').all()
const update = db.prepare(`
  UPDATE entries SET title = ?, summary = ?, title_zh = ?, summary_zh = ?, content = ?, why = ? WHERE id = ?
`)
const clean = (value, max) => truncate(stripHtml(value || ''), max)

let changed = 0
db.exec('BEGIN')
try {
  for (const row of rows) {
    const next = {
      title: clean(row.title, 220),
      summary: clean(row.summary, 800),
      titleZh: clean(row.title_zh, 220),
      summaryZh: clean(row.summary_zh, 800),
      content: clean(row.content, 4000),
      why: clean(row.why, 400),
    }
    const same = next.title === (row.title || '')
      && next.summary === (row.summary || '')
      && next.titleZh === (row.title_zh || '')
      && next.summaryZh === (row.summary_zh || '')
      && next.content === (row.content || '')
      && next.why === (row.why || '')
    if (same) continue
    changed += 1
    if (!dryRun) {
      update.run(next.title, next.summary, next.titleZh, next.summaryZh, next.content, next.why, row.id)
    }
  }
  if (dryRun) db.exec('ROLLBACK')
  else db.exec('COMMIT')
} catch (e) {
  try { db.exec('ROLLBACK') } catch { /* 忽略 */ }
  throw e
}

// 事件标题/摘要来自条目，也要一起清洗
const eventRows = db.prepare('SELECT id, title, summary FROM events').all()
const updateEvent = db.prepare('UPDATE events SET title = ?, summary = ? WHERE id = ?')
let eventsChanged = 0
db.exec('BEGIN')
try {
  for (const row of eventRows) {
    const title = clean(row.title, 220)
    const summary = clean(row.summary, 1000)
    if (title === row.title && summary === row.summary) continue
    eventsChanged += 1
    if (!dryRun) updateEvent.run(title, summary, row.id)
  }
  if (dryRun) db.exec('ROLLBACK')
  else db.exec('COMMIT')
} catch (e) {
  try { db.exec('ROLLBACK') } catch { /* 忽略 */ }
  throw e
}

process.stdout.write(`${dryRun ? '[dry-run] ' : ''}条目清洗 ${changed} / ${rows.length}，事件清洗 ${eventsChanged} / ${eventRows.length}\n`)