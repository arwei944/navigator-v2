/**
 * doc-manager 自测（门禁）
 *
 * 覆盖 scan / index / check / lifecycle / graph 五个模块的核心不变量。
 * 用**临时工作区 fixture**（内存外的小目录）跑，不依赖 nav-v2 真实文档数量
 * ——否则文档一增减，门禁就红。
 *
 * 运行：node tools/console/test-doc-manager.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanWorkspace } from '../doc-manager/lib/scanner.mjs'
import { buildIndex } from '../doc-manager/lib/indexer.mjs'
import { runChecks } from '../doc-manager/lib/checker.mjs'
import { analyzeLifecycle, seriesKey, versionOf } from '../doc-manager/lib/lifecycle.mjs'
import { buildGraph } from '../doc-manager/lib/graph.mjs'
import { classify, extractLinks, parseFrontmatter, resolveDocLink } from '../doc-manager/lib/util.mjs'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) pass++
  else failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}

/* ---------------- 构造临时工作区 ---------------- */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docmgr-'))
const w = (rel, content) => {
  const p = path.join(tmp, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content, 'utf-8')
}

w('README.md', '# 根说明\n\n见 [A](docs/a.md)\n')
w('docs/a.md', '# 文档 甲\n\n链接到 [B](./b.md)\n')
w('docs/b.md', '# 文档 乙\n')
w('docs/dup.md', '# 文档 甲\n')                       /* 与 docs/a.md 标题重复 */
w('docs/audit/old.md', '---\nstatus: archived\n---\n# 归档审计\n\n引用 [A](../a.md)\n')
w('docs/audit/dead.md', '# 死链样例\n\n指向 [不存在](./nope.md)\n')
w('docs/notitle.md', '这行没有标题\n')                 /* 缺失标题 */
w('docs/NAV-v3-plan.md', '# 计划 v3\n')
w('docs/NAV-v5-plan.md', '# 计划 v5\n')
w('.superpowers/sdd/t1/task-1-brief.md', '# 简报一\n')
w('.superpowers/sdd/t2/task-1-brief.md', '# 简报二\n')

const scan = scanWorkspace({ root: tmp })
const byPath = new Map(scan.docs.map(d => [d.path, d]))

/* ---------------- 1. scanner ---------------- */

ok(scan.docs.length === 11, 'scanner：扫到 11 份文档', `实际 ${scan.docs.length}`)
ok(byPath.get('docs/a.md')?.title === '文档 甲', 'scanner：取到首个标题')
ok(byPath.get('docs/a.md')?.links.includes('docs/b.md'), 'scanner：相对链接归一为工作区相对路径')
ok(byPath.get('docs/notitle.md')?.title === '', 'scanner：无标题文档 title 为空')

/* ---------------- 2. util（纯函数）---------------- */

ok(classify('README.md') === 'readme', 'util：README 归类为 readme')
ok(classify('docs/audit/old.md') === 'audit', 'util：docs/audit 归类为 audit')
ok(classify('projects/p1/outputs/x.md') === 'report', 'util：outputs 归类为 report')
ok(resolveDocLink('docs/a.md', 'https://x.com') === null, 'util：外链返回 null')
ok(resolveDocLink('docs/a.md', './b.md') === 'docs/b.md', 'util：相对链接正确归位')
ok(resolveDocLink('docs/a.md', '../../escape.md') === null, 'util：越出工作区的链接丢弃')
const fm = parseFrontmatter('---\nstatus: archived\n---\n# 标题\n')
ok(fm.data.status === 'archived' && fm.body.startsWith('# 标题'), 'util：frontmatter 解析')
ok(extractLinks('![图](x.png) 与 [文](y.md)').length === 1, 'util：图片不算行内文档链接')

/* ---------------- 3. indexer ---------------- */

const index = buildIndex(scan)
ok(index.total === 11, 'indexer：总数正确')
ok(index.missingTitle.includes('docs/notitle.md'), 'indexer：缺失标题被列出')
ok(index.byKind.audit === 2, 'indexer：按类型分组计数', `audit=${index.byKind.audit}`)

/* ---------------- 4. checker ---------------- */

const report = runChecks(scan)
const rules = (r) => report.issues.filter(i => i.rule === r).map(i => i.path)
ok(report.counts.error >= 1, 'checker：检出 error（死链）')
ok(rules('dead-link').includes('docs/audit/dead.md'), 'checker：死链定位正确')
ok(rules('duplicate-title').length >= 1, 'checker：检出重复标题')
ok(rules('missing-title').includes('docs/notitle.md'), 'checker：检出缺失标题')
ok(
  !rules('orphan').some(p => p.startsWith('.superpowers/')),
  'checker：任务简报（过程产物）不算孤立文档',
)
ok(
  rules('stale-reference').includes('docs/audit/old.md') === false,
  'checker：归档文档自己不报过期引用',
)

/* ---------------- 5. lifecycle ---------------- */

ok(seriesKey('docs/NAV-v3-plan.md') === seriesKey('docs/NAV-v5-plan.md'), 'lifecycle：同目录同名视为同系列')
ok(seriesKey('a/progress.md') === null, 'lifecycle：通用文件名不参与系列')
ok(seriesKey('x/p.md') !== seriesKey('y/p.md'), 'lifecycle：不同目录不合并为同系列')
ok(versionOf('docs/NAV-v5-plan.md') === 5, 'lifecycle：版本号提取')
const lc = analyzeLifecycle(scan)
const navSeries = lc.suggestions.find(s => s.series === 'docs|NAV-plan')
ok(!!navSeries && navSeries.keep === 'docs/NAV-v5-plan.md', 'lifecycle：保留版本号最大的那份', JSON.stringify(navSeries))
ok(lc.byStatus.archived === 1, 'lifecycle：状态分布统计')

/* ---------------- 6. graph ---------------- */

const g = buildGraph(scan)
ok(g.edges.some(e => e.from === 'docs/a.md' && e.to === 'docs/b.md'), 'graph：文档间边正确')
ok(!g.orphans.some(p => p.startsWith('.superpowers/')), 'graph：过程产物不算孤立')
ok(g.byProject.length === 0, 'graph：无 projects/ 时不产生项目分组')

/* ---------------- 收尾 ---------------- */

fs.rmSync(tmp, { recursive: true, force: true })

console.log(`\n  doc-manager 自测：${pass} 通过 / ${failures.length} 失败`)
for (const f of failures) console.log(`   ❌ ${f}`)
console.log()
process.exit(failures.length ? 1 : 0)
