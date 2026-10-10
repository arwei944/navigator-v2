/**
 * 第三批 · 序 20 / 29 / 30 的守卫：跨端共享的**纯函数**不变量。
 *
 * 这三项的共性：它们都是「两份实现只要有一处不一致就会出怪问题」的收敛，
 * 而这种不一致不会在界面上立刻显形，只会在很久以后以「搜索框说没收录、
 * 弹窗却拦下来说重复」这种死路的形式出现。所以必须用断言把「同源」钉住。
 *
 *   序 29 —— `hostOf` 原本在 `src/utils/url.js`、`shared/site-infer.mjs`、
 *            `shared/ops/site-ops.mjs`、控制台 UI 各有一份（四份）。现在全部 re-export
 *            `shared/host.mjs`，这里断言**函数身份相同**（不只是行为相同）。
 *   序 30 —— 站点表的元素级门禁（`sanitizeSites`）必须**返回原数组**：调用方按对象身份
 *            做渲染复用（sites.js 的 rebuild），一旦这里造新对象，300 张卡的 memo 全失效。
 *   序 22 —— 快照命名要保证「字典序 == 时间序」，否则按字典序裁剪会误删最新快照。
 *
 * 运行：node tools/console/test-robust.mjs
 */
import { sanitizeSites, isSitesValid } from '../../shared/sanitize.mjs'
import { hostOf } from '../../shared/host.mjs'
import { hostOf as hostFromUrlUtil } from '../../src/utils/url.js'
import { hostOf as hostFromInfer } from '../../shared/site-infer.mjs'
import { hostOf as hostFromOps } from '../../shared/ops/site-ops.mjs'
import {
  snapshotPathname, parseSnapshotName, isSnapshotPathname, prunableSnapshots, SNAPSHOT_PREFIX,
} from '../../shared/snapshots.mjs'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)
const eqv = (a, b, label) => ok(a === b, label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

/* ══════════ 序 20：sanitizeSites ══════════ */

const S = (id, extra = {}) => ({ id, name: `N${id}`, url: `https://${id}.com`, ...extra })
const GOOD = [S('a'), S('b'), S('c')]

// 合法 → 返回**原数组本身**（身份相等）。这是 rebuild 复用 memo 的前提。
{
  const out = sanitizeSites(GOOD)
  ok(out === GOOD, '合法站点表返回原数组（不复制）—— 渲染复用依赖这条')
  eqv(isSitesValid(GOOD), true, 'isSitesValid 合法为 true')
}

const BAD_LISTS = [
  [undefined, 'undefined 不是数组'],
  [null, 'null 不是数组'],
  ['nope', '字符串不是数组'],
  [{}, '对象不是数组'],
  [[], '空数组（全站白屏的典型脏发布）'],
  [[S('a'), null], '元素为 null'],
  [[S('a'), 'str'], '元素为字符串'],
  [[S('a'), ['b']], '元素为数组'],
  [[{ name: 'N', url: 'u' }], '缺 id'],
  [[{ id: 'a', url: 'u' }], '缺 name'],
  [[{ id: 'a', name: 'N' }], '缺 url'],
  [[{ id: '', name: 'N', url: 'u' }], 'id 为空串'],
  [[{ id: '   ', name: 'N', url: 'u' }], 'id 全空白'],
  [[{ id: 1, name: 'N', url: 'u' }], 'id 是数字（渲染按 string id 取值）'],
  [[{ id: 'a', name: 1, url: 'u' }], 'name 是数字'],
  [[{ id: 'a', name: 'N', url: 1 }], 'url 是数字'],
  [[S('a'), S('a')], '重复 id（会导致 Vue key 冲突）'],
]
for (const [list, label] of BAD_LISTS) {
  eqv(sanitizeSites(list), null, `非法站点表被拒：${label}`)
  eqv(isSitesValid(list), false, `isSitesValid 对非法返回 false：${label}`)
}

/* ══════════ 序 29：hostOf 只有一份实现 ══════════ */

// 身份相等 —— 不只是「行为碰巧一样」。这一条挂了就说明又有人复制了一份。
eq(hostFromUrlUtil, hostOf, 'src/utils/url.js 的 hostOf 就是 shared/host.mjs 那一个')
eq(hostFromInfer, hostOf, 'shared/site-infer.mjs 的 hostOf 就是 shared/host.mjs 那一个')
eq(hostFromOps, hostOf, 'shared/ops/site-ops.mjs 的 hostOf 就是 shared/host.mjs 那一个')

const HOST_CASES = [
  ['https://www.Example.com/path?q=1', 'example.com', '去 www + 小写'],
  ['HTTP://SUB.A.COM:8080/x', 'sub.a.com', '去端口 + 小写'],
  ['example.com', 'example.com', '裸域名补 https'],
  ['www.example.com', 'example.com', '裸域名去 www'],
  ['  https://example.com  ', 'example.com', '去首尾空白'],
  ['https://www.www.example.com/', 'www.example.com', '只去一层 www'],
  ['', '', '空串'],
  ['   ', '', '全空白'],
  ['not a url at all', '', '拿不到 host 就返回空串而不是抛错'],
]
for (const [input, want, label] of HOST_CASES) {
  eqv(hostOf(input), want, `hostOf(${JSON.stringify(input)}) —— ${label}`)
}
eqv(hostOf(null), '', 'hostOf(null)')
eqv(hostOf(undefined), '', 'hostOf(undefined)')
eqv(hostOf(123), '0.0.0.123', 'hostOf 对非字符串先 String() 再解析（不抛错）')

/* ══════════ 序 22：快照命名 ══════════ */

const D = new Date('2026-10-10T12:34:56.789Z')
const p9 = snapshotPathname(9, D, 'aaaaaa')
const p10 = snapshotPathname(10, D, 'bbbbbb')

eqv(p9, `${SNAPSHOT_PREFIX}000009-2026-10-10T12-34-56-789Z-aaaaaa.json`, '命名格式（version 6 位零填充 + 随机后缀）')
// 零填充的意义：字典序 == 时间序。缺了它 v9 会排在 v10 之后，按字典序裁剪就误删最新快照。
ok(p9 < p10, '零填充保证字典序 == version 序（v9 < v10）')

// 同 version 同毫秒的两次写入必须有不同的名字 —— 否则「回滚与被回滚同一毫秒」
// 会让后写覆盖掉前一份**用于回滚的快照本身**，兜底当场失效。
ok(snapshotPathname(5, D) !== snapshotPathname(5, D), '同 version 同毫秒的两次命名不碰撞（随机后缀）')

{
  const m = parseSnapshotName(p9)
  eqv(m.version, 9, 'parseSnapshotName 反解 version')
  eqv(m.ts, '2026-10-10T12:34:56.789Z', 'parseSnapshotName 反解时间戳')
  eqv(m.pathname, p9, 'parseSnapshotName 回填 pathname')
}
// 向后兼容：早期写入的快照没有随机后缀，回滚列表必须仍能列出它们
{
  const legacy = `${SNAPSHOT_PREFIX}000004-2026-01-01T00-00-00-000Z.json`
  const m = parseSnapshotName(legacy)
  ok(m && m.version === 4, '无随机后缀的历史快照仍能反解（向后兼容）')
  eqv(isSnapshotPathname(legacy), true, '历史快照仍被认作合法快照')
}

const NOT_SNAPSHOTS = ['sites.json', `${SNAPSHOT_PREFIX}readme.txt`, `${SNAPSHOT_PREFIX}9-2026-01-01T00-00-00-000Z.json`,
  `${SNAPSHOT_PREFIX}000009-2026-01-01.json`, '', null, undefined]
for (const n of NOT_SNAPSHOTS) eqv(isSnapshotPathname(n), false, `非快照对象被拒：${JSON.stringify(n)}`)

// 裁剪：保留最新 N 份，且**不误删同前缀下的无关对象**
{
  const names = []
  for (let v = 1; v <= 25; v++) names.push(snapshotPathname(v, new Date(Date.UTC(2026, 0, v)), 'aaaaaa'))
  names.push(`${SNAPSHOT_PREFIX}notes.txt`) // 同前缀下的无关文件
  const doomed = prunableSnapshots(names, 20)
  eqv(doomed.length, 5, '25 份快照保留 20 份 → 裁掉 5 份')
  ok(!doomed.includes(`${SNAPSHOT_PREFIX}notes.txt`), '同前缀下的无关对象不被裁掉')
  ok(doomed.every(n => /\/0{4}0[1-5]-/.test(n)),
    '被裁掉的是最旧的 5 份（v1…v5）', doomed.join(', '))
  ok(prunableSnapshots(names, 100).length === 0, 'keep 大于总数时不删任何东西')
}

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 跨端纯函数不变量 ${failures.length} 条断言失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 跨端纯函数不变量全部通过：${pass} 条断言`)
