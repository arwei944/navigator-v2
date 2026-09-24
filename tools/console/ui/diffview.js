/** diff 渲染：按行类型着色，限制最大渲染行数以保流畅 */
import { $ } from './core.js'

const MAX_LINES = 4000

function lineClass(line) {
  if (line.startsWith('+++') || line.startsWith('---')) return 'meta'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file') || line.startsWith('rename ')) return 'meta'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'ctx'
}

export function renderDiff(data) {
  const title = $('#diff-title')
  const view = $('#diff-view')
  view.innerHTML = ''

  const flag = data.staged ? '已暂存' : '工作区'
  title.textContent = `${data.path}  ·  ${flag}${data.untracked ? '  ·  新文件' : ''}`

  if (!data.text || !data.text.trim()) {
    const div = document.createElement('div')
    div.className = 'diff-empty'
    div.textContent = '该文件没有可显示的文本差异（可能是二进制或内容相同）。'
    view.append(div)
    return
  }

  const lines = data.text.split('\n')
  const shown = lines.slice(0, MAX_LINES)
  const frag = document.createDocumentFragment()
  for (const line of shown) {
    const div = document.createElement('div')
    div.className = `dl ${lineClass(line)}`
    div.textContent = line === '' ? ' ' : line
    frag.append(div)
  }
  if (lines.length > MAX_LINES || data.truncated) {
    const more = document.createElement('div')
    more.className = 'dl meta'
    more.textContent = `… 差异过大，已截断（共 ${lines.length} 行，仅显示前 ${MAX_LINES} 行）`
    frag.append(more)
  }
  view.append(frag)
  view.scrollTop = 0
}

export function clearDiff(message = '选择左侧文件查看 diff') {
  $('#diff-title').textContent = message
  const view = $('#diff-view')
  view.innerHTML = ''
  const div = document.createElement('div')
  div.className = 'diff-empty'
  div.textContent = '支持行级高亮；未跟踪文件按新增文件展示。'
  view.append(div)
}