/**
 * 真机验证：「搜索框秒加站点」的后台升级链路到底发生了什么。
 *
 * 要回答的问题（单测答不了，必须真机 + 真网络）：
 *   1. 秒加瞬间，卡片的名称 / 描述是什么（本地推断值）；
 *   2. `/api/metadata` 有没有被后台调用、什么时候返回、返回了什么；
 *   3. 返回后**库里那条记录有没有被改写**，改写成了什么；
 *   4. 从「秒加」到「信息变正确」隔了多久 —— 用户能不能感知到。
 *
 * 前置：无头 Chrome（CDP 已开）。默认打线上环境（本机 dist 没有出网能力时也能跑）。
 * 用法：node probe/auto-add-upgrade.mjs <cdp-port> [base]
 */
const PORT = process.argv[2] || '9351'
const BASE = (process.argv[3] || 'https://nav-dashboard-19166.app.workbuddy.host').replace(/\/+$/, '')
const TARGET = process.argv[4] || 'https://www.figma.com'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? ` → ${extra}` : ''}`) }
  else { failures.push(`${label}${extra ? ` → ${extra}` : ''}`); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`) }
}

async function targets() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await r.json()
      const page = list.find(t => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* 还没起来 */ }
    await new Promise(s => setTimeout(s, 500))
  }
  throw new Error(`连不上 CDP ${PORT}`)
}

const target = await targets()
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
const sleep = ms => new Promise(s => setTimeout(s, ms))

async function waitFor(expr, timeout = 20000, label = expr) {
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

console.log(`\n▶ 目标环境：${BASE}`)
console.log(`▶ 测试站点：${TARGET}\n`)

await send('Page.navigate', { url: BASE })
// 全新建档：等应用挂载出搜索框
await waitFor(`document.querySelector('.unified-search-input')`, 30000, '应用首屏挂载')
ok(true, '线上应用已挂载')

// 清空上一次运行留下的本地覆盖层，保证每次都从「未收录」开始（探针可重复跑）
await evalJs(`(() => { localStorage.clear(); return true })()`)
await send('Page.reload')
await waitFor(`document.querySelector('.unified-search-input')`, 30000, '清库后重新挂载')

// 记录基线：这条域名是否已在库（避免落到「已收录」分支）
const preCount = await evalJs(`(() => { try { const r = JSON.parse(localStorage.getItem('nav-sites-overlay')||'{}'); const d = r.data || r; return (d.adds||[]).length } catch { return -1 } })()`)

// 挂 fetch 探针：记录 /api/metadata 的调用时刻与结果
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
      p.then(r => { rec.done = true; rec.ms = Date.now() - t0; rec.status = r.status; rec.clone().text().then(t => { try { rec.body = JSON.parse(t) } catch { rec.body = null } }) })
       .catch(e => { rec.done = true; rec.ms = Date.now() - t0; rec.err = String(e && e.message) });
    }
    return p;
  };
  return true;
})()`)

// 输入网址 → 回车（无头 Chrome 里 focus 事件不一定派发，先来一次真实 mousedown）
await evalJs(`(() => {
  const el = document.querySelector('.unified-search-input');
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  el.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(TARGET)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return el.value;
})()`)

await sleep(400)
const firstItem = await evalJs(`(() => {
  const it = document.querySelector('.omni-item');
  if (!it) return null;
  const t = [...it.querySelectorAll('.omni-item-title')].map(n => n.textContent).join('');
  const s = [...it.querySelectorAll('.omni-item-subtitle')].map(n => n.textContent).join('');
  return { title: t, subtitle: s };
})()`)
console.log('  置顶项：', JSON.stringify(firstItem))
ok(Boolean(firstItem), '输入网址后出现置顶操作项')

const addT0 = Date.now()
await evalJs(`(() => {
  const el = document.querySelector('.unified-search-input');
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  return true;
})()`)

// 等「已添加」toast 出现
const gotToast = await waitFor(
  `[...document.querySelectorAll('.toast-msg')].some(n => n.textContent.includes('已添加'))`,
  25000, '「已添加」toast'
)
const toastAt = Date.now()
const toastText = await evalJs(`(() => { const n = [...document.querySelectorAll('.toast-msg')].find(x => x.textContent.includes('已添加')); return n ? n.textContent.trim() : '' })()`)
ok(gotToast, '添加完成有回执', `${toastText}（${toastAt - addT0}ms）`)

/** 读本地覆盖层的最后一条新增记录 */
const readAdded = () => evalJs(`(() => {
  try {
    const raw = JSON.parse(localStorage.getItem('nav-sites-overlay') || '{}');
    // 覆盖层经 encodeStored 包装：{ __navDataVersion, data: {...} }
    const d = (raw && raw.data) || raw;
    const a = (d.adds || []);
    const s = a[a.length - 1];
    return s ? { id: s.id, name: s.name, desc: s.desc, url: s.url, categoryId: s.categoryId, updatedAt: s.updatedAt, local: s.local, pendingMeta: s.pendingMeta, nameOriginal: s.nameOriginal } : null;
  } catch (e) { return { error: String(e) } }
})()`)

const snap0 = await readAdded()
console.log('\n  秒加瞬间入库：')
console.log('   ', JSON.stringify(snap0))
ok(Boolean(snap0 && snap0.id), '站点已入库（秒加）')
ok(preCount >= 0 && snap0, '覆盖层可读')

// 采样 40 秒，记录任何一次变化
console.log('\n  跟踪 40 秒内的字段变化…')
let last = snap0
const changes = []
const deadline = Date.now() + 40000
while (Date.now() < deadline) {
  await sleep(1000)
  const cur = await readAdded()
  if (!cur || !cur.id) continue
  if (cur.id !== last.id) { console.log('   （检测到新的 add 条目，重置基线）'); last = cur; continue }
  const diff = {}
  for (const k of ['name', 'desc', 'updatedAt', 'pendingMeta']) {
    if (JSON.stringify(cur[k]) !== JSON.stringify(last[k])) diff[k] = [last[k], cur[k]]
  }
  if (Object.keys(diff).length) {
    changes.push({ at: Date.now() - addT0, diff })
    console.log(`   ⏱ +${Math.round((Date.now() - addT0) / 1000)}s 发生变化:`)
    for (const [k, [a, b]] of Object.entries(diff)) console.log(`      ${k}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`)
    last = cur
  }
}

// 等抓取探针把响应体读全（clone().text() 是异步的）
await evalJs(`(async () => {
  const calls = window.__metaCalls || [];
  for (let i = 0; i < 80; i++) {
    if (calls.length && calls.every(c => c.done && (c.body !== undefined || c.err))) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
})()`)
const calls = await evalJs(`window.__metaCalls || []`)
console.log('\n  /api/metadata 调用记录：')
for (const c of calls) {
  console.log(`    ${c.ms ?? '?'}ms status=${c.status ?? c.err} translated=${JSON.stringify(c.body?.translated)} name=${JSON.stringify(c.body?.name)} warning=${JSON.stringify(c.body?.warning)}`)
}

const snapEnd = await readAdded()
console.log('\n  最终库内内容：')
console.log('   ', JSON.stringify(snapEnd))

console.log('\n  ── 结论 ──')
ok(calls.length > 0, '后台确实发起了 /api/metadata 抓取', `${calls.length} 次`)
ok(changes.length > 0, '返回后库内记录被改写（升级生效）', `${changes.length} 次改写`)
if (snapEnd && snap0) {
  const nameChanged = snapEnd.name !== snap0.name
  const descChanged = snapEnd.desc !== snap0.desc
  ok(nameChanged || descChanged, '升级后的名称/描述与秒加值不同', `name:${nameChanged} desc:${descChanged}`)
}

console.log(`\n${failures.length ? '❌' : '✅'} 通过 ${pass} 项，失败 ${failures.length} 项`)
if (failures.length) { console.log('失败项：'); failures.forEach(f => console.log('  - ' + f)) }
ws.close()
process.exit(failures.length ? 1 : 0)
