/**
 * 极简 CDP 驱动：用 Node 内置 WebSocket 直连本机 Chrome，做「真实键盘」级验证。
 *
 * 为什么不引 playwright：项目零额外依赖（devDependencies 只有 vite 相关），
 * 而这套验证只需要 launch / 真实按键 / 读 DOM 三件事，CDP 原生就够。
 *
 * 关键点：`Input.dispatchKeyEvent` 是浏览器进程级输入，走完整的
 * keydown → beforeinput → input → keyup 链路，并会真实移动焦点，
 * 因此能抓到「输入时组件被卸载导致失焦」这类只在真机出现的问题。
 * 用 JS 直接派发 input 事件是抓不到的（它不会让焦点丢失）。
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA || ''}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

export async function findBrowser() {
  const { access } = await import('node:fs/promises')
  for (const p of CHROME_CANDIDATES) {
    try { await access(p); return p } catch { /* 继续找 */ }
  }
  throw new Error('未找到 Chrome/Edge 可执行文件')
}

/** 启动一个隔离 profile 的浏览器，返回 { ws, close } */
export async function launch({ headless = true, port = 0, url = 'about:blank' } = {}) {
  const exe = await findBrowser()
  const profile = await mkdtemp(join(tmpdir(), 'nav-cdp-'))
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-features=Translate,BackForwardCache',
    ...(headless ? ['--headless=new'] : []),
    url,
  ]
  const proc = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const wsUrl = await waitForEndpoint(port)
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', rej, { once: true })
  })
  const client = makeClient(ws)

  async function close() {
    try { ws.close() } catch { /* 忽略 */ }
    try { proc.kill('SIGKILL') } catch { /* 忽略 */ }
    await new Promise(r => setTimeout(r, 150))
    try { await rm(profile, { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
  return { client, close, pid: proc.pid }
}

async function waitForEndpoint(port) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (res.ok) {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        const page = list.find(t => t.type === 'page')
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
      }
    } catch { /* 尚未就绪 */ }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error('浏览器 CDP 端口未就绪')
}

function makeClient(ws) {
  let seq = 0
  const pending = new Map()
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    }
  })
  function send(method, params = {}) {
    const id = ++seq
    ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms))

  return {
    send,
    sleep,
    async goto(url, { settle = 1200 } = {}) {
      await send('Page.enable')
      await send('Page.navigate', { url })
      await sleep(settle)
    },
    /** 在页面里执行表达式并取回值（走 Runtime.evaluate → JSON 化） */
    async eval(expression) {
      const r = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
      return r.result.value
    },
    /**
     * 真实键盘输入：逐字符 dispatchKeyEvent（含 keyDown/char/keyUp）。
     * 字符走 `text` 参数，浏览器才会触发原生 input 事件并维护焦点。
     */
    async type(text, { delay = 60 } = {}) {
      for (const ch of text) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch })
        await send('Input.dispatchKeyEvent', { type: 'keyUp' })
        await sleep(delay)
      }
    },
    async press(key, { code = key, keyCode = 0, modifiers = 0 } = {}) {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers })
    },
    async focus(selector) {
      return this.eval(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;el.focus();return document.activeElement===el})()`)
    },
    async activeSelector() {
      return this.eval(`(()=>{const a=document.activeElement;if(!a)return 'NONE';if(a===document.body)return 'BODY';return a.tagName+(a.className?'.'+String(a.className).split(' ').filter(Boolean).join('.'):'')})()`)
    },
  }
}
