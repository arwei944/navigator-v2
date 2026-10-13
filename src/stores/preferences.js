import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { versionedPersist } from '@/utils/storeVersioning'
import {
  SCHEMES, TOKENS, getScheme, resolveTokens, tokensToCssVars
} from '@/utils/visualScheme'
import { THEME_PRESETS } from '@/utils/themeSchema'
import { RIGHT_PANEL_MODES } from '../../shared/right-panel.mjs'

/**
 * 右侧详情面板可逐项开关的区块。
 *
 * **头部与分类标签刻意不在列** —— 它们定义面板的主体，关掉只会得到一块
 * 「不知道在看什么」的空白。开关只控制「允不允许显示」，
 * 空数据仍然整段不渲染（沿用组件里既有的 `v-if="aliases.length"` 口径）。
 */
export const DEFAULT_RIGHT_SECTIONS = {
  desc: true,
  aliases: true,
  purposes: true,
  note: true,
  stats: true,
  timeline: true,
  actions: true,
}

/**
 * 面板显示模式：悬停预览 / 点击驱动 / 图钉固定。
 *
 * 取值来源是 `shared/right-panel.mjs`（那里还带着状态机的真值表），
 * 这里只做 re-export —— **不要在本地再写一份数组**，两处一漂移就会出现
 * 「设置项能选、状态机不认」的静默失效。
 */
export { RIGHT_PANEL_MODES }

/** 折叠策略：每次展开（= 旧行为）/ 记住上次 / 每次折叠 */
export const RIGHT_COLLAPSE_POLICIES = ['always-expand', 'remember', 'always-collapse']

export const usePreferencesStore = defineStore('preferences', () => {
  const theme = ref('light')
  const themePreset = ref('default')
  const searchEngine = ref('google')
  const wallpaper = ref('')
  const wallpaperBlur = ref(true)
  // 网址自动添加：搜索栏粘贴网址时跳过确认弹窗，直接入库并弹预览卡片
  const autoAddOnUrl = ref(true)
  // 卡片信息密度：compact 只留名称与域名；standard 为既有形态；rich 再补别名与三行描述
  const cardDensity = ref('standard')
  // 视觉方案：scheme 决定整套令牌，overrides 是用户在其上的逐项微调
  const visualScheme = ref(SCHEMES[0].id)
  const visualOverrides = ref({})
  // 首页「此刻推荐」横条：个性化推荐是打扰还是帮助，取决于用户，所以必须能关
  const smartBar = ref(true)
  // 搜索排序的「常访问」加权（v11）：同一相关性档位内，点得多的站点排前。
  // 默认开；关掉即退回纯相关性排序。见 utils/search.js#clickTier —— 那里刻意用
  // 分档而不是连续值，就是为了让「为什么这条在前」能说清楚。
  const clickBoost = ref(true)

  /**
   * 右边栏（站点详情面板）的显示模式。
   *
   * 为什么必须可配：面板内容原本**完全由 hover 决定** —— 鼠标一移开就清空，
   * 用户想读完一个字段或改一处都来不及，而且没有任何办法让它停下来。
   *
   * 注意三种模式的差别**只在于「谁来决定切换」**，而不是「面板什么时候消失」：
   * 面板移开鼠标后一律保留（这正是要修的那个毛病）。渲染层不做分支，
   * 只订阅 `sidebar.rightSite` 这一个状态（推导见 `shared/right-panel.mjs`）：
   *   - `hover`：悬停即切换，主动打开也切换 —— 默认，与既有观感最接近
   *   - `click`：忽略悬停，只有主动打开（右键「查看详情」）才切换
   *   - `pin`  ：忽略悬停，主动打开是 **toggle**（再选同一张即收起），面板顶部常显图钉
   */
  const rightPanelMode = ref('hover')

  /**
   * 详情面板里各区块的显隐，默认全开。
   *
   * 与卡片那套不一样：卡片的显隐来自 `activeTokens`（300 张卡各解算一次会重复计算，
   * 所以要收窄成 `cardDisplay`）；这里只服务**一个**面板，展开成本可忽略，直接存对象。
   */
  const rightSections = ref({ ...DEFAULT_RIGHT_SECTIONS })

  /**
   * 右侧面板的折叠策略。旧行为是「每次进入都展开」（`rightCollapsed` 故意不持久化），
   * 这里把它从写死改成显式选项 —— 「把右边栏当按需查看」的用法也真实存在。
   */
  const rightCollapsePolicy = ref('always-expand')

  /**
   * 管线日志浮标是否常显。
   *
   * 默认关闭 = 「有事才出现」：一次添加/抓取在推进时浮标自动浮现，结束后停留数秒再退。
   * 需要长期盯着（排查多跳链路为什么没补全）的人再打开常显 —— 日志是给人排障的，
   * 不该在平时占着一块屏幕。
   */
  const pipelineLog = ref(false)

  /**
   * 配色「归谁管」：'preset' = 由内置预设落色，'custom' = 由自定义主题落色。
   *
   * 为什么需要这个标记：预设的落色有两条**延迟**路径 —— `themePreset` 的 watcher
   * 与明暗切换后 `setTimeout(…, 10)` 的重放。自定义主题是在 `apply()` 里同步写好配色的，
   * 上面那两条会在下一个微任务/10ms 后把用户的 accent 又盖回预设值。
   * 这个标记就是让那两条路径认出「配色已被接管」。
   */
  let colorsOwner = 'preset'

  const engines = [
    { id: 'google', label: 'Google', url: 'https://www.google.com/search' },
    { id: 'bing', label: 'Bing', url: 'https://www.bing.com/search' },
    { id: 'baidu', label: '百度', url: 'https://www.baidu.com/s' },
    { id: 'duckduckgo', label: 'DuckDuckGo', url: 'https://duckduckgo.com/' },
    { id: 'perplexity', label: 'Perplexity', url: 'https://www.perplexity.ai/search' }
  ]

  function toggleTheme() {
    theme.value = theme.value === 'light' ? 'dark' : 'light'
  }

  function setSearchEngine(id) {
    searchEngine.value = id
  }

  function setAutoAdd(v) {
    autoAddOnUrl.value = Boolean(v)
  }

  function setCardDensity(v) {
    if (['compact', 'standard', 'rich'].includes(v)) cardDensity.value = v
  }

  function setSmartBar(v) {
    smartBar.value = Boolean(v)
  }

  function setClickBoost(v) {
    clickBoost.value = Boolean(v)
  }

  function setRightPanelMode(v) {
    if (RIGHT_PANEL_MODES.includes(v)) rightPanelMode.value = v
  }

  /**
   * 写单个区块开关。基于**合并后**的对象展开，避免把持久化里的残缺对象原样存回去
   * ——否则每写一次都会再丢一次未定义的键，残缺被永久固化。
   */
  function setRightSection(key, on) {
    if (!(key in DEFAULT_RIGHT_SECTIONS)) return
    rightSections.value = { ...activeRightSections.value, [key]: Boolean(on) }
  }

  function resetRightSections() {
    rightSections.value = { ...DEFAULT_RIGHT_SECTIONS }
  }

  function setRightCollapsePolicy(v) {
    if (RIGHT_COLLAPSE_POLICIES.includes(v)) rightCollapsePolicy.value = v
  }

  function setPipelineLog(v) {
    pipelineLog.value = Boolean(v)
  }

  function getCurrentEngine() {
    return engines.find(e => e.id === searchEngine.value) || engines[0]
  }

  function setThemePreset(id) {
    themePreset.value = id
    applyPreset(id)
  }

  /** 直接指定明暗（跟随系统 / 定时切换用），与 toggleTheme 的区别只是不取反 */
  function setTheme(mode) {
    if (mode === 'light' || mode === 'dark') theme.value = mode
  }

  /**
   * 自定义主题用：直接落一组颜色变量。
   * 与 applyPreset 写的是**同一批**变量、同一套键名 —— 这样「内置配色」与
   * 「用户调出来的配色」在组件眼里没有区别，不需要组件去分辨当前是哪种。
   */
  /**
   * :root 元素。node 侧（测试 / CLI）没有 DOM、或 document 只是个空壳时返回 null。
   *
   * 本 store 里所有落色都必须走它：直接写 `document.documentElement` 在 node 里会炸，
   * 而且炸在 setup 阶段（几个 watch 都是 immediate），表现为「某个测试一 import 就崩」，
   * 很难联想到是这里少了一道守卫。v11 让 sites.js 读排序开关时连着炸了三次，
   * 一次修一处是修不完的 —— 统一成一个入口。
   */
  const rootEl = () => (typeof document === 'undefined' ? null : (document.documentElement || null))

  const CSS_VAR_OF = {
    bg: '--bg', bgWhite: '--bg-white', sidebarBg: '--sidebar-bg',
    accent: '--accent', accentLight: '--accent-light'
  }
  function applyColors(colors) {
    if (!colors || typeof colors !== 'object') return
    colorsOwner = 'custom'
    const root = rootEl()
    if (!root) return
    for (const [k, cssVar] of Object.entries(CSS_VAR_OF)) {
      const v = colors[k]
      if (typeof v === 'string' && v) root.style.setProperty(cssVar, v)
    }
  }

  /** 批量写令牌微调（不清空其余项）—— 应用自定义主题时要一次落一组，而不是逐项触发重算 */
  function setVisualTokens(patch) {
    if (!patch || typeof patch !== 'object') return
    visualOverrides.value = { ...visualOverrides.value, ...patch }
  }

  function applyPreset(id) {
    const preset = THEME_PRESETS[id]
    if (!preset) return
    colorsOwner = 'preset'
    // 与 applyVisual 同理：node 侧（测试 / CLI）没有可写的 DOM，落色这一步跳过。
    // 标记先写（它是状态，与 DOM 无关），守卫放在它后面。
    const isDark = theme.value === 'dark'
    const colors = isDark ? preset.dark : preset
    const root = rootEl()
    if (!root) return
    root.style.setProperty('--bg', colors.bg)
    root.style.setProperty('--bg-white', colors.bgWhite)
    root.style.setProperty('--sidebar-bg', colors.sidebarBg)
    root.style.setProperty('--accent', colors.accent)
    root.style.setProperty('--accent-light', colors.accentLight)
  }

  function setWallpaper(url) {
    wallpaper.value = url
    const root = rootEl()
    if (!root) return
    if (url) {
      root.style.setProperty('--wallpaper', `url(${url})`)
      root.style.setProperty('--wallpaper-blur', wallpaperBlur.value ? 'blur(8px)' : 'none')
    } else {
      root.style.removeProperty('--wallpaper')
    }
  }

  /* ---------- 视觉方案 ---------- */

  const activeTokens = computed(() => resolveTokens(visualScheme.value, visualOverrides.value))
  const activeScheme = computed(() => getScheme(visualScheme.value))
  const isVisualCustomized = computed(() => Object.keys(visualOverrides.value).length > 0)

  /** 排列方式：固定列数 / 自适应宽度 / 瀑布流 */
  const cardLayoutMode = computed(() => activeTokens.value.layoutMode || 'fixed')

  /**
   * 卡片元素的显隐开关，统一在这里解算一次。
   * 300 张卡片各自去读 activeTokens（一个深比较的 computed 对象）会重复解算，
   * 这里收成一份，卡片只订阅这几个布尔值。
   */
  const cardDisplay = computed(() => {
    const t = activeTokens.value
    return {
      health: t.showHealth !== false,
      heat: t.showHeat !== false,
      categoryTag: t.showCategoryTag !== false,
      purposes: t.showPurposes !== false,
      badges: t.showBadges !== false
    }
  })

  /**
   * 合并默认值后读取区块开关。
   *
   * 必要性：持久化里躺着的是**旧版本写下的对象**（没有后来新增的键），
   * 直接取 `rightSections[key]` 会得到 undefined → 新加的区块默认不可见，
   * 表现为「升级后某个区块凭空消失」。合并一次即可，不需要迁移脚本。
   */
  const activeRightSections = computed(() => ({ ...DEFAULT_RIGHT_SECTIONS, ...rightSections.value }))

  /** 把当前令牌写成 :root 上的 CSS 变量，全站组件通过变量响应 */
  function applyVisual() {
    // 这个 store 会被 node 侧加载（测试、CLI）：那里要么没有 document，
    // 要么 document 只是个空壳（有 stub 但没有 documentElement）。
    // 所以判的是**真正要用的那个对象**而不是「有没有 document」—— 后一种判法
    // 会在空壳场景下照样抛错。少了这道守卫，任何在 node 里 import 到本 store 的链路
    // 都会在 setup 阶段直接崩（watch immediate 在 setup 里就跑一次）。
    const root = rootEl()
    if (!root) return
    const vars = tokensToCssVars(activeTokens.value, theme.value)
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  }

  /** 切换方案：清空微调，并把方案自带的配色与主题模式一并应用 */
  function setVisualScheme(id) {
    const s = getScheme(id)
    visualScheme.value = s.id
    visualOverrides.value = {}
    // 选方案 = 回到「预设配色」，之后若还有自定义主题落色，会由 applyColors 再接管
    colorsOwner = 'preset'
    if (s.accent && s.accent !== themePreset.value) setThemePreset(s.accent)
    if (s.mode && s.mode !== theme.value) theme.value = s.mode
  }

  function setVisualToken(key, value) {
    if (!TOKENS[key]) return
    visualOverrides.value = { ...visualOverrides.value, [key]: value }
  }

  function resetVisualTokens() {
    visualOverrides.value = {}
  }

  watch(activeTokens, applyVisual, { immediate: true, deep: true })

  // 令牌里有随主题模式变化的部分（描边色、阴影浓度、玻璃底色），切主题要重算
  watch(theme, applyVisual)

  // 监听主题变化，同步当前预设
  watch(theme, (val) => {
    // 这个 watch 是 immediate：store 一 setup 就跑，node 侧必须能活着走过去
    const root = rootEl()
    if (root) root.setAttribute('data-theme', val)
    // 重新应用当前预设（延后一拍是为了让 CSS 变量与 data-theme 同帧生效）。
    // 但自定义主题的配色是逐模式指定的，这条重放会把它盖掉 —— 那种情况交给 theme store 重落色。
    setTimeout(() => { if (colorsOwner !== 'custom') applyPreset(themePreset.value) }, 10)
  }, { immediate: true })

  // 初始化时应用预设
  watch(themePreset, (val) => {
    // 同上：自定义主题落色后，排队的预设重放不得覆盖它
    if (colorsOwner === 'custom') return
    applyPreset(val)
  }, { immediate: true })

  return {
    theme, themePreset, searchEngine, wallpaper, wallpaperBlur, autoAddOnUrl, engines,
    cardDensity,
    visualScheme, visualOverrides, activeTokens, activeScheme, isVisualCustomized,
    cardLayoutMode, cardDisplay, smartBar, clickBoost,
    rightPanelMode, rightSections, activeRightSections, rightCollapsePolicy, pipelineLog,
    toggleTheme, setTheme, setSearchEngine, setAutoAdd, getCurrentEngine, setCardDensity, setSmartBar, setClickBoost,
    setRightPanelMode, setRightSection, resetRightSections, setRightCollapsePolicy, setPipelineLog,
    setThemePreset, setWallpaper, applyColors, THEME_PRESETS,
    setVisualScheme, setVisualToken, setVisualTokens, resetVisualTokens
  }
}, {
  persist: versionedPersist('preferences', ['theme', 'themePreset', 'searchEngine', 'wallpaper', 'wallpaperBlur', 'autoAddOnUrl', 'cardDensity', 'smartBar', 'clickBoost', 'visualScheme', 'visualOverrides', 'rightPanelMode', 'rightSections', 'rightCollapsePolicy', 'pipelineLog'])
})