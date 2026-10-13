/**
 * 真机探针：用「管线日志」观察一次添加站点到底走到哪一跳、停在哪。
 *
 * ## 它回答的三件事（单测答不了，必须真浏览器 + 真网络）
 *
 *   1. 各入口（搜索框秒加 / 添加弹窗）分别触发了哪些 stage，各自耗时多少；
 *   2. 后台抓取那一跳有没有真的发出请求、服务端报了多少 `fetchMs`；
 *   3. 结局：库里那条记录**有没有被改写**成真实信息（而不是停在域名推断草稿上）。
 *
 * ## 为什么判据读的是 `window.__navPipeline__` 而不是 DOM 文案
 *
 * DOM 上的状态文案会随产品迭代变化，拿它做终态判据的探针迟早假红（这条在
 * `add-flow-realtime.mjs` 上已经踩过一次）。追踪总线是**机器可读的结构**，
 * stage key 与 status 是契约的一部分，改它就得同步改这里 —— 这正是我们要的耦合。
 *
 * ## 用法
 *
 *   node probe/pipeline-realtime.mjs <cdp-port> [base] [mode]
 *
 * `mode` = omni（搜索框秒加，默认）| modal（添加弹窗）。
 * 探针**自己拉浏览器**（已有 CDP 端点则复用），跑完自己收掉。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const PORT = process.argv[2] || '9333'
const BASE = (process.argv[3] || 'http://127.0.0.1:4180').replace(/\/+$/, '')
const MODE = process.argv[4] || 'omni'
const TARGET = process.argv[5] || 'https://www.figma.com'

const CHROME = process.env.CHROME_PATH
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? ` → ${extra}` : ''}`) }
  else { failures.push(`${label}${extra ? ` → ${extra}` : ''}`); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`) }
}

const sleep = ms => new Promise(s => setTimeout(s, ms))

/* ───────── 拉浏览器（必须自己拉自己收，不能靠 shell 里 `chrome &`） ───────── */
async function hasEndpoint() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
    const l = await r.json()
    return l.some(t => t.type === 'page' && t.webSocketDebuggerUrl)
  } catch { return false }
}

let child = null
async function ensureChrome() {
  if (await hasEndpoint()) return false
  if (!existsSync(CHROME)) throw new Error(`找不到 Chrome：${CHROME}（用 CHROME_PATH 指定）`)
  const dir = join(tmpdir(), `nav-pipeline-${PORT}`)
  child = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`,
    '--disable-gpu', '--hide-scrollbars', '--window-size=1280,900', '--no-first-run', 'about:blank',
  ], { stdio: 'ignore' })
  for (let i = 0; i < 60; i++) {
    if (await hasEndpoint()) return true
    await sleep(500)
  }
  throw new Error('浏览器起来了但拿不到 CDP 端点')
}

const target = await (async () => {
  await ensureChrome()
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await r.json()
      const page = list.find(t => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* 还没就绪 */ }
    await sleep(500)
  }
  throw new Error(`连不上 CDP ${PORT}`)
})()

const ws = new WebSocket(target.webSocketDebuggerUrl)
let msgId = 0
const pending = new Map()
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id)
    pending.delete(m.id)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
  }
})
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params }))
})
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval 抛错')
  return r.result.value
}
async function waitFor(expr, timeout = 25000, label = expr) {
  const deadline = Date.now() + timeout
  for (;;) {
    let v = false
    try { v = await evalJs(`(() => { try { return !!(${expr}) } catch { return false } })()`) } catch { /* 导航中 */ }
    if (v) return true
    if (Date.now() > deadline) { failures.push(`等待超时：${label}`); console.log(`  ❌ 等待超时：${label}`); return false }
    await sleep(200)
  }
}

await send('Page.enable')
await send('Runtime.enable')

console.log(`\n▶ 目标：${BASE}   入口：${MODE === 'omni' ? '搜索框秒加' : '添加弹窗'}   站点：${TARGET}\n`)

await send('Page.navigate', { url: BASE })
await waitFor(`document.querySelector('.unified-search-input')`, 30000, '应用首屏挂载')
ok(true, '应用已挂载')

// 每次都从「未收录」出发，保证探针可重复
await evalJs(`(() => { localStorage.clear(); return true })()`)
await send('Page.reload')
await waitFor(`document.querySelector('.unified-search-input')`, 30000, '清库后重新挂载')
await waitFor(`!!window.__navPipeline__`, 15000, '管线追踪总线已挂载')
ok(true, '追踪总线可用（面板常驻挂载 → 埋点从不断档）')

// 记录 /api/metadata 的调用与结果（复用浏览器里的真实链路，不改字段）
await evalJs(`(() => {
  window.__metaCalls = [];
  if (window.__origFetch) return true;
  window.__origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const t0 = Date.now();
    const p = window.__origFetch.apply(this, arguments);
    if (url.includes('/api/metadata')) {
      const rec = { url, t0, done: false };
      window.__metaCalls.push(rec);
      p.then(r => { rec.done = true; rec.ms = Date.now() - t0; rec.status = r.status;
        r.clone().text().then(t => { try { rec.body = JSON.parse(t) } catch { rec.body = null } }) })
       .catch(e => { rec.done = true; rec.ms = Date.now() - t0; rec.err = String(e && e.message) });
    }
    return p;
  };
  return true;
})()`)

const readAdded = () => evalJs(`(() => {
  try {
    const raw = JSON.parse(localStorage.getItem('nav-sites-overlay') || '{}');
    const d = (raw && raw.data) || raw || {};
    const a = (d.adds || []);
    const s = a[a.length - 1];
    return s ? { id: s.id, name: s.name, desc: s.desc, categoryId: s.categoryId, iconUrl: s.iconUrl, updatedAt: s.updatedAt } : null;
  } catch (e) { return { error: String(e) } }
})()`)

let addT0 = Date.now()

if (MODE === 'omni') {
  await evalJs(`(() => {
    const el = document.querySelector('.unified-search-input');
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(TARGET)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  })()`)
  await waitFor(`document.querySelector('.omni-item')`, 8000, '出现「添加站点」置顶项')
  addT0 = Date.now()
  await evalJs(`(() => {
    const el = document.querySelector('.unified-search-input');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    return true;
  })()`)
  const gotToast = await waitFor(`[...document.querySelectorAll('.toast-msg')].some(n => n.textContent.includes('已添加'))`, 20000, '「已添加」回执')
  console.log(`   ⏱ 回车 → 「已添加」回执：${Date.now() - addT0}ms${gotToast ? '' : '（超时）'}`)
} else {
  await evalJs(`(() => { document.querySelector('.add-site-btn')?.click(); return true })()`)
  await waitFor(`document.querySelector('.modal input[type=url]')`, 15000, '弹窗挂载')
  await evalJs(`(() => {
    const el = document.querySelector('.modal input[type=url]');
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(TARGET)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return el.value;
  })()`)
  addT0 = Date.now()
  await waitFor(`document.querySelector('.status-line.ok, .status-line.warn, .status-line.err')`, 30000, '弹窗补全状态落终态')
}

const snap0 = await readAdded()

/* ───────── 等整条管线 settle（最新一条 run 不再是 running） ───────── */
const settle = await waitFor(
  `(() => { const rs = window.__navPipeline__.runs.value; const r = rs[rs.length - 1]; return r && r.status !== 'running' })()`,
  30000, '管线跑到终态'
)
ok(settle, '管线跑到终态', `${Date.now() - addT0}ms`)

const runJson = await evalJs(`(() => {
  const rs = window.__navPipeline__.runs.value;
  const r = rs[rs.length - 1];
  if (!r) return 'null';
  return JSON.stringify({
    flow: r.flow, title: r.title, target: r.target, status: r.status, summary: r.summary, startedAt: r.startedAt,
    total: r.endedAt - r.startedAt,
    stages: r.stages.map(s => ({ key: s.key, label: s.label, status: s.status, ms: s.ms, detail: s.detail, reason: s.reason })),
  });
})()`)
const run = JSON.parse(runJson)

const ICON = { running: '…', ok: '✅', warn: '⚠️', fail: '❌', skip: '⤼' }
console.log(`\n  ⏱ 回车 → 管线开跑：${run.startedAt - addT0}ms`)
console.log('\n  ── 管线：' + run.title + ' · ' + run.target + ' ──')
for (const s of run.stages) {
  console.log(`    ${ICON[s.status] || '·'} ${String(s.ms).padStart(6)}ms  ${s.label}${s.detail ? ` — ${s.detail}` : ''}${s.reason ? ` [${s.reason}]` : ''}`)
}
console.log(`    ${ICON[run.status]} 合计 ${run.total}ms  status=${run.status}${run.summary ? `  ${run.summary}` : ''}`)

const calls = await evalJs(`window.__metaCalls || []`)
console.log('\n  /api/metadata 调用：')
for (const c of calls) {
  console.log(`    ${c.ms ?? '?'}ms status=${c.status ?? c.err} server=${c.body?.fetchMs ?? '-'}ms warning=${JSON.stringify(c.body?.warning ?? null)} name=${JSON.stringify(c.body?.name)}`)
}

/* ───────── 面板 UI 冒烟：总线有数据 ≠ 界面看得见 ─────────
   前面的断言读的是总线（机器可读），这里再验一次「人真的看得着」：浮标出现 → 点开 → 有逐跳明细。 */
const pillVisible = await waitFor(`document.querySelector('.pipeline-pill')`, 6000, '管线浮标出现')
ok(pillVisible, '管线日志浮标在流程结束后仍可见（跑完会停留数秒，不闪进闪出）')
if (pillVisible) {
  await evalJs(`(() => { document.querySelector('.pipeline-pill').click(); return true })()`)
  await waitFor(`document.querySelector('.pipeline-panel')`, 5000, '面板展开')
  const dom = await evalJs(`JSON.stringify({
    runs: document.querySelectorAll('.pipeline-run').length,
    stages: document.querySelectorAll('.pipeline-stage').length,
  })`)
  const shown = JSON.parse(dom)
  ok(shown.runs > 0, '面板里列出了 run', `${shown.runs} 条`)
  ok(shown.stages >= run.stages.length, '逐跳明细渲染完整（含未展开的旧记录）', `DOM ${shown.stages} 行 / 本次 ${run.stages.length} 跳`)
}

const snapEnd = MODE === 'omni' ? await readAdded() : null

console.log('\n  ── 断言 ──')
const stage = k => run.stages.find(s => s.key === k)
ok(Boolean(stage('local-infer')), '第 0 跳「本地推断」有记录')
ok(run.flow === (MODE === 'omni' ? 'auto-add' : 'add-modal'), 'run 归属正确的入口', run.flow)
ok(stage('fetch'), '第 1 跳「真实抓取」被执行到了')
if (stage('fetch')) ok(stage('fetch').status === 'ok' || stage('fetch').status === 'warn', '抓取那跳有终态', stage('fetch').status)
ok(stage('translate'), '第 2 跳「中文补译」有结论（ok / skip / warn 都算）')
if (MODE === 'omni') {
  ok(stage('persist')?.status === 'ok', '落库那跳成功')
  if (snap0 && snapEnd) {
    const changed = snapEnd.name !== snap0.name || snapEnd.desc !== snap0.desc
    ok(changed || stage('patch')?.status === 'skip', '结局与日志一致：要么补全字段，要么明说「无需改写」',
      changed ? `changed name:${snapEnd.name !== snap0.name} desc:${snapEnd.desc !== snap0.desc}` : (stage('patch')?.detail || ''))
  }
}

console.log(`\n${failures.length ? '❌' : '✅'} 通过 ${pass} 项，失败 ${failures.length} 项`)
if (failures.length) { console.log('失败项：'); failures.forEach(f => console.log('  - ' + f)) }

ws.close()
if (child) child.kill()
process.exit(failures.length ? 1 : 0)
