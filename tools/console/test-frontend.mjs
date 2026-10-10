/**
 * 第三批 · 序 18 / 20 / 23 的前端守卫。
 *
 * 这些模块依赖 `@/` 别名、Vue 与 Pinia，不能用裸 node 直接 import。这里借 Vite 自己的
 * `ssrLoadModule` 把源码按项目真实配置加载进来（等同构建时的解析规则），
 * 于是不必为了可测性去改生产代码的结构。零新增依赖。
 *
 * 三组断言：
 *   [A] 序 23 —— pinyin-pro 懒加载的**降级 → 就绪 → 自动重算**全链路。
 *       这里的核心不是「能加载」，而是「降级期间算出的缓存必须在引擎到位后被丢弃」——
 *       漏了那一步，用户第一次搜索会得到「拼音搜不到」并且**永久如此**。
 *   [B] 序 20 —— 浏览历史按 siteId 去重（旧实现里连点同一站点 50 次就能占满整个配额）。
 *   [C] 序 20 —— 从会话同步灌入的记录方向是「最新在前」（旧实现 push 到末尾，整个列表倒着）。
 *
 * 运行：node tools/console/test-frontend.mjs
 */
import { createServer } from 'vite'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

/**
 * middlewareMode 下 Vite 仍会尝试起一个 HMR WebSocket，端口被占时往 stderr 喷一行
 * 与本测试无关的告警。真实错误照常打印，只过滤这一条噪声。
 */
const quietLogger = {
  info() {}, warn() {}, warnOnce() {}, clearScreen() {}, hasWarned: false,
  error(msg) { if (!/WebSocket server error/.test(String(msg))) console.error(msg) },
}

const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
  customLogger: quietLogger,
  // pinyin-pro 是 CJS 包，交给 Vite 转换而不是让 Node 直接 import（后者命名导出可能取不到）
  ssr: { noExternal: ['pinyin-pro'] },
})

try {
  /* ══════════ [A] 序 23：拼音引擎懒加载 ══════════ */

  const search = await server.ssrLoadModule('/src/utils/search.js')

  // 一个「只有拼音能命中」的站点：中文名 + 无别名 + url/desc 里都不含目标串
  const site = { id: 'g', name: '谷歌', url: 'https://example.org', desc: '搜索引擎', aliases: [], purposes: [] }

  eq(search.pinyinReady.value, false, '加载后引擎未就绪（不随首屏同步打包）')

  // 降级窗口：拼音档位全部落在空串上 → 纯拼音查询必然 0 命中
  eq(search.scoreSite(site, 'gg'), 0, '引擎未就绪时纯拼音查询不命中（降级为无拼音）')
  eq(search.scoreText('切换主题', 'qhzt'), 0, '引擎未就绪时文本拼音查询不命中')

  // 非拼音路径不受影响 —— 降级只摘掉拼音一档，其余照常工作
  eq(search.scoreSite(site, '谷歌'), search.SCORE.NAME_EXACT, '降级期间中文精确命中照常工作')
  eq(search.scoreSite(site, 'example'), search.SCORE.URL_INCLUDES, '降级期间域名命中照常工作')
  eq(search.scoreText('切换主题', '切换'), 700, '降级期间文本直接命中照常工作')

  // 就绪
  const lib = await search.preloadPinyin()
  ok(typeof lib === 'function', 'preloadPinyin 返回拼音函数')
  eq(search.pinyinReady.value, true, '预取完成后 pinyinReady 翻真')

  // **关键**：降级期间已缓存的键必须作废。site 是同一个对象身份，若键表没被整体换掉，
  // 这里仍会读到「没有拼音字段」的旧键，于是永久搜不出拼音结果。
  eq(search.scoreSite(site, 'gg'), search.SCORE.PY_INITIAL_PREFIX, '引擎到位后同一站点对象重算出拼音首字母命中')
  eq(search.scoreText('切换主题', 'qhzt'), 380, '引擎到位后文本拼音键重算（textKeyCache 已清）')
  eq(search.scoreSite(site, 'guge'), search.SCORE.PY_NAME_INCLUDES, '引擎到位后整拼音命中')

  // 幂等：重复预取不重复加载、不改变结果
  const again = await search.preloadPinyin()
  eq(again, lib, 'preloadPinyin 幂等（返回同一实例）')
  eq(search.pinyinReady.value, true, '重复预取后仍为就绪')

  // rankSites / matchedAlias 走的是同一套键，抽样确认没有旁路
  {
    const ranked = search.rankSites([site, { id: 'x', name: '别的站', url: 'https://other.org' }], 'guge')
    eq(ranked[0]?.id, 'g', 'rankSites 能按拼音排序到目标站')
    const aliased = { ...site, aliases: ['狐狸'] }
    eq(search.matchedAlias(aliased, 'huli'), '狐狸', 'matchedAlias 能解释「拼音命中别名」')
  }

  /* ══════════ [B][C] 序 20：浏览历史 store ══════════ */

  // 注意：pinia 必须用**裸 import** 取，不能过 ssrLoadModule ——
  // ssrLoadModule 会给出另一个模块实例，setActivePinia 设的状态在 store 那边看不见。
  // 而 history.js 里的 'pinia' 在 SSR 下被 Vite externalize 成原生 import，两者才是同一个。
  const { createPinia, setActivePinia } = await import('pinia')
  setActivePinia(createPinia())
  const { useHistoryStore } = await server.ssrLoadModule('/src/stores/history.js')
  const history = useHistoryStore()

  // B1：同一站点重复访问 → 只占一条，且被提到最前
  history.clear()
  history.addRecord('a')
  history.addRecord('b')
  history.addRecord('a')
  eq(history.records.length, 2, '同一 siteId 重复访问只占一条')
  eq(history.records[0].siteId, 'a', '重复访问把该站点提到最前')

  // B2：**旧 bug 的回归点** —— 连点同一站点不能把 50 条配额占满
  history.clear()
  history.addRecord('a'); history.addRecord('b'); history.addRecord('c')
  for (let i = 0; i < 80; i++) history.addRecord('hot')
  eq(history.records.length, 4, '一个高频站点最多占 1 条（不再挤掉其它站点）')
  ok(history.records.some(r => r.siteId === 'a') && history.records.some(r => r.siteId === 'b'),
    '高频访问后其它站点仍在列表里', JSON.stringify(history.records.map(r => r.siteId)))

  // B3：空 / null 的 siteId 不该写进历史
  history.clear()
  for (const v of [undefined, null, '']) history.addRecord(v)
  eq(history.records.length, 0, '空值 siteId 不写入历史')

  // B4：上限截断
  history.clear()
  for (let i = 0; i < 60; i++) history.addRecord(`s${i}`)
  eq(history.records.length, 50, '历史条数截断到 50')
  eq(history.records[0].siteId, 's59', '最新一条在最前')

  // C1：从会话同步灌入 → 必须**最新在前**（旧实现 push 到末尾，列表整个倒过来）
  history.clear()
  history.addRawRecord({ siteId: 'old', timestamp: 1000 })
  history.addRawRecord({ siteId: 'new', timestamp: 3000 })
  history.addRawRecord({ siteId: 'mid', timestamp: 2000 })
  eq(history.records.map(r => r.siteId).join(','), 'new,mid,old', 'addRawRecord 按时间倒序（最新在前）')

  // C2：灌入也要去重，且时间戳接受 ISO 串
  history.clear()
  history.addRawRecord({ siteId: 'x', timestamp: '2026-01-01T00:00:00.000Z' })
  history.addRawRecord({ siteId: 'x', timestamp: '2026-06-01T00:00:00.000Z' })
  eq(history.records.length, 1, 'addRawRecord 按 siteId 去重')
  eq(history.records[0].timestamp, new Date('2026-06-01T00:00:00.000Z').getTime(), 'ISO 串时间戳被归一成毫秒')

  // C3：非法时间戳回退到「现在」而不是 NaN（NaN 会让排序整个失效）
  history.clear()
  history.addRawRecord({ siteId: 'y', timestamp: 'garbage' })
  ok(Number.isFinite(history.records[0].timestamp), '非法时间戳回退成有限数值', String(history.records[0].timestamp))

  // C4：getLastVisitTime 用的是去重后的记录
  history.clear()
  history.addRecord('z')
  ok(Number.isFinite(history.getLastVisitTime('z')), 'getLastVisitTime 返回时间戳')
  eq(history.getLastVisitTime('nope'), null, '未访问过的站点返回 null')

  /* ══════════ [D] 打开外部链接只有一条口径，且必须是「链接导航」而非「弹窗请求」 ══════════ */

  /**
   * 背景：用户反馈「点击卡片会覆盖当前网址」。在桌面 Chrome 里原实现
   * （`window.open(url, '_blank', 'noopener')`）实测**是对的** —— 但按规范，传了
   * windowFeatures 的 window.open 属于**弹窗请求**，在内嵌 WebView / 弹窗拦截下会退化成
   * 「就地打开」。所以统一改成合成 `<a target="_blank" rel="noopener noreferrer">` 的点击。
   *
   * 这里用一个**最小 DOM 桩**验证 openInNewTab 的语义（不引入 jsdom）。
   */
  const made = []
  globalThis.document = {
    createElement(tag) {
      const el = { tag, style: {}, clicked: 0, removed: false, appended: false }
      el.click = () => { el.clicked++ }
      el.remove = () => { el.removed = true }
      made.push(el)
      return el
    },
    body: { appendChild(el) { el.appended = true } },
  }

  const { openInNewTab } = await server.ssrLoadModule('/src/utils/open.js')

  openInNewTab('https://example.com/a?b=1')
  const el = made.at(-1)
  eq(made.length, 1, 'openInNewTab 创建了一个元素')
  eq(el.tag, 'a', '用的是 <a>（链接导航），不是 window.open（弹窗请求）')
  eq(el.href, 'https://example.com/a?b=1', 'href 就是目标地址')
  eq(el.target, '_blank', 'target=_blank —— 新标签页')
  ok(el.rel.includes('noopener') && el.rel.includes('noreferrer'), 'rel 同时含 noopener 与 noreferrer', el.rel)
  eq(el.clicked, 1, '触发了一次点击')
  eq(el.appended, true, '先挂到 body 再点（Firefox 的必要条件）')
  eq(el.removed, true, '点完把临时节点摘掉，不留在 DOM 里')

  const before = made.length
  openInNewTab('')
  openInNewTab(null)
  openInNewTab('   ')
  eq(made.length, before, '空地址不产生任何节点')

  // 源码级绊线：不允许再出现 window.open( 调用 —— 它正是用户反馈问题的根源。
  // 扫描前先剥掉注释，否则 utils/open.js 顶部那段「为什么不用 window.open」的说明会被误判。
  {
    const { readFileSync, readdirSync } = await import('node:fs')
    const { join } = await import('node:path')
    const root = new URL('../../src', import.meta.url).pathname.replace(/^\//, '')
    const stripComments = s => s
      .replace(/\/\*[\s\S]*?\*\//g, '')   // /* ... */ 与 JSDoc
      .replace(/^\s*\/\/.*$/gm, '')       // 整行 // 注释
      .replace(/<!--[\s\S]*?-->/g, '')    // Vue 模板里的 HTML 注释
    const files = readdirSync(root, { recursive: true })
      .filter(f => /\.(vue|js)$/.test(String(f)))
      .map(f => join(root, String(f)))
    const offenders = files.filter(f => /window\.open\s*\(/.test(stripComments(readFileSync(f, 'utf-8'))))
    eq(offenders.length, 0, 'src/ 下不再有 window.open( 调用（应统一走 utils/open.js）',
      offenders.map(f => f.split(/[\\/]/).slice(-2).join('/')).join(', '))
    ok(files.length > 50, `源码扫描确实扫到了文件（${files.length} 个）`, '防止扫了个空目录还判通过')
  }
} finally {
  await server.close()
}

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 前端守卫 ${failures.length} 条断言失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 前端守卫全部通过：${pass} 条断言`)
