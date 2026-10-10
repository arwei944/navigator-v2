import { readFileSync, readdirSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const s = readFileSync('dist/sw.js', 'utf8')
const m = s.match(/precacheAndRoute\((\[[\s\S]*?\]|self\.__WB_MANIFEST)/)
console.log('precacheAndRoute 参数开头:', m ? m[0].slice(0, 200).replace(/\n/g, ' ') : '未匹配')
const urls = [...s.matchAll(/url:\s*"([^"]+)"/g)].map(x => x[1])
console.log('url 条目数:', urls.length)
console.log('前 6:', urls.slice(0, 6))
console.log('含 icons/ 条目数:', urls.filter(u => u.includes('icons/')).length)
console.log('sw.js 大小:', statSync('dist/sw.js').size, 'B')

// 按预缓存清单估算 SW 安装期要下载的总字节
let total = 0
const missing = []
for (const u of urls) {
  const p = join('dist', u.replace(/^\//, ''))
  try { total += statSync(p).size } catch { missing.push(u) }
}
console.log(`预缓存清单实际文件总字节: ${(total / 1024 / 1024).toFixed(2)} MB（缺失 ${missing.length} 个）`)
const iconBytes = urls.filter(u => u.includes('icons/')).reduce((a, u) => {
  try { return a + statSync(join('dist', u.replace(/^\//, ''))).size } catch { return a }
}, 0)
console.log(`其中 icons/ 占: ${(iconBytes / 1024 / 1024).toFixed(2)} MB`)
console.log('dist/icons 实际总字节:', (readdirSync('dist/icons').reduce((a, f) => a + statSync(join('dist/icons', f)).size, 0) / 1024 / 1024).toFixed(2), 'MB')
console.log('assets gz 合计:', (readdirSync('dist/assets').reduce((a, f) => a + gzipSync(readFileSync(join('dist/assets', f))).length, 0) / 1024).toFixed(1), 'KB')
