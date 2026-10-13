#!/usr/bin/env node
/**
 * 分类表来源注册表（热拔插）自测：不联网。
 *
 * 覆盖：
 *   ① 注册校验（缺 id / 缺 load 抛错）
 *   ② categorySourceChain 的配置优先级与容错（顺序 / 换序 / 裁剪 / 全不匹配回退 / none）
 *   ③ resolveCategoryGroups 的**校验闸门**：源给的脏表绝不放行，一律换下一个源
 *   ④ 最终回落：链上无可用来源时返回内置表并标记 builtin-fallback
 *   ⑤ createCategoryResolver 的 TTL 缓存（第二次不再读源）
 *   ⑥ categoryMetaFromGroups 与既有 categoryMeta() 同形状（消费方可直接换用）
 */
import assert from 'node:assert/strict'
import { CATEGORY_GROUPS, categoryMeta } from '../../shared/categories.mjs'
import {
  registerCategorySource, listCategorySources, categorySourceChain,
  resolveCategoryGroups, createCategoryResolver, categoryMetaFromGroups,
} from '../../shared/category-source.mjs'

let pass = 0
let fail = 0
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass += 1 } catch (e) { console.log('  ✖ ' + name + ' — ' + e.message); fail += 1 }
}
async function checkAsync(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); pass += 1 } catch (e) { console.log('  ✖ ' + name + ' — ' + e.message); fail += 1 }
}

/** 结构完全合法的自定义表 */
const GOOD = [
  { id: 'theme', label: '主题域', categories: [{ id: 'alpha', label: '甲', dotColor: '#123456' }] },
]
/** 缺 categories —— sanitizeGroups 必须拒绝 */
const BAD_NO_CATS = [{ id: 'theme', label: '主题域' }]
/** 分类 id 重复 —— 必须拒绝 */
const BAD_DUP = [{ id: 'theme', label: '主题域', categories: [{ id: 'x', label: 'A' }, { id: 'x', label: 'B' }] }]

async function main() {
  console.log('\n注册表校验')
  check('缺 id 抛错', () => { assert.throws(() => registerCategorySource({ load: () => GOOD })) })
  check('缺 load 抛错', () => { assert.throws(() => registerCategorySource({ id: 'x-noload' })) })

  console.log('\n来源链配置（categorySourceChain）')
  check('默认顺序：cloud → builtin（builtin 永远在最后兜底；url 未配置时不出现）', () => {
    const old = process.env.NAV_CATEGORY_URL
    delete process.env.NAV_CATEGORY_URL
    assert.deepEqual(categorySourceChain('').map(s => s.id), ['cloud', 'builtin'])
    // 配上外部 URL 后它插到 builtin 之前
    process.env.NAV_CATEGORY_URL = 'https://example.com/c.json'
    assert.deepEqual(categorySourceChain('').map(s => s.id), ['cloud', 'url', 'builtin'])
    if (old === undefined) delete process.env.NAV_CATEGORY_URL; else process.env.NAV_CATEGORY_URL = old
  })
  check('显式列表决定顺序（换序生效）', () => {
    assert.deepEqual(categorySourceChain('builtin,cloud').map(s => s.id).slice(0, 2), ['builtin', 'cloud'])
  })
  check('none 显式清空（只剩最终回落）', () => {
    assert.deepEqual(categorySourceChain('none'), [])
  })
  check('全不匹配回退全量（不静默清空）', () => {
    assert.ok(categorySourceChain('a,b').some(s => s.id === 'builtin'))
  })
  check('url 源默认不可用（未配 NAV_CATEGORY_URL）', () => {
    const old = process.env.NAV_CATEGORY_URL
    delete process.env.NAV_CATEGORY_URL
    assert.ok(!categorySourceChain('').some(s => s.id === 'url'))
    process.env.NAV_CATEGORY_URL = 'https://example.com/cats.json'
    assert.ok(categorySourceChain('').some(s => s.id === 'url'))
    if (old === undefined) delete process.env.NAV_CATEGORY_URL; else process.env.NAV_CATEGORY_URL = old
  })

  console.log('\n解析与校验闸门（resolveCategoryGroups）')
  await checkAsync('cloud 给出合法表 → 采用它', async () => {
    const out = await resolveCategoryGroups({ ctx: { loadJson: async () => ({ categories: GOOD }) } })
    assert.equal(out.source, 'cloud')
    assert.equal(out.groups[0].categories[0].id, 'alpha')
    assert.equal(out.groups[0].categories[0].dotColor, '#123456')
  })
  await checkAsync('cloud 给出缺 categories 的表 → 换源，绝不返回半张表', async () => {
    const out = await resolveCategoryGroups({ ctx: { loadJson: async () => ({ categories: BAD_NO_CATS }) } })
    assert.notEqual(out.source, 'cloud')
    assert.ok(out.groups.length > 0, '仍须拿到一张可用的表')
    assert.equal(out.source, 'builtin')
  })
  await checkAsync('cloud 给出分类 id 重复的表 → 换源', async () => {
    const out = await resolveCategoryGroups({ ctx: { loadJson: async () => ({ categories: BAD_DUP }) } })
    assert.equal(out.source, 'builtin')
  })
  await checkAsync('cloud 读取出错 → 换源（不抛给调用方）', async () => {
    const out = await resolveCategoryGroups({ ctx: { loadJson: async () => { throw new Error('store 挂了') } } })
    assert.equal(out.source, 'builtin')
  })
  await checkAsync('没有 ctx.loadJson → 直接落到内置', async () => {
    const out = await resolveCategoryGroups({ ctx: {} })
    assert.equal(out.source, 'builtin')
    assert.equal(out.groups.length, CATEGORY_GROUPS.length)
  })
  await checkAsync('空链 → builtin-fallback（并标出来源，便于诊断）', async () => {
    const out = await resolveCategoryGroups({ chain: [], ctx: {} })
    assert.equal(out.source, 'builtin-fallback')
    assert.equal(out.groups.length, CATEGORY_GROUPS.length)
  })
  await checkAsync('外部 URL 源：配置后即可用（假 fetchJson）', async () => {
    const old = process.env.NAV_CATEGORY_URL
    process.env.NAV_CATEGORY_URL = 'https://example.com/cats.json'
    try {
      const out = await resolveCategoryGroups({
        chain: categorySourceChain('url,builtin'),
        ctx: { fetchJson: async () => GOOD },
      })
      assert.equal(out.source, 'url')
      assert.equal(out.groups[0].id, 'theme')
    } finally {
      if (old === undefined) delete process.env.NAV_CATEGORY_URL; else process.env.NAV_CATEGORY_URL = old
    }
  })

  console.log('\nTTL 缓存（createCategoryResolver）')
  await checkAsync('同一 TTL 窗口内只读一次源', async () => {
    let calls = 0
    const resolve = createCategoryResolver({
      ttlMs: 60_000,
      ctx: { loadJson: async () => { calls += 1; return { categories: GOOD } } },
    })
    await resolve(); await resolve(); await resolve()
    assert.equal(calls, 1, `应只读 1 次，实得 ${calls}`)
  })
  await checkAsync('ttlMs=0 时每次都重读（可用来验证缓存确实在生效）', async () => {
    let calls = 0
    const resolve = createCategoryResolver({
      ttlMs: 0,
      ctx: { loadJson: async () => { calls += 1; return { categories: GOOD } } },
    })
    await resolve(); await resolve()
    assert.equal(calls, 2)
  })

  console.log('\n消费方契约')
  check('categoryMetaFromGroups 与内置 categoryMeta() 同形状', () => {
    const fromGroups = categoryMetaFromGroups(CATEGORY_GROUPS)
    const builtin = categoryMeta()
    assert.deepEqual(Object.keys(fromGroups).sort(), Object.keys(builtin).sort())
    const key = Object.keys(builtin)[0]
    assert.deepEqual(fromGroups[key], builtin[key])
  })
  check('listCategorySources 列出三源并按 order 排序', () => {
    const ids = listCategorySources({ check: false }).map(s => s.id)
    assert.deepEqual(ids, ['cloud', 'url', 'builtin'])
  })

  console.log(`\ncategory-source 自测：${pass} 通过 / ${fail} 失败`)
  process.exitCode = fail ? 1 : 0
}

main()
