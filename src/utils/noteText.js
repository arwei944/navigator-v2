/**
 * 便利贴文本的极简解析：清单行 + 粗体 + 链接。
 *
 * ## 为什么不用 v-html
 *
 * 便签内容来自用户自己的输入，但会经过「云端会话同步」到别的设备 —— 一旦中间任何一个
 * 环节被污染（或被别人用同一把 key 写入），`v-html` 就是一个现成的 XSS 落点。
 * 所以这里只做**结构化解析**，模板按结构渲染元素，文本全程走 Vue 的文本插值。
 *
 * 链接只认 http/https：`javascript:` / `data:` 之类的协议不转链接，stay 文本。
 */

const BOLD = /\*\*([^*]+)\*\*/g
const URL_RE = /(https?:\/\/[^\s<>"']+)/g
const TAG_RE = /(^|\s)(#[^\s#]+)/g

/**
 * 把一行拆成可渲染的分段。
 * @returns {Array<{text: string, bold?: boolean, url?: string, tag?: boolean}>}
 */
export function inlineParts(line) {
  const src = String(line ?? '')
  const out = []
  // 先切粗体，再在每段里切 URL —— 两步避免「链接里的 * 被当成粗体标记」
  let last = 0
  for (const m of src.matchAll(BOLD)) {
    if (m.index > last) pushText(out, src.slice(last, m.index))
    pushText(out, m[1], { bold: true })
    last = m.index + m[0].length
  }
  if (last < src.length) pushText(out, src.slice(last))
  return out.length ? out : [{ text: src }]
}

function pushText(out, text, extra) {
  if (!text) return
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    if (m.index > last) pushTag(out, text.slice(last, m.index), extra)
    out.push({ text: m[0], url: m[0], ...(extra || {}) })
    last = m.index + m[0].length
  }
  if (last < text.length) pushTag(out, text.slice(last), extra)
}

function pushTag(out, text, extra) {
  if (!text) return
  let last = 0
  for (const m of text.matchAll(TAG_RE)) {
    const at = m.index + m[1].length
    if (at > last) out.push({ text: text.slice(last, at), ...(extra || {}) })
    out.push({ text: m[2], tag: true, ...(extra || {}) })
    last = at + m[2].length
  }
  if (last < text.length) out.push({ text: text.slice(last), ...(extra || {}) })
}

/**
 * 整段文本 → 行数组。
 * @returns {Array<{type: 'todo'|'bullet'|'text'|'blank', done?: boolean, text: string}>}
 */
export function parseNoteLines(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  // todoIdx 是「第几个清单项」，与行号无关 —— 勾选时要按它去回填原文
  let todoIdx = -1
  return lines.map((line) => {
    const todo = line.match(/^\s*[-*]\s+\[([ xX])\]\s*(.*)$/)
    if (todo) {
      todoIdx += 1
      return { type: 'todo', done: todo[1].toLowerCase() === 'x', text: todo[2], todoIdx }
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    if (bullet) return { type: 'bullet', text: bullet[1] }
    return { type: line.trim() ? 'text' : 'blank', text: line }
  })
}

/** 取出所有未完成的清单项，用于「一键转成待办」 */
export function pendingTodos(text) {
  return parseNoteLines(text)
    .filter(l => l.type === 'todo' && !l.done && l.text.trim())
    .map(l => l.text.trim())
}

/** 把第 index 个清单项（按出现顺序）勾选状态取反，返回新文本 */
export function toggleTodoLine(text, index) {
  const lines = String(text ?? '').split(/\r?\n/)
  let seen = -1
  const out = lines.map((line) => {
    const m = line.match(/^(\s*[-*]\s+\[)([ xX])(\]\s*)(.*)$/)
    if (!m) return line
    seen += 1
    if (seen !== index) return line
    return `${m[1]}${m[2].toLowerCase() === 'x' ? ' ' : 'x'}${m[3]}${m[4]}`
  })
  return out.join('\n')
}
