/**
 * 门禁：增量上传的「产物指纹」与「增量集判据」。
 *
 * 为什么需要：`packSlices` 的增量逻辑依赖 `walkDistHashes` 的两个不变量 ——
 *   1. `data/`（密钥 + SQLite）绝不进指纹、绝不进包；
 *   2. **内容不变 → 指纹不变**（否则每次都会误判全量，优化失效）；
 *      内容变或新增 → 指纹变（否则会漏传文件，线上缺件）。
 * 这两条一旦破了，要么把密钥传上线，要么线上半残 —— 都很难当场发现。
 * 所以写成门禁锁住。
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { walkDistHashes, STARTUP_REQUIRED } from './lib/publish/deploy.mjs'

let pass = 0, fail = 0
const eq = (a, b, msg) => { if (a === b) pass++; else { fail++; console.error(`✗ ${msg}：期望「${b}」，实得「${a}」`) } }
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`✗ ${msg}`) } }

const dir = mkdtempSync(join(tmpdir(), 'nav-manifest-test-'))
try {
  mkdirSync(join(dir, 'assets'))
  mkdirSync(join(dir, 'data'))
  writeFileSync(join(dir, 'index.html'), '<html>a</html>')
  writeFileSync(join(dir, 'assets', 'index-abc.js'), 'console.log(1)')
  writeFileSync(join(dir, 'data', 'admin-key.txt'), 'SECRET-MUST-NOT-SHIP')

  const h1 = walkDistHashes(dir)
  ok(!('data/admin-key.txt' in h1), 'data/ 必须被排除（密钥绝不进指纹）')
  ok('index.html' in h1 && 'assets/index-abc.js' in h1, '普通文件应被收录')
  eq(Object.keys(h1).length, 2, '文件数应为 2（data/ 不计）')

  const h2 = walkDistHashes(dir)
  eq(JSON.stringify(h1), JSON.stringify(h2), '未改动时指纹必须完全一致（否则增量失效）')

  writeFileSync(join(dir, 'assets', 'index-abc.js'), 'console.log(2)')
  const h3 = walkDistHashes(dir)
  eq(h3['index.html'], h1['index.html'], '未改动的文件指纹不应变')
  ok(h3['assets/index-abc.js'] !== h1['assets/index-abc.js'], '改动的文件指纹必须变')

  const changed = Object.keys(h3).filter(r => h1[r] !== h3[r])
  eq(changed.join(','), 'assets/index-abc.js', '增量集应只含改动文件')

  writeFileSync(join(dir, 'assets', 'new-def.js'), 'x')
  const h4 = walkDistHashes(dir)
  const changed4 = Object.keys(h4).filter(r => h1[r] !== h4[r]).sort()
  eq(changed4.join(','), 'assets/index-abc.js,assets/new-def.js', '新增文件应计入增量')

  // 维持原样 → 增量为空（此时不应重传任何文件）
  const h5 = walkDistHashes(dir)
  eq(Object.keys(h5).filter(r => h4[r] !== h5[r]).length, 0, '无改动时增量集必须为空')

  /* ---------- 容器启动必需文件（2026-10-18 线上 503 事故的根因防线） ----------
   * 容器靠「删 server.js → 解压 → 启动」复活，所以增量包**任何时候**都必须含
   * server.js 及其依赖。锁住这条，避免重演「只传前端把容器打挂」。 */
  ok(STARTUP_REQUIRED('server.js'), 'server.js 必须被认定为启动必需（容器靠它触发解压）')
  ok(!STARTUP_REQUIRED('store.mjs') && !STARTUP_REQUIRED('cron.mjs') && !STARTUP_REQUIRED('api/sites.js') && !STARTUP_REQUIRED('shared/auth.mjs'),
    'store/cron/api/shared 不是每次必需（容器 restart 保留文件系统，由根目录健康检查兜底）')
  ok(!STARTUP_REQUIRED('assets/index-abc.js'), '前端 chunk 不是启动必需（应随变化才传）')
  ok(!STARTUP_REQUIRED('icons/a.png'), '图标不是启动必需')

  // 端到端：只改了一个前端 chunk → 增量集 = 该 chunk + server.js（其余不传）
  const all = ['index.html', 'assets/index-abc.js', 'server.js', 'store.mjs', 'api/sites.js', 'icons/a.png']
  const prevH = Object.fromEntries(all.map(r => [r, 'h1']))
  const curH = { ...prevH, 'assets/index-abc.js': 'h2' }   // 只有前端变了
  const incr = all.filter(r => prevH[r] !== curH[r] || STARTUP_REQUIRED(r))
  ok(incr.includes('server.js'), '只改前端时，增量集必须仍包含 server.js（否则容器起不来）')
  ok(incr.includes('assets/index-abc.js'), '改动的文件必须进增量集')
  ok(!incr.includes('store.mjs'), 'store.mjs 未变化时不应进增量（依赖容器保留文件系统）')
  ok(!incr.includes('icons/a.png'), '未变化且非启动文件不应进增量集（增量才有意义）')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n增量上传指纹判据：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
