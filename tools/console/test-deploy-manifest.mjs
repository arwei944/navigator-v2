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
import { walkDistHashes } from './lib/deploy.mjs'

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
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n增量上传指纹判据：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
