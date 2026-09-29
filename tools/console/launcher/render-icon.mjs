/**
 * 把 app-icon.svg 渲染成多个尺寸的 PNG（矢量直出，小尺寸不糊）。
 *
 * 为什么要绕一层 HTML：Chrome 直接截 SVG 文件时会用 viewport 尺寸渲染，
 * SVG 的 width/height 才是唯一可信的固有尺寸；包进 HTML 用 <img width=N> 才能
 * 按任意尺寸精确出图。背景全透明（--default-background-color=00000000）。
 *
 * 用法: node render-icon.mjs <svg> <outDir> [sizes=16,24,32,48,64,128,256]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const [svgPath, outDir, sizesArg] = process.argv.slice(2)
if (!svgPath || !outDir) {
  console.error('用法: node render-icon.mjs <svg> <outDir> [sizes=16,24,32,48,64,128,256]')
  process.exit(2)
}

const sizes = (sizesArg || '16,24,32,48,64,128,256')
  .split(',')
  .map(s => Number(s.trim()))
  .filter(n => Number.isInteger(n) && n > 0 && n <= 256)
if (!sizes.length) throw new Error('没有合法尺寸（ICO 目录项上限 256）')

const chrome = [
  join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
  join(process.env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
  join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
].find(p => p && existsSync(p))
if (!chrome) throw new Error('未找到 chrome.exe（渲染 SVG 依赖本机 Chrome）')

const svg = readFileSync(resolve(svgPath), 'utf8')
if (!/<svg[^>]*\swidth=/.test(svg)) {
  throw new Error('SVG 缺少 width/height：Chrome 会按 viewport 渲染导致出图被裁切')
}

mkdirSync(outDir, { recursive: true })
const workDir = join(tmpdir(), `nav-icon-render-${process.pid}`)
mkdirSync(workDir, { recursive: true })

const toFileUrl = p => 'file:///' + p.replace(/\\/g, '/').replace(/ /g, '%20')
const outputs = []

try {
  for (const size of sizes) {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:transparent;overflow:hidden}
      img{display:block;width:${size}px;height:${size}px}
    </style></head><body><img src="${toFileUrl(resolve(svgPath))}"></body></html>`
    const htmlPath = join(workDir, `icon-${size}.html`)
    writeFileSync(htmlPath, html, 'utf8')

    const out = join(resolve(outDir), `icon-${size}.png`)
    if (existsSync(out)) rmSync(out)
    execFileSync(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        `--window-size=${size},${size}`,
        '--default-background-color=00000000',
        `--screenshot=${out}`,
        toFileUrl(htmlPath),
      ],
      { stdio: 'ignore' }
    )
    if (!existsSync(out)) throw new Error(`渲染失败: ${size}×${size}`)
    outputs.push(out)
    console.log(`[render-icon] ${size}×${size} → ${out}`)
  }
} finally {
  rmSync(workDir, { recursive: true, force: true })
}

console.log(`[render-icon] 完成 ${outputs.length} 个尺寸`)