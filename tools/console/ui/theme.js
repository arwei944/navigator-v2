/** 控制台主题：auto（跟随系统）/ light / dark，持久化到 localStorage。
 *  实际生效值写入 <html data-theme>，样式表按该属性切换语义变量。 */

const KEY = 'nav-console-theme'
const ORDER = ['auto', 'light', 'dark']
const LABEL = { auto: '跟随系统', light: '浅色', dark: '深色' }
const HINT = { auto: '跟随系统', light: '浅色模式', dark: '深色模式' }

const media = matchMedia('(prefers-color-scheme: dark)')

export function themeMode() {
  const v = localStorage.getItem(KEY)
  return ORDER.includes(v) ? v : 'auto'
}

function resolve(mode) {
  return mode === 'auto' ? (media.matches ? 'dark' : 'light') : mode
}

function apply(mode) {
  const theme = resolve(mode)
  document.documentElement.dataset.theme = theme
  document.documentElement.dataset.themeMode = mode
  const btn = document.getElementById('btn-theme')
  if (btn) {
    btn.textContent = LABEL[mode]
    btn.title = `主题：${HINT[mode]}（点击切换）`
    btn.setAttribute('aria-label', `主题：${HINT[mode]}，点击切换`)
  }
}

export function initTheme() {
  apply(themeMode())

  document.getElementById('btn-theme')?.addEventListener('click', () => {
    const next = ORDER[(ORDER.indexOf(themeMode()) + 1) % ORDER.length]
    localStorage.setItem(KEY, next)
    apply(next)
  })

  // 仅在「跟随系统」时响应系统切换，手动选定的模式不被系统覆盖
  media.addEventListener('change', () => {
    if (themeMode() === 'auto') apply('auto')
  })
}