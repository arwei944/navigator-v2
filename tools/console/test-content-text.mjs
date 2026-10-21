/**
 * 阶段 1 文本处理门禁：语言、分词、聚类、热度、规则简报、宽松 JSON。
 */
import assert from 'node:assert/strict'
import {
  isMostlyChinese, tokenize, clusterDocuments, heatScore, ruleDigest, parseJsonLoose,
} from '../../shared/content-text.mjs'

let pass = 0
let fail = 0
function ok(name, fn) {
  try { fn(); pass += 1; console.log(`  ✓ ${name}`) }
  catch (e) { fail += 1; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

const NOW = 1792600000000

console.log('领域动态 · 阶段 1 文本')

ok('中文检测', () => {
  assert.equal(isMostlyChinese('这是一条中文科技新闻'), true)
  assert.equal(isMostlyChinese('This is an English article'), false)
  // 混合标题只要中文占主体就不需要翻译
  assert.equal(isMostlyChinese('OpenAI 发布新模型'), true)
})

ok('分词：英文去停用词、中文 2-gram', () => {
  const tokens = tokenize('OpenAI releases a new model')
  assert.ok(tokens.includes('openai'))
  assert.ok(tokens.includes('releases'))
  assert.ok(!tokens.includes('the'))
  const zh = tokenize('英伟达发布新芯片')
  assert.ok(zh.includes('英伟'))
  assert.ok(zh.includes('伟达'))
})

ok('相似英文标题聚为一类，不相关内容不入簇', () => {
  const docs = [
    { id: 'a', title: 'OpenAI launches GPT-5 model', summary: 'OpenAI releases a new large language model GPT-5.', publishedAt: NOW },
    { id: 'b', title: 'OpenAI releases GPT-5', summary: 'The new GPT-5 model from OpenAI is available now.', publishedAt: NOW - 1000 },
    { id: 'c', title: 'Bitcoin hits a new all-time high', summary: 'BTC price rally continues on exchanges.', publishedAt: NOW },
  ]
  const clusters = clusterDocuments(docs, { threshold: 0.35, minSize: 2 })
  assert.equal(clusters.length, 1)
  assert.deepEqual(clusters[0].members.map(m => m.id).sort(), ['a', 'b'])
})

ok('相似中文标题聚为一类', () => {
  const docs = [
    { id: 'x', title: '英伟达发布新一代 AI 芯片', summary: '英伟达推出新一代 AI 芯片，性能提升。', publishedAt: NOW },
    { id: 'y', title: '英伟达推出新 AI 芯片', summary: '新一代 AI 芯片由英伟达发布。', publishedAt: NOW - 500 },
  ]
  const clusters = clusterDocuments(docs, { threshold: 0.3, minSize: 2 })
  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].members.length, 2)
})

ok('不足两条不成事件', () => {
  assert.deepEqual(clusterDocuments([{ id: 'a', title: 'x', summary: 'y', publishedAt: NOW }]), [])
})

ok('热度随时间衰减', () => {
  const fresh = heatScore({ size: 2, sources: 2, weight: 2, latestAt: NOW, now: NOW })
  const old = heatScore({ size: 2, sources: 2, weight: 2, latestAt: NOW - 24 * 3600000, now: NOW })
  assert.ok(fresh > old)
})

ok('规则简报包含事件、来源数与链接', () => {
  const text = ruleDigest({
    date: '2026-10-22',
    events: [{
      title: 'OpenAI 发布 GPT-5', summary: '新模型发布', domain: 'ai-work',
      sourceCount: 3, primaryUrl: 'https://example.com/a',
    }],
    entries: [],
  })
  assert.match(text, /领域动态简报 · 2026-10-22/)
  assert.match(text, /OpenAI 发布 GPT-5/)
  assert.match(text, /3 个来源/)
  assert.match(text, /https:\/\/example\.com\/a/)
  assert.match(text, /规则汇总/)
})

ok('宽松 JSON 解析：代码块与前后说明', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"summary":"x"}\n```'), { summary: 'x' })
  assert.deepEqual(parseJsonLoose('结果如下：{"summary":"y"} 完毕'), { summary: 'y' })
  assert.equal(parseJsonLoose('不是 JSON'), null)
})

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)