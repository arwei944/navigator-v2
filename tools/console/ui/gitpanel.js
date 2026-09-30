/** 改动面板 + 提交面板：文件列表 / diff / 暂存 / 提交 / 推送 */
import { $, api, openStream, appendLocal, isBusy } from './core.js'
import { renderDiff, clearDiff } from './diffview.js'

const state = { status: null, summary: null, selected: null }

const BADGE_KEY = { M: 'mod', A: 'add', D: 'del', R: 'ren', C: 'add', T: 'mod', '?': 'unt' }
// git 状态在服务端已解码为单词，徽标需要还原成单字母
const LETTER = {
  modified: 'M', added: 'A', deleted: 'D', renamed: 'R',
  copied: 'C', typechange: 'T', unmerged: 'U', untracked: '?', unknown: '?',
}

function el(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

function badgeCode(f, staged) {
  const raw = staged ? (f.index || 'M') : (f.untracked ? '?' : (f.worktree || f.index || 'M'))
  return LETTER[raw] || raw
}

function stagedPaths() {
  return (state.status?.files || []).filter(f => f.staged).map(f => f.path)
}

/**
 * 文件在两侧的归属。
 * 一个文件可能同时有「已暂存的块」和「工作区里的块」（部分暂存），此时两侧都要出现，
 * 否则分块暂存之后就没法再从列表进到工作区那一侧去看剩余差异。
 */
const onStagedSide = f => f.index !== null
const onWorktreeSide = f => f.index === null || f.worktree !== null

/* ---------- 渲染 ---------- */

function renderRepoInfo() {
  const st = state.status
  const box = $('#repo-info')
  box.innerHTML = ''
  if (!st) { box.append(el('span', 'dim', '读取中…')); return }
  box.append(el('span', 'chip', `分支 ${st.branch || '(detached)'}`))
  box.append(el('span', `chip ${st.ahead ? 'warn' : ''}`, `领先 ${st.ahead}`))
  box.append(el('span', `chip ${st.behind ? 'warn' : ''}`, `落后 ${st.behind}`))
  box.append(el('span', 'chip', `改动 ${st.counts.total}`))
  box.append(el('span', 'chip ok', `已暂存 ${st.counts.staged}`))
}

function groupByDir(files) {
  const map = new Map()
  for (const f of files) {
    const i = f.path.lastIndexOf('/')
    const dir = i === -1 ? '(根目录)' : f.path.slice(0, i)
    if (!map.has(dir)) map.set(dir, [])
    map.get(dir).push(f)
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

function fileRow(f, staged, onToggle) {
  const row = el('div', 'file-row')
  const sel = state.selected
  if (sel && sel.path === f.path && sel.staged === staged) row.classList.add('sel')

  const cb = el('input')
  cb.type = 'checkbox'
  cb.checked = staged
  cb.title = staged ? '取消暂存' : '暂存此文件'
  cb.addEventListener('click', e => e.stopPropagation())
  cb.addEventListener('change', () => onToggle(f, staged))

  const code = badgeCode(f, staged)
  const badge = el('span', `sbadge s-${BADGE_KEY[code] || 'mod'}`, code)

  const path = el('span', 'fpath', f.path)
  path.title = f.renamedFrom ? `${f.renamedFrom} → ${f.path}` : f.path

  const stat = el('span', 'fstat')
  if (f.added) stat.append(el('span', 'plus', `+${f.added}`))
  if (f.deleted) stat.append(el('span', 'minus', `-${f.deleted}`))

  row.append(cb, badge, path, stat)
  row.addEventListener('click', () => selectFile(f, staged))
  return row
}

function renderGroup(container, title, files, staged) {
  const head = el('div', 'group-head')
  head.append(el('span', 'group-title', `${title}（${files.length}）`))
  const all = el('button', 'link-btn', staged ? '全部取消' : '全部暂存')
  all.addEventListener('click', async () => {
    if (files.length === 0) return
    await api('/api/git/stage', { method: 'POST', body: { paths: files.map(f => f.path), stage: !staged } })
    await refresh()
  })
  head.append(all)
  container.append(head)

  if (files.length === 0) {
    container.append(el('div', 'list-empty', staged ? '暂无已暂存文件' : '工作区干净'))
    return
  }
  for (const [dir, list] of groupByDir(files)) {
    container.append(el('div', 'dir-head', dir))
    for (const f of list) container.append(fileRow(f, staged, onToggle))
  }
}

async function onToggle(f, staged) {
  await api('/api/git/stage', { method: 'POST', body: { paths: [f.path], stage: !staged } })
  await refresh()
}

function renderFiles() {
  const staged = $('#list-staged')
  const unstaged = $('#list-unstaged')
  const scroller = $('#file-scroll')
  const keepScroll = scroller.scrollTop
  staged.innerHTML = ''
  unstaged.innerHTML = ''
  const files = state.status?.files || []
  renderGroup(staged, '已暂存', files.filter(onStagedSide), true)
  renderGroup(unstaged, '未暂存 / 未跟踪', files.filter(onWorktreeSide), false)
  scroller.scrollTop = keepScroll
  renderStagedChips()
}

function renderStagedChips() {
  const box = $('#staged-chips')
  box.innerHTML = ''
  const files = (state.status?.files || []).filter(f => f.staged)
  if (files.length === 0) {
    box.append(el('span', 'dim', '尚无已暂存文件，请在「改动」面板勾选。'))
    return
  }
  for (const f of files) box.append(el('span', 'chip', f.path))
}

function renderSuggestion() {
  const box = $('#suggest-box')
  box.innerHTML = ''
  const s = state.summary?.sites
  const sug = state.summary?.suggestion

  if (s && s.changed) {
    const card = el('div', 'sites-summary')
    const d = s.diff
    card.append(el('div', 'ss-title', '站点数据变更摘要'))
    const line = el('div', 'ss-line')
    line.append(el('span', 'plus', `新增 ${d.added.length}`))
    line.append(el('span', 'minus', `删除 ${d.removed.length}`))
    line.append(el('span', 'warn', `修改 ${d.modified.length}`))
    line.append(el('span', 'dim', `总数 ${s.currentCount}（HEAD ${s.headCount}）`))
    card.append(line)
    if (d.added.length) card.append(el('div', 'ss-detail', `新增：${d.added.map(x => `${x.id} ${x.name}`).join('、')}`))
    if (d.removed.length) card.append(el('div', 'ss-detail', `删除：${d.removed.map(x => `${x.id} ${x.name}`).join('、')}`))
    if (d.modified.length) card.append(el('div', 'ss-detail', `修改：${d.modified.map(x => `${x.id}（${x.labels.join('/')}）`).join('、')}`))
    const it = s.integrity
    const warn = it.missingIcon.length || it.dupSortOrder.length
    card.append(el('div', `ss-detail ${warn ? 'warn' : 'ok'}`,
      `完整性：图标缺失 ${it.missingIcon.length} · sortOrder 重复 ${it.dupSortOrder.length} · 分类 ${it.categories}`))
    box.append(card)
  }

  if (!sug) {
    box.append(el('div', 'dim', '当前没有可提交的改动。'))
    return
  }
  const row = el('div', 'suggest-row')
  row.append(el('span', 'suggest-label', '建议提交消息'))
  const msg = el('code', 'suggest-msg', sug.message)
  row.append(msg)
  const use = el('button', 'btn small', '采用')
  use.addEventListener('click', () => { $('#commit-message').value = sug.message })
  row.append(use)
  box.append(row)
  if (sug.details?.length) {
    const ul = el('ul', 'suggest-details')
    for (const d of sug.details) ul.append(el('li', null, d))
    box.append(ul)
  }
}

/* ---------- 交互 ---------- */

async function openDiff(path, staged) {
  state.selected = { path, staged }
  renderFiles()
  $('#diff-pane').classList.add('loading')
  try {
    renderDiff(await api(`/api/git/diff?path=${encodeURIComponent(path)}&staged=${staged ? 1 : 0}`), { onHunk })
  } catch (e) {
    clearDiff(`读取 diff 失败：${e.message}`)
  } finally {
    $('#diff-pane').classList.remove('loading')
  }
}

function selectFile(f, staged) {
  return openDiff(f.path, staged)
}

/** 分块暂存 / 取消暂存：只搬选中的块，其余块留在原侧 */
async function onHunk(indexes, staged) {
  const sel = state.selected
  if (!sel) return
  try {
    const r = await api('/api/git/hunks', { method: 'POST', body: { path: sel.path, indexes, staged } })
    appendLocal(
      `${staged ? '取消暂存' : '暂存'} ${sel.path} 的 hunk ${r.applied.join('、')}（该侧剩余 ${r.remaining} 块）`,
      'success',
    )
  } catch (e) {
    appendLocal(`分块操作失败：${e.message}`, 'stderr')
    return
  }
  await refresh()
  await reopenSelected()
}

/** 操作后重新定位当前文件：原侧已无差异就自动翻到另一侧，两侧都干净则清空 */
async function reopenSelected() {
  const sel = state.selected
  if (!sel) return
  const f = (state.status?.files || []).find(x => x.path === sel.path)
  if (!f) {
    state.selected = null
    renderFiles()
    clearDiff()
    return
  }
  const sameSide = sel.staged ? onStagedSide(f) : onWorktreeSide(f)
  await openDiff(sel.path, sameSide ? sel.staged : !sel.staged)
}

async function doCommit({ push = false } = {}) {
  const message = $('#commit-message').value.trim()
  const paths = stagedPaths()
  const out = $('#commit-result')
  if (!message) { out.className = 'result err'; out.textContent = '请先填写提交消息。'; return }
  if (paths.length === 0) { out.className = 'result err'; out.textContent = '请先在「改动」面板暂存要提交的文件。'; return }

  $('#btn-commit').disabled = true
  $('#btn-commit-push').disabled = true
  out.className = 'result'
  out.textContent = '提交中…'
  try {
    const res = await api('/api/git/commit', { method: 'POST', body: { message, paths } })
    for (const line of res.output.split('\n')) appendLocal(line, 'stdout')
    appendLocal(`✅ 已提交 ${res.sha}：${message}`, 'success')
    out.className = 'result ok'
    out.textContent = `已提交 ${res.sha} · ${paths.length} 个文件`
    await refresh()
    if (push) await doPush()
  } catch (e) {
    appendLocal(`❌ 提交失败：${e.message}`, 'stderr')
    out.className = 'result err'
    out.textContent = `提交失败：${e.message}`
  } finally {
    $('#btn-commit').disabled = false
    $('#btn-commit-push').disabled = false
  }
}

async function doPush({ dryRun = false } = {}) {
  const out = $('#commit-result')
  if (isBusy()) { out.className = 'result err'; out.textContent = '已有任务在运行，请等待完成。'; return }
  try {
    const { jobId, branch } = await api('/api/git/push', { method: 'POST', body: { dryRun } })
    out.className = 'result'
    out.textContent = `${dryRun ? '预演' : '推送'}中 → origin/${branch}，实时日志见下方控制台。`
    openStream(jobId, `${dryRun ? '预演 ' : ''}git push → origin/${branch}`, async d => {
      if (dryRun) {
        out.className = d.status === 'success' ? 'result ok' : 'result err'
        out.textContent = d.status === 'success' ? '预演通过：远端可正常接收本次推送。' : `预演失败，退出码 ${d.code}`
        return
      }
      out.className = d.status === 'success' ? 'result ok' : 'result err'
      out.textContent = d.status === 'success' ? `推送成功（${(d.duration / 1000).toFixed(1)}s）` : `推送失败，退出码 ${d.code}`
      await refresh()
    })
  } catch (e) {
    out.className = 'result err'
    out.textContent = `无法推送：${e.message}`
  }
}

export async function refresh() {
  try {
    state.summary = await api('/api/changes/summary')
    state.status = state.summary.status
  } catch (e) {
    appendLocal(`读取仓库状态失败：${e.message}`, 'stderr')
    return
  }
  renderRepoInfo()
  renderFiles()
  renderSuggestion()
}

export function initGitPanel() {
  $('#btn-refresh-status').addEventListener('click', () => refresh())
  $('#btn-commit').addEventListener('click', () => doCommit())
  $('#btn-commit-push').addEventListener('click', () => doCommit({ push: true }))
  $('#btn-push-only').addEventListener('click', () => doPush())
  $('#btn-push-dry').addEventListener('click', () => doPush({ dryRun: true }))
  $('#commit-message').addEventListener('input', () => { $('#commit-result').textContent = '' })
  clearDiff()
  refresh()
}