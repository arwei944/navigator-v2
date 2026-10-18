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

/** 扫描全部目标：区分「命中」「可清运（未跟踪）」「受保护（已跟踪）」 */
export function scanAll(root) {
  const tracked = gitTrackedSet(root)
  return TARGETS.map((t) => {
    const items = expandTarget(root, t)
    const cleanable = items.filter((i) => !tracked.has(i.rel))
    const trackedCount = items.length - cleanable.length
    return {
      id: t.id,
      label: t.label,
      autoClean: t.autoClean,
      reason: t.reason,
      count: items.length,
      bytes: items.reduce((s, i) => s + i.bytes, 0),
      cleanableCount: cleanable.length,
      cleanableBytes: cleanable.reduce((s, i) => s + i.bytes, 0),
      trackedCount,
      items,
    }
  })
}

/** 清运：默认演练（不删），apply=true 才真正删除；被 git 跟踪的永不删 */
export function clean(root, { apply = false, only = null } = {}) {
  const tracked = gitTrackedSet(root)
  const targets = scanAll(root).filter((t) => t.autoClean && (!only || only.includes(t.id)))
  const plan = []
  for (const t of targets) {
    for (const item of t.items) {
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
