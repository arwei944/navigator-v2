/**
 * 数据质量体检用例（F1）：零依赖、不联网。
 *
 * 守的核心不是「能跑」，而是**判据的边界** —— 尤其那条最容易做错的：
 *   同 host 的**不同页面**（github.com/copilot 与 github.com/trending）**不是重复**，
 *   盲合并会误删。真重复只能是「完整 URL（保留路径）规范化后相同」。
 * 另外守住描述质量的四类判据，以及「合并建议只动真重复、绝不碰同站多入口」。
 *
 * 运行：node tools/console/test-data-quality.mjs
 */
import { auditSites, descIssue, planHostMerge, summarizeAudit } from '../../shared/ops/data-quality.mjs'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

/* ---------------- 同 host ≠ 重复 ---------------- */
{
  const sites = [
    { id: 'cd2', name: 'GitHub Copilot', url: 'https://github.com/features/copilot', desc: 'AI 编程助手工具', icon: 'x' },
    { id: 'l9', name: 'GitHub Trending', url: 'https://github.com/trending', desc: 'GitHub 每日趋势排行榜', icon: 'x' },
  ]
  const r = auditSites(sites)
  eq(r.duplicateUrls.length, 0, '同 host 不同页面不算真重复')
  eq(r.sameHostGroups.length, 1, '它们归入「同站多入口」，供人工甄别')
  eq(r.sameHostGroups[0].ids.length, 2, '该组含两条')
  ok(r.clean, '同站多入口不算「问题」—— clean 仍为真（不该报警）')
  eq(planHostMerge(r).removeIds.length, 0, '合并建议不碰同站多入口')
}

/* ---------------- 真重复 = 完整 URL 规范化后相同 ---------------- */
{
  const sites = [
    { id: 'a', name: 'A', url: 'https://example.com', desc: '一个足够长的描述' },
    { id: 'b', name: 'B', url: 'http://www.example.com/', desc: '另一个足够长的描述' },
    { id: 'c', name: 'C', url: 'https://other.com/deep', desc: '第三个足够长的描述' },
  ]
  const r = auditSites(sites)
  eq(r.duplicateUrls.length, 1, '去 www / 协议 / 尾斜杠后相同 = 真重复')
  eq(r.duplicateUrls[0].ids.length, 2, '重复组含两条')
  ok(!r.clean, '存在真重复时 clean 为假')

  const plan = planHostMerge(r)
  eq(plan.removeIds.length, 1, '合并建议只移除多余的一条')
  eq(plan.removeIds[0], 'b', '默认保留列表首条，移除其余')
  ok(!plan.removeIds.includes('c'), '无关站点不在移除清单里')
}

/* ---------------- 路径不同但去掉尾斜杠后相同 → 仍算真重复 ---------------- */
{
  const sites = [
    { id: 'x', name: 'X', url: 'https://site.com/path/', desc: '描述文本足够长' },
    { id: 'y', name: 'Y', url: 'https://site.com/path', desc: '描述文本也够长' },
  ]
  eq(auditSites(sites).duplicateUrls.length, 1, '尾斜杠差异不算差异（同一页）')
}

/* ---------------- 描述质量四类判据 ---------------- */
{
  eq(descIssue({ desc: '' }), 'missing', '空描述')
  eq(descIssue({ desc: '暂无' }), 'placeholder', '占位词优先于「过短」识别')
  eq(descIssue({ desc: '短' }), 'too-short', '过短描述')
  eq(descIssue({ name: 'Example Site', desc: 'example site' }), 'same-as-name', '与站名雷同')
  eq(descIssue({ name: 'Foo', desc: '这是正常的一句描述' }), '', '正常描述无问题')

  const r = auditSites([
    { id: 'w', name: 'W', url: 'https://w.com', desc: '' },
    { id: 'n', name: 'N', url: 'https://n.com', desc: '这是一句合格的站点描述' },
  ])
  eq(r.weakDesc.length, 1, '只有空描述那条进 weakDesc')
  eq(r.weakDesc[0].id, 'w', '命中的是空描述站点')
}

/* ---------------- 缺 icon / 地址不可解析 ---------------- */
{
  const r = auditSites([
    { id: 'i1', name: 'I1', url: 'https://i1.com', desc: '描述文本足够长', icon: '' },
    { id: 'i2', name: 'I2', url: 'https://i2.com', desc: '描述文本足够长', icon: 'https://x/i.png' },
    { id: 'bad', name: 'Bad', url: 'not a url', desc: '描述文本足够长', icon: 'x' },
  ])
  eq(r.missingIcon.length, 1, '缺 icon 只算没有 icon 的那条')
  eq(r.missingIcon[0], 'i1', '命中的是缺 icon 站')
  ok(r.unknownUrl.includes('bad'), '无法解析的地址被挑出')
}

/* ---------------- 摘要不撒谎 ---------------- */
{
  const clean = auditSites([{ id: 'a', name: 'A', url: 'https://a.com', desc: '这是一句足够长的站点描述', icon: 'x' }])
  ok(summarizeAudit(clean).startsWith('✅'), '干净数据的摘要以 ✅ 开头')
  const dirty = auditSites([{ id: 'a', name: 'A', url: 'https://a.com', desc: '', icon: '' }])
  ok(summarizeAudit(dirty).startsWith('⚠️'), '有问题的摘要以 ⚠️ 开头')
  eq(summarizeAudit(null), '（无数据）', '空输入不崩')
}

/* ---------------- 报告 ---------------- */
console.log(`\n数据质量体检用例（F1）：${pass} 通过，${failures.length} 失败`)
if (failures.length) {
  for (const f of failures) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('  ✓ 全部通过')
