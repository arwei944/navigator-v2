/**
 * 站点元信息代理 API：抓取 URL 的标题/描述/favicon
 * GET /api/metadata?url=https://example.com
 * 返回 { name, desc, favicon, domain }
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const MAX_BYTES = 256 * 1024 // 最多读取 256KB HTML

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

function pickTitle(html) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
  if (og) return decodeHtmlEntities(og[1]).trim()
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (m) {
    return decodeHtmlEntities(m[1].replace(/\s+/g, ' ').trim()).slice(0, 120)
  }
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (h1) return decodeHtmlEntities(h1[1].replace(/<[^>]+>/g, '').trim()).slice(0, 120)
  return ''
}

function pickDesc(html) {
  const patterns = [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i
  ]
  for (const p of patterns) {
    const m = html.match(p)
    if (m && m[1]) return decodeHtmlEntities(m[1]).trim().slice(0, 200)
  }
  return ''
}

function pickFavicon(html, base) {
  // 优先高分辨率 apple-touch-icon，其次标准 icon，最后 /favicon.ico
  const apple = html.match(/<link[^>]+rel=["'][^"']*(?:apple-touch-icon|mask-icon)[^"']*["'][^>]*>/i)
  if (apple) {
    const h = apple[0].match(/href=["']([^"']+)["']/i)
    if (h && h[1]) {
      try { return new URL(h[1], base).href } catch { /* next */ }
    }
  }
  const links = [...html.matchAll(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/gi)]
  for (const l of links) {
    const href = l[0].match(/href=["']([^"']+)["']/i)
    if (href && href[1]) {
      try {
        return new URL(href[1], base).href
      } catch { /* next */ }
    }
  }
  return new URL('/favicon.ico', base).href
}

export default async function handler(req, res) {
  const raw = req.query.url
  if (!raw) {
    res.status(400).json({ error: '缺少 url 参数' })
    return
  }

  let target
  try {
    target = new URL(raw.startsWith('http') ? raw : 'https://' + raw)
  } catch {
    res.status(400).json({ error: '无效的 URL' })
    return
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    res.status(400).json({ error: '仅支持 http/https' })
    return
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const resp = await fetch(target.href, {
      headers: {
        'user-agent': UA,
        'accept-language': 'zh-CN,zh;q=0.9',
        'accept': 'text/html,application/xhtml+xml'
      },
      redirect: 'follow',
      signal: controller.signal
    })
    if (!resp.ok) {
      res.status(502).json({ error: `目标站点返回 ${resp.status}` })
      return
    }

    // 截断读取，避免超大页面拖垮函数
    const reader = resp.body.getReader()
    const chunks = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.byteLength
      if (total > MAX_BYTES) {
        reader.cancel().catch(() => {})
        break
      }
    }
    const buf = Buffer.concat(chunks)

    // 多编码回退：utf-8 → gbk/gb2312 → gb18030 → big5 → latin1(min 保底)
    const encoders = ['utf-8', 'gbk', 'gb18030', 'big5', 'latin1']
    let html = buf.toString('utf-8')
    let name = pickTitle(html)
    if (!name) {
      const charsetDecl = (html.match(/charset=["']?([\w-]+)/i) || [])[1]?.toLowerCase()
      let order = encoders
      if (charsetDecl && encoders.includes(charsetDecl)) {
        order = [charsetDecl, ...encoders.filter(e => e !== charsetDecl)]
      }
      for (const enc of order) {
        try {
          const decoded = new TextDecoder(enc).decode(buf)
          const t = pickTitle(decoded)
          if (t) {
            html = decoded
            name = t
            break
          }
        } catch { /* 该编码不可用则尝试下一个 */ }
      }
    }
    if (!name) {
      res.status(502).json({
        error: '无法解析页面标题（页面可能为 JS 渲染或正文无 <title>）'
      })
      return
    }

    const desc = pickDesc(html)
    const favicon = pickFavicon(html, target.origin)
    const domain = target.hostname.replace(/^www\./, '')

    res.status(200).json({
      name,
      desc,
      favicon,
      domain,
      url: target.href
    })
  } catch (e) {
    const msg = e.name === 'AbortError' ? '抓取超时' : '抓取失败: ' + e.message
    res.status(502).json({ error: msg })
  } finally {
    clearTimeout(timer)
  }
}
