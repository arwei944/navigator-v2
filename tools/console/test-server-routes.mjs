/**
 * 服务端路由门禁：`api/` 目录 ↔ 构建产物 ↔ 路由表 三者同源
 *
 * 为什么需要它：`api/` 下的每个 `.js` 就是对外的接口，但「有文件」不等于
 * 「线上能访问」。这条链上有三个环节，历史上每一处都是手抄清单：
 *
 *   ① `server/main.mjs` 的 import + 路由表（原先 16 组，两行一组）
 *   ② `scripts/postbuild-spa-fallbacks.mjs` 的复制白名单
 *   ③ 部署包里的 `api/` 实际文件
 *
 * 漏掉任何一处的后果都不是报错，而是**静默 404**：我们的约定里 404 有业务含义
 * （前端据此判定「本部署没有该接口」并停止轮询），所以表现成「后台某个面板不工作」，
 * 而且线上才看得见。
 *
 * 现在 ① 和 ② 都改成按目录派生，本门禁负责钉住剩下的不变量：
 *   - 每个 `api/*.js` 都有 `export default`（路由表依赖它）
 *   - 构建产物里的 `api/` 与仓库 `api/` 文件集**逐一相等**（不多不少）
 *   - `server.js` 里确实用目录派生（防止有人改回手抄清单）
 *
 * 运行：node tools/console/test-server-routes.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? ` → ${extra}` : ''}`) }
  else { failures.push(`${label}${extra ? ` — ${extra}` : ''}`); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`) }
}

/* ---------------- ① 接口文件契约 ---------------- */

const API_DIR = join(ROOT, 'api')
const apiJs = readdirSync(API_DIR).filter(f => f.endsWith('.js')).sort()
ok(apiJs.length > 0, `api/ 下有 ${apiJs.length} 个接口文件`)

const noDefault = apiJs.filter(f => !/export\s+default/.test(readFileSync(join(API_DIR, f), 'utf8')))
ok(noDefault.length === 0, '每个 api/*.js 都有 default 导出（路由表依赖它）', noDefault.join(' '))

/* ---------------- ② 构建产物与仓库同源 ---------------- */

const DIST_API = join(ROOT, 'dist', 'api')
if (!existsSync(DIST_API)) {
  // 未构建时不算失败：这道门禁要守的是「构建出来是否一致」，
  // 而不是「你有没有先构建」。与 test-bundle 的 --strict 语义保持一致。
  const strict = process.argv.includes('--strict')
  console.log('  ℹ️  没有 dist/api（未构建）—— 跳过产物比对')
  ok(!strict, '产物比对（未构建，--strict 下视为失败）', strict ? '先跑 npm run build' : '')
} else {
  const distJs = readdirSync(DIST_API).filter(f => f.endsWith('.js')).sort()
  const missing = apiJs.filter(f => !distJs.includes(f))
  const extra = distJs.filter(f => !apiJs.includes(f))
  ok(missing.length === 0, `仓库的 ${apiJs.length} 个接口全部进了产物`, missing.join(' ') || '')
  ok(extra.length === 0, '产物里没有仓库不存在的残留接口', extra.join(' ') || '')
}

/* ---------------- ③ 路由表确实是目录派生 ---------------- */

const serverSrc = readFileSync(join(ROOT, 'server', 'main.mjs'), 'utf8')
ok(/readdirSync\(API_DIR\)|readdirSync\([^)]*api[^)]*\)/.test(serverSrc),
  'server/main.mjs 的路由表从 api/ 目录派生（不是手抄清单）')
ok(!/const \w+Handler = \(await import\('\.\/api\//.test(serverSrc),
  'server/main.mjs 里没有逐个 import 接口的手抄残留')

/* ---------------- ④ 构建脚本同样派生 ---------------- */

const postSrc = readFileSync(join(ROOT, 'scripts', 'postbuild-spa-fallbacks.mjs'), 'utf8')
ok(/readdirSync\(join\(root, 'api'\)\)/.test(postSrc),
  'postbuild 的接口复制清单从目录派生（不是白名单）')
ok(!/\['sites\.js',/.test(postSrc),
  'postbuild 里没有遗留的手工文件名白名单')

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 服务端路由门禁 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  console.error('\n  这类漂移只会表现为线上「某个接口 404」，本地构建不报错。')
  process.exit(1)
}
console.log(`\n✅ 服务端路由门禁通过：${pass} 条断言`)
