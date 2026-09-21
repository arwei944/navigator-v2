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
  try { return new URL(href, base).href } catch { return null }
}

function normalizeHost(url) {
  return url.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')
}

async function extractIconLinks(html, base) {
  const links = []
  const re = /<link[^>]+rel=["']([^"']*icon[^"']*)["'][^>]*>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    const rel = m[1].toLowerCase()
    const hrefMatch = m[0].match(/href=["']([^"']+)["']/)
    if (!hrefMatch) continue
    const abs = toAbsolute(hrefMatch[1], base)
    if (!abs) continue
    const sizesMatch = m[0].match(/sizes=["']([^"']+)["']/)
    const sizes = sizesMatch ? sizesMatch[1] : ''
    links.push({ url: abs, rel, sizes })
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

async function tryDownload(url) {
  const buf = await fetchBuf(url)
  const ext = detectExt(buf)
  if (ext === 'bin') throw new Error('unknown format')
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

  async function worker() {
    while (queue.length) {
      const site = queue.shift()
      const id = site.id
      try {
        const { buf, ext } = await getFavicon(site)
        const fname = `${id}.${ext}`
        fs.writeFileSync(path.join(iconsDir, fname), buf)
        site.icon = `icons/${fname}`
        updated.push(id)
      } catch (e) {
        delete site.icon
        failed.push({ id, name: site.name, url: site.url, err: e.message })
      }
      done++
      if (done % 20 === 0 || done === sites.length) {
        console.log(`progress ${done}/${sites.length}`)
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  fs.writeFileSync(dataPath, JSON.stringify(sites, null, 2))
  console.log('--- done ---')
  console.log(`total=${sites.length} ok=${updated.length} fail=${failed.length}`)
  if (failed.length) {
    console.log('FAILED:')
    failed.forEach(f => console.log(`  ${f.id}\t${f.url}\t${f.err}`))
  }
}

run().catch(e => { console.error(e); process.exit(1) })
