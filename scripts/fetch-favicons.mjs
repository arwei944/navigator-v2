/**
 * 站点图标批量补抓。
 *
 * **抓取逻辑已抽到 `shared/image-engine.mjs`**：三级回退链
 * （页面 icon 声明 → `/favicon.ico` → favicon.im）现在是三个可换序、可裁剪、
 * 可替换的 provider。本脚本只负责**批量调度与落盘**
 * —— 换图标源改一个环境变量（`NAV_ICON_PROVIDERS=page-links,favicon-im`），不碰这里。
 *
 * 用法: node scripts/fetch-favicons.mjs [--limit N] [--only <siteId>]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveImage } from '../shared/image-engine.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const dataPath = path.join(root, 'api', 'sites-data.json')
const iconsDir = path.join(root, 'public', 'icons')

fs.mkdirSync(iconsDir, { recursive: true })

const sites = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
const CONCURRENCY = 6

/** 取一张图标；全链失败返回 null（「这站没有图标」是常态，不是异常） */
async function getFavicon(site) {
  const out = await resolveImage(site, { kind: 'favicon' })
  return out ? { buf: out.buf, ext: out.ext } : null
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
        const got = await getFavicon(site)
        if (!got) throw new Error('all sources failed')
        const fname = `${id}.${got.ext}`
        fs.writeFileSync(path.join(iconsDir, fname), got.buf)
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
