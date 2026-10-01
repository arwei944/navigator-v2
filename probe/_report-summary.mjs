import { readFileSync } from 'node:fs'

const raw = JSON.parse(readFileSync('_probe-report.json', 'utf8'))
const lines = raw.lines

const results = []
const steps = []
const drawers = []
const backs = []
const palettes = []
const keyboards = []
const persists = []
const caps = []
const notes = []
for (const l of lines) {
  if (l.startsWith('RESULT ')) results.push(JSON.parse(l.slice(7)))
  else if (l.startsWith('STEPS ')) steps.push(JSON.parse(l.slice(6)))
  else if (l.startsWith('DRAWER ')) drawers.push(JSON.parse(l.slice(7)))
  else if (l.startsWith('BACK ')) backs.push(JSON.parse(l.slice(5)))
  else if (l.startsWith('PALETTE ')) palettes.push(JSON.parse(l.slice(8)))
  else if (l.startsWith('KEYBOARD ')) keyboards.push(JSON.parse(l.slice(9)))
  else if (l.startsWith('PERSIST ')) persists.push(JSON.parse(l.slice(8)))
  else if (l.startsWith('CAPABILITY ')) caps.push(JSON.parse(l.slice(11)))
  else notes.push(l)
}

console.log('================ 运行说明 ================')
for (const n of notes) console.log('  ' + n)

console.log('\n================ RESULT（静态测量） ================')
const cols = ['cfg', 'url', 'mainW', 'sidebarW', 'rightW', 'hOverflow', 'navItems',
  'sidebarOverflow', 'filterBarVisible', 'domainTabs', 'chips', 'chipRowOverflowX', 'cardsRendered']
for (const r of results) {
  if (r.error) { console.log(r.cfg + '  ERROR ' + r.error); continue }
  console.log(cols.map(c => `${c}=${r[c]}`).join('  '))
}

console.log('\n================ 移动端关键项（≤768） ================')
for (const r of results) {
  if (!r.cfg || !r.cfg.includes('@375')) continue
  console.log(`${r.cfg.padEnd(22)} mainW=${r.mainW} sidebar=${r.sidebarPos} right=${r.rightDisplay} tabbar=${r.tabbarDisplay} tabs=${r.tabLabels} hOverflow=${r.hOverflow}`)
}

console.log('\n================ 域 tabs 标签（计数） ================')
for (const r of results) {
  if (r.domainLabels) console.log(`${r.cfg.padEnd(22)} ${r.domainLabels}  | active=${r.activeDomain} | chips=${r.chips}`)
}

/* AC-4：侧栏 5 项首屏可见（桌面 900 高，无需滚动） */
console.log('\n================ AC-4 侧栏首屏可见 ================')
let ac4Bad = 0
{
  const seen = new Set()
  for (const r of results) {
    if (r.error || !r.cfg.includes('@1440') || seen.has(r.cfg)) continue
    seen.add(r.cfg)
    if (!r.navAllVisible) ac4Bad++
    console.log(`  ${r.navAllVisible ? 'OK ' : '!! '}${r.cfg.padEnd(22)} navItems=${r.navItems} navAllVisible=${r.navAllVisible}`)
  }
}

/* AC-6：首屏内容优先（≥6 卡片 / chrome 行数 ≤2）—— 只看默认「全部」视图 */
console.log('\n================ AC-6 首屏内容优先 ================')
let ac6Bad = 0
{
  const seen = new Set()
  for (const r of results) {
    if (r.error || r.url !== '/') continue
    if (!/@1440|@1920/.test(r.cfg) || seen.has(r.cfg)) continue
    seen.add(r.cfg)
    const cardsOk = r.cardsInFirstScreen >= 6
    const rowsOk = r.chromeRows <= 2
    if (!cardsOk || !rowsOk) ac6Bad++
    console.log(`  ${cardsOk && rowsOk ? 'OK ' : '!! '}${r.cfg.padEnd(14)} 首屏卡片=${String(r.cardsInFirstScreen).padStart(2)} (需≥6)  chrome行=${r.chromeRows} (需≤2)  chrome高=${r.chromeTotal}  gridTop=${r.gridTop}`)
  }
}

console.log('\n================ STEPS（交互断言） ================')
for (const s of steps) {
  console.log('\n--- ' + s.cfg)
  for (const st of s.steps) {
    if (st.error) { console.log(`  ${st.tag}  ERROR ${st.error}`); continue }
    const flag = st.countMatchesCards ? 'OK ' : '!! '
    console.log(`  ${flag}${String(st.tag).padEnd(18)} path=${String(st.path).padEnd(24)} dom=${String(st.activeDomain).padEnd(14)} chip=${String(st.activeChip).padEnd(14)} cards=${String(st.cards).padStart(3)} count=${String(st.countShown).padStart(3)}`)
  }
}

const allSteps = steps.flatMap(s => s.steps).filter(s => !s.error)
const bad = allSteps.filter(s => s.countMatchesCards === false)

/* 范围保持：从收藏/最近进入筛选，路径必须原地不动（这是本次修复的核心） */
console.log('\n================ 范围保持（修复回归） ================')
let scopeBad = 0
for (const s of steps) {
  const base = s.cfg.split(' @')[0].split('?')[0]
  if (base !== '/favorites' && base !== '/recent') continue
  for (const st of s.steps) {
    if (st.error) continue
    const kept = String(st.path).split('?')[0] === base
    if (!kept) scopeBad++
    console.log(`  ${kept ? 'OK ' : '!! '}${s.cfg}  ${String(st.tag).padEnd(18)} path=${String(st.path).padEnd(24)} cards=${st.cards}`)
  }
}

/* AC-2：汉堡开合抽屉 —— 三次快照的状态迁移必须全部发生 */
console.log('\n================ AC-2 移动端抽屉开合 ================')
let drawerBad = 0
for (const d of drawers) {
  const [a, b, c] = d.steps
  const tx = (t) => {
    const m = /matrix\(([^)]+)\)/.exec(String(t))
    return m ? Number(m[1].split(',')[4]) : null
  }
  const off = (s) => tx(s?.transform) < -1   // 抽屉停在屏幕外
  const on = (s) => Math.abs(tx(s?.transform) ?? 999) < 1 // 归位到 0
  const checks = [
    ['初始关闭（停在屏幕外）', a && a.open === false && a.hamburgerW > 0 && off(a)],
    ['点击后打开（归位 0）', b && b.open === true && b.overlayShown === true && on(b)],
    ['遮罩点击后关闭（退回屏幕外）', c && c.open === false && c.overlayShown === false && off(c)]
  ]
  for (const [name, ok] of checks) {
    if (!ok) drawerBad++
    console.log(`  ${ok ? 'OK ' : '!! '}${d.cfg}  ${name}`)
  }
  console.log(`      hamburger=${a?.hamburgerW}px  transform: ${a?.transform} → ${b?.transform} → ${c?.transform}`)
}

/* AC-3：返回键 —— 筛选后回退必须复原范围与计数 */
console.log('\n================ AC-3 浏览器返回键 ================')
let backBad = 0
for (const bk of backs) {
  const [a, b, c] = bk.steps
  const checks = [
    ['初始收藏', a && String(a.path).split('?')[0] === '/favorites' && a.countMatchesCards === true],
    ['筛选进入', b && String(b.path).includes('c=crypto') && b.countMatchesCards === true],
    ['回退复原', c && String(c.path).split('?')[0] === '/favorites' && c.cards === a?.cards && c.countMatchesCards === true]
  ]
  for (const [name, ok] of checks) {
    if (!ok) backBad++
    console.log(`  ${ok ? 'OK ' : '!! '}${bk.cfg}  ${name}`)
  }
  console.log(`      ${a?.path}(${a?.cards}) → ${b?.path}(${b?.cards}) → ${c?.path}(${c?.cards})`)
}

/* AC-8：旧链接不失效（/category/:id 与 /c/:id 都重定向到 /?c=:id） */
console.log('\n================ AC-8 旧链接兼容 ================')
let ac8Bad = 0
{
  const seen = new Set()
  for (const r of results) {
    if (r.error) continue
    const m = /^(\/(?:c|category)\/([a-z0-9]+))/.exec(r.cfg)
    if (!m || seen.has(r.cfg)) continue
    seen.add(r.cfg)
    // 旧链接只需把分类搬到 query，其它既有参数（sort 等）应原样保留，顺序不作要求
    const [p, qs] = String(r.url).split('?')
    const ok = p === '/' && new URLSearchParams(qs || '').get('c') === m[2]
    if (!ok) ac8Bad++
    console.log(`  ${ok ? 'OK ' : '!! '}${m[1].padEnd(16)} → ${r.url}  cards=${r.cardsRendered}`)
  }
}

/* AC-5：分类可检索（命令面板输入「交」→ 命中「交易所 CEX」→ 进入 /?c=cex） */
console.log('\n================ AC-5 分类可检索（命令面板） ================')
let ac5Bad = 0
for (const p of palettes) {
  const [opened, typed, clicked] = p.steps
  const checks = [
    ['面板可打开', opened && opened.panel === true],
    ['输入「交」命中「交易所 CEX」', typed && typed.categoryHit === true],
    ['点击后进入 /?c=cex', clicked && clicked.path === '/?c=cex']
  ]
  for (const [name, ok] of checks) { if (!ok) ac5Bad++; console.log(`  ${ok ? 'OK ' : '!! '}${p.cfg}  ${name}`) }
  console.log(`      分组=${typed?.groups}  落到 ${clicked?.path} chip=${clicked?.activeChip} cards=${clicked?.cards}`)
}

/* AC-7：键盘全链路（切范围 → 选分类 → 打开站点入口） */
console.log('\n================ AC-7 键盘全链路 ================')
let ac7Bad = 0
for (const k of keyboards) {
  const [a, b, c] = k.steps
  const checks = [
    ['键盘切范围（回车 → /favorites）', a && String(a.path).split('?')[0] === '/' && b && String(b.path).split('?')[0] === '/favorites' && b.focusOk === true],
    ['键盘选分类（回车 → /?c=cex）', c && String(c.path).includes('c=cex')],
    ['打开站点入口可聚焦', c && c.visitFocusable === true && !!c.visitHref]
  ]
  for (const [name, ok] of checks) { if (!ok) ac7Bad++; console.log(`  ${ok ? 'OK ' : '!! '}${k.cfg}  ${name}`) }
  console.log(`      ${a?.path} → ${b?.path} → ${c?.path}  visitHref=${c?.visitHref}`)
}

/* AC-10：侧栏偏好保持（折叠 → 刷新 → 仍折叠） */
console.log('\n================ AC-10 侧栏偏好保持 ================')
let ac10Bad = 0
for (const p of persists) {
  const [a, b, c] = p.steps
  const checks = [
    ['折叠生效', a && a.collapsed === false && b && b.collapsed === true],
    ['刷新后仍折叠', c && c.collapsed === true]
  ]
  for (const [name, ok] of checks) { if (!ok) ac10Bad++; console.log(`  ${ok ? 'OK ' : '!! '}${p.cfg}  ${name}`) }
  console.log(`      collapsed: ${a?.collapsed} → ${b?.collapsed} → ${c?.collapsed}   width: ${a?.width} → ${b?.width} → ${c?.width}`)
}

/* AC-9：能力无回归（8 项） */
console.log('\n================ AC-9 能力无回归（8 项） ================')
let ac9Bad = 0
const CAP_NAMES = { favorite: '收藏', todo: '待办', history: '历史', trash: '回收站', batchSelect: '批量选择', dragSort: '拖拽排序', palette: '命令面板', admin: '管理后台' }
for (const c of caps) {
  const s = c.steps[0] || {}
  for (const key of Object.keys(CAP_NAMES)) {
    const ok = s[key] === true
    if (!ok) ac9Bad++
    console.log(`  ${ok ? 'OK ' : '!! '}${CAP_NAMES[key]}`)
  }
  console.log(`      原始：${JSON.stringify(s)}`)
}

const failTotal = bad.length + scopeBad + drawerBad + backBad + ac4Bad + ac5Bad + ac6Bad + ac7Bad + ac8Bad + ac9Bad + ac10Bad
console.log(`\n交互快照 ${allSteps.length} 个，计数≠卡片数 ${bad.length} 个，范围被挤掉 ${scopeBad} 个`)
console.log(`抽屉断言 ${drawers.length * 3} 条失败 ${drawerBad}；返回键 ${backs.length * 3} 条失败 ${backBad}`)
console.log(`AC-4 失败 ${ac4Bad}；AC-5 失败 ${ac5Bad}；AC-6 失败 ${ac6Bad}；AC-7 失败 ${ac7Bad}；AC-8 失败 ${ac8Bad}；AC-9 失败 ${ac9Bad}；AC-10 失败 ${ac10Bad}`)
console.log(failTotal === 0 ? '★ 全部断言通过' : `✗ 合计失败 ${failTotal} 条`)
if (bad.length) for (const b of bad) console.log('  x ' + JSON.stringify(b))