/**
 * 存储安全门禁（localStorage 写入必须走 safeStorage）
 *
 * 为什么需要它：`localStorage.setItem` 在配额满 / Safari 无痕 / 隐私设置下会抛
 * `QuotaExceededError`。裸调用会让异常冒泡、打断业务 —— 项目已有过两次真实后果
 * （`recordVisit` 里抛错 → 这次点击不计入云端口径；`deleteSite` 里抛错 → 站点复活但回收站没有）。
 * `utils/safeStorage.js` 把失败降级为「内存态仍然正确 + 控制台告警」，绝不打断流程。
 *
 * 但「有包装」不等于「都走包装」：收敛前有 **23 处裸调用散落 6 个业务文件**
 * （deployApi / opsApi / session / offlineQueue / searchHistory / AdminView）。
 * 这道门禁守住「写入必须走 safeStorage」这条不变量，防它再漂回去。
 *
 * 注意：`getItem` 不抛配额错、**不需要**包装 —— 所以本门禁只管 set/remove，
 * 不误报读取。
 *
 * 运行：node tools/console/test-storage-guard.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? ` → ${extra}` : ''}`) }
  else { failures.push(label); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`) }
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(vue|js|mjs)$/.test(e.name)) out.push(p)
  }
  return out
}

const ROOT_FWD = ROOT.replace(/\\/g, '/')
const WRITE_RE = /localStorage\.(setItem|removeItem)\s*\(/g
const ALLOWED = ['safeStorage.js'] // 包装本身当然在调它

const offenders = []
let safeUsers = 0
for (const f of walk(join(ROOT, 'src'))) {
  const rel = f.replace(/\\/g, '/').replace(ROOT_FWD, '')
  const src = readFileSync(f, 'utf8')
  const m = src.match(WRITE_RE)
  if (m && !ALLOWED.some(a => rel.endsWith(a))) offenders.push(`${rel}: ${m.length} 处`)
  if (/from ['"][^'"]*safeStorage(\.js)?['"]/.test(src)) safeUsers++
}

console.log('\n── localStorage 写入一律走 safeStorage ──')
ok(offenders.length === 0,
  'src/ 内无裸 localStorage.setItem / removeItem',
  offenders.length ? '\n      ' + offenders.join('\n      ') : '')
ok(safeUsers >= 5, `已有 ${safeUsers} 个模块引用 safeStorage`,
  safeUsers >= 5 ? '' : '（偏少，包装可能被绕过）')

// 包装自身必须导出两个函数
const safeSrc = readFileSync(join(ROOT, 'src', 'utils', 'safeStorage.js'), 'utf8')
ok(/export function safeSetItem/.test(safeSrc), 'safeStorage 导出 safeSetItem')
ok(/export function safeRemoveItem/.test(safeSrc), 'safeStorage 导出 safeRemoveItem')

if (failures.length) {
  console.error(`\n❌ 存储安全门禁 ${failures.length} 条失败（通过 ${pass} 条）`)
  console.error('  写入请用 utils/safeStorage.js 的 safeSetItem / safeRemoveItem：')
  console.error('  配额满 / 无痕模式下裸 setItem 会抛错并打断业务流程（改动降级为仅内存生效 + 告警）。')
  process.exit(1)
}
console.log(`\n✅ 存储安全门禁通过：${pass} 条断言`)
