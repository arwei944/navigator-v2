/**
 * 浏览器临时工作区的门禁。
 *
 * 重点守护三条：
 *   1. 规范化会**丢掉 query/hash**但**保留路径**（否则同一页面反复入库，深链站点又认不出来）；
 *   2. 批次内同网址合并、与主库重复要标出来（默认跳过，不静默覆盖）；
 *   3. 三种提升策略行为可预测，且合并不破坏主库已有字段（id / 归档 / 访问计数）。
 */
import assert from 'node:assert/strict'
import {
  normalizeUrl, isIngestable, suggestCategory, buildBatch, mergeBatchInto, summarizeBatch,
} from '../../shared/ingest-core.mjs'
import { CATEGORY_GROUPS } from '../../shared/categories.mjs'

let pass = 0
let fail = 0
function ok(name, fn) {
  try {
    fn()
    pass += 1
    console.log(`  ✓ ${name}`)
  } catch (e) {
    fail += 1
    console.log(`  ✗ ${name}\n    ${e.message}`)
  }
}

const existing = [{
  id: 's1', name: 'ChatGPT', url: 'chat.openai.com', desc: '旧', categoryId: 'starter',
  color: '#22c55e', initial: 'C', sortOrder: 1, visitCount: 7, createdAt: 1, updatedAt: 1,
  aliases: ['GPT'], purposes: [], position: { domain: 'ai-work', stage: 'chat', source: 'auto' },
  archived: false, pinned: true,
}]

console.log('浏览器临时工作区')

ok('URL 归一化：去协议 / www / query / hash / 尾斜杠，保留路径', () => {
  assert.equal(normalizeUrl('https://www.GitHub.com/user/repo/?utm=1#readme'), 'github.com/user/repo')
  assert.equal(normalizeUrl('chat.openai.com'), 'chat.openai.com')
  assert.equal(normalizeUrl('https://a.com/'), 'a.com')
  assert.equal(normalizeUrl(''), '')
})

ok('浏览器内部页面 / 本机地址被拒绝', () => {
  assert.equal(isIngestable('chrome://extensions').ok, false)
  assert.equal(isIngestable('http://localhost:3000/').ok, false)
  assert.equal(isIngestable('file:///C:/a.html').ok, false)
  assert.equal(isIngestable('not-a-domain').ok, false)
  assert.equal(isIngestable('https://example.com/a').ok, true)
})

ok('分类建议命中已登记分类', () => {
  assert.equal(suggestCategory('github.com', 'GitHub', CATEGORY_GROUPS), 'coding')
  assert.equal(suggestCategory('binance.com', 'Binance', CATEGORY_GROUPS), 'cex')
  assert.equal(suggestCategory('unknown.example', '随便', CATEGORY_GROUPS), 'starter')
})

ok('批次内同网址合并、访问次数累加', () => {
  const batch = buildBatch([
    { url: 'https://a.com/x?utm=1', title: 'A', visitCount: 2 },
    { url: 'https://www.a.com/x', title: 'A 长标题', visitCount: 3 },
  ], { categories: CATEGORY_GROUPS, now: 1000 })
  assert.equal(batch.items.length, 1)
  assert.equal(batch.items[0].visitCount, 5)
  assert.equal(batch.items[0].title, 'A 长标题')
})

ok('与主库重复会标记 duplicateOf', () => {
  const batch = buildBatch([{ url: 'https://chat.openai.com/', title: 'ChatGPT', visitCount: 1 }], {
    categories: CATEGORY_GROUPS, existingSites: existing, now: 1000,
  })
  assert.equal(batch.stats.duplicates, 1)
  assert.equal(batch.items[0].duplicateOf, 's1')
})

ok('非法条目进入 invalid，不计入 items', () => {
  const batch = buildBatch([
    { url: 'chrome://newtab', title: '新标签页' },
    { url: 'https://ok.example.com', title: '正常' },
  ], { categories: CATEGORY_GROUPS, now: 1000 })
  assert.equal(batch.items.length, 1)
  assert.equal(batch.invalid.length, 1)
  assert.equal(batch.stats.invalid, 1)
})

ok('生成的标准站点对象字段齐全', () => {
  const batch = buildBatch([{ url: 'https://example.com', title: '示例', visitCount: 2 }], {
    categories: CATEGORY_GROUPS, now: 1000,
  })
  const site = batch.items[0].site
  for (const key of ['id', 'name', 'url', 'desc', 'categoryId', 'color', 'initial', 'sortOrder', 'visitCount', 'createdAt', 'updatedAt', 'icon', 'aliases', 'purposes', 'position']) {
    assert.ok(key in site, `缺少字段 ${key}`)
  }
  assert.match(site.id, /^ing-[0-9a-f]{8}$/)
  assert.equal(site.position.source, 'browser')
})

ok('skip 策略：重复跳过', () => {
  const batch = buildBatch([{ url: 'https://chat.openai.com', title: 'ChatGPT' }], {
    categories: CATEGORY_GROUPS, existingSites: existing, now: 1000,
  })
  const r = mergeBatchInto(existing, batch, { strategy: 'skip' })
  assert.equal(r.stats.added, 0)
  assert.equal(r.stats.skipped, 1)
})

ok('overwrite 策略：保留原 id 与本地状态', () => {
  const batch = buildBatch([{ url: 'https://chat.openai.com', title: 'ChatGPT 新', visitCount: 9 }], {
    categories: CATEGORY_GROUPS, existingSites: existing, now: 1000,
  })
  const r = mergeBatchInto(existing, batch, { strategy: 'overwrite' })
  assert.equal(r.stats.updated, 1)
  const s = r.sites[0]
  assert.equal(s.id, 's1')
  assert.equal(s.name, 'ChatGPT 新')
  assert.equal(s.pinned, true)
  assert.equal(s.visitCount, 9)
  assert.equal(r.sites.length, 1)
})

ok('new-id 策略：同网址新增一条且 id 唯一', () => {
  const batch = buildBatch([{ url: 'https://chat.openai.com', title: 'ChatGPT 副本' }], {
    categories: CATEGORY_GROUPS, existingSites: existing, now: 1000,
  })
  const r = mergeBatchInto(existing, batch, { strategy: 'new-id' })
  assert.equal(r.sites.length, 2)
  assert.notEqual(r.sites[1].id, 's1')
  assert.equal(new Set(r.sites.map(s => s.id)).size, 2)
})

ok('只提升选中的 key', () => {
  const batch = buildBatch([
    { url: 'https://a.example.com', title: 'A' },
    { url: 'https://b.example.com', title: 'B' },
  ], { categories: CATEGORY_GROUPS, now: 1000 })
  const key = batch.items[0].key
  const r = mergeBatchInto([], batch, { keys: [key], strategy: 'skip' })
  assert.equal(r.sites.length, 1)
  assert.equal(r.sites[0].url, 'a.example.com')
})

ok('分类覆盖生效', () => {
  const batch = buildBatch([{ url: 'https://a.example.com', title: 'A' }], {
    categories: CATEGORY_GROUPS, now: 1000,
  })
  const key = batch.items[0].key
  const r = mergeBatchInto([], batch, { categoryOverrides: { [key]: 'design' } })
  assert.equal(r.sites[0].categoryId, 'design')
})

ok('批次摘要不包含 items', () => {
  const batch = buildBatch([{ url: 'https://a.example.com', title: 'A' }], {
    categories: CATEGORY_GROUPS, now: 1000,
  })
  const s = summarizeBatch(batch)
  assert.equal(s.items, undefined)
  assert.equal(s.pending, 1)
})

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)