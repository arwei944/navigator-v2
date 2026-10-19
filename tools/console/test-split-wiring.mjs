#!/usr/bin/env node
/**
 * test-split-wiring —— 大文件拆分后的「接线」守卫。
 *
 * ## 为什么需要它
 *
 * 2026-10 把五个大文件拆成了纯函数 / 组合式模块。纯函数部分由 `test-sites-split`
 * 直接断言；但**组合式之间的接线**（谁把哪个 ref 传给谁、返回值解构对不对）
 * 是 Node 直接 import 测不到的 —— 它们依赖 `@/` 别名与 Vue 运行时。
 *
 * 构建能验证「语法没问题」，验证不了「接上去之后行为还对」。而这正是拆分最常见的故障：
 *   - `useOmniPhrase` 拿到的 `commands` 是 ref 还是数组？
 *   - `buildDefaultGroups` 的 `getRecentSites` 签名对不上？
 *   - `filterByAxes` 的 `cats` 少传一个方法，整域筛选静默退化成「不过滤」？
 *
 * 所以这里用 Vite 自己的 `ssrLoadModule`（与项目既有 test-frontend / test-mobile 同一手法）
 * 把模块按**真实解析规则**加载进来，再组装真实调用链。
 *
 * ## 覆盖
 *
 *   [A] 自然语言 → 命令：`切换主题` 必须命中 `view.theme`；不明确输入必须不猜
 *   [B] 默认视图 / 二级页：分组结构、固定常用命令、空输入不给「无匹配」
 *   [C] 筛选与排序：归档范围、整域筛选、置顶只在非搜索时浮前
 *   [D] 结构：拆分边界仍在（防有人把实现合回去）
 *
 * 运行：node tools/console/test-split-wiring.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createServer } from 'vite'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => {
  if (cond) pass++
  else failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}

/* 关掉 HMR：middlewareMode 下仍会起 WebSocket，端口被占时往 stderr 喷一行 */
const server = await createServer({
  root: ROOT,
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
})

try {
  const { matchPhrase, describePhrase } = await server.ssrLoadModule('/src/utils/commandPhrases.js')
  const { buildCommands } = await server.ssrLoadModule('/src/utils/commands.js')
  const { buildDefaultGroups, buildSiteActionItems, GROUP_LABEL, COMMON_COMMAND_IDS } = await server.ssrLoadModule(
    '/src/utils/omniViews.js',
  )
  const { filterByAxes, computeFilteredSites } = await server.ssrLoadModule('/src/stores/sitesFilter.js')

  /* ── 构造一个够用的命令上下文 ── */
  const noop = () => () => {}
  const ctx = {
    router: { push: noop() },
    sites: [],
    categories: [{ id: 'ai', label: 'AI' }],
    preferences: {
      theme: 'light',
      toggleTheme: noop(),
      setThemePreset: noop(),
      setVisualScheme: noop(),
      engines: [{ id: 'google', label: 'Google' }],
      THEME_PRESETS: { p1: { id: 'p1', name: '默认' } },
    },
    sidebar: { toggle: noop(), showDetail: noop() },
    omni: { close: noop() },
    toast: { push: noop() },
    favorites: { isFav: () => false, toggle: noop() },
    notes: { count: 0 },
    openSite: noop(),
    siteNotes: { has: () => false },
  }
  const commands = buildCommands(ctx)

  /* ══════════ [A] 自然语言 → 命令 ══════════ */

  ok(commands.length >= 40, `命令表构建成功（${commands.length} 条）`)

  const hit = matchPhrase('切换主题', commands, {})
  ok(Boolean(hit), '「切换主题」能被理解')
  ok(hit && hit.cmd.id === 'view.theme', '「切换主题」命中 view.theme', hit ? hit.cmd.id : '无')
  ok(hit && describePhrase(hit).includes('切换主题'), '理解说明可读（describePhrase）')

  const ambiguous = matchPhrase('主题', commands, {})
  ok(ambiguous === null || Boolean(ambiguous.cmd), '模糊输入要么不猜、要么给一条明确命令（不抛错）')

  ok(matchPhrase('收', commands, {}) === null, '过短输入不猜（低于 PHRASE_MIN）')

  /* ══════════ [B] 默认视图 / 二级页 ══════════ */

  const recentSite = { id: 's1', name: '最近用的', url: 'a.com' }
  const groups = buildDefaultGroups({
    sites: [recentSite],
    commands,
    getRecentSites: () => [recentSite],
    openSite: noop(),
  })
  ok(groups.some((g) => g.type === 'recent'), '默认视图含最近访问组')
  ok(groups.some((g) => g.type === 'common'), '默认视图含常用命令组')

  const common = groups.find((g) => g.type === 'common')
  ok(common && common.items.length === COMMON_COMMAND_IDS.length, `常用命令条数与常量一致（${common?.items.length}）`)
  ok(common && common.items.every((i) => typeof i.run === 'function'), '每条常用命令都有可执行 run')
  ok(GROUP_LABEL.phrase === '理解', '分组标签表完整（理解组）')

  const actions = buildSiteActionItems({
    pageSite: { id: 's1', name: 'X', url: 'x.com' },
    commands: buildCommands(ctx),
    query: '',
    scoreCtx: { matchAny: () => 0, scoreText: () => 0, subWeight: 0.5 },
  })
  ok(actions.length >= 3, `二级页操作列表非空（${actions.length} 条）`)
  ok(actions.every((a) => a.key.startsWith('act:')), '二级页每项都有稳定 key')
  ok(
    buildSiteActionItems({ pageSite: null, commands, query: '', scoreCtx: {} }).length === 0,
    '不在二级页时操作列表为空（不误报）',
  )

  /* ══════════ [C] 筛选与排序 ══════════ */

  const cats = {
    isDomainScope: (v) => v === 'ai',
    categoriesOfDomain: (v) => (v === 'ai' ? [{ id: 'starter' }, { id: 'coding' }] : []),
  }
  const list = [
    { id: 'a', name: 'Alpha', categoryId: 'starter', purposes: ['learning'], pinned: true },
    { id: 'b', name: 'Bravo', categoryId: 'coding', purposes: [], pinned: false },
    { id: 'c', name: 'Charlie', categoryId: 'cex', purposes: [] },
    { id: 'd', name: 'Delta', categoryId: 'starter', archived: true },
  ]

  const visible = filterByAxes(list, { archivedScope: false, category: 'all', purpose: 'all' }, cats)
  ok(visible.map((s) => s.id).join(',') === 'a,b,c', '归档站不进非归档范围')
  ok(
    filterByAxes(list, { archivedScope: true, category: 'all', purpose: 'all' }, cats).map((s) => s.id).join(',') === 'd',
    '归档范围只看归档站',
  )
  ok(
    filterByAxes(list, { archivedScope: false, category: 'ai', purpose: 'all' }, cats).map((s) => s.id).join(',') === 'a,b',
    '整域筛选命中全部子分类',
  )
  ok(
    filterByAxes(list, { archivedScope: false, category: 'all', purpose: 'learning' }, cats).map((s) => s.id).join(',') === 'a',
    '用途筛选生效',
  )

  /* 排序：置顶只在非搜索时浮前；搜索时按相关性，不能让置顶插队 */
  const clicksStore = { countFor: () => 0, mergedCounts: {} }
  const sortCtx = {
    cats,
    clicksStore,
    historyRecords: [],
    buildSignals: () => ({}),
    hasSignal: () => false,
    rankSmart: (l) => l.map((site) => ({ site })),
    rankSites: (l) => l.slice(), // 模拟「相关性排序」：原始顺序
  }
  const noSearch = computeFilteredSites(list, {
    archivedScope: false, category: 'all', purpose: 'all', sortBy: 'default', searchQuery: '', clickBoost: false,
  }, sortCtx)
  ok(noSearch[0].id === 'a', '不搜索时置顶项浮到最前')

  const searched = computeFilteredSites(list, {
    archivedScope: false, category: 'all', purpose: 'all', sortBy: 'default', searchQuery: 'charlie', clickBoost: false,
  }, sortCtx)
  ok(searched.map((s) => s.id).join(',') === 'a,b,c', '搜索时置顶不插队（相关性说了算）')

  /* ══════════ [D] 命令评分必须带上下文（真实回归） ══════════
   *
   * 2026-10 拆分 useOmniBox 时，`commandResults` 里的 `commandScore(c, q)` 漏了第三个
   * 参数，而 `commandScore` 用解构签名 `{ matchAny, scoreText, subWeight }` —— 漏传即抛
   * 「Cannot destructure property 'matchAny' of 'undefined'」。
   *
   * 后果不是「结果少几条」，而是：异常发生在搜索框 render 期间的 computed 里，
   * Vue 把整棵子树卸掉重挂 → 输入框失焦 → 用户输入 `github` 只有 `g` 进得去。
   * 这个缺陷 build 与既有门禁全绿，只有真机按键能暴露，所以在这里补两道机器守卫：
   *   1) 结构：每个 `commandScore(...)` 调用点都必须传第三个参数；
   *   2) 行为：拿真实命令表跑一遍评分，不许抛错且必须能命中。 */

  const { commandScore } = await server.ssrLoadModule('/src/utils/omniViews.js')
  const { matchAny, scoreText } = await server.ssrLoadModule('/src/utils/search.js')
  const scoreCtx = { matchAny, scoreText, subWeight: 0.5 }
  let scoreThrew = null
  try {
    const scored = commands.map(c => commandScore(c, 'theme', scoreCtx))
    ok(scored.some(s => s > 0), '命令评分在真实命令表上能命中')
  } catch (e) {
    scoreThrew = e?.message || String(e)
  }
  ok(!scoreThrew, '命令评分带上下文时不抛错', scoreThrew || '')
  let missingCtx = null
  try {
    commandScore(commands[0], 'theme')
  } catch (e) {
    missingCtx = e?.message || String(e)
  }
  ok(/Cannot destructure|undefined/.test(missingCtx || ''), '漏传上下文会明确报错（签名契约成立）')

  const omniSrc = readFileSync(join(ROOT, 'src/composables/useOmniBox.js'), 'utf-8')
  const bareScoreCalls = [...omniSrc.matchAll(/commandScore\(\s*[^,()]+,\s*[^,()]+\s*\)/g)]
  ok(bareScoreCalls.length === 0, 'useOmniBox 中每个 commandScore 调用都传了评分上下文', bareScoreCalls.map(m => m[0]).join(' / '))
  const ctxIdx = omniSrc.indexOf('const scoreCtx =')
  const firstScoreCall = omniSrc.search(/commandScore\(/)
  ok(ctxIdx >= 0 && (firstScoreCall === -1 || ctxIdx < firstScoreCall), 'scoreCtx 定义在首次 commandScore 调用之前')

  /* ══════════ [E] 拆分边界仍在 ══════════ */

  const read = (p) => readFileSync(join(ROOT, p), 'utf-8')
  const omni = read('src/composables/useOmniBox.js')
  ok(/useOmniPreview\(/.test(omni), 'useOmniBox 接线 useOmniPreview')
  ok(/useOmniPhrase\(/.test(omni), 'useOmniBox 接线 useOmniPhrase')
  ok(/buildDefaultGroups\(/.test(omni), 'useOmniBox 接线 buildDefaultGroups')
  ok(!/function matchPhrase/.test(omni), 'useOmniBox 未重新内联自然语言匹配')

  const app = read('src/App.vue')
  ok(/useRouteSync\(/.test(app), 'App.vue 接线 useRouteSync')
  ok(/useAppLifecycle\(/.test(app), 'App.vue 接线 useAppLifecycle')
  ok(/useCloudNotice\(/.test(app), 'App.vue 接线 useCloudNotice')

  const sites = read('src/stores/sites.js')
  ok(/createCloudSync\(/.test(sites), 'sites.js 接线 createCloudSync')
  ok(/rebuildSites\(/.test(sites), 'sites.js 接线 rebuildSites')
  ok(/createSiteMutations\(/.test(sites), 'sites.js 接线 createSiteMutations')
} catch (e) {
  failures.push('执行异常：' + (e?.message || e))
  console.error(e?.stack || e)
} finally {
  await server.close()
}

console.log(`\n🔌 拆分接线守卫：${pass} 通过 / ${failures.length} 失败`)
if (failures.length) {
  for (const f of failures) console.log(`   ❌ ${f}`)
  process.exit(1)
}
console.log('   ✅ 自然语言 / 默认视图 / 二级页 / 筛选排序 / 拆分边界 全部接线正确')
