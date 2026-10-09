import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const dataPath = path.join(root, 'api', 'sites-data.json')
const iconsDir = path.join(root, 'public', 'icons')

fs.mkdirSync(iconsDir, { recursive: true })

const sites = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
const CONCURRENCY = 6
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const TIMEOUT = 12000

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
  ])
}

async function fetchBuf(url) {
  const res = await withTimeout(fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': '*/*' },
    redirect: 'follow'
  }), TIMEOUT)
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const buf = Buffer.from(await res.arrayBuffer())
  if (!buf.length) throw new Error('empty')
  return buf
}

function detectExt(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'ico'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  if (buf.length >= 6 && buf.toString('latin1', 0, 4) === 'GIF8') return 'gif'
  if (buf.length >= 12 && buf.toString('latin1', 0, 12) === '\x00\x00\x00\x1cftypavif') return 'avif'
  const head = buf.toString('latin1', 0, 200)
  if (head.includes('<svg') || head.includes('<?xml')) return 'svg'
  return 'bin'
}

function toAbsolute(href, base) {
  const h = String(href || '').trim()
  if (!h) return null
  // `data:,`（抑制 favicon 请求）等于没声明；`data:image/…` 是真实内联图标，原样保留
  if (h.startsWith('data:')) {
    const comma = h.indexOf(',')
    if (comma < 0 || !/^image\//i.test(h.slice(5, comma))) return null
    return h.slice(comma + 1).trim() ? h : null
  }
  try { return new URL(h, base).href } catch { return null }
}

/** 内联 data: 图片解码为 Buffer；非 data: 或解码失败返回 null */
function decodeDataUri(uri) {
  const comma = uri.indexOf(',')
  if (comma < 0) return null
  const meta = uri.slice(5, comma)
  const payload = uri.slice(comma + 1)
  try {
    return /;base64/i.test(meta)
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8')
  } catch { return null }
}

function normalizeHost(url) {
  return url.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')
}

/**
 * 取标签属性值，按定界引号配对。
 * 不能用 `[^"']+`：内联 SVG 的 href 值是双引号包裹、内部含单引号
 * （`href="data:image/svg+xml,%3Csvg xmlns='…'"`），会从第一个单引号处被截断。
 */
function attrValue(tag, name) {
  const quoted = tag.match(new RegExp(name + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", 'i'))
  if (quoted) return quoted[2]
  const bare = tag.match(new RegExp(name + '\\s*=\\s*([^\\s>]+)', 'i'))
  return bare ? bare[1] : ''
}

async function extractIconLinks(html, base) {
  const links = []
  const re = /<link[^>]+rel=["']([^"']*icon[^"']*)["'][^>]*>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    const rel = m[1].toLowerCase()
    const href = attrValue(m[0], 'href')
    if (!href) continue
    const abs = toAbsolute(href, base)
    if (!abs) continue
    links.push({ url: abs, rel, sizes: attrValue(m[0], 'sizes') })
  }
  links.sort((a, b) => {
    const rank = (l) => {
      if (l.rel.includes('apple-touch-icon')) return 0
      if (l.sizes.includes('180') || l.sizes.includes('192') || l.sizes.includes('96') || l.sizes.includes('128')) return 1
      return 2
    }
    return rank(a) - rank(b)
  })
  return links
}

/**
 * favicon.im 对查不到图标的域名会返回 200 + 灰色占位 SVG（灰圆 + 斜体 f），
 * 体积小、格式合法，若不识别会被当成真图标落盘。
 */
function isPlaceholderIcon(buf) {
  if (buf.length > 512) return false
  const text = buf.toString('utf8')
  return text.includes('<svg') && text.includes('#808080') && /<text[^>]*>\s*f\s*<\/text>/i.test(text)
}

async function tryDownload(url) {
  const buf = url.startsWith('data:') ? decodeDataUri(url) : await fetchBuf(url)
  if (!buf || !buf.length) throw new Error('empty')
  const ext = detectExt(buf)
  if (ext === 'bin') throw new Error('unknown format')
  if (isPlaceholderIcon(buf)) throw new Error('placeholder icon (source has no real favicon)')
  return { buf, ext }
}

async function getFavicon(site) {
  const url = site.url
  const base = url.includes('://') ? url : 'https://' + url

  // 1. parse page HTML for icon links
  try {
    const html = (await fetchBuf(base)).toString('utf8')
    const links = await extractIconLinks(html, base)
    for (const l of links.slice(0, 3)) {
      try {
        const { buf, ext } = await tryDownload(l.url)
        return { buf, ext }
      } catch { /* next */ }
    }
  } catch { /* page blocked or unavailable */ }

  // 2. try /favicon.ico
  try {
    const u = new URL('/favicon.ico', base).href
    const { buf, ext } = await tryDownload(u)
    return { buf, ext }
  } catch { /* none */ }

  // 3. favicon.im fallback (accept any raster format)
  try {
    const host = normalizeHost(url)
    const { buf, ext } = await tryDownload(`https://favicon.im/${host}?format=png&size=128`)
    return { buf, ext }
  } catch { /* none */ }

  throw new Error('all sources failed')
}

async function run() {
  const LIMIT = parseInt(process.env.LIMIT || '0', 10)
  const onlyIdx = process.argv.indexOf('--only')
  const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : ''
  let done = 0
  const failed = []
  const updated = []
  let queue = LIMIT > 0 ? sites.slice(0, LIMIT) : [...sites]
  if (only) queue = queue.filter(s => s.id === only)
  // 进度分母必须用队列长度：带 --limit / --only 时 sites.length 永远到不了，进度条打不满
  const queueTotal = queue.length

  async function worker() {
    while (queue.length) {
      const site = queue.shift()
      const id = site.id
      const prev = site.icon
      try {
        const { buf, ext } = await getFavicon(site)
        const fname = `${id}.${ext}`
        fs.writeFileSync(path.join(iconsDir, fname), buf)
        site.icon = `icons/${fname}`
        updated.push(id)
      } catch (e) {
        // 抓取失败**绝不能删 icon 字段**：这只是一次网络请求失败，
        // 却会把站点已经抓好的图标从数据文件里永久抹掉（历史上 8 条站点无图标
        // 大概率就是这么来的）。保留原值，把失败列出来让人重试即可。
        failed.push({ id, name: site.name, url: site.url, err: e.message })
      }
      // 仅在成功抓到、且路径确实变了时才删旧文件（换扩展名的情况）
      if (prev && site.icon && prev !== site.icon) {
        const oldPath = path.resolve(root, 'public', prev)
        // 路径穿越防护：prev 直接来自数据文件，含 ../ 就可能删到 public/ 之外
        if (oldPath.startsWith(iconsDir + path.sep)) {
          try { fs.rmSync(oldPath, { force: true }) } catch { /* ignore */ }
        } else {
          console.warn(`  跳过删除可疑路径: ${prev}`)
        }
      }
      done++
      if (done % 20 === 0 || done === queueTotal) {
        console.log(`progress ${done}/${queueTotal}`)
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  // 写回前先备份 + 原子替换：这个文件是发布源，写坏一半比不写更糟
  const backupPath = dataPath.replace(/\.json$/, '') + '.bak-' + new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19) + '.json'
  fs.copyFileSync(dataPath, backupPath)
  const tmpPath = dataPath + '.tmp'
  fs.writeFileSync(tmpPath, JSON.stringify(sites, null, 2) + '\n')
  fs.renameSync(tmpPath, dataPath)
  console.log(`已写入 ${dataPath}（备份: ${path.relative(root, backupPath)}）`)
  console.log('--- done ---')
  console.log(`total=${sites.length} ok=${updated.length} fail=${failed.length}`)
  if (failed.length) {
    console.log('FAILED:')
    failed.forEach(f => console.log(`  ${f.id}\t${f.url}\t${f.err}`))
  }
}

run().catch(e => { console.error(e); process.exit(1) })
