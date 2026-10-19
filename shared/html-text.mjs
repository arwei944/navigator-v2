/**
 * HTML 文本与标签工具 —— 零业务语义的基础层。
 *
 * ## 为什么从 site-infer.mjs 里拆出来
 *
 * `site-infer.mjs` 原本是一个上千行的单文件引擎，但它的前半段是**与站点推断无关**的
 * 通用工具：实体解码、属性取值、meta 提取、字节解码。这些函数既不含分类规则、
 * 也不含名称启发式，任何需要读 HTML 的地方都会用到它们。
 *
 * 拆出来之后：
 *   - site-infer 只留「推断决策」（名称 / 描述 / 图标 / 分类 / 合并）
 *   - 这些工具可以被单独引用与断言，不必连带加载整条推断链
 *
 * **对外导出保持不变**：site-infer 仍然 re-export 这些函数，
 * 既有 `import { decodeHtmlBytes } from '.../site-infer.mjs'` 一行都不用改。
 */

/* ---------------- 实体与标签 ---------------- */

export function decodeEntities(str) {
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

/**
 * 取标签属性值，按定界引号配对。
 * 不能用 `[^"']+`：内联 SVG 的 href 是双引号包裹、内部含单引号
 * （`href="data:image/svg+xml,%3Csvg xmlns='…'"`），会从第一个单引号处被截断。
 */
export function attrValue(tag, name) {
  const src = String(tag)
  const quoted = src.match(new RegExp(name + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", 'i'))
  if (quoted) return quoted[2]
  const bare = src.match(new RegExp(name + '\\s*=\\s*([^\\s>]+)', 'i'))
  return bare ? bare[1] : ''
}

/** 按 property/name/itemprop 取 <meta> 内容；属性书写顺序颠倒的页面也能命中 */
export function metaContent(html, keys) {
  const want = keys.map((k) => String(k).toLowerCase())
  for (const tag of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    const t = tag[0]
    const key = (attrValue(t, 'property') || attrValue(t, 'name') || attrValue(t, 'itemprop') || '').toLowerCase()
    if (!want.includes(key)) continue
    const content = attrValue(t, 'content')
    if (content) return decodeEntities(content).trim()
  }
  return ''
}

/** 去掉脚本 / 样式 / 注释 / 标签，留下纯文本（内部使用，也供需要的地方复用） */
export function stripTags(html) {
  return String(html)
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
}

/** 压平空白并截断到 max，同时去掉截断处残留的标点 */
export function clip(str, max = 120) {
  const s = String(str).replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max).replace(/[\s，,、。.；;:：-]+$/, '') : s
}

/* ---------------- 字节解码 ---------------- */

/**
 * 把 HTML 字节解成字符串，多编码回退：声明编码 → utf-8 → gb18030 → big5 → latin1。
 * 只在 utf-8 出现较多替换字符（≥3 个，说明确实不是 UTF-8）时才换编码，
 * 避免一个坏字节就把整页判成 gb18030；latin1 永远能解出干净结果，故只作最后兜底。
 */
export function decodeHtmlBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const dec = (enc) => new TextDecoder(enc).decode(u8)
  const badCount = (s) => (s.match(/\uFFFD/g) || []).length

  let best = dec('utf-8')
  let bestBad = badCount(best)
  if (bestBad < 3) return best

  const declared = (best.match(/charset\s*=\s*["']?([\w-]+)/i) || [])[1]?.toLowerCase()
  const order = [...(declared && declared !== 'utf-8' ? [declared] : []), 'gb18030', 'gbk', 'big5', 'latin1']
  for (const enc of order) {
    try {
      const alt = dec(enc)
      const bad = badCount(alt)
      if (bad < bestBad) {
        best = alt
        bestBad = bad
        if (bad === 0) break
      }
    } catch {
      /* 该编码不可用则尝试下一个 */
    }
  }
  return best
}
