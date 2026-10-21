/**
 * 领域动态阶段 0 的门禁：订阅解析、清洗、指纹去重、分类、退避。
 */
import assert from 'node:assert/strict'
import {
  stripHtml, cleanTitle, parseFeed, parseJsonFeed, parseHn, parseGithubRepos,
  parseV2exTopics, entryFingerprint, classifyEntry, backoffDelayMs, ttlCutoff, isSourceDue,
} from '../../shared/content-core.mjs'

let pass = 0
let fail = 0
function ok(name, fn) {
  try { fn(); pass += 1; console.log(`  ✓ ${name}`) }
  catch (e) { fail += 1; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0)

console.log('领域动态 · 阶段 0')

ok('stripHtml 去标签、解码实体、压空白', () => {
  assert.equal(stripHtml('<p>Hello&nbsp;<b>World</b></p>'), 'Hello World')
  assert.equal(stripHtml('<![CDATA[<p>A &amp; B</p>]]>'), 'A & B')
  assert.equal(stripHtml('a<br>b'), 'a b')
})

ok('cleanTitle 去 HTML 与多余空白', () => {
  assert.equal(cleanTitle('  <b>标题</b>  '), '标题')
})

ok('解析 RSS 2.0', () => {
  const xml = `<?xml version="1.0"?><rss><channel><title>Feed</title>
    <item><title>A</title><link>https://a.com/1</link><description><![CDATA[<p>摘要 A</p>]]></description>
      <pubDate>Tue, 21 Oct 2026 10:00:00 GMT</pubDate><guid>g1</guid></item>
    <item><title>B</title><link>https://a.com/2</link><description>摘要 B</description></item>
  </channel></rss>`
  const r = parseFeed(xml, { now: NOW })
  assert.equal(r.feedTitle, 'Feed')
  assert.equal(r.items.length, 2)
  assert.equal(r.items[0].title, 'A')
  assert.equal(r.items[0].url, 'https://a.com/1')
  assert.equal(r.items[0].summary, '摘要 A')
  assert.equal(r.items[0].guid, 'g1')
  assert.equal(r.items[1].guid, 'https://a.com/2')
})

ok('解析 Atom（link href）', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title>
    <entry><id>urn:1</id><title>C</title><link rel="alternate" href="https://c.com/x"/>
      <summary>摘要 C</summary><published>2026-10-21T10:00:00Z</published><author><name>Alice</name></author></entry>
  </feed>`
  const r = parseFeed(xml, { now: NOW })
  assert.equal(r.items.length, 1)
  assert.equal(r.items[0].url, 'https://c.com/x')
  assert.equal(r.items[0].author, 'Alice')
  assert.equal(r.items[0].guid, 'urn:1')
})

ok('解析 JSON Feed', () => {
  const r = parseJsonFeed({
    title: 'JF',
    items: [{ id: '1', url: 'https://j.com/1', title: 'J', content_text: '文本', date_published: '2026-10-21T10:00:00Z' }],
  }, { now: NOW })
  assert.equal(r.feedTitle, 'JF')
  assert.equal(r.items[0].summary, '文本')
})

ok('解析 Hacker News', () => {
  const r = parseHn([
    { id: 1, type: 'story', title: 'HN A', url: 'https://hn.com/a', score: 10, descendants: 2, by: 'bob', time: 1790000000 },
    { id: 2, type: 'comment', title: 'ignore' },
  ], { now: NOW })
  assert.equal(r.length, 1)
  assert.equal(r[0].guid, 'hn-1')
  assert.equal(r[0].author, 'bob')
})

ok('解析 GitHub 与 V2EX', () => {
  const gh = parseGithubRepos({ items: [{ id: 7, full_name: 'a/b', html_url: 'https://github.com/a/b', description: 'd', language: 'JS', stargazers_count: 3, owner: { login: 'a' } }] }, { now: NOW })
  assert.equal(gh[0].title, 'a/b')
  assert.match(gh[0].summary, /★ 3/)
  const v2 = parseV2exTopics([{ id: 9, url: 'https://v2ex.com/t/9', title: 'V', content: 'c', member: { username: 'u' }, created: 1790000000 }], { now: NOW })
  assert.equal(v2[0].guid, 'v2ex-9')
})

ok('指纹忽略协议/query/尾斜杠差异', () => {
  const a = entryFingerprint({ title: 'A', url: 'https://x.com/a?utm=1' })
  const b = entryFingerprint({ title: 'A', url: 'http://x.com/a/' })
  assert.equal(a, b)
  assert.notEqual(a, entryFingerprint({ title: 'B', url: 'https://x.com/a' }))
})

ok('分类：明确关键词覆盖源默认值', () => {
  const source = { domain: 'infra', categoryId: 'projects' }
  const ai = classifyEntry({ title: 'OpenAI releases a new model', summary: '' }, source)
  assert.equal(ai.domain, 'ai-work')
  const crypto = classifyEntry({ title: 'Bitcoin ETF inflows', summary: '' }, source)
  assert.equal(crypto.domain, 'onchain')
})

ok('分类：源默认值合法时沿用', () => {
  const r = classifyEntry({ title: '普通标题', summary: '' }, { domain: 'onchain', categoryId: 'media' })
  assert.deepEqual(r, { domain: 'onchain', categoryId: 'media' })
})

ok('分类：非法默认值回落到该域第一个分类', () => {
  const r = classifyEntry({ title: '普通标题', summary: '' }, { domain: 'onchain', categoryId: 'not-exist' })
  assert.equal(r.domain, 'onchain')
  assert.ok(r.categoryId)
})

ok('失败退避阶梯封顶 24 小时', () => {
  assert.equal(backoffDelayMs(1), 5 * 60000)
  assert.equal(backoffDelayMs(2), 15 * 60000)
  assert.equal(backoffDelayMs(3), 60 * 60000)
  assert.equal(backoffDelayMs(4), 6 * 60 * 60000)
  assert.equal(backoffDelayMs(5), 24 * 60 * 60000)
  assert.equal(backoffDelayMs(99), 24 * 60 * 60000)
})

ok('TTL 截止时间与到期判断', () => {
  assert.equal(ttlCutoff(30, NOW), NOW - 30 * 86400000)
  assert.equal(isSourceDue({ enabled: 1, next_fetch_at: NOW - 1 }, NOW), true)
  assert.equal(isSourceDue({ enabled: 1, next_fetch_at: NOW + 1 }, NOW), false)
  assert.equal(isSourceDue({ enabled: 0, next_fetch_at: 0 }, NOW), false)
})

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)