/**
 * desc「机器垃圾」形态检测用例：零依赖、不联网。
 *
 * 守的核心：
 *  1. 五类垃圾形态各归各类（标签残留 / 实体未解码 / 乱码 / 字面 null / 连续重复）；
 *  2. **与内核的分工边界** —— 缺失 / 过短 / 占位 / 与站名雷同由
 *     shared/ops/data-quality.mjs#descIssue 负责，本补充层对它们一律返回 ''，
 *     否则同一问题会被面板报两次；
 *  3. 空描述与非法输入不抛。
 *
 * 运行：node tools/console/test-desc-junk.mjs
 */
import { descJunkReason, auditDescJunk, DESC_JUNK_RULES } from '../../shared/site-infer.mjs'

let pass = 0
const failures = []
function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

/* ---------------- 形态分型 ---------------- */

eq(descJunkReason('这家店很棒<b>真的</b>很不错啊'), 'HTML 标签残留', 'HTML 标签 → 标签残留')
eq(descJunkReason('设计 &amp; 代码的社区平台啊'), 'HTML 实体未解码', '&amp; 实体 → 实体未解码')
eq(descJunkReason('编号 &#8212; 的说明文字内容'), 'HTML 实体未解码', '数字实体 → 实体未解码')
eq(descJunkReason('这是一段含替换字符�的描述文本'), '替换字符（乱码）', '替换字符 → 乱码')
eq(descJunkReason('undefined'), '字面 undefined / null', '字面 undefined → 字面值')
eq(descJunkReason('  null  '), '字面 undefined / null', '带空白的 null → 字面值')
eq(descJunkReason('aaaaaaaaaaaaaaaaa'), '连续重复字符', '长重复串 → 连续重复字符')

/* ---------------- 与内核的分工边界 ---------------- */

eq(descJunkReason('暂无描述'), '', '占位词不归本层（交给内核 descIssue）')
eq(descJunkReason('太短'), '', '过短不归本层（交给内核 descIssue）')
eq(descJunkReason('GitHub'), '', '与站名雷同不归本层（交给内核 descIssue）')
eq(descJunkReason('全球最大的代码托管与协作开发平台'), '', '正常描述 → 无垃圾')
eq(descJunkReason(''), '', '空描述 → 无垃圾（交给内核报「缺失」）')
eq(descJunkReason('   '), '', '纯空白 → 无垃圾')
eq(descJunkReason(null), '', 'null → 不抛且无垃圾')
eq(descJunkReason(undefined), '', 'undefined → 不抛且无垃圾')

// 标签残留的正则不能把正常的 `<3` 或 `a > b` 误判
eq(descJunkReason('我喜欢这个站 <3 真的很棒'), '', '裸 < 不算标签残留')
eq(descJunkReason('条件 a > b 的说明平台'), '', '裸 > 不算标签残留')

ok(DESC_JUNK_RULES.length >= 5, '垃圾规则表非空且覆盖多形态')

/* ---------------- 聚合 ---------------- */

const sites = [
  { id: 'a', name: 'A', url: 'a.com', desc: '一条正常的站点描述文本内容' },
  { id: 'b', name: 'B', url: 'b.com', desc: '这里有<b>标签</b>残留的描述' },
  { id: 'c', name: 'C', url: 'c.com', desc: 'undefine' },
  { id: 'd', name: 'D', url: 'd.com', desc: '设计 &amp; 代码平台描述' },
]
const hits = auditDescJunk(sites)
eq(hits.length, 2, '聚合只挑出垃圾形态条目')
eq(hits.map(h => h.id).join(','), 'b,d', '命中的 id 与顺序正确')
eq(hits[0].reason, 'HTML 标签残留', '聚合带出人读原因')

eq(auditDescJunk(null).length, 0, 'auditDescJunk(null) 不抛')
eq(auditDescJunk([null, 1, 'x', undefined]).length, 0, '过滤非对象条目')

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.log(`✖ ${failures.length} 条失败：`)
  for (const f of failures) console.log('  - ' + f)
  console.log(`\n通过 ${pass}，失败 ${failures.length}`)
  process.exit(1)
}
console.log(`✓ desc 机器垃圾形态检测：${pass} 条通过`)
