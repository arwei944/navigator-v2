/**
 * 用无头 Chrome 把 public/favicon.svg 渲染成 PWA 需要的 PNG 图标。
 * manifest 声明了 pwa-192x192.png / pwa-512x512.png，但这两个文件从来没生成过，
 * 导致 Chrome 判定 manifest 不合规、PWA 无法安装。
 *
 * 注意：Emulation.setDeviceMetricsOverride 是会话级的，改尺寸与截图必须在同一条连接内。
 */
import { writeFileSync } from 'node:fs'

const PORT = process.argv[2] || '9341'
const ROOT = 'C:/work/nav-v2'
const HTML = `${ROOT}/probe/_icon.html`

writeFileSync(HTML, `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;padding:0;overflow:hidden}
img{display:block;width:100vw;height:100vh}
</style><img src="file:///${ROOT}/public/favicon.svg">`)

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const t = list.find(x => x.type === 'page' && x.webSocketDebuggerUrl)
if (!t) throw new Error('没有可用的 Chrome 页面')

const ws = new WebSocket(t.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const pending = new Map()
ws.onmessage = e => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
}
const send = (method, params = {}) => {
  const i = ++id
  ws.send(JSON.stringify({ id: i, method, params }))
  return new Promise(r => pending.set(i, r))
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

await send('Page.enable')

for (const size of [512, 192]) {
  await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: 'file:///' + HTML })
  await sleep(1200)
  const r = await send('Page.captureScreenshot', { format: 'png' })
  const buf = Buffer.from(r.data, 'base64')
  const out = `${ROOT}/public/pwa-${size}x${size}.png`
  writeFileSync(out, buf)
  console.log(`✅ ${out}  ${buf.length} bytes`)
}

ws.close()
process.exit(0)
