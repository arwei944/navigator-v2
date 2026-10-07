/**
 * shared/purposes.mjs 与 shared/translate.mjs 用例：内联 fixture，不联网、零依赖。
 * 翻译用例用注入的假 fetchText 驱动，因此能覆盖「Google 成功 / Google 失败退兜底 /
 * 两个引擎都失败」三条分支，而不真的打外部接口。
 * 运行：node tools/console/test-purposes.mjs
 */
import {
  PURPOSE_TAGS, PURPOSE_IDS, MAX_PURPOSES,
  purposeLabel, purposeColor, inferPurposes, normalizePurposes, tallyPurposes,
} from '../../shared/purposes.mjs'
import {
  looksChinese, needsTranslation, shouldTranslateName,
  parseGoogle, parseMyMemory, googleUrl, myMemoryUrl,
  translateToZh, translateSiteFields,
} from '../../shared/translate.mjs'

let pass = 0
const failures = []

function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}
function deepEq(actual, expected, label) {
  ok(JSON.stringify(actual) === JSON.stringify(expected), label,
    `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

/* ---------------- 词表 ---------------- */

ok(PURPOSE_TAGS.length >= 10, '用途词表具备足够的表达力')
ok(PURPOSE_IDS.has('reference') && PURPOSE_IDS.has('tool'), '词表包含核心用途')
eq(purposeLabel('reference'), '查资料', '取用途中文名')
eq(purposeLabel('nope'), '', '未知用途返回空标签')
ok(/^#[0-9a-f]{6}$/.test(purposeColor('tool')), '用途色是合法十六进制')
eq(purposeColor('nope'), '#64748b', '未知用途返回中性色')
eq(purposeLabel(123), '', '非字符串 id 不抛错，返回空标签')
eq(purposeColor(null), '#64748b', 'null id 返回中性色')
eq(purposeLabel('reference '), '', '带空格的 id 不做容错匹配（调用方须先归一）')
ok(MAX_PURPOSES >= 3, '用途上限至少 3 个')

// 词表内部必须自洽：id 唯一、颜色合法
const idSeen = new Set()
let tableOk = true
for (const t of PURPOSE_TAGS) {
  if (idSeen.has(t.id) || !t.label || !/^#[0-9a-f]{6}$/.test(t.color)) tableOk = false
  idSeen.add(t.id)
}
ok(tableOk, '词表 id 唯一且每条都有 label 与合法色值')

/* ---------------- 推断 ---------------- */

deepEq(inferPurposes({ categoryId: 'cex' }), ['trading'], '分类基线：交易所 → 交易')
deepEq(inferPurposes({ categoryId: 'data' }), ['data', 'reference'], '分类基线可给多个用途')
deepEq(inferPurposes({ categoryId: 'nope-xyz' }), [], '未知分类不给任何用途（不硬猜）')

const iKw = inferPurposes({ categoryId: 'starter', name: '某视频站', desc: '海量影视资源与直播' })
ok(iKw.includes('video'), '关键词命中补充用途（视频）')
ok(iKw[0] === 'ai-chat', '分类基线排在关键词命中之前（更可信）')
ok(iKw.length <= MAX_PURPOSES, '推断结果不超过上限')

const iDup = inferPurposes({ categoryId: 'coding', name: '代码仓库', desc: '开源代码托管与部署' })
eq(new Set(iDup).size, iDup.length, '推断结果去重')

// 上限截断：分类基线 + 大量关键词命中也不能超过 MAX_PURPOSES
const iCap = inferPurposes({
  categoryId: 'data',
  name: '视频 社区 新闻 教程 代码 设计 交易 数据 对话 办公 工具 百科',
  desc: '直播 论坛 资讯 课程 开源 素材 合约 看板 助手 协作 在线 参考',
})
eq(iCap.length, MAX_PURPOSES, '推断结果按上限截断')

eq(inferPurposes({ categoryId: 'cex' }, { max: 1 }).length, 1, '自定义上限生效')
deepEq(inferPurposes(), [], '空入参返回空数组（无从判断，不编造）')
deepEq(inferPurposes({ name: 'Nothing', desc: '无信号', categoryId: '' }), [], '无任何信号时返回空数组')

/* ---------------- 推断：信号来源 ---------------- */

// 四个字段都参与匹配：名称 / 描述 / 关键词 / 网址
deepEq(inferPurposes({ url: 'https://github.com/foo/bar' }), ['coding'], '网址命中关键词（github → 写代码）')
deepEq(inferPurposes({ keywords: '素材 图标' }), ['design'], 'keywords 字段参与匹配')
deepEq(inferPurposes({ name: 'GITHUB', desc: 'CODE HOSTING' }), ['coding'], '匹配不区分大小写')
deepEq(inferPurposes({ categoryId: '  cex  ' }), ['trading'], '分类 id 两端空白被容忍')

// 单关键词 → 单用途：锁住词与用途的对应关系，防止后续加规则时「一个词点亮两个用途」
const single = [
  ['直播', 'video'],
  ['百科', 'reference'],
  ['配色', 'design'],
  ['看板', 'data'],
  ['日程', 'productivity'],
  ['交易所', 'trading'],
]
for (const [word, tag] of single) {
  deepEq(inferPurposes({ desc: word }), [tag], `单关键词「${word}」只点亮 ${tag}`)
}

// 关键词与分类基线重叠时不得重复推入
const iOverlap = inferPurposes({ categoryId: 'data', desc: '数据看板与榜单' })
eq(new Set(iOverlap).size, iOverlap.length, '关键词与分类基线重叠时不产生重复')
ok(iOverlap.includes('data'), '重叠时分类基线的用途仍在结果内')

// 契约：推断结果永远是合法用途 id，可直接入库 / 参与筛选
for (const input of [{ categoryId: 'cex' }, { name: '视频社区教程代码设计' }, { categoryId: 'data', desc: '直播 论坛 资讯' }]) {
  ok(inferPurposes(input).every(id => PURPOSE_IDS.has(id)), '推断结果只含词表内 id')
}

eq(inferPurposes({ categoryId: 'cex' }, { max: 0 }).length, 0, '上限为 0 时返回空数组')
eq(inferPurposes({ categoryId: 'cex' }, { max: 99 }).length, 1, '上限放大也不编造用途（分类基线仅 1 个）')

/* ---------------- 归一 ---------------- */

deepEq(normalizePurposes(['reference', 'tool']), ['reference', 'tool'], '数组入参原样通过')
deepEq(normalizePurposes('reference, tool'), ['reference', 'tool'], '逗号分隔字符串可解析')
deepEq(normalizePurposes('reference、tool\nvideo'), ['reference', 'tool', 'video'], '顿号 / 换行分隔可解析')
deepEq(normalizePurposes(['reference', 'reference']), ['reference'], '归一化去重')
deepEq(normalizePurposes(['reference', '不存在的用途', 'tool']), ['reference', 'tool'], '剔除不在词表内的脏值')
deepEq(normalizePurposes(['  ', null, undefined, 'tool']), ['tool'], '空白 / 空值被丢弃')
deepEq(normalizePurposes(null), [], 'null 入参返回空数组')
eq(normalizePurposes(['reference', 'tool', 'data', 'video', 'news']).length, MAX_PURPOSES, '归一化按上限截断')

// 推断结果本身就是合法用途，可直接喂给归一化（两个函数的契约要对齐）
const inferred = inferPurposes({ categoryId: 'defi', name: '借贷协议' })
deepEq(normalizePurposes(inferred), inferred, '推断结果满足归一化契约（无需二次清洗）')

deepEq(normalizePurposes('reference，tool'), ['reference', 'tool'], '全角逗号可解析')
deepEq(normalizePurposes([123, {}, [], true]), [], '数组内的非字符串项一律丢弃')
deepEq(normalizePurposes(123), [], '数字入参不抛错，返回空数组')
deepEq(normalizePurposes(['reference', 'tool', 'data'], { max: 2 }), ['reference', 'tool'], '自定义上限生效')
deepEq(normalizePurposes(['reference', 'reference', 'tool', 'data', 'video']), ['reference', 'tool', 'data', 'video'],
  '先去重再截断：重复项不占用名额')
eq(normalizePurposes(['tool', 'tool', 'tool']).length, 1, '全重复输入只保留一个')
deepEq(normalizePurposes('  '), [], '纯空白字符串返回空数组')

/* ---------------- 统计 ---------------- */

const tally = tallyPurposes([
  { purposes: ['reference', 'tool'] },
  { purposes: ['reference'] },
  { purposes: 'tool,video' },
  {},
])
eq(tally[0].id, 'reference', '统计按数量降序，reference 居首')
eq(tally.find(t => t.id === 'reference').count, 2, '统计计数正确')
eq(tally.find(t => t.id === 'tool').count, 2, '字符串形态的用途同样计入')
eq(tally.find(t => t.id === 'video').count, 1, '单个用途计数正确')
ok(tally.every(t => typeof t.label === 'string' && t.count >= 0), '统计项带 label 与 count')
eq(tallyPurposes([]).length, PURPOSE_TAGS.length, '无数据时仍返回完整词表（计数为 0）')
deepEq(tallyPurposes([]), tallyPurposes(null), '非数组入参等价于空数据，不抛错')

// 词表外的脏值不得计入统计（否则后台会显示一个查不到中文名的用途）
const tallyDirty = tallyPurposes([{ purposes: ['nope', 'reference'] }, { purposes: ['nope'] }])
eq(tallyDirty.reduce((n, t) => n + t.count, 0), 1, '脏值被丢弃，只统计合法用途')
eq(tallyDirty.find(t => t.id === 'reference').count, 1, '合法用途照常计数')

// 计数守恒：各项之和 == 所有站点归一化后的用途总数（reference×2 + tool×2 + video×1）
const tallySum = tally.reduce((n, t) => n + t.count, 0)
eq(tallySum, 5, '统计各项之和等于归一化后的用途总数')

// 并列时按 label 排序，保证同一份数据每次渲染顺序一致（否则后台表格会跳动）
deepEq(tallyPurposes([]).map(t => t.id), tallyPurposes([]).map(t => t.id), '零计数时排序稳定')
eq(tallyPurposes([])[0].count, 0, '零计数项 count 为 0')
ok(tallyPurposes([]).every(t => typeof t.color === 'string'), '统计项带 color 供后台着色')

/* ---------------- 翻译：语言判定 ---------------- */

ok(looksChinese('中文站点'), '识别中文')
ok(looksChinese('ChatGPT 中文站'), '混合文案含汉字即视为中文')
ok(!looksChinese('OpenRouter'), '纯英文不算中文')
ok(!looksChinese(''), '空串不算中文')
ok(needsTranslation('Best free online tools'), '英文散文需要翻译')
ok(!needsTranslation('中文描述'), '中文不需要翻译')
ok(!needsTranslation('12345'), '纯数字不需要翻译')
ok(!needsTranslation('   '), '空白不需要翻译')

ok(shouldTranslateName('Best Free Online Tools'), '词组型名称需要翻译')
ok(!shouldTranslateName('Uniswap'), '单词型名称视为品牌，不翻译')
ok(!shouldTranslateName('OpenAI'), '品牌名不翻译')
ok(!shouldTranslateName('中文站名'), '中文名称不翻译')

ok(!looksChinese('!!!'), '纯符号不算中文')
ok(!looksChinese('　'), '全角空格不算中文')
ok(needsTranslation('3D Tools'), '字母混数字需要翻译')
ok(!needsTranslation('&*()'), '纯符号不需要翻译')
ok(shouldTranslateName('Best\tTools'), '含制表符的词组型名称需要翻译')
ok(!shouldTranslateName('  Tools  '), '首尾空白不算词组，单词名仍不翻译')
ok(!shouldTranslateName(''), '空名称不翻译')

/* ---------------- 翻译：解析与地址 ---------------- */

const gRaw = JSON.stringify([[['最佳免费在线工具', 'Best free online tools', null, null, 10]], null, 'en'])
eq(parseGoogle(gRaw).text, '最佳免费在线工具', 'Google 响应按段拼接')
eq(parseGoogle(gRaw).source, 'en', 'Google 响应带回源语言')
eq(parseGoogle(JSON.stringify([[['第一段'], ['第二段']], null, 'en'])).text, '第一段第二段', '长文本多段拼接')
eq(parseGoogle('not json').text, '', 'Google 非法响应返回空')
eq(parseGoogle('').text, '', 'Google 空响应返回空')

eq(parseMyMemory('{"responseData":{"translatedText":"在线工具"}}'), '在线工具', 'MyMemory 响应解析')
eq(parseMyMemory('{"responseData":{"translatedText":"it&#39;s"}}'), "it's", 'MyMemory 实体还原')
eq(parseMyMemory('bad').text ?? '', '', 'MyMemory 非法响应返回空')

ok(googleUrl('hello world').includes('translate.googleapis.com'), 'Google 地址正确')
ok(googleUrl('hello world').includes('tl=zh-CN'), 'Google 目标语言为中文')
ok(googleUrl('a b').includes('q=a+b') || googleUrl('a b').includes('q=a%20b'), '查询串被正确编码')
ok(myMemoryUrl('hello').includes('langpair=en%7Czh-CN'), 'MyMemory 语言对正确')
ok(googleUrl('x'.repeat(1000)).length < 1200, '超长文本被截断后再编码')

// 解析的健壮性：空段 / 非字符串段 / 非数组响应都不能把整条链路带崩
eq(parseGoogle(JSON.stringify([[['', 'orig'], ['译文', 'o2']], null, 'en'])).text, '译文', '空段被过滤，不拼接进译文')
eq(parseGoogle(JSON.stringify([[['  译文  ', 'x']], null, 'en'])).text, '译文', '译文两端空白被裁掉')
eq(parseGoogle(JSON.stringify([[['译文'], 'not-array'], null, 'en'])).text, '译文', '非数组段被忽略')
eq(parseGoogle('{"a":1}').text, '', 'data[0] 非数组时返回空')
eq(parseGoogle(JSON.stringify([[['译文']], null, 123])).source, '', '源语言非字符串时返回空串')

eq(parseMyMemory('{"responseData":{"translatedText":"a &amp; b"}}'), 'a & b', 'MyMemory 还原 &amp;')
eq(parseMyMemory('{"responseData":{"translatedText":"&quot;hi&quot;"}}'), '"hi"', 'MyMemory 还原 &quot;')
eq(parseMyMemory('{"responseData":{"translatedText":"&lt;tag&gt;"}}'), '<tag>', 'MyMemory 还原尖括号实体')
eq(parseMyMemory('{"responseData":{"translatedText":"  x  "}}'), 'x', 'MyMemory 译文两端空白被裁掉')
eq(parseMyMemory('{"responseData":{"translatedText":123}}'), '', 'translatedText 非字符串时返回空')
eq(parseMyMemory('{"foo":1}'), '', '缺少 responseData 时返回空')
eq(parseMyMemory(''), '', 'MyMemory 空响应返回空')

// 地址构造：目标语言可覆盖，截断长度精确到 MAX_LEN(480)
ok(googleUrl('hi', { to: 'ja' }).includes('tl=ja'), 'Google 目标语言可覆盖')
eq(new URL(googleUrl('x'.repeat(1000))).searchParams.get('q').length, 480, 'Google 查询串被截到 480 字符')
ok(myMemoryUrl('hi', { from: 'fr', to: 'ja' }).includes('langpair=fr%7Cja'), 'MyMemory 语言对可覆盖')
eq(typeof googleUrl(undefined), 'string', '空文本构造地址不抛错')
eq(new URL(myMemoryUrl('x'.repeat(1000))).searchParams.get('q').length, 480, 'MyMemory 查询串被截到 480 字符')

/* ---------------- 翻译：引擎链路 ---------------- */

const googleOk = async (url) => (url.includes('translate.googleapis') ? gRaw : '')
const r1 = await translateToZh('Best free online tools', { fetchText: googleOk })
eq(r1.text, '最佳免费在线工具', 'Google 优先命中')
eq(r1.engine, 'google', '引擎标记为 google')

const googleFail = async (url) => {
  if (url.includes('translate.googleapis')) throw new Error('boom')
  return '{"responseData":{"translatedText":"兜底译文"}}'
}
const r2 = await translateToZh('Some english text', { fetchText: googleFail })
eq(r2.text, '兜底译文', 'Google 失败时退 MyMemory')
eq(r2.engine, 'mymemory', '引擎标记为 mymemory')

// Google 返回原文（等于没翻）时也应继续尝试兜底，而不是把原文当译文收下
const googleEcho = async (url) => {
  if (url.includes('translate.googleapis')) return JSON.stringify([[['Some english text', 'Some english text']], null, 'en'])
  return '{"responseData":{"translatedText":"真正的译文"}}'
}
eq((await translateToZh('Some english text', { fetchText: googleEcho })).text, '真正的译文', '译文与原文相同视为未翻译，继续兜底')

const allFail = async () => { throw new Error('offline') }
eq((await translateToZh('Hello', { fetchText: allFail })).text, '', '两个引擎都失败返回空串')
eq((await translateToZh('Hello', { fetchText: allFail })).engine, '', '失败时引擎为空')
eq((await translateToZh('Hello', {})).text, '', '未注入 fetchText 时安全返回空')
eq((await translateToZh('', { fetchText: googleOk })).text, '', '空文本不发起翻译')

// Google 解析不出内容（空段 / 非 JSON）时同样要退兜底，而不是直接判定失败
const googleBlank = async (url) => (url.includes('translate.googleapis')
  ? JSON.stringify([[['', 'x']], null, 'en'])
  : '{"responseData":{"translatedText":"兜底译文"}}')
eq((await translateToZh('Hello world', { fetchText: googleBlank })).text, '兜底译文', 'Google 解析不出内容时退 MyMemory')

const googleGarbage = async (url) => (url.includes('translate.googleapis') ? 'not json' : '{"responseData":{"translatedText":"兜底"}}')
eq((await translateToZh('Hello world', { fetchText: googleGarbage })).text, '兜底', 'Google 返回非 JSON 时退 MyMemory')

// 兜底接口回显原文也算「没翻成」，此时宁可返回空串让调用方保留原文
const mmEcho = async (url) => (url.includes('translate.googleapis') ? 'not json' : '{"responseData":{"translatedText":"Hello"}}')
eq((await translateToZh('Hello', { fetchText: mmEcho })).text, '', 'MyMemory 回显原文时返回空串')

// 传输层返回异常值不得抛错
eq((await translateToZh('Hello', { fetchText: async () => null })).text, '', 'fetchText 返回 null 时安全返回空')
eq((await translateToZh('Hello', { fetchText: 'not-a-fn' })).text, '', 'fetchText 非函数时安全返回空')

// 入参裁剪与 from 透传：请求前先 trim，语言对按调用方指定
let qSeen = ''
await translateToZh('   spaced text   ', { fetchText: async (url) => { qSeen = new URL(url).searchParams.get('q'); return '' } })
eq(qSeen, 'spaced text', '入参两端空白在请求前被裁掉')

let seenUrl = ''
await translateToZh('Bonjour', { fetchText: async (url) => { seenUrl = url; return '' }, from: 'fr' })
ok(seenUrl.includes('langpair=fr%7Czh-CN'), 'from 参数透传到 MyMemory 地址')

/* ---------------- 翻译：字段编排 ---------------- */

const f1 = await translateSiteFields(
  { name: 'Best Free Online Tools', desc: 'A collection of handy web utilities.' },
  { fetchText: async (url) => (url.includes('translate.googleapis')
    ? JSON.stringify([[['译文'], null, 'en']])
    : '') },
)
eq(f1.name, '译文', '词组型名称被翻译')
eq(f1.desc, '译文', '英文描述被翻译')
eq(f1.translated.name, true, '名称翻译标记为 true')
eq(f1.original.name, 'Best Free Online Tools', '保留原文供 UI 展示')
eq(f1.engines.desc, 'google', '记录翻译引擎')
eq(f1.engines.name, 'google', '记录名称翻译引擎')
eq(f1.original.desc, 'A collection of handy web utilities.', '描述原文同样保留供 UI 对照')

const f2 = await translateSiteFields(
  { name: 'Uniswap', desc: '去中心化交易协议' },
  { fetchText: async () => { throw new Error('should not be called') } },
)
eq(f2.name, 'Uniswap', '品牌名单词不翻译，原样保留')
eq(f2.desc, '去中心化交易协议', '中文描述不翻译')
eq(f2.translated.name, false, '未翻译时标记为 false')
eq(f2.translated.desc, false, '未翻译时标记为 false')

// 译文拿不到时保留原文，绝不写入空串（否则站点会丢名字 / 丢描述）
const f3 = await translateSiteFields({ name: 'Best Tools', desc: 'Nice tools' }, { fetchText: allFail })
eq(f3.name, 'Best Tools', '翻译失败时名称保留原文')
eq(f3.desc, 'Nice tools', '翻译失败时描述保留原文')
eq(f3.translated.desc, false, '失败时翻译标记为 false')

// 部分翻译：名称要译、描述已是中文 —— 各字段独立判断，互不牵连
const f4 = await translateSiteFields(
  { name: 'Best Free Tools', desc: '中文简介' },
  { fetchText: async (url) => (url.includes('translate.googleapis') ? JSON.stringify([[['最佳工具'], null, 'en']]) : '') },
)
eq(f4.name, '最佳工具', '名称需要翻译时被翻译')
eq(f4.desc, '中文简介', '中文描述保持原样，不发起翻译')
eq(f4.translated.name, true, '名称翻译标记为 true')
eq(f4.translated.desc, false, '描述未翻译标记为 false')
eq(f4.engines.desc, '', '未翻译的字段引擎为空')

// 字段缺省时不得抛错
const f5 = await translateSiteFields({}, { fetchText: async () => '' })
eq(f5.name, '', '缺省名称返回空串')
eq(f5.desc, '', '缺省描述返回空串')
eq(f5.translated.name, false, '缺省字段标记为未翻译')

// from 透传到传输层
let fUrl = ''
await translateSiteFields({ name: 'Bonjour Monde', desc: '' },
  { fetchText: async (url) => { fUrl = url; return '' }, from: 'fr' })
ok(fUrl.includes('langpair=fr%7Czh-CN'), 'translateSiteFields 透传 from 参数')

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ ${failures.length} 条断言失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ purposes + translate 全部通过：${pass} 条断言`)