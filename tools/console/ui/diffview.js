/**
 * diff 渲染：按 hunk 分块着色，并在每块上挂「暂存此块 / 取消暂存此块」。
 *
 * 分块数据由服务端解析（shared/hunk-patch.mjs），前端只负责画与派发动作，
 * 避免在浏览器里再实现一套 hunk 边界解析。
 */
import { $ } from './core.js'

const MAX_LINES = 4000

function el(tag, cls, text) {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

function lineClass(line) {
  if (line.startsWith('+++') || line.startsWith('---')) return 'meta'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file') || line.startsWith('rename ')) return 'meta'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'ctx'
}

function diffLine(line) {
  return el('div', `dl ${lineClass(line)}`, line === '' ? ' ' : line)
}

/** 单个 hunk 的工具条：边界标签 + 增删统计 + 分块操作按钮 */
function hunkBar(hunk, data, onHunk) {
  const bar = el('div', 'hunk-bar')
  bar.append(el('span', 'hunk-label', hunk.header.trim()))

  const stat = el('span', 'hunk-stat')
  if (hunk.additions) stat.append(el('span', 'plus', `+${hunk.additions}`))
  if (hunk.deletions) stat.append(el('span', 'minus', `-${hunk.deletions}`))
  bar.append(stat)

  const btn = el('button', 'btn small ghost', data.staged ? '取消暂存此块' : '暂存此块')
  const blocked = !data.hunksUsable || typeof onHunk !== 'function'
  btn.disabled = blocked
  if (blocked) {
    btn.title = data.untracked
      ? '未跟踪文件整份都是新增，直接勾选文件即可暂存'
      : '该差异不支持分块操作（二进制、多文件或超出展示上限）'
  } else {
    btn.title = `只操作这一块，其余块不受影响（hunk #${hunk.index}）`
  }
  btn.addEventListener('click', () => onHunk([hunk.index], Boolean(data.staged)))
  bar.append(btn)
  return bar
}

export function renderDiff(data, opts = {}) {
  const title = $('#diff-title')
  const view = $('#diff-view')
  view.innerHTML = ''

  const flag = data.staged ? '已暂存' : '工作区'
  title.textContent = `${data.path}  ·  ${flag}${data.untracked ? '  ·  新文件' : ''}`

  if (!data.text || !data.text.trim()) {
    view.append(el('div', 'diff-empty', '该文件没有可显示的文本差异（可能是二进制或内容相同）。'))
    return
  }

  const frag = document.createDocumentFragment()
  let budget = MAX_LINES
  const structured = Array.isArray(data.hunks) && data.hunks.length > 0 && Array.isArray(data.header)

  const pushLines = (lines, wrap) => {
    for (const line of lines) {
      if (budget <= 0) return
      budget--
      wrap.append(diffLine(line))
    }
  }

  if (structured) {
    for (const line of data.header) {
      if (budget <= 0) break
      budget--
      frag.append(diffLine(line))
    }
    for (const hunk of data.hunks) {
      frag.append(hunkBar(hunk, data, opts.onHunk))
      const body = el('div', 'hunk-body')
      pushLines(hunk.lines, body)
      frag.append(body)
    }
  } else {
    pushLines(data.text.split('\n'), frag)
  }

  if (budget <= 0 || data.truncated) {
    frag.append(el('div', 'dl meta', '… 差异过大，已截断展示（可缩小改动范围后重试）'))
  }
  view.append(frag)
  view.scrollTop = 0
}

export function clearDiff(message = '选择左侧文件查看 diff') {
  $('#diff-title').textContent = message
  const view = $('#diff-view')
  view.innerHTML = ''
  view.append(el('div', 'diff-empty', '支持按 hunk 逐块暂存 / 取消暂存；未跟踪文件按新增文件展示。'))
}