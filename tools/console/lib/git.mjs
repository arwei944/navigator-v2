/**
 * Git 封装：直接调用 git CLI（零新增依赖）。
 * 结构化查询用 execFile 取输出；长任务（push / publish）交给 jobs.mjs 的 spawn 接管。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.mjs'

const pExecFile = promisify(execFile)
const MAX_DIFF_BYTES = 256 * 1024
const MAX_UNTRACKED_BYTES = 512 * 1024

export class GitError extends Error {
  constructor(message) {
    super(message || 'git 命令执行失败')
    this.name = 'GitError'
  }
}

async function git(args, { allowNonZero = false } = {}) {
  try {
    const { stdout } = await pExecFile('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    })
    return stdout
  } catch (e) {
    if (allowNonZero) return e.stdout || ''
    const raw = String(e.stderr || e.stdout || e.message || '').trim()
    throw new GitError(raw.split('\n').slice(0, 8).join('\n'))
  }
}

/** 拒绝绝对路径与目录穿越，避免通过 path 参数越出仓库 */
export function assertSafePath(p) {
  if (!p || typeof p !== 'string') throw new GitError('非法文件路径')
  if (p.includes('\0')) throw new GitError('非法文件路径')
  const norm = p.replace(/\\/g, '/')
  if (norm.startsWith('/') || /^[a-zA-Z]:/.test(norm)) throw new GitError(`不允许绝对路径：${p}`)
  if (norm.split('/').some(seg => seg === '..')) throw new GitError(`不允许目录穿越：${p}`)
  return p
}

function normalizePaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) throw new GitError('未指定文件')
  const list = paths.map(p => assertSafePath(String(p).trim())).filter(Boolean)
  if (list.length === 0) throw new GitError('未指定文件')
  return [...new Set(list)]
}

const XY = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', T: 'typechange', U: 'unmerged' }
const decode = ch => (ch === '.' || !ch ? null : XY[ch] || 'unknown')

async function numstat(extra) {
  const out = await git(['diff', '--numstat', '-z', ...extra])
  const map = new Map()
  const toks = out.split('\0')
  for (let i = 0; i < toks.length; i++) {
    const m = toks[i].match(/^(\d+|-)\t(\d+|-)\t(.*)$/)
    if (!m) continue
    let path = m[3]
    if (path === '') path = toks[i + 2] || '' // 重命名：紧随 old、new 两个 token
    map.set(path, { added: m[1] === '-' ? null : Number(m[1]), deleted: m[2] === '-' ? null : Number(m[2]) })
  }
  return map
}

function countUntrackedLines(relPath) {
  const abs = join(ROOT, relPath)
  try {
    if (statSync(abs).size > MAX_UNTRACKED_BYTES) return 0
    const text = readFileSync(abs, 'utf-8')
    if (text.includes('\0')) return 0
    return text.split(/\r?\n/).filter(l => l !== '').length
  } catch {
    return 0
  }
}

/** 工作区状态：分支 / 领先落后 / 文件列表（含增删行数） */
export async function getStatus() {
  const out = await git(['status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z'])
  const toks = out.split('\0').filter(t => t !== '')
  const info = { branch: '', upstream: '', ahead: 0, behind: 0, detached: false, files: [] }

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.startsWith('# branch.head ')) {
      const head = t.slice('# branch.head '.length)
      info.detached = head === '(detached)'
      info.branch = info.detached ? '' : head
    } else if (t.startsWith('# branch.upstream ')) {
      info.upstream = t.slice('# branch.upstream '.length)
    } else if (t.startsWith('# branch.ab ')) {
      const m = t.match(/\+(\d+) -(\d+)/)
      if (m) { info.ahead = Number(m[1]); info.behind = Number(m[2]) }
    } else if (t.startsWith('1 ')) {
      const p = t.slice(2).split(' ')
      info.files.push({ path: p.slice(7).join(' '), index: decode(p[0][0]), worktree: decode(p[0][1]), untracked: false, renamedFrom: null })
    } else if (t.startsWith('2 ')) {
      const p = t.slice(2).split(' ')
      const from = toks[++i] || null
      info.files.push({ path: p.slice(8).join(' '), index: decode(p[0][0]), worktree: decode(p[0][1]), untracked: false, renamedFrom: from })
    } else if (t.startsWith('? ')) {
      info.files.push({ path: t.slice(2), index: null, worktree: 'untracked', untracked: true, renamedFrom: null })
    }
  }

  const [unstaged, staged] = await Promise.all([numstat(['--']), numstat(['--cached', '--'])])
  for (const f of info.files) {
    const un = unstaged.get(f.path) || unstaged.get(f.renamedFrom) || {}
    const st = staged.get(f.path) || staged.get(f.renamedFrom) || {}
    f.staged = f.index !== null
    f.added = f.untracked ? countUntrackedLines(f.path) : (st.added || 0) + (un.added || 0)
    f.deleted = f.untracked ? 0 : (st.deleted || 0) + (un.deleted || 0)
  }
  info.files.sort((a, b) => a.path.localeCompare(b.path))
  info.counts = {
    total: info.files.length,
    staged: info.files.filter(f => f.staged).length,
    unstaged: info.files.filter(f => !f.staged).length,
    untracked: info.files.filter(f => f.untracked).length,
    added: info.files.reduce((n, f) => n + (f.added || 0), 0),
    deleted: info.files.reduce((n, f) => n + (f.deleted || 0), 0),
  }
  return info
}

function truncate(text) {
  if (text.length <= MAX_DIFF_BYTES) return { text, truncated: false }
  return { text: text.slice(0, MAX_DIFF_BYTES), truncated: true }
}

function buildUntrackedDiff(relPath) {
  const abs = join(ROOT, relPath)
  let size = 0
  try { size = statSync(abs).size } catch { return { text: '', truncated: false } }
  if (size > MAX_UNTRACKED_BYTES) {
    return { text: `（未跟踪文件 ${(size / 1024).toFixed(1)} KB，超出展示上限，未生成 diff）`, truncated: true }
  }
  const raw = readFileSync(abs, 'utf-8')
  if (raw.includes('\0')) return { text: `Binary file ${relPath} (${size} bytes, untracked)`, truncated: false }
  const lines = raw.split(/\r?\n/)
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  const body = [
    `diff --git a/${relPath} b/${relPath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${relPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map(l => '+' + l),
  ].join('\n')
  return truncate(body + '\n')
}

/** 单文件 diff：已跟踪走 git diff，未跟踪按新增文件构造 */
export async function getDiff(relPath, staged = false) {
  assertSafePath(relPath)
  const args = ['diff', '--no-color', '--patch', '--find-renames']
  if (staged) args.push('--cached')
  args.push('--', relPath)
  const text = await git(args)
  if (text.trim()) return { path: relPath, staged, untracked: false, ...truncate(text) }

  const abs = join(ROOT, relPath)
  let tracked = true
  try { statSync(abs) } catch { tracked = false }
  if (!tracked) return { path: relPath, staged, untracked: false, text: '', truncated: false }
  return { path: relPath, staged, untracked: true, ...buildUntrackedDiff(relPath) }
}

export async function stagePaths(paths) {
  const list = normalizePaths(paths)
  await git(['add', '--', ...list])
  return list
}

async function hasHead() {
  const out = await git(['rev-parse', '--verify', 'HEAD'], { allowNonZero: true })
  return out.trim() !== ''
}

export async function unstagePaths(paths) {
  const list = normalizePaths(paths)
  if (await hasHead()) await git(['reset', '-q', 'HEAD', '--', ...list])
  else await git(['rm', '--cached', '-r', '--force', '--', ...list])
  return list
}

/** 提交：指定 paths 时只提交这些文件（git commit -- <paths>） */
export async function commit(message, paths) {
  const msg = String(message || '').trim()
  if (!msg) throw new GitError('提交消息不能为空')
  const args = ['commit', '-m', msg]
  if (Array.isArray(paths) && paths.length > 0) args.push('--', ...normalizePaths(paths))
  const out = await git(args)
  const sha = (await git(['rev-parse', '--short', 'HEAD'])).trim()
  return { sha, output: out.trim() }
}

/** 读取 HEAD 版本的文件内容（用于与工作区做结构化对比） */
export async function showFileAtHead(relPath) {
  assertSafePath(relPath)
  const out = await git(['show', `HEAD:${relPath}`], { allowNonZero: true })
  return out || null
}

export async function getRemoteUrl() {
  const out = await git(['remote', 'get-url', 'origin'], { allowNonZero: true })
  return out.trim()
}