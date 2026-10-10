import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { versionedPersist } from '@/utils/storeVersioning'
import {
  SCHEMES, TOKENS, getScheme, resolveTokens, tokensToCssVars
} from '@/utils/visualScheme'
import { THEME_PRESETS } from '@/utils/themeSchema'

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
  const CSS_VAR_OF = {
    bg: '--bg', bgWhite: '--bg-white', sidebarBg: '--sidebar-bg',
    accent: '--accent', accentLight: '--accent-light'
  }
  function applyColors(colors) {
    if (!colors || typeof colors !== 'object') return
    colorsOwner = 'custom'
    const root = document.documentElement
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

    const isDark = theme.value === 'dark'
    const colors = isDark ? preset.dark : preset

    const root = document.documentElement
    root.style.setProperty('--bg', colors.bg)
    root.style.setProperty('--bg-white', colors.bgWhite)
    root.style.setProperty('--sidebar-bg', colors.sidebarBg)
    root.style.setProperty('--accent', colors.accent)
    root.style.setProperty('--accent-light', colors.accentLight)
  }

  function setWallpaper(url) {
    wallpaper.value = url
    if (url) {
      document.documentElement.style.setProperty('--wallpaper', `url(${url})`)
      document.documentElement.style.setProperty('--wallpaper-blur', wallpaperBlur.value ? 'blur(8px)' : 'none')
    } else {
      document.documentElement.style.removeProperty('--wallpaper')
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

  /** 把当前令牌写成 :root 上的 CSS 变量，全站组件通过变量响应 */
  function applyVisual() {
    const vars = tokensToCssVars(activeTokens.value, theme.value)
    const root = document.documentElement
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
    document.documentElement.setAttribute('data-theme', val)
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
    cardLayoutMode, cardDisplay, smartBar,
    toggleTheme, setTheme, setSearchEngine, setAutoAdd, getCurrentEngine, setCardDensity, setSmartBar,
    setThemePreset, setWallpaper, applyColors, THEME_PRESETS,
    setVisualScheme, setVisualToken, setVisualTokens, resetVisualTokens
  }
}, {
  persist: versionedPersist('preferences', ['theme', 'themePreset', 'searchEngine', 'wallpaper', 'wallpaperBlur', 'autoAddOnUrl', 'cardDensity', 'smartBar', 'visualScheme', 'visualOverrides'])
})