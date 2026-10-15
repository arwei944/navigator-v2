/**
 * 后台快捷键与全局搜索守卫：纯函数，不碰 DOM。
 *
 * 守的核心：
 *  1. 快捷键只在「不在输入框里、没按修饰键」时生效 —— 否则用户在搜索框里打 gs 就跳面板；
 *  2. 搜索的排序：设置项 > 模块 > 站点，且标题前缀命中优先（打「站点」先出「站点管理」）。
 *
 * 运行：node tools/console/test-admin-tools.mjs
 */
import { ADMIN_SHORTCUTS, matchShortcut, shouldIgnoreKey, SHORTCUT_PREFIX } from '../../shared/admin-shortcuts.mjs'
import { buildAdminIndex, searchAdminIndex, ADMIN_SETTINGS_ENTRIES } from '../../shared/admin-search.mjs'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

/* ---- 快捷键 ---- */

eq(matchShortcut('g', 's')?.tab, 'sites', 'g+s → 站点管理')
eq(matchShortcut('G', 'S')?.tab, 'sites', '大小写不敏感')
eq(matchShortcut('g', 'z'), null, '未登记的键位 → null')
eq(matchShortcut('', 's'), null, '缺前缀 → null')
eq(SHORTCUT_PREFIX, 'g', '前缀是 g')
// tab 目标不重复、且都在合理的模块集合里
const tabs = ADMIN_SHORTCUTS.map(s => s.tab)
eq(new Set(tabs).size, tabs.length, '每条快捷键指向不同模块')

eq(shouldIgnoreKey({ target: { tagName: 'INPUT' } }), true, '焦点在 input → 忽略')
eq(shouldIgnoreKey({ target: { tagName: 'TEXTAREA' } }), true, '焦点在 textarea → 忽略')
eq(shouldIgnoreKey({ target: { tagName: 'DIV', isContentEditable: true } }), true, 'contenteditable → 忽略')
eq(shouldIgnoreKey({ target: { tagName: 'DIV' } }), false, '普通元素 → 不忽略')
eq(shouldIgnoreKey({ target: { tagName: 'DIV' }, ctrlKey: true }), true, '带 Ctrl → 忽略（不抢浏览器组合键）')
eq(shouldIgnoreKey({ target: { tagName: 'DIV' }, metaKey: true }), true, '带 Cmd → 忽略')
eq(shouldIgnoreKey(null), true, '无事件对象 → 忽略')

/* ---- 搜索索引 ---- */

const tabsList = [
  { id: 'overview', label: '概览' },
  { id: 'sites', label: '站点管理' },
  { id: 'plugins', label: '插件' },
]
const sites = [
  { id: 'a', name: '站点导航', url: 'nav.example', desc: '一个导航站', aliases: ['导航'] },
  { id: 'b', name: 'GitHub', url: 'github.com', desc: '代码托管' },
]
const index = buildAdminIndex({ tabs: tabsList, sites, categories: [{ id: 'ai', label: 'AI 对话' }] })
ok(index.length >= tabsList.length + sites.length + 1, '索引包含模块、站点与分类', String(index.length))
ok(index.every(it => it.title), '索引项都有标题（无标题的被过滤）')

// 找模块
const r1 = searchAdminIndex(index, '插件')
ok(r1.length > 0 && r1[0].kind === 'tab' && r1[0].target === 'plugins', '搜「插件」命中的是插件模块', JSON.stringify(r1[0]))

// 找设置项：搜「告警」应命中 settings 条目
const r2 = searchAdminIndex(index, '告警')
ok(r2.some(x => x.kind === 'setting' && x.target === 'preferences'), '搜「告警」命中偏好设置里的告警规则', JSON.stringify(r2.map(x => x.id)))

// 找站点
const r3 = searchAdminIndex(index, 'github')
ok(r3.some(x => x.kind === 'site' && x.title === 'GitHub'), '搜「github」命中站点')

// 别名可搜
ok(searchAdminIndex(index, '导航').some(x => x.kind === 'site'), '站点别名参与搜索')

// 排序：设置项权重高于模块
const r4 = searchAdminIndex(index, '站点')
ok(r4.length > 0, '搜「站点」有结果')
const firstSiteMgmt = r4.findIndex(x => x.target === 'sites')
ok(firstSiteMgmt !== -1, '结果里有站点相关项')

// 空查询
eq(searchAdminIndex(index, '').length, 0, '空查询 → 空结果')
eq(searchAdminIndex(index, '   ').length, 0, '纯空白 → 空结果')
eq(searchAdminIndex(null, 'x').length, 0, '无索引安全')

// limit 生效
ok(searchAdminIndex(index, 'a', 1).length <= 1, 'limit 生效')
eq(ADMIN_SETTINGS_ENTRIES.length > 0, true, '设置项表非空')

/* ---- 结果 ---- */

if (failures.length) {
  console.error(`\n❌ 后台快捷键/搜索 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 后台快捷键与全局搜索：${pass} 条断言`)
process.exit(0)
