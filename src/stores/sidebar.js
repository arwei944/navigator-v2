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

  function toggle() { open.value = !open.value }
  function close() { open.value = false }
  function openSidebar() { open.value = true }
  function setActiveNav(nav) { activeNav.value = nav }
  function toggleCollapse() { collapsed.value = !collapsed.value }
  function toggleRightCollapse() { rightCollapsed.value = !rightCollapsed.value }
  // 两侧宽度下限都是 60px：左侧图标的物理下限（nav 项 44px + 两侧各 8px 内边距），
  // 拖到这个宽度以下就只剩图标了，再窄连图标都放不下。上限 400px。
  function setWidth(val) { width.value = Math.max(60, Math.min(400, val)) }
  function setRightWidth(val) { rightWidth.value = Math.max(60, Math.min(400, val)) }
  function setHoveredSite(site) { hoveredSite.value = site }
  function clearHoveredSite() { hoveredSite.value = null }

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
    open, collapsed, rightCollapsed, activeNav, width, rightWidth, hoveredSite, detailSheetSite,
    toggle, close, openSidebar, setActiveNav,
    toggleCollapse, toggleRightCollapse, setWidth, setRightWidth,
    setHoveredSite, clearHoveredSite, showDetail, closeDetailSheet
  }
}, {
  // rightCollapsed 不入持久化：右侧详情面板每次进入都默认展开，避免折叠一次被长期记住
  persist: versionedPersist('sidebar', ['width', 'rightWidth', 'collapsed'])
})