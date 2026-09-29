/**
 * 把若干 PNG 打包成一个多尺寸 Windows ICO（Vista+ 支持 ICO 内嵌 PNG 数据）。
 * 不引任何依赖。
 *
 * 多尺寸的意义：任务栏/资源管理器小图标（16/24/32）直接取对应尺寸，
 * 不必从 256 缩下来，避免糊。ICO 目录项用 1 字节存尺寸，故上限 256（256 记作 0）。
 *
 * 用法: node make-icon.mjs <out.ico> <in1.png> [in2.png ...]
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [out, ...inputs] = process.argv.slice(2)
if (!out || !inputs.length) {
  console.error('用法: node make-icon.mjs <out.ico> <in1.png> [in2.png ...]')
  process.exit(2)
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const seen = new Set()
const images = inputs
  .map(path => {
    const png = readFileSync(path)
    if (!png.subarray(0, 8).equals(PNG_SIG)) throw new Error(`${path} 不是 PNG 文件`)
    const width = png.readUInt32BE(16)
    const height = png.readUInt32BE(20)
    if (width !== height) throw new Error(`${path} 不是正方形（${width}×${height}）`)
    if (width > 256) throw new Error(`${path} 超过 256×256（ICO 目录项只有 1 字节存尺寸）`)
    if (seen.has(width)) throw new Error(`${path} 与其它输入尺寸重复（${width}）`)
    seen.add(width)
    return { png, width }
  })
  .sort((a, b) => a.width - b.width)

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: 1 = icon
header.writeUInt16LE(images.length, 4)

let offset = 6 + 16 * images.length
const entries = images.map(({ png, width }) => {
  const entry = Buffer.alloc(16)
  entry.writeUInt8(width === 256 ? 0 : width, 0)
  entry.writeUInt8(width === 256 ? 0 : width, 1)
  entry.writeUInt8(0, 2) // 调色板数（真彩为 0）
  entry.writeUInt8(0, 3) // reserved
  entry.writeUInt16LE(1, 4) // planes
  entry.writeUInt16LE(32, 6) // bpp
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(offset, 12)
  offset += png.length
  return entry
})

writeFileSync(out, Buffer.concat([header, ...entries, ...images.map(i => i.png)]))
console.log(`[make-icon] ${out}  ${images.length} 个尺寸: ${images.map(i => i.width).join('/')}`)