/**
 * 体检与清运内核。
 *
 * 硬护栏（安全底线）：任何被 git 跟踪的路径一律不删 —— 即使它命中了白名单正则。
 * 这让「白名单写错」不会变成「资产被误删」，也让本工具可以放心地默认dry-run。
 */
import { readdirSync, statSync, existsSync, rmSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import { TARGETS } from './targets.mjs'

const posix = (p) => p.split(sep).join('/')

/** 递归求文件/目录的字节数与文件数 */
export function measure(p) {
  const st = statSync(p)
  if (!st.isDirectory()) return { bytes: st.size, files: 1 }
  let bytes = 0
  let files = 0
  for (const name of readdirSync(p)) {
    const r = measure(join(p, name))
    bytes += r.bytes
    files += r.files
  }
  return { bytes, files }
}

/** 一次拿到仓库跟踪文件集合（相对 posix 路径），避免逐个文件调 git */
export function gitTrackedSet(root) {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], {
      cwd: root,
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    })
    return new Set(out.split('\0').filter(Boolean))
  } catch {
    return new Set()
  }
}

/** 展开单个目标的命中条目 */
export function expandTarget(root, target) {
  const base = join(root, target.dir === '.' ? '' : target.dir)
  if (!existsSync(base)) return []
  const items = []
  for (const name of readdirSync(base)) {
    if (!target.re.test(name)) continue
    const abs = join(base, name)
    const st = statSync(abs)
    if (target.kind === 'dir' && !st.isDirectory()) continue
    if (target.kind === 'file' && !st.isFile()) continue
    items.push({
      abs,
      rel: posix(relative(root, abs)),
      kind: st.isDirectory() ? 'dir' : 'file',
      ...measure(abs),
    })
  }
  return items
}

/**
 * 带保留策略的目标展开：re 匹配的是「容器目录」，真正的条目在容器内部。
 * 用于 backups 这类「不能整体删、但应保留最近 N 份」的数据仓。
 */
export function parseSnapshotTime(name) {
  const m = name.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/)
  if (!m) return 0
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
}

function expandRetainTarget(root, target) {
  const base = join(root, target.dir === '.' ? '' : target.dir)
  if (!existsSync(base)) return []
  let container = null
  for (const name of readdirSync(base)) {
    if (target.re.test(name)) {
      container = join(base, name)
      break
    }
  }
  if (!container || !statSync(container).isDirectory()) return []
  const items = []
  for (const name of readdirSync(container)) {
    const abs = join(container, name)
    if (!statSync(abs).isFile()) continue
    items.push({ abs, rel: posix(relative(root, abs)), kind: 'file', ...measure(abs) })
  }
  return items
}

/** 扫描全部目标：区分「命中」「可清运（未跟踪）」「受保护（已跟踪）」 */
export function scanAll(root) {
  const tracked = gitTrackedSet(root)
  return TARGETS.map((t) => {
    const items = t.retain ? expandRetainTarget(root, t) : expandTarget(root, t)
    // 保留策略：按快照时间（优先文件名时间戳，回退 mtime）保留最新 N 份，其余为可清运候选
    let excess = []
    if (t.retain) {
      const ranked = [...items].sort((a, b) => {
        const ta = parseSnapshotTime(a.rel) || statSync(a.abs).mtimeMs
        const tb = parseSnapshotTime(b.rel) || statSync(b.abs).mtimeMs
        return tb - ta
      })
      excess = ranked.slice(t.retain)
    }
    const untracked = items.filter((i) => !tracked.has(i.rel))
    const cleanable = t.retain ? excess.filter((i) => !tracked.has(i.rel)) : untracked
    const trackedCount = items.length - untracked.length
    return {
      id: t.id,
      label: t.label,
      autoClean: t.autoClean,
      reason: t.reason,
      retain: t.retain || null,
      policy: t.retain ? `保留最近 ${t.retain} 份` : null,
      count: items.length,
      bytes: items.reduce((s, i) => s + i.bytes, 0),
      cleanableCount: cleanable.length,
      cleanableBytes: cleanable.reduce((s, i) => s + i.bytes, 0),
      trackedCount,
      items,
      excessItems: excess,
      excessCount: excess.length,
      excessBytes: excess.reduce((s, i) => s + i.bytes, 0),
    }
  })
}

/** 清运：默认演练（不删），apply=true 才真正删除；被 git 跟踪的永不删 */
export function clean(root, { apply = false, only = null } = {}) {
  const tracked = gitTrackedSet(root)
  const targets = scanAll(root).filter(
    (t) => (t.autoClean || t.retain) && (!only || only.includes(t.id)),
  )
  const plan = []
  for (const t of targets) {
    // 带保留策略的目标：只清「超出保留份数」的部分，绝不整体清空
    const candidates = t.retain ? t.excessItems : t.items
    for (const item of candidates) {
      if (tracked.has(item.rel)) continue // 硬护栏
      plan.push({ target: t.id, rel: item.rel, abs: item.abs, kind: item.kind, bytes: item.bytes })
    }
  }
  const result = {
    applied: false,
    targets: targets.map((t) => t.id),
    count: plan.length,
    bytes: plan.reduce((s, p) => s + p.bytes, 0),
    plan,
  }
  if (!apply) return result
  for (const p of plan) rmSync(p.abs, { recursive: true, force: true })
  result.applied = true
  return result
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}
