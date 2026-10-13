/**
 * 右边栏设置面板用例：显示模式状态机（shared/right-panel.mjs）+
 * 编辑字段归一（shared/site-edit.mjs）+ 几处**源码级守卫**
 * （持久化白名单、两个编辑入口共用同一份归一、折叠策略的启动时机）。
 *
 * 为什么有源码级断言：这几条的正确性无法靠纯函数用例覆盖 ——
 * 「白名单漏了一个键」在运行时表现为"改了设置刷新就没了"，纯函数永远测不到；
 * 「两个入口各写一份归一」也只在将来漂移时才暴露。用文本断言把契约钉住，
 * 改动一旦破坏就立刻变红（这正是本项目对守卫用例的一贯口径）。
 *
 * 运行：node tools/console/test-right-panel.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { RIGHT_PANEL_MODES, reduceRightPanel } from '../../shared/right-panel.mjs'
import { toDomain, parseAliases, siteToForm, buildSitePatch } from '../../shared/site-edit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

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

/* ==================== 1. 显示模式状态机 ==================== */

const A = { id: 'a', name: 'A' }
const B = { id: 'b', name: 'B' }

eq(RIGHT_PANEL_MODES.length, 3, '模式恰好三种')
deepEq(RIGHT_PANEL_MODES, ['hover', 'click', 'pin'], '模式取值与顺序稳定（设置面板按此渲染）')

/* --- hover：悬停与主动打开都切换 --- */
deepEq(reduceRightPanel('hover', { site: null }, { type: 'hover', site: A }), { site: A },
  'hover：悬停即切换')
deepEq(reduceRightPanel('hover', { site: A }, { type: 'hover', site: B }), { site: B },
  'hover：悬停到另一张即切换')
deepEq(reduceRightPanel('hover', { site: A }, { type: 'select', site: B }), { site: B },
  'hover：主动打开也切换')

/* --- click：忽略悬停 --- */
deepEq(reduceRightPanel('click', { site: A }, { type: 'hover', site: B }), { site: A },
  'click：悬停不改动面板（这是它的卖点）')
deepEq(reduceRightPanel('click', { site: null }, { type: 'hover', site: B }), { site: null },
  'click：空面板悬停也不会打开')
deepEq(reduceRightPanel('click', { site: A }, { type: 'select', site: B }), { site: B },
  'click：主动打开才切换')
deepEq(reduceRightPanel('click', { site: A }, { type: 'select', site: A }), { site: A },
  'click：主动打开同一张 = 无变化（与 pin 的区别之一）')

/* --- pin：忽略悬停 + 主动打开是 toggle --- */
deepEq(reduceRightPanel('pin', { site: A }, { type: 'hover', site: B }), { site: A },
  'pin：悬停不改动面板')
deepEq(reduceRightPanel('pin', { site: A }, { type: 'select', site: A }), { site: null },
  'pin：再选同一张 = 拔掉图钉（与 click 的区别之一）')
deepEq(reduceRightPanel('pin', { site: A }, { type: 'select', site: B }), { site: B },
  'pin：换一张 = 改钉到新的')
deepEq(reduceRightPanel('pin', { site: null }, { type: 'select', site: A }), { site: A },
  'pin：空面板上主动打开 = 钉住')

/* --- clear 与模式无关 --- */
for (const m of RIGHT_PANEL_MODES) {
  deepEq(reduceRightPanel(m, { site: A }, { type: 'clear' }), { site: null },
    `${m}：清空一律生效`)
}

/* --- 非法输入不抛错、不留空壳 --- */
deepEq(reduceRightPanel('nope', { site: null }, { type: 'hover', site: A }), { site: A },
  '非法模式按 hover 处理（宁可跟着鼠标变，也不要卡住不动）')
deepEq(reduceRightPanel(undefined, { site: null }, { type: 'hover', site: A }), { site: A },
  '模式缺省时按 hover 处理')
deepEq(reduceRightPanel('pin', { site: A }, { type: 'select', site: null }), { site: A },
  'select 空目标：保持现状，不显示空壳')
deepEq(reduceRightPanel('hover', { site: A }, { type: 'unknown' }), { site: A },
  '未知事件类型：状态原样返回')
deepEq(reduceRightPanel('hover'), { site: null }, '无状态无事件时不抛错')
ok(reduceRightPanel('hover', { site: A }, { type: 'hover', site: B }).site === B,
  '返回的永远是完整状态对象（调用方整体赋值）')

/* --- frozen：编辑期间悬停不得抢走面板 --- */
deepEq(reduceRightPanel('hover', { site: A, frozen: true }, { type: 'hover', site: B }), { site: A },
  'frozen：悬停被拦下（否则编辑时手抖划过卡片就丢改动）')
deepEq(reduceRightPanel('hover', { site: A, frozen: true }, { type: 'select', site: B }), { site: B },
  'frozen 只拦悬停：select 是明确动作，照常生效')
deepEq(reduceRightPanel('hover', { site: A, frozen: true }, { type: 'clear' }), { site: null },
  'frozen 只拦悬停：clear 照常生效（用户点图钉要能拔掉）')
deepEq(reduceRightPanel('hover', { site: A, frozen: false }, { type: 'hover', site: B }), { site: B },
  'frozen=false 与未提供 frozen 等价')
deepEq(reduceRightPanel('hover', { site: A, frozen: 'yes' }, { type: 'hover', site: B }), { site: B },
  'frozen 只认严格 true（脏值不锁面板）')

/* ==================== 2. 编辑字段归一 ==================== */

eq(toDomain('https://www.Example.com/path?q=1'), 'example.com', '域名脱协议/路径/www/大小写')
eq(toDomain('Example.COM'), 'example.com', '裸域名也归一小写')
eq(toDomain('http://sub.example.com'), 'sub.example.com', '只脱 www.，不脱其他子域')
eq(toDomain(''), '', '空输入返回空串')
eq(toDomain(null), '', 'null 不抛错')
eq(toDomain(undefined), '', 'undefined 不抛错')

deepEq(parseAliases('币安、Binance, binance\nBNB', '某某', 'example.com'), ['币安', 'Binance', 'BNB'],
  '别名：顿号/逗号/换行分隔 + 大小写不敏感去重')
deepEq(parseAliases('GPT, gpt', 'ChatGPT', 'chat.openai.com'), ['GPT'],
  '别名：与自己大小写不敏感同形的项被剔除')
deepEq(parseAliases('ChatGPT', 'ChatGPT', 'chat.openai.com'), [],
  '别名：与站名完全同形被剔除（否则搜索等于给每次查询加噪声）')
deepEq(parseAliases('chat.openai.com', 'ChatGPT', 'chat.openai.com'), [],
  '别名：与域名同形被剔除')
deepEq(parseAliases('  a  ,  , b ', 'x', 'y'), ['a', 'b'], '别名：空片段丢弃、两侧空白裁掉')
deepEq(parseAliases('', 'x', 'y'), [], '别名：空串得空数组')
deepEq(parseAliases(null, 'x', 'y'), [], '别名：null 不抛错')

const f1 = buildSitePatch({ name: '某站', url: 'https://www.foo.com/a', desc: '', categoryId: 'ai', color: '#fff', aliases: '', purposes: [] })
eq(f1.url, 'foo.com', 'patch：落库 url 是裸域名')
ok(!('purposes' in f1) || f1.purposes === undefined,
  'patch：清空用途时传 undefined 而不是空数组（空数组会让卡片渲染出空行）')
eq(f1.initial, '某', 'patch：initial 由站名首字符派生')
eq(f1.pinned, false, 'patch：pinned 缺省为 false（显式写回，便于取消置顶）')
eq(f1.archived, false, 'patch：archived 缺省为 false')
eq(f1.name, '某站', 'patch：name 原样回传')

const f2 = buildSitePatch({ name: 'ChatGPT', url: 'chat.openai.com', purposes: ['ai-chat', 'nope-xyz'] })
deepEq(f2.purposes, ['ai-chat'], 'patch：词表外的用途被过滤')
const f3 = buildSitePatch({ name: 'x', url: 'y', purposes: ['ai-chat', 'ai-chat'] })
deepEq(f3.purposes, ['ai-chat'], 'patch：用途去重')
eq(buildSitePatch({}).initial, '', 'patch：缺名时不抛错，initial 为空串')
eq(buildSitePatch({ name: 'ChatGPT' }).url, '', 'patch：缺站名时不抛错，url 为空串')
deepEq(buildSitePatch({ name: 'n', url: '', aliases: 'a、b' }).aliases, ['a', 'b'],
  'patch：域名缺失时别名仍按站名/空域名过滤')

/* --- siteToForm 往返：两个编辑入口「打开时看到同一份东西」 --- */
const srcSite = { id: 's1', name: 'ChatGPT', url: 'chat.openai.com', desc: '对话助手', categoryId: 'ai', color: '#10a37f', aliases: ['GPT', '小绿'], purposes: ['ai-chat'], pinned: true, archived: false }
const form = siteToForm(srcSite)
eq(form.aliases, 'GPT、小绿', 'siteToForm：别名拼成顿号分隔字符串（表单控件是文本框）')
deepEq(form.purposes, ['ai-chat'], 'siteToForm：用途归一为数组')
eq(form.pinned, true, 'siteToForm：pinned === true 才为真')
eq(form.archived, false, 'siteToForm：archived === true 才为真')
const rt = buildSitePatch(form)
eq(rt.name, srcSite.name, '往返：名称不变')
eq(rt.url, srcSite.url, '往返：域名不变')
eq(rt.color, srcSite.color, '往返：颜色不变')
deepEq(rt.aliases, srcSite.aliases, '往返：别名不变')
deepEq(rt.purposes, srcSite.purposes, '往返：用途不变')
eq(rt.pinned, true, '往返：置顶不变')
deepEq(siteToForm(null).aliases, '', 'siteToForm：null 走默认值分支')
eq(siteToForm({ id: 'z', name: 'n' }).color, undefined,
  'siteToForm：刻意不补默认值（补了就会悄悄改变 EditSiteModal 的既有行为）')

/* ==================== 3. 源码级守卫 ==================== */

const prefsSrc = read('src/stores/preferences.js')
const sidebarSrc = read('src/stores/sidebar.js')
const appSrc = read('src/App.vue')
const detailSrc = read('src/components/right/SiteDetailPanel.vue')
const editModalSrc = read('src/components/EditSiteModal.vue')
const rightSidebarSrc = read('src/components/RightSidebar.vue')
const siteCardSrc = read('src/components/SiteCard.vue')

// 3.1 模式取值只定义一处（本地再写一份数组 → "设置项能选、状态机不认"的静默失效）
ok(/export\s*\{\s*RIGHT_PANEL_MODES\s*\}/.test(prefsSrc),
  'preferences.js 从 shared/right-panel.mjs re-export 模式取值，不本地再写一份')
ok(!/const\s+RIGHT_PANEL_MODES\s*=/.test(prefsSrc),
  'preferences.js 不得本地定义 RIGHT_PANEL_MODES')

// 3.2 持久化白名单必须含三组新偏好（漏一个 → 改了设置刷新就没了）
for (const key of ['rightPanelMode', 'rightSections', 'rightCollapsePolicy']) {
  const re = new RegExp(`['"]${key}['"]`)
  ok(re.test(prefsSrc), `preferences.js 声明了 ${key}`)
}
const persistLine = prefsSrc.split('\n').find(l => l.includes('versionedPersist('))
ok(!!persistLine, 'preferences.js 有 persist 配置')
const persistBlock = prefsSrc.slice(prefsSrc.indexOf('versionedPersist('), prefsSrc.indexOf('versionedPersist(') + 400)
for (const key of ['rightPanelMode', 'rightSections', 'rightCollapsePolicy']) {
  ok(persistBlock.includes(`'${key}'`), `${key} 在 persist 白名单里（否则改了设置刷新即丢）`)
}

// 3.3 单状态模型：旧的双目标 API 不得复活
for (const dead of ['hoveredSite', 'pinnedSite', 'setHoveredSite', 'clearHoveredSite', 'displaySite']) {
  ok(!new RegExp(`\\b${dead}\\b`).test(sidebarSrc), `sidebar.js 不得再出现 ${dead}`)
}
ok(/reduceRightPanel/.test(sidebarSrc), 'sidebar.js 的写入统一走 reduceRightPanel（唯一通道）')
ok(/frozen:\s*rightFrozen\.value/.test(sidebarSrc), 'sidebar.js 把 frozen 传进状态机')
ok(/setRightFrozen/.test(sidebarSrc), 'sidebar.js 暴露 setRightFrozen')

// 3.4 折叠策略的启动时机：必须在持久化回填之后（App.vue 的 onMounted），不能写在 store setup 主体
ok(/applyCollapsePolicy\s*\(\)/.test(sidebarSrc), 'sidebar.js 定义 applyCollapsePolicy')
ok(/applyCollapsePolicy\s*\(\)/.test(appSrc), 'App.vue 调用了 applyCollapsePolicy（启动时机）')
{
  // 断言调用点在 onMounted 回调体内，而不是模块顶层
  const idx = appSrc.indexOf('onMounted(() =>')
  const callIdx = appSrc.indexOf('sidebarStore.applyCollapsePolicy()')
  ok(idx !== -1 && callIdx > idx, 'applyCollapsePolicy 落在 onMounted 回调里（persistedstate 回填之后）')
  // store setup 主体里不得直接同步读持久化值来定折叠
  ok(!/rightCollapsed\.value\s*=\s*prefs\.rightCollapsePolicy/.test(sidebarSrc),
    'sidebar.js 不得在 setup 主体同步按策略写 rightCollapsed')
}

// 3.5 两个编辑入口共用同一份归一（复制一份 = 开两条会分叉的路）
for (const [name, src] of [['EditSiteModal.vue', editModalSrc], ['SiteDetailPanel.vue', detailSrc]]) {
  ok(/from\s+['"][^'"]*shared\/site-edit\.mjs['"]/.test(src), `${name} 引入 shared/site-edit.mjs`)
  ok(/buildSitePatch\s*\(/.test(src), `${name} 用 buildSitePatch 构造落库 patch`)
  ok(/siteToForm\s*\(/.test(src), `${name} 用 siteToForm 构造表单初值`)
  ok(!/function\s+parseAliases/.test(src), `${name} 不得再本地实现 parseAliases`)
}

// 3.6 内联编辑必须占用面板（否则 hover 模式下编辑中鼠标划过卡片即丢改动）
ok(/setRightFrozen\s*\(\s*true\s*\)|setRightFrozen\s*\(\s*v\s*\)/.test(detailSrc),
  'SiteDetailPanel 在进入编辑态时占用面板')
ok(/onBeforeUnmount\([\s\S]{0,200}setRightFrozen\s*\(\s*false\s*\)/.test(detailSrc),
  'SiteDetailPanel 卸载时释放占用（否则面板会永久冻结）')

// 3.7 区块显隐只作用于阅读态；编辑态不受开关约束
ok(/activeRightSections/.test(detailSrc), 'SiteDetailPanel 读取 activeRightSections')
{
  const showCount = (detailSrc.match(/v-if="show\./g) || []).length
  ok(showCount >= 7, `阅读态各区块都挂了开关（实得 ${showCount} 处，期望 ≥7）`)
  // 头部与分类标签不得挂开关
  ok(!/detail-header[^>]*v-if="show\./.test(detailSrc), '头部不参与区块开关')
  ok(!/detail-category[^>]*v-if="show\./.test(detailSrc), '分类标签不参与区块开关')
}

// 3.8 触发分流：卡片悬停走 hoverSite，右键详情走 selectSite；不得再直接写 rightSite
ok(/hoverSite\s*\(/.test(siteCardSrc), 'SiteCard 悬停走 sidebarStore.hoverSite')
ok(!/clearHoveredSite|onHoverLeave/.test(siteCardSrc), 'SiteCard 不再在鼠标离开时清空面板（这正是要修的毛病）')
ok(/selectSite\s*\(/.test(sidebarSrc), 'sidebar.js 的 showDetail 走 selectSite（与模式语义不脱钩）')

// 3.9 面板内容按 id 现取：否则 updateSite 后 rebuild 换新对象，面板停在旧值
ok(/sitesStore\.sites\.find/.test(rightSidebarSrc),
  'RightSidebar 按 id 重取站点（否则内联编辑保存后面板不刷新）')

// 3.10 编辑弹窗在三处引用必须**全部**异步 —— 漏一处整模块就被提升回首屏
// （实测：静态引入时首屏 598.3 → 604.0 KiB，越过 600 KiB 预算）。
// 这条比体积断言更早失败、也更直接指出原因。
for (const p of ['src/App.vue', 'src/components/CardsContainer.vue', 'src/components/admin/AdminSitesPanel.vue']) {
  const src = read(p)
  ok(!/^import EditSiteModal from/m.test(src), `${p} 不得静态 import EditSiteModal`)
  ok(/defineAsyncComponent\(\(\)\s*=>\s*import\('@\/components\/EditSiteModal\.vue'\)\)/.test(src),
    `${p} 用 defineAsyncComponent 加载 EditSiteModal`)
}
// SiteDetailPanel 里的用途选择器同理：它在首屏组件内，但只有进编辑态才需要
ok(/defineAsyncComponent\(\(\)\s*=>\s*import\('@\/components\/PurposePicker\.vue'\)\)/.test(detailSrc),
  'SiteDetailPanel 异步加载 PurposePicker（静态引入会把首屏顶过预算）')
ok(!/^import PurposePicker from/m.test(detailSrc), 'SiteDetailPanel 不得静态 import PurposePicker')

/* ==================== 结果 ==================== */

if (failures.length) {
  console.error(`\n❌ ${failures.length} 条断言失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ right-panel（模式状态机 + 编辑归一 + 源码守卫）全部通过：${pass} 条断言`)
