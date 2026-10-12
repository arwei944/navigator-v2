/**
 * I3 守卫：自然语言 → 命令。
 *
 * 核心风险是**误伤**：把一句普通搜索猜成命令，用户就搜不到想搜的站。
 * 所以除了正向命中，这里用穷举断言「常见搜索词不会被猜成命令」。
 *
 * 运行：node tools/console/test-command-phrases.mjs
 */
import { matchPhrase as matchPhraseRaw, describePhrase, PHRASE_MIN } from '../../src/utils/commandPhrases.js'
import { PHRASE_ALIASES } from '../../src/utils/phraseAliases.js'

/**
 * 别名表是**独立模块**（懒加载，见 phraseAliases.js 头部）：`matchPhrase` 的第三个参数
 * 由调用方注入。测试里包一层，既保持下方用例读起来干净，也顺便钉住「注入」这个契约——
 * 如果哪天有人把表重新 import 回 commandPhrases.js，这里传参就成了摆设但用例仍绿，
 * 所以另有一条断言专门盯「不传别名表也能工作」。
 */
const matchPhrase = (q, cmds = CMDS, aliases = PHRASE_ALIASES) => matchPhraseRaw(q, cmds, aliases)

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? ` → ${extra}` : ''}`) }
  else { failures.push(`${label}${extra ? ` — ${extra}` : ''}`); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`) }
}
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

/** 与 buildCommands 同构的最小命令表（真表要 ctx，测试用同 id/title 的替身） */
const CMDS = [
  { id: 'page.home', title: '首页' },
  { id: 'page.favorites', title: '收藏' },
  { id: 'page.recent', title: '最近访问' },
  { id: 'page.archived', title: '归档' },
  { id: 'page.feed', title: '内容聚合' },
  { id: 'page.trash', title: '回收站' },
  { id: 'page.insights', title: '洞察面板' },
  { id: 'page.admin', title: '管理后台' },
  { id: 'view.theme', title: '切换主题' },
  { id: 'view.mode', title: '切换到列表视图' },
  { id: 'view.clickboost', title: '开启常访问加权' },
  { id: 'view.sort.default', title: '排序：默认排序' },
  { id: 'view.sort.clicks', title: '排序：按点击量' },
  { id: 'view.sort.smart', title: '排序：智能排序' },
  { id: 'view.density.compact', title: '卡片密度：紧凑' },
  { id: 'view.scheme.apple', title: '视觉方案：苹果' },
  { id: 'view.preset.ink', title: '配色：墨绿' },
  { id: 'action.add', title: '添加站点' },
  { id: 'action.todo', title: '待办事项' },
  { id: 'action.stickyBoard', title: '打开便签墙' },
  { id: 'action.settings', title: '设置' },
  { id: 'action.card', title: '卡片设置' },
  { id: 'action.shortcuts', title: '查看快捷键' },
  { id: 'action.batch', title: '批量选择站点' },
  { id: 'action.emptyTrash', title: '清空回收站' },
  { id: 'action.undo', title: '撤销上一步' }
]

console.log('\n▶ I3 自然语言命令\n')

/* ── 1. 正向命中 ── */
const cases = [
  ['切换到深色', 'view.theme', 'alias'],
  ['帮我切到暗色模式', 'view.theme', 'alias'],
  ['浅色', 'view.theme', 'alias'],
  ['打开洞察面板', 'page.insights', 'title'],
  ['看看数据统计', 'page.insights', 'alias'],
  ['收藏夹', 'page.favorites', 'alias'],
  ['我的待办', 'action.todo', 'alias'],
  ['清空回收站', 'action.emptyTrash', 'title'],
  ['快捷键', 'action.shortcuts', 'alias'],
  ['按点击量排序', 'view.sort.clicks', 'alias'],
  ['添加站点', 'action.add', 'title'],
  ['便签墙', 'action.stickyBoard', 'alias'],
  ['设置', 'action.settings', 'title'],
  ['卡片设置', 'action.card', 'title'],
  ['回收站', 'page.trash', 'title'],
  ['列表视图', 'view.mode', 'alias'],
  // 「撤销」是纯口语说法：用户不会打拼音 chexiao，别名层是它唯一的入口
  ['撤销刚才的操作', 'action.undo', 'alias'],
  ['撤销上一步', 'action.undo', 'title']
]
for (const [q, id, kind] of cases) {
  const hit = matchPhrase(q, CMDS)
  ok(hit?.cmd?.id === id, `「${q}」→ ${id}`, hit ? `实得 ${hit.cmd.id}（${hit.kind}）` : 'null')
  if (hit) eq(hit.kind, kind, `「${q}」命中类型是 ${kind}`)
}

/* ── 2. 动态 id 靠 title 子串兜底（别名表没列它们） ── */
{
  const hit = matchPhrase('苹果方案', CMDS)
  ok(hit?.cmd?.id === 'view.scheme.apple', '「苹果方案」→ view.scheme.apple（title 子串兜底）', hit?.cmd?.id)
  const hit2 = matchPhrase('墨绿配色', CMDS)
  ok(hit2?.cmd?.id === 'view.preset.ink', '「墨绿配色」→ view.preset.ink', hit2?.cmd?.id)
}

/* ── 3. 输入太短不猜 ── */
{
  eq(matchPhrase('', CMDS), null, '空输入 → null')
  eq(matchPhrase('   ', CMDS), null, '纯空白 → null')
  eq(matchPhrase('暗', CMDS), null, '单字「暗」不猜（低于 PHRASE_MIN）')
  eq(matchPhrase('a', CMDS), null, '单字母不猜')
  ok(PHRASE_MIN >= 2, 'PHRASE_MIN 至少为 2')
}

/* ── 4. 无意义 / 不像命令的输入 → null（防误伤的主战场） ── */
{
  const noise = ['asdfgh', 'qwerty', '123456', '！！！', '。。。', 'zzzzzz', 'xyz123', '。。。abc']
  for (const q of noise) eq(matchPhrase(q, CMDS), null, `无意义输入「${q}」→ null`)
}

/* ── 5. 普通搜索词不能被猜成命令（误伤的代价是搜不到站点） ── */
{
  // 这些是用户真会搜的东西：站点名、分类、用途
  const searches = [
    '谷歌', 'chatgpt', '百度', 'github', 'youtube', 'bilibili',
    'ai 绘画', '免费图床', '在线ps', '视频剪辑', '电子书', '翻译',
    '比特币', '交易所', 'vps', '域名注册', '天气预报', '邮箱',
    'clash', '机场', '网盘', 'pdf 转换', '代码格式化', '配色网站'
  ]
  let leaked = []
  for (const q of searches) {
    const hit = matchPhrase(q, CMDS)
    if (hit) leaked.push(`${q}→${hit.cmd.id}(${hit.phrase})`)
  }
  eq(leaked.length, 0, `${searches.length} 个真实搜索词无一被误判为命令`, leaked.join(' '))
}

/* ── 5b. title 前缀不参与子串匹配（这条是真踩过的坑） ── */
{
  // 「配色网站」是想找配色类站点，不是要切配色。view.preset.* 的 title 前缀
  // 正是「配色：」，让前缀参与匹配就会把它猜成命令，整段搜索结果消失。
  eq(matchPhrase('配色网站', CMDS), null, '「配色网站」不被猜成切换配色（前缀不参与匹配）')
  eq(matchPhrase('排序网站', CMDS), null, '「排序网站」不被猜成排序命令')
  eq(matchPhrase('视觉方案网站', CMDS), null, '「视觉方案网站」不被猜成切方案')
  // 但特征名仍然有效
  ok(matchPhrase('墨绿配色', CMDS)?.cmd?.id === 'view.preset.ink', '特征名「墨绿」仍能命中 preset')
  ok(matchPhrase('苹果风格', CMDS)?.cmd?.id === 'view.scheme.apple', '特征名「苹果」仍能命中 scheme')
}

/* ── 5c. 别名表是可选的第三级参数（懒加载契约） ── */
{
  // 表还没到时（网络慢 / 首次 chunk 未回）必须**优雅降级**：标题与特征名两级照常，
  // 不能因为没有别名表就把「打开洞察面板」这种整句也认不出来。
  ok(matchPhrase('打开洞察面板', CMDS, {})?.cmd?.id === 'page.insights',
    '无别名表时整句标题仍能命中')
  ok(matchPhrase('墨绿配色', CMDS, {})?.cmd?.id === 'view.preset.ink',
    '无别名表时 title 特征名兜底仍能命中')
  eq(matchPhrase('深色', CMDS, {}), null, '无别名表时纯别名说法不再命中（说明表真的在起作用）')
  // 表本身要能独立加载（懒加载模块的存在性）
  ok(Object.keys(PHRASE_ALIASES).length >= 30,
    '别名表可独立加载且内容完整', `${Object.keys(PHRASE_ALIASES).length} 条命令`)
}

/* ── 6. 意图不明确不猜（同分且无完整标题） ── */
{
  // 「排序」同时是 8 条 view.sort.* 的 title 子串 → 同分 → 不猜
  eq(matchPhrase('排序', CMDS), null, '「排序」命中多条同分 → null（不自作主张）')
  // 加上限定词就明确了
  const hit = matchPhrase('按点击量排序', CMDS)
  ok(hit?.cmd?.id === 'view.sort.clicks', '加上「按点击量」后明确命中', hit?.cmd?.id)
}

/* ── 7. 可重现性：同输入两次结果一致 ── */
{
  const a = matchPhrase('切换到深色', CMDS)
  const b = matchPhrase('切换到深色', CMDS)
  eq(a?.cmd?.id, b?.cmd?.id, '同一输入两次解析结果一致')
}

/* ── 8. 边界：命令表为空 / 缺 title ── */
{
  eq(matchPhrase('切换到深色', []), null, '空命令表 → null')
  eq(matchPhrase('切换到深色', null), null, '命令表为 null → null')
  eq(matchPhrase('切换到深色', [{ id: 'x' }, { title: '切换主题' }]), null,
    '命令缺 id 或 title 时不炸（返回 null）')
}

/* ── 9. describePhrase 给出「理解为」文案 ── */
{
  const hit = matchPhrase('切换到深色', CMDS)
  const d = describePhrase(hit)
  ok(/深色/.test(d) && /切换主题/.test(d), '「理解为」含用户原话与命令名', d)
  eq(describePhrase(null), '', '无命中时文案为空')
}

/* ── 10. 别名表自身健全性 ── */
{
  const ids = new Set(Object.keys(PHRASE_ALIASES))
  eq(ids.size, Object.keys(PHRASE_ALIASES).length, '别名表无重复 id')
  let bad = []
  for (const [id, arr] of Object.entries(PHRASE_ALIASES)) {
    if (!Array.isArray(arr) || !arr.length) bad.push(`${id}:空`)
    for (const a of arr) if (String(a).length < PHRASE_MIN) bad.push(`${id}:${a}过短`)
  }
  eq(bad.length, 0, '每个别名都非空且长度达标', bad.join(' '))
  // 别名单调也应当能命中（用户可能只打别名本身）
  const single = matchPhrase('待办事项', CMDS)
  ok(single?.cmd?.id === 'action.todo', '别名本身作为输入也能命中', single?.cmd?.id)
}

console.log('')
if (failures.length) {
  console.error(`❌ I3 守卫 ${failures.length} 项失败（通过 ${pass} 项）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`✅ I3 守卫全部通过：${pass} 条断言`)
process.exit(0)
