import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { versionedPersist } from '@/utils/storeVersioning'
import {
  SCHEMES, TOKENS, getScheme, resolveTokens, tokensToCssVars
} from '@/utils/visualScheme'

const THEME_PRESETS = {
  'default': {
    id: 'default',
    name: '默认蓝',
    primary: '#2563eb',
    bg: '#f1f5f9',
    bgWhite: '#ffffff',
    sidebarBg: '#0f172a',
    accent: '#2563eb',
    accentLight: '#dbeafe',
    dark: {
      bg: '#0f172a',
      bgWhite: '#1e293b',
      sidebarBg: '#020617',
      accent: '#3b82f6',
      accentLight: '#1e3a5f'
    }
  },
  'green': {
    id: 'green',
    name: '极客绿',
    primary: '#10b981',
    bg: '#ecfdf5',
    bgWhite: '#ffffff',
    sidebarBg: '#064e3b',
    accent: '#10b981',
    accentLight: '#d1fae5',
    dark: {
      bg: '#022c22',
      bgWhite: '#064e3b',
      sidebarBg: '#020617',
      accent: '#34d399',
      accentLight: '#064e3b'
    }
  },
  'purple': {
    id: 'purple',
    name: '赛博紫',
    primary: '#8b5cf6',
    bg: '#f5f3ff',
    bgWhite: '#ffffff',
    sidebarBg: '#2e1065',
    accent: '#8b5cf6',
    accentLight: '#ede9fe',
    dark: {
      bg: '#1e1b4b',
      bgWhite: '#2e1065',
      sidebarBg: '#020617',
      accent: '#a78bfa',
      accentLight: '#2e1065'
    }
  },
  'orange': {
    id: 'orange',
    name: '日落橙',
    primary: '#f59e0b',
    bg: '#fff7ed',
    bgWhite: '#ffffff',
    sidebarBg: '#431407',
    accent: '#f59e0b',
    accentLight: '#fef3c7',
    dark: {
      bg: '#1c1917',
      bgWhite: '#292524',
      sidebarBg: '#020617',
      accent: '#fbbf24',
      accentLight: '#431407'
    }
  }
}

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

  function getCurrentEngine() {
    return engines.find(e => e.id === searchEngine.value) || engines[0]
  }

  function setThemePreset(id) {
    themePreset.value = id
    applyPreset(id)
  }

  function applyPreset(id) {
    const preset = THEME_PRESETS[id]
    if (!preset) return

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
    // 重新应用当前预设
    setTimeout(() => applyPreset(themePreset.value), 10)
  }, { immediate: true })

  // 初始化时应用预设
  watch(themePreset, (val) => {
    applyPreset(val)
  }, { immediate: true })

  return {
    theme, themePreset, searchEngine, wallpaper, wallpaperBlur, autoAddOnUrl, engines,
    cardDensity,
    visualScheme, visualOverrides, activeTokens, activeScheme, isVisualCustomized,
    cardLayoutMode, cardDisplay,
    toggleTheme, setSearchEngine, setAutoAdd, getCurrentEngine, setCardDensity,
    setThemePreset, setWallpaper, THEME_PRESETS,
    setVisualScheme, setVisualToken, resetVisualTokens
  }
}, {
  persist: versionedPersist('preferences', ['theme', 'themePreset', 'searchEngine', 'wallpaper', 'wallpaperBlur', 'autoAddOnUrl', 'cardDensity', 'visualScheme', 'visualOverrides'])
})