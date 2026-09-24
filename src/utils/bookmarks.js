// 书签文件解析（.html / .json），供收藏导入面板使用
export function parseBookmarkFile(file, onResult) {
  const reader = new FileReader()
  reader.onload = (e) => {
    const content = e.target.result
    if (file.name.endsWith('.json')) {
      onResult(parseJSON(content))
    } else if (file.name.endsWith('.html')) {
      onResult(parseBookmarkHTML(content))
    }
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
    html += `    <DT><A HREF="https://${s.url}" ADD_DATE="${Math.floor(s.createdAt / 1000)}">${s.name}</A>\n`
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