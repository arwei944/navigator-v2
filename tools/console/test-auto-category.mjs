/**
 * 自动分类决策：6 条优先级分支 + label 归一 + id 派生与冲突自增。
 * 纯 node 直跑：node tools/console/test-auto-category.mjs
 *
 * existing 用内置分类表真实构造，保证测的是「新分类会不会被误建」这个真问题。
 */
import { categoryList, domainList, domainOfScope } from '../../shared/categories.mjs'
import { purposeLabel } from '../../shared/purposes.mjs'
import { suggestCategory, normalizeLabel, categoryIdFor, DOT_PALETTE } from '../../shared/auto-category.mjs'

let pass = 0
const failures = []
function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

const existing = categoryList().map(c => ({ id: c.id, label: c.label, groupId: domainOfScope(c.id) }))
const domainIds = domainList().map(d => d.id)

/* ① 元数据分类可信且在本地表 → 直接复用 */
const t1 = suggestCategory({ categoryId: 'design', categoryConfidence: 'high', existing, domainIds })
eq(t1.kind, 'use', '① 可信分类走复用')
eq(t1.categoryId, 'design', '① 复用 design')

/* ① 低置信不采信 → 转主题判断 */
const t1b = suggestCategory({ categoryId: 'design', categoryConfidence: 'low', desc: 'AI 音乐生成平台', existing, domainIds })
eq(t1b.kind, 'create', '① 低置信不采信')
eq(t1b.label, 'AI 音乐', '① 转主题后落到 AI 音乐')

/* ① 本地表里没有的分类 id（云端自定义表下发）→ 转主题判断 */
const t1c = suggestCategory({ categoryId: 'not-in-local', categoryConfidence: 'high', desc: 'AI 音乐生成', existing, domainIds })
eq(t1c.kind, 'create', '① 未知分类 id 转主题')

/* ② 主题命中 + 本地已有同名 → 复用内置，不重复建 */
const t2 = suggestCategory({ desc: '在线写作助手，支持文案润色', existing, domainIds })
eq(t2.kind, 'use', '② 同名主题复用')
eq(t2.categoryId, 'writing', '② 复用内置「写作与内容」')

/* ② 主题命中 + 本地没有 → 新建（核心新能力） */
const t3 = suggestCategory({ desc: 'AI 音乐生成，输入歌词自动作曲，支持 suno 风格', existing, domainIds })
eq(t3.kind, 'create', '② 新建主题分类')
eq(t3.label, 'AI 音乐', '② 主题标签')
eq(t3.groupId, 'ai', '② 主题智能归入 ai 域')
eq(t3.id, 'aiyy', '② 拼音首字母派生 id')
ok(DOT_PALETTE.includes(t3.dotColor), '② 配色取自调色板')

/* ② id 冲突自增（AI 音乐 / AI 语音 拼音同为 aiyy，这是真实撞车场景） */
const t3b = suggestCategory({
  desc: 'AI 音乐生成',
  existing: [...existing, { id: 'aiyy', label: 'AI 语音', groupId: 'ai' }],
  domainIds,
})
eq(t3b.id, 'aiyy2', '② id 冲突自增到 aiyy2')

/* ③ 用途兜底 → 新建 */
const t4 = suggestCategory({ name: 'StreamX', desc: '在线观看高清影视内容', purposes: ['video'], existing, domainIds })
eq(t4.kind, 'create', '③ 用途兜底新建')
eq(t4.label, purposeLabel('video'), '③ 标签取用途文案')
eq(t4.groupId, 'tools', '③ 用途智能归入 tools 域')

/* ③ 用途同名 → 复用 */
const t4b = suggestCategory({
  name: 'StreamX', desc: '在线观看', purposes: ['video'],
  existing: [...existing, { id: 'ksp', label: '看视频', groupId: 'tools' }],
  domainIds,
})
eq(t4b.kind, 'use', '③ 用途同名复用')
eq(t4b.categoryId, 'ksp', '③ 复用已有「看视频」')

/* ④ 无任何信号 → 「其他」，且只建一次 */
const t5 = suggestCategory({ name: 'mystery', desc: '', existing, domainIds })
eq(t5.kind, 'create', '④ 无信号落到其他')
eq(t5.label, '其他', '④ 标签为其他')
eq(t5.groupId, 'tools', '④ 其他归入 tools 域')
const t6 = suggestCategory({
  name: 'mystery2', desc: '',
  existing: [...existing, { id: t5.id, label: t5.label, groupId: t5.groupId }],
  domainIds,
})
eq(t6.kind, 'use', '④ 其他只建一次')
eq(t6.categoryId, t5.id, '④ 复用已建的其他')

/* label 归一：归一后相等才算「已有同名」，否则会重复建同类 */
eq(normalizeLabel('AI 绘画'), normalizeLabel('ai绘画'), '归一忽略大小写与空格')
eq(normalizeLabel('AI 绘画'), normalizeLabel('AI绘画'), '「AI 绘画」与「AI绘画」判定为同一分类')
eq(normalizeLabel('DeFi 借贷/收益'), normalizeLabel('defi 借贷 收益'), '归一忽略符号与空格')

/* id 派生与冲突自增 */
eq(categoryIdFor('AI 音乐', new Set()), 'aiyy', 'categoryIdFor 拼音首字母')
eq(categoryIdFor('AI 音乐', new Set(['aiyy'])), 'aiyy2', 'categoryIdFor 冲突自增')
eq(categoryIdFor('AI 音乐', new Set(['aiyy', 'aiyy2'])), 'aiyy3', 'categoryIdFor 连续冲突继续自增')
eq(categoryIdFor('其他', new Set(['qt'])), 'qt2', 'categoryIdFor 中文标签派生')
const noDomain = categoryIdFor('AI', new Set(domainIds))
ok(noDomain !== 'ai' && /^ai\d+$/.test(noDomain), 'categoryIdFor 避开域 id，不与 ai 域重名', `实得 ${noDomain}`)

/* 空表也要能跑（首次使用、云端表未下发） */
const bare = suggestCategory({ desc: 'AI 音乐生成', existing: [], domainIds })
eq(bare.kind, 'create', '空分类表同样能新建')
eq(bare.dotColor, DOT_PALETTE[0], '空表时取调色板第一个颜色')

if (failures.length) {
  console.error(`\n❌ 自动分类决策测试失败 ${failures.length} 项：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 自动分类决策全部通过：${pass} 条断言`)
