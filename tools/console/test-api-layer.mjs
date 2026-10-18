/**
 * 接口层门禁：组件层不得绕过 services 直连 /api
 *
 * 为什么需要它：`src/services/` 早就把各接口封装好了（deployApi / opsApi / authApi /
 * session / healthApi …），但**封装存在 ≠ 组件在用它** —— 收敛前 `/api/deploy-status`
 * 在 4 个组件里各写了一遍（AboutView / AdminView / AdminAside / AdminLogin），
 * 接口一旦改名或加鉴权头，就得靠人去翻组件。
 *
 * 本门禁把「组件只消费 services、不自己拼 /api 路径」这条不变量钉住。
 *
 * 边界（有意不查）：
 *   - `services/` 与 `stores/` 是数据访问层，允许直接 fetch（它们就是那层）。
 *   - 只查 `fetch(…)` 调用里的 `/api`，**不查所有 `/api` 字面量** ——
 *     注释里提到接口名是正常的；`<img :src="/api/cover…">` 这类也不是请求调用。
 *
 * 运行：node tools/console/test-api-layer.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const ROOT_FWD = ROOT.replace(/\\/g, '/')
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

// `fetch(` 到该调用的第一个 `)` 之间出现 `/api` —— 即「裸调接口」
const CALL_RE = /fetch\([^)]*\/api/g

const offenders = []
for (const sub of ['views', 'components']) {
  for (const f of walk(join(ROOT, 'src', sub))) {
    const m = readFileSync(f, 'utf8').match(CALL_RE)
    if (m) offenders.push(`${f.replace(/\\/g, '/').replace(ROOT_FWD, '')}: ${m.length} 处`)
  }
}

console.log('\n── 组件层不绕过 services 直连 /api ──')
ok(offenders.length === 0,
  'src/views 与 src/components 内无裸 fetch("/api…")',
  offenders.length ? '\n      ' + offenders.join('\n      ') : '')

const services = readdirSync(join(ROOT, 'src', 'services')).filter(f => f.endsWith('.js'))
ok(services.length >= 8, `services/ 有 ${services.length} 个封装模块`)

const deploySrc = readFileSync(join(ROOT, 'src', 'services', 'deployApi.js'), 'utf8')
ok(deploySrc.includes('/api/deploy-status'), 'deployApi 封装了 /api/deploy-status')
const healthExists = services.includes('healthApi.js')
ok(healthExists, 'healthApi 封装了 /api/health 与 /api/health-history')

if (failures.length) {
  console.error(`\n❌ 接口层门禁 ${failures.length} 条失败（通过 ${pass} 条）`)
  console.error('  组件里请改用 services/ 下的封装（deployApi / healthApi / opsApi …），')
  console.error('  不要把 /api 路径写死在组件里 —— 改名或加鉴权时就漏改了。')
  process.exit(1)
}
console.log(`\n✅ 接口层门禁通过：${pass} 条断言`)
