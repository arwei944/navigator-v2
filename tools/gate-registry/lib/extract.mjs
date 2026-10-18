/**
 * 门禁信息提取：从 package.json 的 console:test:all 链与各脚本头注释里取事实。
 * 纯静态 —— 不执行任何门禁脚本（那要两分钟），保证 ledger 快速且无副作用。
 */
import { readFileSync } from 'node:fs'

/** 从 package.json 文本提取 console:test:all 里已收录的脚本相对路径（保持链路顺序） */
export function extractFromTestAll(pkgJsonText) {
  const pkg = JSON.parse(pkgJsonText)
  const chain = pkg.scripts['console:test:all'] || ''
  const out = []
  for (const seg of chain.split(' && ')) {
    const m = seg.match(/node\s+(?:--\S+\s+)*([^\s]+\.mjs)/)
    if (m) out.push(m[1])
  }
  return out
}

/**
 * 取脚本的一句话用途：头注释里第一个非空行；若形如 `名字 —— 说明`，取破折号后的说明。
 * 没有头注释时返回 null（由调用方标注）。
 */
export function purposeOf(file) {
  let text
  try {
    text = readFileSync(file, 'utf-8')
  } catch {
    return null
  }
  const m = text.match(/\/\*\*([\s\S]*?)\*\//)
  if (!m) return null
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.replace(/^\s*\*\s?/, '').trim()
    if (!line || line.startsWith('@')) continue
    const idx = line.indexOf('——')
    return idx >= 0 ? line.slice(idx + 2).trim() : line
  }
  return null
}

/** 脚本行数（作为「体量」的粗指标，不猜断言数——那会不准） */
export function linesOf(file) {
  try {
    return readFileSync(file, 'utf-8').split(/\r?\n/).length
  } catch {
    return 0
  }
}

/**
 * 门禁分类规则（名称 + 用途关键词 → 域）。首个命中即归类，末位兜底「未分类」。
 *
 * 为什么按「域」分：台账原本只能逐条看，答不了「哪个域的守卫最薄」。
 * 分类让「某域只有 1 道门禁」这类结构性缺口一眼可见。
 */
const CATEGORY_RULES = [
  ['搜索与交互', /search|intent|command|omni|preview/i],
  [
    '前端与体验',
    /frontend|a11y|mobile|contrast|bundle|ui|bgm|theme|chart|graph-layout|gridnav|panel|side-width|filter-chips|notes|undo|sw-refresh|visual|touch|gesture|format|safeStorage|share/i,
  ],
  ['部署与发布', /deploy|publish|release|botkeep|endpoint|manifest|schedule/i],
  ['安全与鉴权', /auth|security|netguard|session|secret|rate|token/i],
  ['文档治理', /doc|readme/i],
  ['工作区治理', /hygiene|workspace|script|gate|env|deps|registry|hunks|robust/i],
  [
    '数据与内容',
    /data|site|quality|desc|category|alias|seed|audit|translate|glossary|meta|auto-add|affinity|trust|url/i,
  ],
  [
    '服务端与运行时',
    /server|api|store|cron|health|mcp|v10|stack|offline|sync|engine|ops|uptime|poll|http|image|llm|probe|alert|admin|net/i,
  ],
]

export function categoryOf(name, purpose = '') {
  const text = `${name} ${purpose}`
  for (const [label, re] of CATEGORY_RULES) if (re.test(text)) return label
  return '未分类'
}
