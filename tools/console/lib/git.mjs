/**
 * Git 封装：直接调用 git CLI（零新增依赖）。
 * 结构化查询用 execFile 取输出；长任务（push / publish）交给 jobs.mjs 的 spawn 接管。
 */
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.mjs'
import { assertIndexesInRange, buildSubsetPatch, hunkStats, splitHunks } from '../../../shared/hunk-patch.mjs'

const pExecFile = promisify(execFile)
const MAX_DIFF_BYTES = 256 * 1024
const MAX_UNTRACKED_BYTES = 512 * 1024

export class GitError extends Error {
  constructor(message) {
    super(message || 'git 命令执行失败')
    this.name = 'GitError'
  }
}

async function git(args, { allowNonZero = false, cwd = ROOT } = {}) {
  try {
    const { stdout } = await pExecFile('git', args, {
      cwd,
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

function diffArgs(relPath, staged) {
  const args = ['diff', '--no-color', '--patch', '--find-renames']
  if (staged) args.push('--cached')
  args.push('--', relPath)
  return args
}

/** 把解析结果附到 diff 上：UI 靠 hunks 渲染逐块操作，纯文本调用方继续读 text */
function withHunks(relPath, staged, raw, truncated) {
  const parsed = splitHunks(raw)
  // 截断后的文本无法切出完整 hunk，二进制/多文件差异也不能做子集补丁
  const usable = !truncated && !parsed.binary && !parsed.multiFile && parsed.hunks.length > 0
  return {
    path: relPath,
    staged,
    untracked: false,
    header: parsed.header,
    hunks: parsed.hunks.map(h => ({ ...h, ...hunkStats(h) })),
    hunksUsable: usable,
    binary: parsed.binary,
    multiFile: parsed.multiFile,
  }
}

/** 单文件 diff：已跟踪走 git diff，未跟踪按新增文件构造 */
export async function getDiff(relPath, staged = false) {
  assertSafePath(relPath)
  const raw = await git(diffArgs(relPath, staged))
  if (raw.trim()) {
    const t = truncate(raw)
    return { ...withHunks(relPath, staged, raw, t.truncated), text: t.text, truncated: t.truncated }
  }

  const abs = join(ROOT, relPath)
  let tracked = true
  try { statSync(abs) } catch { tracked = false }
  const empty = { path: relPath, staged, untracked: false, text: '', truncated: false, header: [], hunks: [], hunksUsable: false, binary: false, multiFile: false }
  if (!tracked) return empty
  // 未跟踪文件整份都是新增，没有「部分暂存」的语义，因此不提供 hunk 操作
  return { ...empty, untracked: true, ...buildUntrackedDiff(relPath) }
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

/* ---------------- hunk 级暂存 / 取消暂存 ---------------- */

/** 把补丁经 stdin 喂给 git apply：execFile 没有 input 选项，这里用 spawn 直接写管道 */
function gitApply(args, patch, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    const p = spawn('git', args, { cwd, windowsHide: true })
    let out = ''
    let err = ''
    p.stdout.on('data', d => { out += d })
    p.stderr.on('data', d => { err += d })
    p.on('error', e => reject(new GitError(e.message)))
    p.on('close', code => {
      if (code === 0) { resolve(out); return }
      const msg = String(err || out).trim().split('\n').slice(0, 8).join('\n')
      reject(new GitError(msg || `git ${args.join(' ')} 退出码 ${code}`))
    })
    p.stdin.end(patch, 'utf-8')
  })
}

/** 索引中该文件的 blob（mode + sha），用于失败兜底回退 */
async function indexEntry(relPath, cwd = ROOT) {
  const out = await git(['ls-files', '-s', '--', relPath], { allowNonZero: true, cwd })
  const line = out.split('\n').find(Boolean)
  if (!line) return null
  const m = line.match(/^(\d+)\s+([0-9a-f]+)\s+\d+\t/)
  return m ? { mode: m[1], sha: m[2] } : null
}

/**
 * hunk 级暂存 / 取消暂存。
 *
 * 两侧语义：`staged:false` 取「索引 → 工作区」差异，补丁正向应用即把选中块搬进索引；
 * `staged:true` 取「HEAD → 索引」差异，补丁反向应用即把选中块退回工作区。
 * 两个方向都只动索引（`--cached`），工作区文件本身不被改写。
 *
 * `cwd` 仅用于测试时指向临时仓库，默认即项目根。
 */
export async function applyHunks(relPath, indexes, { staged = false, cwd = ROOT } = {}) {
  assertSafePath(relPath)
  const list = Array.isArray(indexes) ? indexes.map(Number) : []
  if (list.length === 0) throw new GitError('未指定 hunk 序号')

  const raw = await git(diffArgs(relPath, staged), { cwd })
  if (!raw.trim()) {
    throw new GitError(staged ? `没有已暂存差异可取消：${relPath}` : `没有未暂存差异可暂存：${relPath}`)
  }
  const parsed = splitHunks(raw)
  if (parsed.multiFile) throw new GitError(`多文件差异不支持 hunk 级操作：${relPath}`)
  if (parsed.binary) throw new GitError(`二进制文件不支持 hunk 级操作：${relPath}`)
  const range = assertIndexesInRange(list, parsed.hunks.length)
  if (!range.ok) throw new GitError(range.error)

  const patch = buildSubsetPatch(parsed, list)
  const before = await indexEntry(relPath, cwd)
  const args = ['apply', '--cached']
  if (staged) args.push('--reverse')

  try {
    await gitApply(args, patch, cwd)
  } catch (e) {
    // git apply 先全量校验再落盘，正常失败不会留下脏索引；这里仍比对 blob 兜底，
    // 把任何意外半应用收敛回操作前状态（不用 git restore --staged，避免误伤已暂存的其它块）。
    const after = await indexEntry(relPath, cwd)
    const drifted = (after?.sha || null) !== (before?.sha || null)
    if (drifted && before) await git(['update-index', '--cacheinfo', `${before.mode},${before.sha},${relPath}`], { cwd })
    throw new GitError(`补丁应用失败：${e.message}${drifted && before ? '（索引已回退到操作前状态）' : ''}`)
  }

  const [unstaged, stagedText] = await Promise.all([
    git(diffArgs(relPath, false), { cwd }),
    git(diffArgs(relPath, true), { cwd }),
  ])
  return {
    path: relPath,
    mode: staged ? 'unstage' : 'stage',
    applied: list,
    total: parsed.hunks.length,
    remaining: splitHunks(staged ? stagedText : unstaged).hunks.length,
  }
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

/** 最近一次提交的概要信息（供同步面板展示本地版本锚点） */
export async function headCommit() {
  const out = await git(['log', '-1', '--pretty=%H%x1f%h%x1f%s%x1f%cI'], { allowNonZero: true })
  const line = out.trim()
  if (!line) return null
  const [sha, short, subject, date] = line.split('\x1f')
  return { sha, short, subject, date }
}

/** 提交历史（供历史面板） */
export async function getLog(limit = 20) {
  const out = await git(['log', `-${limit}`, '--pretty=%H%x1f%h%x1f%an%x1f%cI%x1f%s'], { allowNonZero: true })
  return out.trim().split('\n').filter(Boolean).map(line => {
    const [sha, short, author, date, subject] = line.split('\x1f')
    return { sha, short, author, date, subject }
  })
}

/** 远端已有提交的 SHA 集合（用于标注「已推送 / 仅本地」） */
export async function remoteShas(upstream, limit = 300) {
  if (!upstream) return new Set()
  const out = await git(['log', `-${limit}`, upstream, '--pretty=%H'], { allowNonZero: true })
  return new Set(out.trim().split('\n').filter(Boolean))
}

/** 待推送的本地提交（upstream..HEAD）：发布预检要展示「推上去的是哪些提交」 */
export async function pendingCommits(limit = 20) {
  const st = await getStatus()
  if (!st.upstream) {
    // 无上游时「待推送」等于本地全部提交，取最近 limit 条即可
    return getLog(limit)
  }
  const out = await git(['log', `${st.upstream}..HEAD`, `-${limit}`, '--pretty=%H%x1f%h%x1f%an%x1f%cI%x1f%s'], { allowNonZero: true })
  return out.trim().split('\n').filter(Boolean).map(line => {
    const [sha, short, author, date, subject] = line.split('\x1f')
    return { sha, short, author, date, subject }
  })
}

export async function getRemoteUrl() {
  const out = await git(['remote', 'get-url', 'origin'], { allowNonZero: true })
  return out.trim()
}