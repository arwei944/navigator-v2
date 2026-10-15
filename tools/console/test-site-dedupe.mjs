/**
 * 站点去重 / 书签导入 / 批量编辑用例：零依赖、不联网。
 *
 * 守的核心：
 *  1. **判重与落库同源** —— normalizeUrl 去 www，与 hostOf 一致，`www.x.com` 与 `x.com`
 *     必须被认成同一个站（否则库里会出现两条同名不同串的记录）；
 *  2. 书签导入：批内重复、已收录、非法地址三类都要被挑出来，不能静默塞进库；
 *  3. 新增的批量操作（多字段 / 置顶 / 归档 / 改描述）真的改了、且只改该改的字段。
 *
 * 运行：node tools/console/test-site-dedupe.mjs
 */
import {
  normalizeUrl, dedupeKey, findDupe, findNearDuplicates,
  applyBatch, BATCH_OPS,
} from '../../shared/ops/site-ops.mjs'
import { prepareBookmarkImport, summarizeImport } from '../../shared/bookmark-import.mjs'

let pass = 0
const failures = []
function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

const CATS = { ai: { label: 'AI 对话', color: '#3b82f6' }, coding: { label: '编程开发', color: '#10b981' }, media: { label: '媒体资讯', color: '#f59e0b' } }
const S = (over) => ({ id: over.id || over.url, name: over.name || 'X', url: over.url, desc: 'd', categoryId: 'ai', purposes: [], aliases: [], ...over })

/* ---------------- normalizeUrl / dedupeKey ---------------- */

eq(normalizeUrl('https://www.github.com/a/b?x=1'), 'github.com', '去协议/路径/query/www')
eq(normalizeUrl('http://WWW.Example.COM'), 'example.com', '大小写与 www 一并归一')
eq(normalizeUrl('example.com'), 'example.com', '裸域名补协议后取 host')
eq(normalizeUrl('  figma.com  '), 'figma.com', '首尾空白去除')
eq(dedupeKey('https://www.github.com/x'), 'github.com', 'dedupeKey 与 normalizeUrl 同源')
eq(normalizeUrl('www.github.com') === normalizeUrl('github.com'), true, 'www 与裸域同值')

let threw = false
try { normalizeUrl('ftp://a.com') } catch { threw = true }
ok(threw, '非 http(s) 协议抛错')
threw = false
try { normalizeUrl('') } catch { threw = true }
ok(threw, '空值抛错')

/* ---------------- findDupe ---------------- */

const library = [S({ id: 's1', name: 'GitHub', url: 'github.com' }), S({ id: 's2', name: 'Notion', url: 'notion.so' })]
eq(findDupe({ url: 'www.github.com' }, library)?.id, 's1', 'www 变体命中已收录')
eq(findDupe({ url: 'github.com' }, library, { excludeId: 's1' }), null, '编辑自己不算重复')
eq(findDupe({ url: 'gitlab.com' }, library), null, '不同域不命中')
eq(findDupe({ url: '' }, library), null, '空地址不命中')
// 子域是不同的站（可分别收录）
eq(findDupe({ url: 'gist.github.com' }, library), null, '子域不当作完全同域重复')

/* ---------------- findNearDuplicates ---------------- */

const near = findNearDuplicates([
  S({ id: 'a', name: 'GitHub', url: 'github.com' }),
  S({ id: 'b', name: 'GitHub Gist', url: 'gist.github.com' }),
  S({ id: 'c', name: 'Figma', url: 'figma.com' }),
  S({ id: 'd', name: 'Figma', url: 'figma.com/community' }),  // 同域同名
])
eq(near.length, 2, '两组同族（github 家族 + figma 家族）', JSON.stringify(near.map(g => g.key)))
ok(near[0].kind === 'family' && near[0].label === 'github.com', '同族组以注册域为标签', JSON.stringify(near[0]))
ok(near[0].sites.length === 2, '同族组含两条')
ok(near.every(g => g.sites.length >= 2), '每个组都至少两条')
ok(near.some(g => g.label === 'figma.com'), 'figma.com 与 figma.com/community 归为同族')

// 同名不同域：应报为 name 组
const near2 = findNearDuplicates([
  S({ id: 'p', name: 'DeepSeek', url: 'deepseek.com' }),
  S({ id: 'q', name: 'DeepSeek', url: 'chat.deepseek.com' }),  // 同族（deepseek.com）
])
eq(near2.length, 1, '同族优先，同名的同族不重复报', JSON.stringify(near2.map(g => g.key)))

const near3 = findNearDuplicates([
  S({ id: 'p', name: 'Notion', url: 'notion.so' }),
  S({ id: 'q', name: 'Notion', url: 'notion.site' }),
])
ok(near3.some(g => g.kind === 'name'), '同名不同域报 name 组', JSON.stringify(near3.map(g => g.kind)))

/* ---------------- prepareBookmarkImport ---------------- */

const bm = prepareBookmarkImport([
  { name: 'GitHub', url: 'https://github.com/anthropics' },        // 已收录 → 跳过
  { name: 'Figma', url: 'https://figma.com' },                     // 新增
  { name: 'Figma 重复', url: 'https://www.figma.com/file/1' },     // 批内重复（同域）→ 跳过
  { name: 'ChatGPT', url: 'https://chat.openai.com/' },            // 新增（子域）
  { name: '书签栏', url: 'chrome://bookmarks' },                   // 非法
  { name: '', url: 'javascript:void(0)' },                        // 非法
  { name: 'Broken', url: 'ftp://files.example.com' },             // 非法
], { existingSites: library, categoryMeta: CATS, fallbackCategory: 'ai' })

eq(bm.toAdd.length, 2, '两条可导入', JSON.stringify(bm.toAdd.map(s => s.url)))
eq(bm.duplicates.length, 2, '两条重复被跳过', JSON.stringify(bm.duplicates.map(d => d.reason)))
eq(bm.invalid.length, 3, '三条非法被挑出', JSON.stringify(bm.invalid.map(d => d.url)))
eq(bm.total, 7, '总数 7')
ok(bm.toAdd.every(s => !s.url.startsWith('www.')), '导入的 url 已去 www')
ok(bm.toAdd.every(s => s.initial && s.color && s.categoryId), '草稿字段齐备（initial/color/categoryId）')
const chat = bm.toAdd.find(s => s.url === 'chat.openai.com')
ok(chat && /ChatGPT/.test(chat.name), '书签标题用作站名')

// 全部非法时不应崩
const bm2 = prepareBookmarkImport([{ name: 'x', url: '' }], {})
eq(bm2.toAdd.length, 0, '空输入安全')
ok(summarizeImport(bm).includes('可导入 2 个'), '摘要包含可导入数', summarizeImport(bm))

/* ---------------- 新增的批量操作 ---------------- */

const sites = [
  S({ id: 'a', name: 'A', url: 'a.com', desc: '旧描述', categoryId: 'ai', color: '#111' }),
  S({ id: 'b', name: 'B', url: 'b.com', desc: '旧描述', categoryId: 'ai', color: '#111' }),
]

// 多字段编辑：只写填了的
const r1 = applyBatch(sites, { ids: ['a', 'b'], op: 'fieldset', patch: { categoryId: 'coding', desc: '' } })
ok(r1.ok, 'fieldset 成功')
const a1 = r1.next.find(s => s.id === 'a')
eq(a1.categoryId, 'coding', '多字段：分类被改')
eq(a1.desc, '旧描述', '多字段：留空的字段保持原样（不被清空）')
ok(r1.changes[0].fields.includes('categoryId'), 'diff 报出改动的字段', JSON.stringify(r1.changes[0].fields))

// 置顶：与归档互斥
const r2 = applyBatch([{ ...sites[0], archived: true }], { ids: ['a'], op: 'pin', patch: {} })
eq(r2.next[0].pinned, true, '置顶生效')
eq(r2.next[0].archived, false, '置顶自动取消归档')

const r3 = applyBatch([{ ...sites[0], pinned: true }], { ids: ['a'], op: 'archive', patch: {} })
eq(r3.next[0].archived, true, '归档生效')
eq(r3.next[0].pinned, false, '归档自动取消置顶')

// 无变化时跳过
const r4 = applyBatch([{ ...sites[0], pinned: true }], { ids: ['a'], op: 'pin', patch: {} })
eq(r4.changes.length, 0, '已是置顶则无变化')
eq(r4.skipped.length, 1, '跳过计数正确')

// 改描述
const r5 = applyBatch(sites, { ids: ['a', 'b'], op: 'desc', patch: { desc: '统一描述' } })
ok(r5.next.every(s => s.desc === '统一描述'), '改描述覆盖全部选中')

// 缺参数要报错
const r6 = applyBatch(sites, { ids: ['a'], op: 'desc', patch: {} })
ok(!r6.ok && r6.errors.length > 0, '改描述缺参数报错')

// 目录暴露了这些操作
ok(BATCH_OPS.fieldset && BATCH_OPS.pin && BATCH_OPS.archive && BATCH_OPS.unarchive && BATCH_OPS.desc, 'BATCH_OPS 已登记新操作')

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.log(`✖ ${failures.length} 条失败：`)
  for (const f of failures) console.log('  - ' + f)
  console.log(`\n通过 ${pass}，失败 ${failures.length}`)
  process.exit(1)
}
console.log(`✓ 站点去重 / 书签导入 / 批量编辑：${pass} 条通过`)
