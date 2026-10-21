#!/usr/bin/env node
/**
 * 站点数据导入自测：不联网、不碰数据库。
 *
 * 覆盖：
 *   ① CSV 状态机：引号、逗号、引号内换行、BOM、\r\n
 *   ② 表头别名（中英文）与列归一化
 *   ③ JSON 三种形态（导出格式 / {sites} / 顶层数组）与格式自动识别
 *   ④ 单行规范化：必填、分类白名单、id 派生、position 摊平列还原
 *   ⑤ 三种冲突策略（skip / overwrite / new-id）的实际结果
 *   ⑥ 无效行逐条报因，且不污染 nextSites
 *   ⑦ **CSV 往返**：真实 300 条导出成 CSV 再解析回来，关键字段必须一致
 *
 * ⑦ 是这一层最重要的不变量。没有它，「导出能下载」和「导入能读回」是两件互不相干的事，
 * 而用户会默认它们是一对。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  parseCsv, csvToObjects, looksLikeJson, parseImportText, normalizeIncomingSite,
  planImport, diffSiteFields, IMPORT_STRATEGIES, MAX_IMPORT_ROWS,
} from '../../shared/data-import.mjs'
import { categoryIndex, normalizeUrl } from '../../shared/data-audit.mjs'
import { sitesToCsv } from '../../shared/data-report.mjs'
import { CATEGORY_GROUPS } from '../../shared/categories.mjs'
import { sanitizeSites } from '../../shared/sanitize.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const seedSites = JSON.parse(readFileSync(join(ROOT, 'api', 'sites-data.json'), 'utf-8'))
const catIdx = categoryIndex(CATEGORY_GROUPS)

let pass = 0
let fail = 0
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass += 1 } catch (e) { console.log('  ✖ ' + name + ' — ' + e.message); fail += 1 }
}

console.log('\n[1] CSV 状态机')
check('基本行列', () => {
  const rows = parseCsv('a,b,c\n1,2,3')
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', '2', '3']])
})
check('引号内的逗号与换行不被切开', () => {
  const rows = parseCsv('a,b\n"x,y","line1\nline2"')
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[1], ['x,y', 'line1\nline2'])
})
check('双引号转义', () => {
  const rows = parseCsv('a\n"他说""你好"""')
  assert.deepEqual(rows[1], ['他说"你好"'])
})
check('BOM 被剥离', () => {
  const rows = parseCsv('﻿a,b\n1,2')
  assert.deepEqual(rows[0], ['a', 'b'])
})
check('CRLF 与孤立 CR 都当行尾', () => {
  assert.equal(parseCsv('a\r\nb\rc\nd').length, 4)
})
check('末尾空行被丢弃', () => {
  assert.equal(parseCsv('a,b\n1,2\n\n').length, 2)
})
check('末行无换行也能读到最后一行', () => {
  assert.deepEqual(parseCsv('a,b\n1,2')[1], ['1', '2'])
})

console.log('\n[2] 表头别名')
check('中文表头映射到字段', () => {
  const { objects, headers } = csvToObjects('名称,网址,描述,分类\nA,a.com,描述,starter')
  assert.deepEqual(headers.slice(0, 4), ['name', 'url', 'desc', 'categoryId'])
  assert.equal(objects[0].name, 'A')
  assert.equal(objects[0].categoryId, 'starter')
})
check('英文别名 title / link 可用', () => {
  const { objects } = csvToObjects('title,link\nA,a.com')
  assert.equal(objects[0].name, 'A')
  assert.equal(objects[0].url, 'a.com')
})
check('缺 name / url 列时给出可读错误', () => {
  const { error } = csvToObjects('foo,bar\n1,2')
  assert.equal(error, '')
  const p = parseImportText('foo,bar\n1,2', { format: 'csv' })
  assert.equal(p.rows.length, 0)
  assert.match(p.diagnostics[0].message, /缺少必需列/)
})

console.log('\n[3] JSON 形态与格式识别')
check('导出格式 sites 字段', () => {
  const p = parseImportText(JSON.stringify({ kind: 'navigator-sites-export', sites: [{ name: 'A', url: 'a.com' }] }))
  assert.equal(p.format, 'json')
  assert.equal(p.rows.length, 1)
})
check('{sites} 形态', () => {
  const p = parseImportText(JSON.stringify({ sites: [{ name: 'A', url: 'a.com' }] }))
  assert.equal(p.rows.length, 1)
})
check('顶层数组形态', () => {
  const p = parseImportText(JSON.stringify([{ name: 'A', url: 'a.com' }]))
  assert.equal(p.rows.length, 1)
})
check('自动识别 JSON / CSV', () => {
  assert.equal(looksLikeJson(' [1]'), true)
  assert.equal(looksLikeJson('a,b'), false)
  assert.equal(parseImportText('a,b\n1,2').format, 'csv')
})
check('坏 JSON 给出解析错误而不是抛异常', () => {
  const p = parseImportText('{oops}')
  assert.equal(p.rows.length, 0)
  assert.match(p.diagnostics[0].message, /JSON 解析失败/)
})
check('JSON 里没有站点数组时明确报错', () => {
  const p = parseImportText('{"foo":1}')
  assert.match(p.diagnostics[0].message, /没有找到站点数组/)
})

console.log('\n[4] 单行规范化')
check('缺名称 / 网址逐条报因', () => {
  const a = normalizeIncomingSite({ url: 'a.com', categoryId: 'starter' })
  assert.equal(a.site, null)
  assert.equal(a.issues[0].message, '缺少名称')
  const b = normalizeIncomingSite({ name: 'A', categoryId: 'starter' })
  assert.equal(b.issues[0].message, '缺少网址')
})
check('非法域名被拒', () => {
  const r = normalizeIncomingSite({ name: 'A', url: 'not a domain', categoryId: 'starter' })
  assert.equal(r.site, null)
  assert.match(r.issues[0].message, /不是合法域名/)
})
check('未登记分类被拒', () => {
  const r = normalizeIncomingSite(
    { name: 'A', url: 'a.com', categoryId: 'ghost' },
    { allowedCategories: new Set(['starter']) },
  )
  assert.equal(r.site, null)
  assert.match(r.issues[0].message, /分类未登记/)
})
check('无 id 时从网址派生稳定 id', () => {
  const a = normalizeIncomingSite({ name: 'A', url: 'https://www.A.com/', categoryId: 'starter' })
  const b = normalizeIncomingSite({ name: 'A2', url: 'a.com', categoryId: 'starter' })
  assert.equal(a.site.id, b.site.id, '不同写法但同一网址应派生同一 id')
  assert.match(a.site.id, /^imp-/)
})
check('URL 归一化后入库', () => {
  const r = normalizeIncomingSite({ name: 'A', url: 'https://www.a.com/', categoryId: 'starter' })
  assert.equal(r.site.url, 'a.com')
})
check('缺省 color / initial 自动补齐', () => {
  const r = normalizeIncomingSite({ name: 'zebra', url: 'z.com', categoryId: 'starter' })
  assert.equal(r.site.initial, 'Z')
  assert.match(r.site.color, /^#[0-9a-f]{6}$/i)
})
check('CSV 的 position 摊平列还原为对象', () => {
  const r = normalizeIncomingSite({
    name: 'A', url: 'a.com', categoryId: 'starter',
    'position.domain': 'ai-work', 'position.stage': 'chat',
    'position.source': 'auto', 'position.confidence': '0.5',
    'position.reason': '描述命中',
  })
  assert.deepEqual(r.site.position, {
    domain: 'ai-work', stage: 'chat', source: 'auto', confidence: 0.5, reason: '描述命中',
  })
})
check('purposes / aliases 用分号拆分', () => {
  const r = normalizeIncomingSite({ name: 'A', url: 'a.com', categoryId: 'starter', purposes: 'tool;data', aliases: 'AA；A1' })
  assert.deepEqual(r.site.purposes, ['tool', 'data'])
  assert.deepEqual(r.site.aliases, ['AA', 'A1'])
})
check('非对象输入不抛错', () => {
  for (const v of [null, 1, 'x', []]) {
    const r = normalizeIncomingSite(v)
    assert.equal(r.site, null)
  }
})

console.log('\n[5] 冲突策略')
const existing = [
  { id: 's1', name: 'ChatGPT', url: 'chat.openai.com', categoryId: 'starter', sortOrder: 1, aliases: [], position: {} },
  { id: 's2', name: 'Zapper', url: 'zapper.fi', categoryId: 'chain', sortOrder: 2, aliases: [], position: {} },
]
const incoming = [
  { name: 'ChatGPT 新版', url: 'chat.openai.com', categoryId: 'starter', desc: '改过的描述' },
  { name: 'Zapper', url: 'ZAPPER.FI', categoryId: 'chain' },
  { name: '新站', url: 'new.example.com', categoryId: 'starter' },
]

check('skip：同 id / 同网址都跳过，只留新站', () => {
  const p = planImport(existing, incoming, { strategy: 'skip', categoryIndex: catIdx, now: 1 })
  assert.equal(p.stats.adds, 1)
  assert.equal(p.stats.skips, 2)
  assert.equal(p.nextSites.length, 3)
})
check('overwrite：保留原 id，内容以导入为准', () => {
  const p = planImport(existing, incoming, { strategy: 'overwrite', categoryIndex: catIdx, now: 1 })
  assert.equal(p.stats.updates, 2)
  const s1 = p.nextSites.find(s => s.id === 's1')
  assert.equal(s1.name, 'ChatGPT 新版')
  assert.equal(s1.desc, '改过的描述')
})
check('new-id：全部作为新站点且 id 唯一', () => {
  const p = planImport(existing, incoming, { strategy: 'new-id', categoryIndex: catIdx, now: 1 })
  assert.equal(p.stats.adds, 3)
  const ids = p.nextSites.map(s => s.id)
  assert.equal(new Set(ids).size, ids.length)
})
check('三种策略的结果都能过站点表门禁', () => {
  for (const s of IMPORT_STRATEGIES) {
    const p = planImport(existing, incoming, { strategy: s.key, categoryIndex: catIdx, now: 1 })
    assert.ok(sanitizeSites(p.nextSites), s.key)
  }
})
check('无效行进入 invalid 且不写入 nextSites', () => {
  const p = planImport(existing, [
    { name: '', url: 'x.com', categoryId: 'starter' },
    { name: '好站', url: 'good.com', categoryId: 'starter' },
  ], { strategy: 'skip', categoryIndex: catIdx, now: 1 })
  assert.equal(p.stats.invalid, 1)
  assert.equal(p.stats.adds, 1)
  assert.equal(p.nextSites.length, 3)
})
check('新增条目 sortOrder 顺延到末尾', () => {
  const p = planImport(existing, [{ name: 'N', url: 'n.com', categoryId: 'starter' }], {
    strategy: 'skip', categoryIndex: catIdx, now: 1,
  })
  assert.equal(p.nextSites[p.nextSites.length - 1].sortOrder, 3)
})
check('超过行数上限直接拒绝', () => {
  const many = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ name: `N${i}`, url: `n${i}.com`, categoryId: 'starter' }))
  const p = planImport(existing, many, { strategy: 'skip', categoryIndex: catIdx, now: 1 })
  assert.equal(p.blocked, true)
  assert.equal(p.nextSites, existing)
})

console.log('\n[6] CSV 往返（真实 300 条）')
check('导出 → 解析 → 规范化，关键字段一致', () => {
  const sample = seedSites.slice(0, 30)
  const csv = sitesToCsv(sample)
  const parsed = parseImportText(csv, { format: 'csv' })
  assert.equal(parsed.diagnostics.filter(d => d.level === 'error').length, 0)
  assert.equal(parsed.rows.length, 30)

  for (let i = 0; i < sample.length; i += 1) {
    const src = sample[i]
    const { site, issues } = normalizeIncomingSite(parsed.rows[i], {
      index: i, now: 1, allowedCategories: catIdx,
    })
    assert.ok(site, `第 ${i} 行规范化失败：${JSON.stringify(issues)}`)
    assert.equal(site.id, src.id, `id 不一致：${src.id}`)
    assert.equal(site.name, src.name)
    assert.equal(site.url, src.url)
    assert.equal(site.desc, src.desc, `描述不一致：${src.id}`)
    assert.equal(site.categoryId, src.categoryId)
    assert.equal(site.sortOrder, src.sortOrder)
    assert.deepEqual(site.purposes, src.purposes || [], `用途不一致：${src.id}`)
    assert.deepEqual(site.aliases, src.aliases || [], `别名不一致：${src.id}`)
    assert.equal(site.position.domain, src.position.domain, `domain 不一致：${src.id}`)
    assert.equal(site.position.stage, src.position.stage)
    assert.equal(site.position.confidence, src.position.confidence)
  }
})
check('全量 300 条往返无一行失败', () => {
  const csv = sitesToCsv(seedSites)
  const parsed = parseImportText(csv, { format: 'csv' })
  assert.equal(parsed.rows.length, 300)
  let bad = 0
  parsed.rows.forEach((row, i) => {
    const r = normalizeIncomingSite(row, { index: i, now: 1, allowedCategories: catIdx })
    if (!r.site) bad += 1
  })
  assert.equal(bad, 0, `有 ${bad} 行无法规范化`)
})
check('JSON 导出往返同样一致', () => {
  const payload = JSON.stringify({ kind: 'navigator-sites-export', sites: seedSites.slice(0, 10) })
  const parsed = parseImportText(payload)
  assert.equal(parsed.rows.length, 10)
  const p = planImport([], parsed.rows, { strategy: 'skip', categoryIndex: catIdx, now: 1 })
  assert.equal(p.stats.adds, 10)
  assert.ok(sanitizeSites(p.nextSites))
})
check('导入回自身库时 skip 策略全跳过', () => {
  const csv = sitesToCsv(seedSites)
  const parsed = parseImportText(csv, { format: 'csv' })
  const p = planImport(seedSites, parsed.rows, { strategy: 'skip', categoryIndex: catIdx, now: 1 })
  assert.equal(p.stats.adds, 0)
  assert.equal(p.stats.skips, 300)
  assert.equal(p.nextSites.length, 300)
})
check('归一化 URL 的重复判定与体检口径一致', () => {
  assert.equal(normalizeUrl('HTTPS://WWW.A.com/').value.toLowerCase(), normalizeUrl('a.com').value.toLowerCase())
})

console.log('\n[7] 字段级 diff（E1）')
check('完全相同的对象不产生 diff', () => {
  assert.deepEqual(diffSiteFields(existing[0], { ...existing[0] }), [])
})
check('标量字段变化逐条列出', () => {
  const d = diffSiteFields(
    { id: 'a', name: 'A', url: 'a.com', desc: '旧', categoryId: 'starter', color: '#000', initial: 'A', icon: '' },
    { id: 'a', name: 'A', url: 'a.com', desc: '新', categoryId: 'starter', color: '#000', initial: 'A', icon: '' },
  )
  assert.equal(d.length, 1)
  assert.deepEqual(d[0], { field: 'desc', from: '旧', to: '新' })
})
check('id / createdAt / updatedAt 不参与比较', () => {
  const d = diffSiteFields(
    { id: 'a', name: 'A', url: 'a.com', createdAt: 1, updatedAt: 1 },
    { id: 'b', name: 'A', url: 'a.com', createdAt: 2, updatedAt: 2 },
  )
  assert.deepEqual(d, [])
})
check('数组字段用 ; 连接后比较', () => {
  const d = diffSiteFields(
    { aliases: ['a', 'b'], purposes: ['tool'] },
    { aliases: ['a', 'b'], purposes: ['tool', 'data'] },
  )
  assert.equal(d.length, 1)
  assert.equal(d[0].field, 'purposes')
  assert.equal(d[0].from, 'tool')
  assert.equal(d[0].to, 'tool;data')
})
check('position 子字段逐项比较', () => {
  const d = diffSiteFields(
    { position: { domain: 'ai-work', stage: 'chat', confidence: 0.9 } },
    { position: { domain: 'ai-work', stage: 'coding', confidence: 0.9 } },
  )
  assert.equal(d.length, 1)
  assert.equal(d[0].field, 'position.stage')
})
check('overwrite 时 updates 带 fields', () => {
  const p = planImport(existing, [{ name: 'ChatGPT 新版', url: 'chat.openai.com', categoryId: 'starter', desc: '新描述' }], {
    strategy: 'overwrite', categoryIndex: catIdx, now: 1,
  })
  assert.equal(p.updates.length, 1)
  const fields = p.updates[0].fields.map(f => f.field)
  assert.ok(fields.includes('name'))
  assert.ok(fields.includes('desc'))
})
check('同一条数据覆盖回自身 → noopUpdates 计入、changedFields 为 0', () => {
  // 夹具必须字段完整：缺 color / initial 时规范化会补默认值，
  // 那本来就是一次真实变更，不该被当成「覆盖回自身」。
  const complete = existing.map(s => ({
    ...s,
    desc: '', color: '#000000', initial: 'X', icon: '', purposes: [],
    // position 也必须完整：source 为空时规范化会补成 manual（那是真实变更，不算 noop）
    position: { domain: 'ai-work', stage: 'chat', source: 'auto', confidence: 0.9, reason: '' },
  }))
  const p = planImport(complete, complete.map(s => ({ ...s })), {
    strategy: 'overwrite', categoryIndex: catIdx, now: 1,
  })
  assert.equal(p.stats.updates, 2)
  assert.equal(p.stats.noopUpdates, 2)
  assert.equal(p.stats.changedFields, 0)
})
check('真实 300 条 CSV 往返覆盖，字段变化只来自 URL 归一化', () => {
  const csv = sitesToCsv(seedSites)
  const parsed = parseImportText(csv, { format: 'csv' })
  const p = planImport(seedSites, parsed.rows, {
    strategy: 'overwrite', categoryIndex: catIdx, now: 1,
  })
  assert.equal(p.stats.updates, 300)
  // 导出的是原值，导入时规范化会统一 URL 形态（去尾斜杠）。
  // 这是**有意为之**的差异，不是往返丢数据；允许且仅允许它出现在 url 上。
  for (const u of p.updates) {
    for (const f of u.fields || []) {
      assert.equal(f.field, 'url', `${u.id} 出现了非 URL 的字段差异：${f.field}`)
      assert.equal(f.from, `${f.to}/`, `URL 差异不是去尾斜杠：${f.from} → ${f.to}`)
    }
  }
  assert.ok(p.stats.changedFields <= 1, `差异过多：${p.stats.changedFields}`)
})

console.log(`\n结果：${pass} 通过，${fail} 失败`)
if (fail) process.exitCode = 1
