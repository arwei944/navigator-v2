/**
 * doc-manager 公共工具：目录遍历、Markdown 解析、文档分类与状态推断。
 *
 * 设计原则：
 *   - **纯函数优先** —— 解析 / 分类 / 归一化都是纯的，便于 `test-doc-manager.mjs` 直接覆盖；
 *   - **副作用集中** —— 唯一的文件系统读取入口是 `walkFiles`，其余模块只消费它的产物；
 *   - **零第三方依赖** —— 只吃 node 内置模块，跑在任何环境下都不需要先装东西。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 任何层级命中即跳过（构建产物 / 依赖 / VCS 内部目录） */
export const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', '.vite', 'coverage',
  '.claude', '.newmax', '.pnpm-store', '.turbo', '.cache',
])

/** 视为文档的扩展名 */
export const DOC_EXT = new Set(['.md', '.markdown'])

/**
 * 递归遍历目录下的文件绝对路径。
 *   - 不跟随符号链接（防环）
 *   - 目录不可读时静默跳过（一个坏目录不应中断整轮扫描）
 */
export function* walkFiles(root, { skipDirs = SKIP_DIRS } = {}) {
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (skipDirs.has(e.name)) continue
        stack.push(full)
      } else if (e.isFile()) {
        yield full
      }
    }
  }
}

/** 解析文首的 `--- ... ---` frontmatter（极简 YAML：`key: value` 与 `- 列表项`） */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!m) return { data: {}, body: text }
  const data = {}
  let key = null
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('- ') && key) {
      if (!Array.isArray(data[key])) data[key] = []
      data[key].push(line.slice(2).trim())
      continue
    }
    const i = line.indexOf(':')
    if (i < 0) continue
    key = line.slice(0, i).trim()
    data[key] = line.slice(i + 1).trim()
  }
  return { data, body: text.slice(m[0].length) }
}

/** 取第一个标题（# ~ ###### 皆可），去掉尾部 # 号 */
export function firstHeading(text) {
  const m = /^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(text)
  return m ? m[1].trim() : ''
}

/** 全部标题（用于重复标题 / 结构检测） */
export function allHeadings(text) {
  const out = []
  const re = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm
  let m
  while ((m = re.exec(text))) out.push({ level: m[1].length, text: m[2].trim() })
  return out
}

/** 抓 Markdown 行内链接的目标（排除图片 `![...]()`） */
export function extractLinks(text) {
  const out = []
  const re = /(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  let m
  while ((m = re.exec(text))) out.push(m[1])
  return out
}

/**
 * 把文档里的链接归一为「相对工作区根」的路径。
 * 外链（http: / mailto: / 协议相对）与锚点返回 null；越出工作区根的也丢弃。
 */
export function resolveDocLink(fromRel, target) {
  if (!target) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null
  if (target.startsWith('//') || target.startsWith('#')) return null
  const clean = target.split('#')[0].split('?')[0]
  if (!clean) return null
  const fromDir = path.posix.dirname(fromRel)
  const joined = path.posix.normalize(path.posix.join(fromDir, clean))
  return joined.startsWith('..') ? null : joined
}

/** 按路径 / 文件名归类文档（台账分组用） */
export function classify(rel) {
  const p = rel.replace(/\\/g, '/').toLowerCase()
  const base = p.split('/').pop()
  if (base === 'readme.md') return 'readme'
  if (base === 'project.md') return 'project'
  if (p.includes('/memory/')) return 'memory'
  if (p.includes('/outputs/')) return 'report'
  if (p.includes('/references/')) return 'reference'
  if (p.includes('docs/audit/')) return 'audit'
  if (p.includes('/specs/')) return 'spec'
  if (p.includes('/plans/')) return 'plan'
  if (p.includes('/sdd/')) return 'sdd'
  if (p.includes('/archive/') || p.includes('/archived/')) return 'archive'
  if (/upgrade-plan|roadmap/.test(base)) return 'plan'
  if (/-design\.md$|design-/.test(base)) return 'design'
  if (/handover/.test(base)) return 'handover'
  return 'other'
}

/** 推断文档状态：frontmatter.status 优先，其次目录约定（archive/ → archived） */
export function inferStatus(rel, frontmatter = {}) {
  const s = String(frontmatter.status || '').trim().toLowerCase()
  if (s) return s
  const p = rel.replace(/\\/g, '/').toLowerCase()
  if (p.includes('/archive/') || p.includes('/archived/')) return 'archived'
  return 'active'
}

/**
 * 「知识型文档」—— 这类文档的价值在于被人/被别的文档引用，**孤立才值得报警**。
 *
 * 过程产物（任务简报 `sdd`、记忆 `memory`、产出报告 `report`、参考 `reference`）天然由
 * 任务系统 / 时间线组织，不靠文档互链。把它们算作「孤立」只会刷屏（实测 84/87 条噪声）。
 */
export const KNOWLEDGE_KINDS = new Set(['plan', 'spec', 'audit', 'design', 'other'])
