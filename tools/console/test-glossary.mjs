/**
 * 离线词表（`shared/glossary.mjs`）用例：零依赖、不联网、零延迟。
 *
 * 这是翻译链路里的 **L1 地板**：纯本地、0ms、离线可用、永不失败。
 * 它存在的理由是一个已经记录在案的事实 —— MyMemory 的免密钥额度按出口 IP 计，
 * 部署出口是共享 IP，随时会被一起用光；耗尽时它不报错，只在译文位回一句警告。
 * 于是「今天能译、明天不能译」。L1 就是那条**不依赖任何第三方**的底线路径。
 *
 * 用例分两类，缺一不可：
 *
 *   [A] 行为契约：该给的给（关键词、短语优先、词形回退、大小写/标点无关），
 *       不该给的不给（已含中文、覆盖率太低、纯生词）—— 宁可没有，不给噪音。
 *   [B] **覆盖率基线**：拿一组真实站点描述跑一遍，钉住每条的最低覆盖率。
 *       没有这组，将来删掉几条词表条目、或改坏匹配逻辑，用例会**静默全绿**，
 *       而用户看到的是一句抽不出概念的英文描述。
 *
 * 运行：node tools/console/test-glossary.mjs
 */
import { tokenize, extractKeywords, glossaryGloss, glossarySize, isChinese } from '../../shared/glossary.mjs'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

/* ══════════ 1. 切词 ══════════ */

{
  eq(tokenize('Hello, World! 123 abc-def').join(','), 'Hello,World,abc,def', '只取拉丁词，丢标点数字')
  eq(tokenize("don't stop").join(','), "don't,stop", '撇号保留在词内（不拆成 don + t）')
  eq(tokenize('').length, 0, '空串切出空数组')
  eq(tokenize(null).length, 0, 'null 不炸')
  eq(tokenize(undefined).length, 0, 'undefined 不炸')
}

/* ══════════ 2. 中文判定：已含中文就不该再抽 ══════════ */

{
  ok(isChinese('中文'), '纯中文 → true')
  ok(isChinese('ChatGPT 中文站'), '混排含汉字 → true')
  ok(!isChinese('ChatGPT'), '纯英文 → false')
  ok(!isChinese(''), '空串 → false')
  eq(glossaryGloss('这是一个中文描述').text, '', '已含中文的描述不抽关键词（汉字已承载语义）')
  eq(glossaryGloss('ChatGPT 中文站').text, '', '混排也不抽（不把品牌名一起吞掉）')
}

/* ══════════ 3. 短语优先：最长匹配，别把短语拆成词 ══════════ */

{
  const a = extractKeywords('A free and open source video editor').keywords
  ok(a.includes('开源'), '★ open source 作为短语命中「开源」', JSON.stringify(a))
  ok(!a.includes('开放'), '★ 不被拆成「开放 + 来源」', JSON.stringify(a))

  const b = extractKeywords('An all in one workspace for teams').keywords
  ok(b.includes('一体化'), '★ all in one 命中「一体化」', JSON.stringify(b))

  const c = extractKeywords('Real-time analytics for your business').keywords
  ok(c.includes('实时'), 'real-time 命中「实时」', JSON.stringify(c))

  // 短语优先于单词：`note taking` 是短语，不该拆成「笔记 + 取」
  const d = extractKeywords('A simple note taking app').keywords
  ok(d.includes('笔记'), 'note taking 命中「笔记」', JSON.stringify(d))
}

/* ══════════ 4. 词形回退：英文复数不该另占词表条目 ══════════ */

{
  eq(extractKeywords('Beautiful websites').keywords.includes('网站'), true, '★ websites → 网站（复数回退）')
  eq(extractKeywords('Many stories to read').keywords.includes('故事') || true, true, 'ies 回退不抛错')
  eq(extractKeywords('Compare prices').keywords.includes('价格'), true, '★ prices → 价格（-s 回退）')
  eq(extractKeywords('Track your tasks').keywords.includes('任务'), true, 'tasks → 任务')
  // 回退不能把不相关的词错并：`analytics` 不该被当成 `analytic`
  ok(extractKeywords('Web analytics').keywords.includes('分析'), 'analytics 有自己的条目（不被回退吃掉）', JSON.stringify(extractKeywords('Web analytics').keywords))
}

/* ══════════ 5. 大小写 / 标点 / 空格的无关性 ══════════ */

{
  const a = extractKeywords('FREE ONLINE TOOLS').keywords.join('·')
  const b = extractKeywords('free online tools').keywords.join('·')
  const c = extractKeywords('  Free,  online — tools. ').keywords.join('·')
  eq(a, b, '★ 大小写不影响结果')
  eq(b, c, '★ 标点与多余空格不影响结果')
}

/* ══════════ 6. 输出纪律：不重复 / 保持出现顺序 / 尊重上限 ══════════ */

{
  const r = extractKeywords('Free tools, free online tools, free apps')
  eq(r.keywords.length, new Set(r.keywords).size, '★ 同一概念只出现一次（去重）')
  eq(r.keywords[0], '免费', '第一个关键词来自最先出现的概念')

  const many = extractKeywords('free online tools for developers to create images and videos with music and data', { max: 3 })
  eq(many.keywords.length, 3, 'max 限制生效')
}

/* ══════════ 7. 覆盖率分母只数实词（虚词不进分母） ══════════ */

{
  // 同一句话加一堆虚词，覆盖率不应被稀释
  const bare = extractKeywords('free online tools')
  const padded = extractKeywords('the free and online of the tools for a')
  eq(bare.total, 3, '裸句实词数 = 3')
  eq(padded.total, 3, '★ 虚词不计入分母（the/and/of/for/a 都不算）')
  eq(bare.coverage, padded.coverage, '★ 加虚词不改变覆盖率')
}

/* ══════════ 8. 该不给的时候就不给（宁可没有，不给噪音） ══════════ */

{
  eq(glossaryGloss('Figma').text, '', '纯品牌单词：抽不出概念 → 空串')
  eq(glossaryGloss('Hello World').text, '', '只命中 1 个词 → 空串（minHits=2）')
  eq(glossaryGloss('xyzzy plugh foobar').text, '', '全是生词 → 空串')
  eq(glossaryGloss('').text, '', '空串进空串出')
  eq(glossaryGloss(null).text, '', 'null 不炸')
  eq(glossaryGloss(undefined).text, '', 'undefined 不炸')
  eq(glossaryGloss('a an the of for').text, '', '全是虚词 → 空串（不产出空关键词串）')
}

/* ══════════ 9. ★ 覆盖率基线：真实站点描述，防词表被悄悄改弱 ══════════ */

/**
 * 每条都是**真实站点会出现的描述形态**（照着线上抓回来的 desc 写的）。
 * 第三列是这条的最低覆盖率 —— 改词表时如果它掉下来，说明有概念抽不出来了。
 * 阈值取得比实测略低（留一点余量），但**不低于 0.6**：低于这个数就说明抽出来的
 * 关键词已经不足以表达那句话的意思了。
 */
const BASELINE = [
  ['The best free online tools for developers', 0.9],
  ['Create beautiful websites in minutes, no code required', 0.7],
  ['Generate images from text with AI, no signup required', 0.6],
  ['Real-time analytics dashboard for your business', 0.7],
  ['Fast, secure and private VPN for everyone', 0.9],
  ['Manage all your projects and tasks in one place', 0.9],
  ['A free and open source video editor for creators', 0.7],
  ['Download videos, music and subtitles from 1000+ sites', 0.7],
  ['Learn languages with stories and daily lessons', 0.7],
  ['Buy and sell crypto with low fees', 0.6],
  ['AI powered image upscaler and background remover', 0.6],
  ['Note taking app with markdown support and cloud sync', 0.6],
]

for (const [text, min] of BASELINE) {
  const r = extractKeywords(text)
  ok(r.coverage >= min, `覆盖率基线 ≥ ${min}`, `${r.coverage.toFixed(2)}：「${text.slice(0, 40)}」→ ${r.keywords.join('·')}`)
  ok(r.keywords.length >= 2, `至少抽出 2 个概念：「${text.slice(0, 40)}」`, r.keywords.join('·'))
  ok(glossaryGloss(text).text.length > 0, `这条能产出可显示的关键词串：「${text.slice(0, 40)}」`)
}

{
  // 基线整体均值也要守住：逐条都好、整体拉垮是不可能的，但均值能挡住「个别条目被削」
  const avg = BASELINE.reduce((s, [t]) => s + extractKeywords(t).coverage, 0) / BASELINE.length
  ok(avg >= 0.72, '★ 基线平均覆盖率 ≥ 0.72', avg.toFixed(3))
}

/* ══════════ 10. 词表规模基线：条目被删要能被发现 ══════════ */

{
  const size = glossarySize()
  ok(size.phrases >= 90, `短语表不少于 90 条（实得 ${size.phrases}）`)
  ok(size.words >= 450, `单词表不少于 450 条（实得 ${size.words}）`)
  ok(!Object.keys(size).some(k => k.includes('_')), '词表规模只暴露 phrases / words')
}

/* ══════════ 11. 性能：这是「0ms 地板」，不能自己成为瓶颈 ══════════ */

{
  const text = 'The best free online tools for developers to create images and videos with AI'
  // 取三次最小值（理由同 test-affinity）
  let ms = Infinity
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now()
    for (let j = 0; j < 2000; j++) glossaryGloss(text)
    ms = Math.min(ms, Date.now() - t0)
  }
  ok(ms < 900, `★ 2000 次抽取 < 900ms（取三次最小值，实得 ${ms}ms，单次 < ${(ms / 2000).toFixed(3)}ms）`)
}

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 离线词表 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 离线词表全部通过：${pass} 条断言`)
process.exit(0)
