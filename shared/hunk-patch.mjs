/**
 * 统一 diff 的 hunk 边界解析与子集补丁生成（纯函数，无 IO、无依赖）。
 *
 * 只解决一件事：把 `git diff` 的输出切成「文件头 + 若干 hunk」，再按选中序号
 * 拼回一个合法补丁，交给 `git apply --cached` 应用。这与 lazygit / `git add -p`
 * 的做法一致 —— 不需要行级选择，因此不引 jsdiff 之类的完整补丁库。
 *
 * 之所以单独成模块：控制台、CLI、MCP 三处都要用，且它可以用纯文本夹具单测，
 * 不必真的建仓库。
 */

/** `@@ -oldStart,oldLines +newStart,newLines @@ section`；行数省略时按 1 计 */
const HUNK_HEAD = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/

/**
 * 切分单文件 diff。
 * - `header`：第一个 hunk 之前的全部行（diff --git / index / --- / +++ / mode / rename 等）
 * - `hunks`：每个 hunk 的头行 + 内容行，`index` 即调用方要传回的序号
 * - `multiFile`：出现多个 `diff --git` 时为 true —— 子集补丁只对单文件安全，调用方应拒绝
 * - `binary`：二进制差异无法按 hunk 切分，调用方应拒绝
 */
export function splitHunks(diffText) {
  const text = String(diffText ?? '')
  if (!text) return { header: [], hunks: [], multiFile: false, binary: false }

  // 保留 split 产生的尾部空串，它承载「原文本以换行结尾」这一信息，拼回时才能原样还原
  const lines = text.split('\n')
  const header = []
  const hunks = []
  let multiFile = false
  let binary = false
  let fileSections = 0
  let cur = null

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      fileSections++
      if (fileSections > 1) multiFile = true
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) binary = true

    const m = HUNK_HEAD.exec(line)
    if (m) {
      cur = {
        index: hunks.length,
        header: line,
        oldStart: Number(m[1]),
        oldLines: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newLines: m[4] === undefined ? 1 : Number(m[4]),
        section: m[5] || '',
        lines: [],
      }
      hunks.push(cur)
      continue
    }
    if (cur) cur.lines.push(line)
    else header.push(line)
  }

  return { header, hunks, multiFile, binary }
}

/** 单个 hunk 的增删行数（`+++` / `---` 只会出现在文件头，不会落进 hunk 内容） */
export function hunkStats(hunk) {
  let additions = 0
  let deletions = 0
  for (const line of hunk?.lines || []) {
    if (line.startsWith('+')) additions++
    else if (line.startsWith('-')) deletions++
  }
  return { additions, deletions, changed: additions + deletions }
}

/** hunk 的显示标签，如 `@@ -12,7 +12,9 @@` */
export function hunkLabel(hunk) {
  return hunk?.header?.split('@@').slice(0, 3).join('@@').trim() || ''
}

/** 只保留变更行（用于列表里的折叠预览，上下文行不展示） */
export function hunkPreview(hunk, limit = 8) {
  const changed = (hunk?.lines || []).filter(l => l.startsWith('+') || l.startsWith('-'))
  const shown = changed.slice(0, limit)
  return { lines: shown, more: Math.max(0, changed.length - shown.length), total: changed.length }
}

/**
 * 按选中序号拼子集补丁。
 * hunk 头里的行号保持原样：`git apply` 逐个 hunk 用上下文定位，未选中的 hunk
 * 被省略不会影响其余 hunk 的定位，这正是 `git add -p` 的行为。
 */
export function buildSubsetPatch(parsed, indexes) {
  const set = new Set((indexes || []).map(Number))
  const parts = [...(parsed?.header || [])]
  for (const h of parsed?.hunks || []) {
    if (!set.has(h.index)) continue
    parts.push(h.header, ...h.lines)
  }
  const patch = parts.join('\n')
  // 选中的 hunk 不是最后一个时，尾部空串不在其中，需补齐结尾换行
  return patch.endsWith('\n') ? patch : patch + '\n'
}

/** 解析逗号分隔的 hunk 序号；重复项去重并升序，便于稳定输出 */
export function parseHunkIndexes(raw) {
  const list = String(raw ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s !== '')
    .map(Number)
  if (list.some(n => !Number.isInteger(n) || n < 0)) {
    return { ok: false, error: `hunk 序号必须是非负整数：${raw}` }
  }
  const unique = [...new Set(list)].sort((a, b) => a - b)
  if (unique.length === 0) return { ok: false, error: '未指定 hunk 序号' }
  return { ok: true, indexes: unique }
}

/** 校验序号是否落在 hunk 数量范围内 */
export function assertIndexesInRange(indexes, total) {
  const bad = (indexes || []).filter(i => i < 0 || i >= total)
  if (bad.length) return { ok: false, error: `hunk 序号越界：${bad.join('、')}（该文件共 ${total} 个 hunk）` }
  return { ok: true }
}