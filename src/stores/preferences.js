import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { versionedPersist } from '@/utils/storeVersioning'

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
    theme, themePreset, searchEngine, wallpaper, wallpaperBlur, engines,
    toggleTheme, setSearchEngine, getCurrentEngine,
    setThemePreset, setWallpaper, THEME_PRESETS
  }
}, {
  persist: versionedPersist('preferences', ['theme', 'themePreset', 'searchEngine', 'wallpaper', 'wallpaperBlur'])
})