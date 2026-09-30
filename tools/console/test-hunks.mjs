/**
 * hunk 级暂存 / 取消暂存用例。
 * 运行：node tools/console/test-hunks.mjs   （或 npm run console:test:hunks）
 *
 * 分两层：
 *   ① 纯解析层 —— 用文本夹具验证 hunk 边界切分与子集补丁拼接，不需要仓库
 *   ② 真实仓库层 —— 在系统临时目录建一个独立仓库，跑真实的 `git apply --cached`，
 *      断言「只暂存选中的块」且「工作区文件一字未改」
 *
 * 之所以要在临时仓库里跑：hunk 补丁的方向（正向暂存 / 反向取消）与 `--cached` 的
 * 组合一旦写错，症状是索引被悄悄改坏，光看解析结果发现不了。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertIndexesInRange, buildSubsetPatch, hunkPreview, hunkStats, parseHunkIndexes, splitHunks,
} from '../../shared/hunk-patch.mjs'
import { applyHunks } from './lib/git.mjs'

let pass = 0
const failures = []

function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}

function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

/* ================= ① 纯解析层 ================= */

const FIXTURE = [
  'diff --git a/src/app.js b/src/app.js',
  'index 1111111..2222222 100644',
  '--- a/src/app.js',
  '+++ b/src/app.js',
  '@@ -1,5 +1,5 @@',
  ' one',
  ' two',
  '-three',
  '+THREE',
  ' four',
  ' five',
  '@@ -20,4 +20,5 @@ export function run() {',
  ' twenty',
  '+twenty-one',
  ' twenty-two',
  ' twenty-three',
  ' twenty-four',
  '',
].join('\n')

{
  const parsed = splitHunks(FIXTURE)
  eq(parsed.hunks.length, 2, '切出 2 个 hunk')
  eq(parsed.multiFile, false, '单文件 diff 不标记 multiFile')
  eq(parsed.binary, false, '文本 diff 不标记 binary')
  eq(parsed.header.length, 4, '文件头含 diff/index/---/+++ 四行')
  eq(parsed.header[0], 'diff --git a/src/app.js b/src/app.js', '文件头首行是 diff --git')
  eq(parsed.hunks[0].index, 0, '第一个 hunk 序号为 0')
  eq(parsed.hunks[0].oldStart, 1, 'hunk0 oldStart')
  eq(parsed.hunks[0].oldLines, 5, 'hunk0 oldLines')
  eq(parsed.hunks[0].newLines, 5, 'hunk0 newLines')
  eq(parsed.hunks[1].oldStart, 20, 'hunk1 oldStart')
  eq(parsed.hunks[1].section, 'export function run() {', 'hunk1 带 section 标题')
  eq(parsed.hunks[1].lines.length, 6, 'hunk1 含 5 行内容 + 尾部空串')

  const s0 = hunkStats(parsed.hunks[0])
  eq(s0.additions, 1, 'hunk0 增 1 行')
  eq(s0.deletions, 1, 'hunk0 删 1 行')
  eq(s0.changed, 2, 'hunk0 变更 2 行')
  eq(hunkStats(parsed.hunks[1]).additions, 1, 'hunk1 只增不删')
  eq(hunkStats(parsed.hunks[1]).deletions, 0, 'hunk1 删除数为 0')

  eq(buildSubsetPatch(parsed, [0, 1]), FIXTURE, '全选时子集补丁与原文逐字节一致')
  const only1 = buildSubsetPatch(parsed, [1])
  ok(only1.includes('@@ -20,4 +20,5 @@'), '只选 hunk1 时保留其头行')
  ok(!only1.split('\n').includes('-three'), '只选 hunk1 时不带 hunk0 的变更')
  ok(only1.startsWith('diff --git '), '子集补丁保留文件头')
  ok(only1.endsWith('\n'), '子集补丁以换行结尾')
  ok(buildSubsetPatch(parsed, [0]).endsWith('\n'), '选中非末尾 hunk 时仍补齐结尾换行')

  const p = hunkPreview(parsed.hunks[0])
  eq(p.total, 2, 'hunk0 预览统计 2 行变更')
  eq(p.lines.length, 2, 'hunk0 预览返回 2 行')
}

{
  // 无尾换行的文件：`\ No newline at end of file` 必须留在 hunk 内，不能被当成文件头
  const noEol = [
    'diff --git a/f.txt b/f.txt',
    'index 3333333..4444444 100644',
    '--- a/f.txt',
    '+++ b/f.txt',
    '@@ -1 +1 @@',
    '-old',
    '\\ No newline at end of file',
    '+new',
    '\\ No newline at end of file',
    '',
  ].join('\n')
  const parsed = splitHunks(noEol)
  eq(parsed.hunks.length, 1, '无尾换行文件切出 1 个 hunk')
  eq(parsed.hunks[0].oldLines, 1, '省略行数时按 1 计')
  ok(parsed.hunks[0].lines.some(l => l.startsWith('\\ No newline')), '保留 No newline 标记行')
  eq(parsed.header.length, 4, 'No newline 标记未混入文件头')
}

{
  // 新增文件：oldStart/oldLines 都是 0
  const added = [
    'diff --git a/new.txt b/new.txt',
    'new file mode 100644',
    'index 0000000..5555555',
    '--- /dev/null',
    '+++ b/new.txt',
    '@@ -0,0 +1,2 @@',
    '+a',
    '+b',
    '',
  ].join('\n')
  const parsed = splitHunks(added)
  eq(parsed.hunks[0].oldStart, 0, '新增文件 oldStart 为 0')
  eq(parsed.hunks[0].oldLines, 0, '新增文件 oldLines 为 0')
  eq(hunkStats(parsed.hunks[0]).additions, 2, '新增文件统计 2 行新增')
  eq(buildSubsetPatch(parsed, [0]), added, '新增文件全选可原样还原')
}

{
  const two = splitHunks([
    'diff --git a/a.txt b/a.txt',
    'index 1..2 100644',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -1 +1 @@',
    '-x',
    '+y',
    'diff --git a/b.txt b/b.txt',
    'index 3..4 100644',
    '--- a/b.txt',
    '+++ b/b.txt',
    '@@ -1 +1 @@',
    '-p',
    '+q',
    '',
  ].join('\n'))
  eq(two.multiFile, true, '多文件 diff 标记 multiFile')

  const bin = splitHunks([
    'diff --git a/x.png b/x.png',
    'index 1..2 100644',
    'Binary files a/x.png and b/x.png differ',
    '',
  ].join('\n'))
  eq(bin.binary, true, '二进制差异标记 binary')
  eq(bin.hunks.length, 0, '二进制差异没有 hunk')

  eq(splitHunks('').hunks.length, 0, '空文本无 hunk')
  eq(splitHunks(null).header.length, 0, 'null 输入安全返回空结构')
}

{
  const a = parseHunkIndexes('2,0,2')
  eq(a.ok, true, '解析 hunk 序号成功')
  eq(JSON.stringify(a.indexes), '[0,2]', '序号去重并升序')
  eq(parseHunkIndexes('x').ok, false, '非数字序号被拒')
  eq(parseHunkIndexes('').ok, false, '空序号被拒')
  eq(parseHunkIndexes('-1').ok, false, '负数序号被拒')
  eq(assertIndexesInRange([0, 1], 2).ok, true, '序号在范围内通过')
  eq(assertIndexesInRange([2], 2).ok, false, '序号越界被拒')
}

/* ================= ② 真实仓库层 ================= */

function gitIn(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

const tmp = mkdtempSync(join(tmpdir(), 'nav-hunks-'))
const FILE = 'demo.txt'
const BASE = Array.from({ length: 20 }, (_, i) => `L${i + 1}`)

try {
  gitIn(tmp, ['init', '-q'])
  gitIn(tmp, ['config', 'user.email', 'test@nav.local'])
  gitIn(tmp, ['config', 'user.name', 'nav test'])
  gitIn(tmp, ['config', 'core.autocrlf', 'false'])

  writeFileSync(join(tmp, FILE), BASE.join('\n') + '\n', 'utf-8')
  gitIn(tmp, ['add', '--', FILE])
  gitIn(tmp, ['commit', '-q', '-m', 'base'])

  const edited = BASE.slice()
  edited[1] = 'L2-changed'
  edited[9] = 'L10-changed'
  edited[17] = 'L18-changed'
  const editedText = edited.join('\n') + '\n'
  writeFileSync(join(tmp, FILE), editedText, 'utf-8')

  const unstagedBefore = gitIn(tmp, ['diff', '--', FILE])
  eq(splitHunks(unstagedBefore).hunks.length, 3, '三处分散修改切出 3 个 hunk')

  /* ---- 暂存中间那一个 hunk ---- */
  const staged = await applyHunks(FILE, [1], { cwd: tmp })
  eq(staged.mode, 'stage', '暂存方向 mode=stage')
  eq(JSON.stringify(staged.applied), '[1]', '回显实际应用的 hunk 序号')
  eq(staged.total, 3, '回显该文件 hunk 总数')
  eq(staged.remaining, 2, '暂存后未暂存 hunk 剩 2 个')

  const stagedText = gitIn(tmp, ['diff', '--cached', '--', FILE])
  ok(stagedText.includes('+L10-changed'), '选中块已进入索引')
  ok(!stagedText.includes('L2-changed'), '未选中的第一处修改未进索引')
  ok(!stagedText.includes('L18-changed'), '未选中的第三处修改未进索引')
  eq(splitHunks(stagedText).hunks.length, 1, '索引侧只有 1 个 hunk')

  const unstagedAfter = gitIn(tmp, ['diff', '--', FILE])
  eq(splitHunks(unstagedAfter).hunks.length, 2, '工作区侧剩 2 个 hunk')
  ok(unstagedAfter.includes('+L2-changed') && unstagedAfter.includes('+L18-changed'), '剩余两块仍在工作区')
  eq(readFileSync(join(tmp, FILE), 'utf-8'), editedText, '--cached 不改写工作区文件')

  /* ---- 再暂存一块，形成「多块已暂存」---- */
  const staged2 = await applyHunks(FILE, [0], { cwd: tmp })
  eq(staged2.remaining, 1, '第二次暂存后工作区剩 1 个 hunk')
  eq(splitHunks(gitIn(tmp, ['diff', '--cached', '--', FILE])).hunks.length, 2, '索引侧累计 2 个 hunk')

  /* ---- 反向取消其中一块 ---- */
  const un = await applyHunks(FILE, [0], { staged: true, cwd: tmp })
  eq(un.mode, 'unstage', '取消暂存方向 mode=unstage')
  eq(un.remaining, 1, '取消后索引侧剩 1 个 hunk')
  const stagedAfterUn = gitIn(tmp, ['diff', '--cached', '--', FILE])
  eq(splitHunks(stagedAfterUn).hunks.length, 1, '索引侧确实只剩 1 个 hunk')
  ok(stagedAfterUn.includes('+L10-changed'), '保留的是未被取消的那一块')
  eq(splitHunks(gitIn(tmp, ['diff', '--', FILE])).hunks.length, 2, '取消的块退回工作区')
  eq(readFileSync(join(tmp, FILE), 'utf-8'), editedText, '取消暂存同样不改写工作区文件')

  /* ---- 全部取消，回到未暂存状态 ---- */
  await applyHunks(FILE, [0], { staged: true, cwd: tmp })
  eq(gitIn(tmp, ['diff', '--cached', '--', FILE]).trim(), '', '全部取消后索引与 HEAD 一致')
  eq(splitHunks(gitIn(tmp, ['diff', '--', FILE])).hunks.length, 3, '工作区恢复 3 个 hunk')

  /* ---- 越界与失败路径：索引必须原封不动 ---- */
  const idxBefore = gitIn(tmp, ['ls-files', '-s', '--', FILE])
  let threw = ''
  try { await applyHunks(FILE, [9], { cwd: tmp }) } catch (e) { threw = e.message }
  ok(threw.includes('越界'), '越界序号被拒且提示明确', threw)
  eq(gitIn(tmp, ['ls-files', '-s', '--', FILE]), idxBefore, '越界失败后索引未变')

  threw = ''
  try { await applyHunks(FILE, [], { cwd: tmp }) } catch (e) { threw = e.message }
  ok(threw.includes('未指定'), '空序号被拒', threw)

  /* ---- 二进制文件拒绝 ---- */
  const binPath = 'blob.bin'
  writeFileSync(join(tmp, binPath), Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00, 0xff]))
  gitIn(tmp, ['add', '--', binPath])
  gitIn(tmp, ['commit', '-q', '-m', 'bin'])
  writeFileSync(join(tmp, binPath), Buffer.from([0x00, 0x09, 0x02, 0x03, 0x00, 0xfe]))
  threw = ''
  try { await applyHunks(binPath, [0], { cwd: tmp }) } catch (e) { threw = e.message }
  ok(threw.includes('二进制'), '二进制文件被拒', threw)

  /* ---- 路径安全 ---- */
  threw = ''
  try { await applyHunks('../outside.txt', [0], { cwd: tmp }) } catch (e) { threw = e.message }
  ok(threw.includes('目录穿越'), '目录穿越路径被拒', threw)
} finally {
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 }) } catch { /* 临时目录清理失败不影响结论 */ }
}

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ ${failures.length} 条断言失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ hunk 级暂存全部通过：${pass} 条断言`)