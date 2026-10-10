/**
 * 用「全新 Chrome 配置 + 全新构建产物」跑一轮 perf-batch2 的辅助脚本。
 *
 * 为什么必须换配置目录：上一版的 Service Worker 会留在 profile 里，它的预缓存
 * 行为会直接改变首访下载量 —— 用同一个 profile 测新旧两版，等于把两版的 SW
 * 混在一起。每次都用新的 user-data-dir，测的才是「第一访问」。
 *
 * 用法: node probe/_ab-run.mjs <标签>
 */
import { spawn } from 'node:child_process'
import { rmSync, mkdirSync } from 'node:fs'

const label = process.argv[2] || 'run'
const PORT = 9346
const DIR = '.chrome-ab'

rmSync(DIR, { recursive: true, force: true })
mkdirSync(DIR, { recursive: true })

const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${DIR}`,
  '--no-proxy-server',
  '--proxy-bypass-list=*',
  '--disable-gpu',
  '--hide-scrollbars',
  '--window-size=1440,1000',
  'about:blank'
], { stdio: 'ignore', detached: true })
chrome.unref()

// 等调试端口就绪
let up = false
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
    if (r.ok) { up = true; break }
  } catch {}
  await new Promise(r => setTimeout(r, 300))
}
if (!up) { console.error('Chrome 未就绪'); process.exit(1) }

console.log(`\n##################### ${label} #####################`)
const child = spawn(process.execPath, ['probe/perf-batch2.mjs', String(PORT), 'http://localhost:4173', '5'], { stdio: 'inherit' })
const code = await new Promise(r => child.on('exit', r))

// 收工：杀掉这个临时 Chrome
try { process.kill(chrome.pid) } catch {}
await new Promise(r => setTimeout(r, 400))
try { rmSync(DIR, { recursive: true, force: true }) } catch {}
process.exit(code ?? 0)
