// 书签文件解析（.html / .json），供收藏导入面板使用
export function parseBookmarkFile(file, onResult) {
  const reader = new FileReader()
  reader.onload = (e) => {
    const content = e.target.result
    if (file.name.endsWith('.json')) {
      onResult(parseJSON(content))
    } else if (file.name.endsWith('.html')) {
      onResult(parseBookmarkHTML(content))
    } else {
      // 扩展名不认识时也要给结果 —— 否则 onload 一声不响，用户以为按钮坏了
      onResult({ error: '不支持的文件类型，请选择 .html 或 .json 书签文件' })
    }
  }
  /**
   * 读取失败必须**说出来**：原先只挂 onload，编码不符 / 文件被占用 / 体积过大导致
   * 读取失败时回调永不触发，界面停在「点了导入但什么都没发生」——用户只会以为按钮坏了。
   * FileReader 的 error 事件覆盖这三类失败，统一回一个可展示的错误结果。
   */
  reader.onerror = () => {
    onResult({ error: '读取文件失败，请确认文件未损坏、未被其他程序占用后重试' })
  }
  reader.readAsText(file, 'UTF-8')
}

export function parseJSON(content) {
  let data
  try {
    data = JSON.parse(content)
  } catch {
    return { error: 'JSON 解析失败，请检查文件格式' }
  }
  const items = Array.isArray(data) ? data : (data.sites || data.bookmarks || [])
  return {
    items: items.map(item => ({
      name: item.name || item.title || '未命名',
      url: item.url || item.href || '#',
      desc: item.desc || item.description || ''
    }))
  }
}

export function parseBookmarkHTML(content) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(content, 'text/html')
  const links = doc.querySelectorAll('a[href]')
  const items = []
  const seen = new Set()

  links.forEach(link => {
    const href = link.getAttribute('href')
    const text = link.textContent.trim()
    if (!href || href === '#' || href.startsWith('javascript:') || href.startsWith('place:')) return
    if (seen.has(href)) return
    seen.add(href)
    items.push({
      name: text || href.replace(/^https?:\/\//, '').split('/')[0],
      url: href,
      desc: ''
    })
  })

  return { items }
}

// 导出站点为 JSON 数据文件
export function buildExportJSON(sites, favorites, history) {
  return {
    exportedAt: new Date().toISOString(),
    version: 2,
    sites,
    favorites,
    history
  }
}

/**
 * HTML 转义：站名 / URL 会被直接拼进书签文件的标签体与属性值里。
 * 中文站名里出现 `<`、`&`、引号并不罕见（「搜索 & 发现」「<工具>」），
 * 不转义就会破坏导出文件的结构 —— 属性被引号截断、标签提前闭合，
 * 导入到浏览器后条目丢失或串位。`&` 必须最先替换，否则会二次转义。
 */
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** ADD_DATE 取 Unix 秒；createdAt 缺失 / 非数值时兜底为导出时刻 —— 导出 NaN 导入浏览器后是非法时间 */
function addDateSeconds(createdAt) {
  const t = Number(createdAt)
  return Number.isFinite(t) && t > 0 ? Math.floor(t / 1000) : Math.floor(Date.now() / 1000)
}

// 导出站点为 Netscape 书签 HTML
export function buildExportHTML(sites) {
  const now = new Date().toISOString().split('T')[0]
  let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Navigator Bookmarks</TITLE>
<H1>Navigator Bookmarks</H1>
<DL><p>
  <DT><H3>Navigator 导航站 (${now})</H3>
  <DL><p>\n`
  sites.forEach(s => {
    // HREF 与标签体都过 escapeHtml：url 里出现引号会把属性截断，站名里的 < & 会破坏标签
    html += `    <DT><A HREF="https://${escapeHtml(s.url)}" ADD_DATE="${addDateSeconds(s.createdAt)}">${escapeHtml(s.name)}</A>\n`
  })
  html += `  </DL><p>\n</DL><p>\n`
  return html
}

// 触发浏览器下载
export function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}