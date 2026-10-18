/**
 * 扫描 nav-v2 工作区的文档，抽取结构化元信息。
 *
 * 这是台账 / 巡检 / 生命周期 / 图谱四个子命令的**共同数据源** —— 上游只此一处读盘，
 * 下游全部消费同一份 `docs[]`，避免「四套扫描口径各说各话」。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  walkFiles, DOC_EXT, parseFrontmatter, firstHeading, allHeadings,
  extractLinks, resolveDocLink, classify, inferStatus,
} from './util.mjs'

/** 默认纳入的子目录（工作区根级的 *.md 自动纳入，无需在此列出） */
export const DEFAULT_INCLUDE = ['docs', 'projects', '.superpowers', 'backups', 'tools']

/** 单个文档超过此大小只记录元信息、不解析正文（防超大文件拖垮整轮扫描） */
export const MAX_PARSE_BYTES = 512 * 1024

/**
 * @typedef {object} Doc
 * @property {string}   path       相对工作区根、正斜杠分隔
 * @property {string}   title      首个标题
 * @property {string}   kind       分类（plan/spec/audit/report/memory/readme/…）
 * @property {string}   status     推断状态（active/superseded/archived/…）
 * @property {number}   size       字节数
 * @property {string}   mtime      ISO 时间
 * @property {object}   frontmatter
 * @property {{level:number,text:string}[]} headings
 * @property {string[]} links      出链（相对工作区根、已归一）
 * @property {string|null} parseError
 */

/**
 * 扫描工作区，返回全部文档及其元信息。
 * @param {{root:string, include?:string[], maxParseBytes?:number}} opts
 * @returns {{root:string, scannedAt:string, docs:Doc[], stats:object}}
 */
export function scanWorkspace({ root, include = DEFAULT_INCLUDE, maxParseBytes = MAX_PARSE_BYTES } = {}) {
  if (!root) throw new Error('scanWorkspace 需要 root 参数')
  const absRoot = path.resolve(root)
  if (!fs.existsSync(absRoot)) throw new Error(`工作区根不存在：${absRoot}`)

  const fileSet = new Set()

  // 1) 工作区根级的文档（README.md / HANDOVER.md …）
  for (const e of fs.readdirSync(absRoot, { withFileTypes: true })) {
    if (e.isFile() && DOC_EXT.has(path.extname(e.name).toLowerCase())) {
      fileSet.add(path.join(absRoot, e.name))
    }
  }
  // 2) 指定子目录（递归）
  for (const name of include) {
    const dir = path.join(absRoot, name)
    if (!fs.existsSync(dir)) continue
    for (const f of walkFiles(dir)) {
      if (DOC_EXT.has(path.extname(f).toLowerCase())) fileSet.add(f)
    }
  }

  const docs = []
  for (const abs of fileSet) {
    const rel = path.relative(absRoot, abs).replace(/\\/g, '/')
    let stat
    try {
      stat = fs.statSync(abs)
    } catch {
      continue
    }

    /** @type {Doc} */
    const doc = {
      path: rel,
      title: '',
      kind: classify(rel),
      status: 'active',
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      frontmatter: {},
      headings: [],
      links: [],
      parseError: null,
    }

    if (stat.size <= maxParseBytes) {
      try {
        const text = fs.readFileSync(abs, 'utf-8')
        const { data, body } = parseFrontmatter(text)
        doc.frontmatter = data
        doc.title = firstHeading(body) || firstHeading(text)
        doc.headings = allHeadings(body)
        doc.links = [...new Set(extractLinks(body).map(t => resolveDocLink(rel, t)).filter(Boolean))]
      } catch (e) {
        doc.parseError = String((e && e.message) || e)
      }
    } else {
      doc.parseError = `文件过大（>${Math.round(maxParseBytes / 1024)}KB），仅记录元信息`
    }

    doc.status = inferStatus(rel, doc.frontmatter)
    docs.push(doc)
  }

  docs.sort((a, b) => a.path.localeCompare(b.path))
  return { root: absRoot, scannedAt: new Date().toISOString(), docs, stats: computeStats(docs) }
}

/** 汇总统计（按类型 / 状态分组，最早与最新时间） */
export function computeStats(docs) {
  const byKind = {}
  const byStatus = {}
  let bytes = 0
  for (const d of docs) {
    byKind[d.kind] = (byKind[d.kind] || 0) + 1
    byStatus[d.status] = (byStatus[d.status] || 0) + 1
    bytes += d.size
  }
  const dates = docs.map(d => d.mtime).sort()
  return {
    total: docs.length,
    bytes,
    byKind,
    byStatus,
    oldest: dates[0] || null,
    newest: dates[dates.length - 1] || null,
  }
}
