/**
 * 真机验收：「添加站点」弹窗那句状态文案，说的是不是真话。
 *
 * 这句话原先在 `AddSiteModal.vue` 里有**两个**触发点，含义完全不同却共用同一句文案：
 *   ① `!r.ok` —— 接口真的没打成功（网络/限流/非 JSON）；
 *   ② 抓取成功但 `!better` —— 接口通了，只是服务端也没能读出比本地推断更好的东西
 *      （典型：服务端抓取超时，回退到同一套域名推断，于是和本地草稿一模一样）。
 *
 * ② 的情况下面向用户说「后端抓取不可用」是**说假话**（真机复现：github.com 接口 200、
 * 服务端 warning 已写明「抓取超时…」，前端却丢了这句真话）。项目口径见 MEMORY：
 * 不要把「在线但接口不可用」写成「已离线」，反过来也一样。
 *
 * 修好后本探针转为**验收**，核心断言两条：
 *   - 接口 200 时，文案里绝不出现「后端抓取不可用」，且原样转达服务端 warning；
 *   - 接口真失败时，文案要给出具体原因，而不是笼统概括。
 *
 * 用法：node probe/add-modal-status.mjs <cdp-port> [base] [url1] [url2] ...
 */
const PORT = process.argv[2] || '9351'
const BASE = (process.argv[3] || 'https://nav-dashboard-19166.app.workbuddy.host').replace(/\/+$/, '')
const TARGETS = process.argv.slice(4).length
  ? process.argv.slice(4)
  : ['https://github.com', 'https://www.figma.com']

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
console.log(`\n▶ 目标环境：${BASE}\n`)

await send('Page.navigate', { url: BASE })
await waitFor(`document.querySelector('.add-site-btn')`, 30000, '应用首屏挂载')
ok(true, '线上应用已挂载')

// 记录 /api/metadata 的调用与响应（探针自己的 fetch 包装）
await evalJs(`(() => {
  window.__meta = [];
  if (window.__origFetch) return true;
  window.__origFetch = window.fetch;
  window.fetch = function (input) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const t0 = Date.now();
    const p = window.__origFetch.apply(this, arguments);
    if (url.includes('/api/metadata')) {
      const rec = { url, t0 };
      window.__meta.push(rec);
      p.then(function (r) {
        rec.status = r.status;
        rec.ms = Date.now() - t0;
        return r.clone().text();
      }).then(function (t) { try { rec.body = JSON.parse(t) } catch (e) { rec.raw = String(t).slice(0, 120) } })
        .catch(function (e) { rec.err = String(e && e.message) });
    }
    return p;
  };
  return true;
})()`)

for (const T of TARGETS) {
  console.log(`\n──────── ${T} ────────`)
  await evalJs(`window.__meta = []; true`)

  // 打开添加弹窗
  await evalJs(`document.querySelector('.add-site-btn').click(); true`)
  const opened = await waitFor(`document.querySelector('input[type=url]')`, 15000, '添加弹窗打开')
  ok(opened, '添加弹窗可打开')

  const t0 = Date.now()
  await evalJs(`(() => {
    const el = document.querySelector('input[type=url]');
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(T)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return el.value;
  })()`)

  // 采样状态文案：等它「稳定」下来。
  // 稳定判据必须**长于真实抓取耗时** —— 线上 /api/metadata 实测要 5~9.4s，
  // 用 4s 会在 loading 态就判定收敛（第一次跑就踩了这个坑）。这里取 12s。
  const seen = []
  let last = ''
  let stableSince = Date.now()
  const deadline = Date.now() + 40000
  while (Date.now() < deadline) {
    await sleep(400)
    const txt = await evalJs(`(() => { const n = document.querySelector('.status-line span:last-child'); return n ? n.textContent.trim() : '' })()`)
    const kind = await evalJs(`(() => { const n = document.querySelector('.status-line'); return n ? n.className : '' })()`)
    if (txt && txt !== last) {
      seen.push({ at: Date.now() - t0, txt, kind })
      console.log(`  ⏱ +${Math.round((Date.now() - t0) / 1000)}s  [${kind.replace('status-line', '').trim() || '-'}] ${txt}`)
      last = txt
      stableSince = Date.now()
    } else if (txt && txt === last) {
      if (Date.now() - stableSince > 12000) break
    }
  }

  const calls = await evalJs(`window.__meta || []`)
  for (const c of calls) {
    const b = c.body || {}
    console.log(`  📡 ${c.ms ?? '?'}ms status=${c.status ?? c.err} warning=${JSON.stringify(b.warning ?? '')} name=${JSON.stringify(b.name)} translated=${JSON.stringify(b.translated)}`)
  }

  const finalTxt = seen.length ? seen[seen.length - 1].txt : ''
  const isUnavailable = finalTxt.includes('后端抓取不可用')
  const apiOk = calls.some(c => c.status === 200)
  const warning = (calls.map(c => (c.body || {}).warning).find(w => w) || '')
  const apiFailMsg = (calls.map(c => (c.body || {}).message).find(m => m) ||
    (calls.map(c => c.err).find(Boolean) || ''))

  if (isUnavailable) {
    console.log(`\n  ⟹ 文案判定「后端抓取不可用」，但接口 HTTP 状态：${calls.map(c => c.status ?? c.err).join(',') || '未发起'}`)
  } else {
    console.log(`\n  ⟹ 未出现「后端抓取不可用」文案`)
  }

  // ① 核心契约：接口通了就绝不能说后端不可用
  if (apiOk) {
    ok(!isUnavailable, '【核心】接口 200 时不说「后端抓取不可用」',
      isUnavailable ? `文案：${finalTxt}` : '')
    // 服务端已经写明了原因（如「抓取超时…」），前端应当原样转达而不是丢掉
    if (warning) {
      ok(finalTxt.includes(warning), '原样转达了服务端 warning（不丢真话）',
        finalTxt.includes(warning) ? warning : `服务端=${warning} / 文案=${finalTxt}`)
    } else {
      ok(!/后端/.test(finalTxt) || /页面/.test(finalTxt),
        '无 warning 时把归因指向对方页面而非自己的后端', finalTxt)
    }
  } else if (calls.length) {
    // ② 接口真失败：文案要给具体原因（限流/内网/404/网络），而不是笼统
    const specific = apiFailMsg && finalTxt.includes(apiFailMsg.slice(0, 6))
    ok(specific || !isUnavailable, '接口失败时给出具体原因（或至少不是笼统「后端不可用」）',
      `传输层=${apiFailMsg || '无'} / 文案=${finalTxt}`)
  } else {
    ok(false, '一次 /api/metadata 都没发起（弹窗本该触发抓取）')
  }
  ok(finalTxt.length > 0, '状态文案非空（不把用户晾在 loading）')

  // 关掉弹窗，准备下一个
  await evalJs(`(() => { const b = document.querySelector('.modal-close, .modal .close, [aria-label=关闭]'); if (b) b.click(); return true })()`)
  await sleep(600)
}

console.log(`\n${failures.length ? '❌' : '✅'} 通过 ${pass} 项，失败 ${failures.length} 项`)
if (failures.length) { console.log('失败项：'); failures.forEach(f => console.log('  - ' + f)) }
ws.close()
process.exit(0)
