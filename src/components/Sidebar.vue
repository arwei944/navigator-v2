<template>
  <aside class="sidebar" :class="{ open: sidebarStore.open, collapsed: isCollapsed }"
         :style="isCollapsed
           ? { width: 'var(--sidebar-w-collapsed, 60px)', minWidth: 'var(--sidebar-w-collapsed, 60px)' }
           : { width: sidebarStore.width + 'px', minWidth: sidebarStore.width + 'px' }"
         role="navigation" aria-label="主导航">
    <div class="sidebar-header">
      <div class="sidebar-logo" aria-hidden="true">N</div>
      <span class="sidebar-brand" v-show="!isCollapsed">Navigator</span>
    </div>

    <!-- 侧栏只负责「范围」这一轴；方向与子分类的筛选在中间栏的筛选条上 -->
    <nav class="sidebar-nav">
      <div class="sidebar-nav-item" :class="{ active: sidebarStore.activeNav === 'discover' }"
           @click="navigate('Home')" @keydown.enter="navigate('Home')" :title="isCollapsed ? '全部' : ''" tabindex="0" role="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <span v-show="!isCollapsed">全部</span>
      </div>
      <div class="sidebar-nav-item" :class="{ active: sidebarStore.activeNav === 'favorites' }"
           @click="navigate('Favorites')" @keydown.enter="navigate('Favorites')" :title="isCollapsed ? '收藏' : ''" tabindex="0" role="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        <span v-show="!isCollapsed">收藏</span>
        <span v-if="favoritesStore.count > 0" class="badge">{{ favoritesStore.count }}</span>
      </div>
      <div class="sidebar-nav-item" :class="{ active: sidebarStore.activeNav === 'recent' }"
           @click="navigate('Recent')" @keydown.enter="navigate('Recent')" :title="isCollapsed ? '最近' : ''" tabindex="0" role="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span v-show="!isCollapsed">最近</span>
      </div>
      <div class="sidebar-nav-item" :class="{ active: sidebarStore.activeNav === 'feed' }"
           @click="navigate('Feed')" @keydown.enter="navigate('Feed')" :title="isCollapsed ? '内容聚合' : ''" tabindex="0" role="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>
        <span v-show="!isCollapsed">内容聚合</span>
      </div>
      <div class="sidebar-nav-item" :class="{ active: sidebarStore.activeNav === 'trash' }"
           @click="navigate('Trash')" @keydown.enter="navigate('Trash')" :title="isCollapsed ? '回收站' : ''" tabindex="0" role="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        <span v-show="!isCollapsed">回收站</span>
        <span v-if="sitesStore.trash.length > 0" class="badge">{{ sitesStore.trash.length }}</span>
      </div>
    </nav>

    <div class="sidebar-footer" v-show="!isCollapsed">
      <!-- 统计与时钟从首屏工具栏下沉到这里，把首屏让给内容 -->
      <div class="sidebar-stats">
        <div class="sidebar-stat">共 <strong>{{ sitesStore.sites.length }}</strong> 个站点</div>
        <div class="sidebar-stat">今日访问 <strong>{{ todayCount }}</strong></div>
        <div class="sidebar-stat">收藏 <strong>{{ favoritesStore.count }}</strong></div>
      </div>
      <DigitalClock class="sidebar-clock" />
      <button class="sidebar-btn sidebar-btn-primary" @click="showAddModal = true" aria-label="添加网站">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        添加网站
      </button>
    </div>

    <!-- 折叠/展开切换按钮 -->
    <button class="sidebar-collapse-toggle" @click="sidebarStore.toggleCollapse()" :title="isCollapsed ? '展开侧边栏' : '折叠侧边栏'">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :style="{ transform: isCollapsed ? 'rotate(180deg)' : '' }">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
    </button>

    <!-- 拖拽调节宽度手柄 -->
    <div class="sidebar-resize-handle" @mousedown="startResize" title="拖拽调节宽度"></div>

    <!-- 弹窗 -->
    <AddSiteModal v-if="showAddModal" @close="showAddModal = false" />
  </aside>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSidebarStore } from '@/stores/sidebar'
import { useSitesStore } from '@/stores/sites'
import { useFavoritesStore } from '@/stores/favorites'
import { useHistoryStore } from '@/stores/history'
import AddSiteModal from '@/components/AddSiteModal.vue'
import DigitalClock from '@/components/DigitalClock.vue'

const route = useRoute()
const router = useRouter()
const sidebarStore = useSidebarStore()
const sitesStore = useSitesStore()
const favoritesStore = useFavoritesStore()
const historyStore = useHistoryStore()
const showAddModal = ref(false)

const todayCount = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return historyStore.records.filter(r => r.timestamp >= today.getTime()).length
})

// 移动端（≤768px）侧栏是 off-canvas 抽屉，此时忽略桌面折叠态，始终展开显示完整内容
const MOBILE_QUERY = '(max-width: 768px)'
const isMobile = ref(false)
let mq = null
function syncIsMobile(e) { isMobile.value = e.matches }

const isCollapsed = computed(() => sidebarStore.collapsed && !isMobile.value)

function navigate(name) {
  // 已在目标范围：清掉筛选，回到该范围的干净状态
  if (route.name === name) {
    router.push({ name, query: undefined })
  } else {
    router.push({ name })
  }
  sidebarStore.close()
}

/* ---- 拖拽调节宽度 ---- */
let resizeUnlisten = null

function startResize(e) {
  e.preventDefault()
  const startX = e.clientX
  const startWidth = sidebarStore.width

  function onMove(ev) {
    const delta = ev.clientX - startX
    sidebarStore.setWidth(startWidth + delta)
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'

  resizeUnlisten = onUp
}

onMounted(() => {
  mq = window.matchMedia(MOBILE_QUERY)
  isMobile.value = mq.matches
  mq.addEventListener('change', syncIsMobile)
})

onUnmounted(() => {
  if (resizeUnlisten) resizeUnlisten()
  if (mq) mq.removeEventListener('change', syncIsMobile)
})
</script>

<style scoped>
.sidebar {
  width: var(--sidebar-w, 240px);
  min-width: var(--sidebar-w, 240px);
  background: var(--glass-bg);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  color: var(--text-sidebar);
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow-y: auto;
  overflow-x: hidden;
  z-index: 100;
  position: relative;
  border-right: 1px solid var(--border);
  transition: width .28s cubic-bezier(.4,0,.2,1), min-width .28s cubic-bezier(.4,0,.2,1), transform .28s cubic-bezier(.4,0,.2,1);
}
.sidebar::-webkit-scrollbar { width: 4px; }
.sidebar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

/* 折叠状态 */
.sidebar.collapsed .sidebar-header {
  justify-content: center;
  padding: 16px 8px 12px;
}
.sidebar.collapsed .sidebar-logo {
  width: 32px;
  height: 32px;
  font-size: 13px;
  border-radius: 8px;
}
.sidebar.collapsed .sidebar-nav {
  padding: 8px 8px;
  align-items: center;
}
.sidebar.collapsed .sidebar-nav-item {
  justify-content: center;
  padding: 9px 0;
  width: 44px;
  margin: 0 auto;
}
.sidebar.collapsed .sidebar-nav-item svg {
  width: 20px;
  height: 20px;
}
.sidebar.collapsed .badge {
  position: absolute;
  top: 2px;
  right: 2px;
  font-size: 9px;
  min-width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  border-radius: 8px;
}

.sidebar-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 20px 16px;
  border-bottom: 1px solid var(--border);
  transition: padding .28s ease;
}
.sidebar-logo {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 14px;
  color: #fff;
  letter-spacing: 1px;
  flex-shrink: 0;
}
.sidebar-brand {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-sidebar);
  letter-spacing: -.2px;
  white-space: nowrap;
}
.sidebar-nav {
  padding: 16px 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sidebar-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-sidebar-dim);
  transition: all .15s ease;
  position: relative;
}
.sidebar-nav-item:hover { background: var(--sidebar-hover); color: var(--text-sidebar); }
.sidebar-nav-item.active { background: var(--sidebar-active); color: var(--text-sidebar); }
.sidebar-nav-item svg { width: 18px; height: 18px; flex-shrink: 0; opacity: .7; }
.sidebar-nav-item.active svg { opacity: 1; }
.badge { margin-left: auto; font-size: 11px; font-weight: 600; background: var(--border-light); padding: 2px 8px; border-radius: 10px; color: var(--text-sidebar-dim); }
.sidebar-footer { margin-top: auto; padding: 16px 12px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
.sidebar-stats { display: flex; flex-wrap: wrap; gap: 4px 14px; padding: 0 4px; }
.sidebar-stat { font-size: 12px; color: var(--text-sidebar-dim); }
.sidebar-stat strong { color: var(--text-sidebar); font-weight: 600; }
.sidebar-clock { padding: 2px 0 0; }
.sidebar-clock :deep(.clock-time) { color: var(--text-sidebar); }
.sidebar-clock :deep(.digital-clock) { align-items: flex-start; }
.sidebar-btn {
  display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-radius: var(--radius-sm);
  cursor: pointer; font-size: 13px; font-weight: 500; color: var(--text-sidebar-dim);
  transition: all .15s ease; border: 1px dashed var(--border); background: transparent;
  width: 100%; text-align: left; font-family: inherit;
}
.sidebar-btn:hover { background: var(--sidebar-hover); color: var(--text-sidebar); border-color: var(--accent); }
.sidebar-btn svg { width: 16px; height: 16px; opacity: .7; }
/* 唯一的固定动作：实心，区别于曾经的四个虚线按钮 */
.sidebar-btn-primary {
  border-style: solid;
  border-color: transparent;
  background: var(--accent);
  color: #fff;
}
.sidebar-btn-primary:hover { background: var(--accent); color: #fff; opacity: .9; border-color: transparent; }
.sidebar-btn-primary svg { opacity: 1; }

/* 折叠切换按钮 */
.sidebar-collapse-toggle {
  position: absolute;
  bottom: 12px;
  right: -14px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--bg-white);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  box-shadow: 0 2px 8px rgba(0,0,0,.12);
  transition: all .15s ease;
  padding: 0;
}
.sidebar-collapse-toggle:hover {
  color: var(--accent);
  border-color: var(--accent);
  box-shadow: 0 2px 12px rgba(0,0,0,.18);
}
.sidebar-collapse-toggle svg {
  width: 14px;
  height: 14px;
  transition: transform .28s ease;
}

/* 拖拽调节宽度手柄 */
.sidebar-resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 20;
  background: transparent;
  transition: background .15s ease;
}
.sidebar-resize-handle:hover,
.sidebar-resize-handle:active {
  background: var(--accent);
  opacity: .3;
}
.sidebar.collapsed .sidebar-resize-handle {
  display: none;
}

/* 移动端：off-canvas 抽屉，脱离文档流，不再挤压内容区 */
@media (max-width: 768px) {
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    /* 覆盖内联的桌面宽度（内联样式只能由 !important 覆盖） */
    width: min(82vw, 320px) !important;
    min-width: 0 !important;
    transform: translateX(-100%);
    z-index: 200;
    border-right: none;
    box-shadow: 0 0 40px rgba(0, 0, 0, .28);
    transition: transform .28s cubic-bezier(.4, 0, .2, 1);
  }
  .sidebar.open { transform: translateX(0); }
  .sidebar-resize-handle,
  .sidebar-collapse-toggle { display: none; }
  .sidebar-header { padding-top: calc(18px + env(safe-area-inset-top)); }
}
</style>
