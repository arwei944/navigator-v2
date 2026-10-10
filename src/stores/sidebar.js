import { defineStore } from 'pinia'
import { ref } from 'vue'
import { versionedPersist } from '@/utils/storeVersioning'

export const useSidebarStore = defineStore('sidebar', () => {
  const open = ref(false)
  const collapsed = ref(false)
  const rightCollapsed = ref(false)
  const activeNav = ref('discover')
  const width = ref(240) // 左侧栏可拖拽宽度，默认240px
  const rightWidth = ref(280) // 右侧详情面板可拖拽宽度，默认280px
  const hoveredSite = ref(null) // 鼠标悬停的站点详情
  // ≤768px 的详情入口：触屏没有 hover，右侧面板又整体隐藏，详情在那里原本毫无入口
  const detailSheetSite = ref(null)

  /**
   * 侧栏 / 详情面板正在改宽（折叠、展开、拖拽调宽）。
   * 期间临时摘掉毛玻璃：backdrop-filter 每帧都要重算模糊，叠加 300 张卡片随宽度重排，
   * 实测折叠动画会掉出 150ms 的卡顿帧（空闲基线稳定 16.7ms / 60fps）；只关模糊即可降到 33ms。
   * 动画结束自动恢复，用户看不到差别（那 0.3 秒面板本来就在移动）。
   */
  const animating = ref(false)
  let animTimer = null
  function markAnimating(ms = 320) {
    animating.value = true
    clearTimeout(animTimer)
    animTimer = setTimeout(() => { animating.value = false }, ms)
  }

  function toggle() {
    open.value = !open.value
    // 窄屏抽屉是覆盖在网格之上的浮层，滑入/滑出期间它自己的毛玻璃每帧都要在
    // 300 张卡之上重算一次模糊。与折叠、拖拽同源，一并临时摘掉。
    markAnimating()
  }
  function close() { open.value = false }
  function openSidebar() { open.value = true }
  function setActiveNav(nav) { activeNav.value = nav }
  function toggleCollapse() { collapsed.value = !collapsed.value; markAnimating() }
  function toggleRightCollapse() { rightCollapsed.value = !rightCollapsed.value; markAnimating() }
  // 两侧宽度下限都是 60px：左侧图标的物理下限（nav 项 44px + 两侧各 8px 内边距），
  // 拖到这个宽度以下就只剩图标了，再窄连图标都放不下。上限 400px。
  //
  // 计时取 300ms 而不是更短的 140ms：拖拽期间 mousemove 是连续来的，但用户随时可能
  // 停顿一下再继续。计时若短于停顿，模糊会在拖拽中途重新弹回来，正好卡在最需要流畅的
  // 那一刻重算。松手后多留 300ms 再恢复，用户看不到差别（面板本来就在动）。
  function setWidth(val) { width.value = Math.max(60, Math.min(400, val)); markAnimating(300) }
  function setRightWidth(val) { rightWidth.value = Math.max(60, Math.min(400, val)); markAnimating(300) }
  function setHoveredSite(site) { hoveredSite.value = site }  function clearHoveredSite() { hoveredSite.value = null }

  /**
   * 打开站点详情：桌面走右侧面板，窄屏走底部抽屉。
   * 按调用时的视口一次性分流，调用方（卡片右键菜单）不必知道断点在哪。
   */
  function showDetail(site) {
    if (!site) return
    const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
    if (narrow) {
      detailSheetSite.value = site
      return
    }
    rightCollapsed.value = false
    hoveredSite.value = site
  }
  function closeDetailSheet() { detailSheetSite.value = null }

  return {
    open, collapsed, rightCollapsed, activeNav, width, rightWidth, hoveredSite, detailSheetSite, animating,
    toggle, close, openSidebar, setActiveNav,
    toggleCollapse, toggleRightCollapse, setWidth, setRightWidth,
    setHoveredSite, clearHoveredSite, showDetail, closeDetailSheet
  }
}, {
  // rightCollapsed 不入持久化：右侧详情面板每次进入都默认展开，避免折叠一次被长期记住
  persist: versionedPersist('sidebar', ['width', 'rightWidth', 'collapsed'])
})