import { defineStore } from 'pinia'
import { ref } from 'vue'
import { versionedPersist } from '@/utils/storeVersioning'

export const useSidebarStore = defineStore('sidebar', () => {
  const open = ref(false)
  const collapsed = ref(false)
  const rightCollapsed = ref(false)
  const activeNav = ref('discover')
  const width = ref(240) // 可拖拽宽度，默认240px
  const hoveredSite = ref(null) // 鼠标悬停的站点详情

  function toggle() { open.value = !open.value }
  function close() { open.value = false }
  function openSidebar() { open.value = true }
  function setActiveNav(nav) { activeNav.value = nav }
  function toggleCollapse() { collapsed.value = !collapsed.value }
  function toggleRightCollapse() { rightCollapsed.value = !rightCollapsed.value }
  function setWidth(val) { width.value = Math.max(160, Math.min(400, val)) }
  function setHoveredSite(site) { hoveredSite.value = site }
  function clearHoveredSite() { hoveredSite.value = null }

  return {
    open, collapsed, rightCollapsed, activeNav, width, hoveredSite,
    toggle, close, openSidebar, setActiveNav,
    toggleCollapse, toggleRightCollapse, setWidth,
    setHoveredSite, clearHoveredSite
  }
}, {
  persist: versionedPersist('sidebar', ['width', 'collapsed', 'rightCollapsed'])
})