/**
 * 本地推断兜底（`src/services/localMeta.js`）用例：零依赖、不联网。
 *
 * 背景：站点改纯静态托管后 `/api/metadata` 整体消失，自动补全必然 404。
 * 兜底方案是在浏览器里跑**与服务端同一个** `inferSite` 引擎（传空 HTML），
 * 产出「按域名推断」的草稿。这层用例守的是几条会直接影响体验的契约：
 *
 *   ① 同域已收录 → 直接沿用已收录的**真名**（比拼域名靠谱得多，这是引擎自带的能力）；
 *   ② 未知域名 → 名称/分类/配色都有值，且分类真的存在于给定的分类表里；
 *   ③ 描述为推断值（confidence.desc === 'low'）—— 说清楚边界，不假装抓到了；
 *   ④ 非法网址 → 与 fetchSiteMeta 同构的失败结构，调用方不用多写一层分支。
 *
 * 运行：node tools/console/test-local-meta.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { localSiteMeta, localMetaNotice } from '../../src/services/localMeta.js'
import { categoryMeta as builtinCategoryMeta } from '../../shared/categories.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

/** 与 stores/sites.js 同源的站点表：同域沿用真名这条能力必须拿真实数据来验 */
const SEED = JSON.parse(readFileSync(join(root, 'api', 'sites-data.json'), 'utf-8'))
const META = builtinCategoryMeta()

/* ══════════ 1. 同域已收录：沿用真名 ══════════ */

const known = SEED.find(s => /^https?:\/\/(www\.)?github\.com/i.test(s.url)) || SEED[0]
const knownUrl = known.url.startsWith('http') ? known.url : 'https://' + known.url
const knownHost = knownUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase()

{
  const r = await localSiteMeta(knownUrl, { existingSites: SEED, categoryMeta: META })
  eq(r.ok, true, `已收录域名（${knownHost}）返回成功`)
  ok(r.data && typeof r.data === 'object', '返回的是对象')
  eq(r.data.name, known.name, `已收录域名沿用真名「${known.name}」而不是拼域名`)
  ok(r.data.confidence?.name === 'high' || r.data.confidence?.name === 'medium',
    '沿用真名时置信度不是 low', `实得 ${r.data.confidence?.name}`)
  ok(r.data.sources?.name === 'known', '名称来源标记为 known（可区分「真抓到」与「推断」）')
}

/* ══════════ 2. 未知域名：按域名推断，各字段都有值 ══════════ */

{
  const r = await localSiteMeta('https://tapecode.ai/', { existingSites: SEED, categoryMeta: META })
  eq(r.ok, true, '未知域名返回成功')
  const d = r.data
  ok(typeof d.name === 'string' && d.name.trim(), '名称非空（按域名拼出）', d.name)
  ok(!/tapecode\.ai/.test(d.name), '名称不是原始域名串（应美化）', d.name)
  ok(/^#[0-9a-f]{6}$/i.test(d.color || ''), '配色是合法 #rrggbb', d.color)
  ok(d.categoryId && META[d.categoryId], '推断出的分类真的存在于分类表里', d.categoryId)
  ok(typeof d.categoryLabel === 'string', '带分类名', d.categoryLabel)
  ok(Array.isArray(d.purposes), '用途是数组（可为空）', JSON.stringify(d.purposes))
  eq(d.confidence?.desc, 'low', '描述置信度标为 low（调用方据此说「推断值」）')
  ok(typeof d.desc === 'string' && d.desc.includes('tapecode.ai'),
    '描述是生成的模板话（含域名，非站点自述）', d.desc)
  ok(/^https:\/\/tapecode\.ai\/favicon\.ico$/.test(d.faviconUrl || ''),
    '图标兜底到 /favicon.ico（与服务端同款行为）', d.faviconUrl)
  eq(d.domain, 'tapecode.ai', 'domain 已去 www、小写')
  eq(d.local, true, '标记 local（UI 可据此区分来源）')
}

/* ══════════ 3. 自定义分类表生效（含用户新建的分类） ══════════ */

{
  // 造一张只含「开发工具」的表，确认推断结果落在这张表里，而不是内置表
  const custom = { dev: { label: '开发工具', color: '#3b82f6' } }
  const r = await localSiteMeta('https://github.com/', { existingSites: [], categoryMeta: custom })
  eq(r.ok, true, '自定义分类表可用')
  ok(!r.data.categoryId || custom[r.data.categoryId],
    '推断出的分类在自定义表里（不会指向下拉框里没有的项）', r.data.categoryId)
}

/* ══════════ 4. 非法网址：失败结构与 fetchSiteMeta 同构 ══════════ */

{
  const r = await localSiteMeta('不是网址')
  eq(r.ok, false, '非法网址返回失败')
  ok(typeof r.reason === 'string' && r.reason, '带机器可读 reason', r.reason)
  ok(typeof r.message === 'string' && r.message, '带人话 message', r.message)
  eq(r.status, 0, 'status 为 0（未发起任何请求）')
}

/* ══════════ 5. 提示文案：把「推断值」说在明处 ══════════ */

{
  const r = await localSiteMeta('https://tapecode.ai/', { existingSites: SEED, categoryMeta: META })
  const notice = localMetaNotice(r.data)
  ok(/推断/.test(notice), '提示文案明确说了「推断」', notice)
  ok(/后端/.test(notice), '提示文案交代了原因（后端不可用）', notice)
  ok(/描述/.test(notice), '提示文案点名了描述是生成的（否则会被当成站点自述）', notice)
  // 已收录域名沿用真名时 low 项更少，文案也应能生成（不抛错、不返回空）
  const r2 = await localSiteMeta(knownUrl, { existingSites: SEED, categoryMeta: META })
  ok(typeof localMetaNotice(r2.data) === 'string' && localMetaNotice(r2.data).length > 0,
    '已收录域名的提示文案也能生成')
}

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 本地推断兜底 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 本地推断兜底全部通过：${pass} 条断言`)
process.exit(0)
