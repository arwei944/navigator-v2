<template>
  <aside class="sidebar" :class="{ open: sidebarStore.open, 'icon-only': iconOnly }"
         :style="{ width: sidebarWidth, minWidth: sidebarWidth }"
         role="navigation" aria-label="主导航">
    <div class="sidebar-header">
      <div class="sidebar-logo" aria-hidden="true">N</div>
      <span class="sidebar-brand" v-show="!iconOnly">Navigator</span>
    </div>

    <!-- 侧栏只负责「范围」这一轴；方向与子分类的筛选在中间栏的筛选条上 -->
    <nav class="sidebar-nav">
      <div class="sidebar-nav-item" :class="{ active: sidebarStore.activeNav === 'discover' }"
           @click="navigate('Home')" @keydown.enter="navigate('Home')" :title="iconOnly ? '全部' : ''" tabindex="0" role="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <span v-show="!iconOnly">全部</span>
      </div>
      <div class="sidebar-nav-item" :class="{ active: sidebarStore.activeNav === 'favorites' }"
           @click="navigate('Favorites')" @keydown.enter="navigate('Favorites')" :title="iconOnly ? '收藏' : ''" tabindex="0" role="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        <span v-show="!iconOnly">收藏</span>
        <span v-if="favoritesStore.count > 0" class="badge">{{ favoritesStore.count }}</span>
      </div>
      <div class="sidebar-nav-item" :class="{ active: sidebarStore.activeNav === 'recent' }"
           @click="navigate('Recent')" @keydown.enter="navigate('Recent')" :title="iconOnly ? '最近' : ''" tabindex="0" role="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span v-show="!iconOnly">最近</span>
      </div>
      <div class="sidebar-nav-item" :class="{ active: sidebarStore.activeNav === 'feed' }"
           @click="navigate('Feed')" @keydown.enter="navigate('Feed')" :title="iconOnly ? '内容聚合' : ''" tabindex="0" role="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>
        <span v-show="!iconOnly">内容聚合</span>
      </div>
      <div class="sidebar-nav-item" :class="{ active: sidebarStore.activeNav === 'archived' }"
           @click="navigate('Archived')" @keydown.enter="navigate('Archived')" :title="iconOnly ? '归档' : ''" tabindex="0" role="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/><line x1="10" y1="13" x2="14" y2="13"/></svg>
        <span v-show="!iconOnly">归档</span>
        <span v-if="sitesStore.archivedCount > 0" class="badge">{{ sitesStore.archivedCount }}</span>
      </div>
      <div class="sidebar-nav-item" :class="{ active: sidebarStore.activeNav === 'trash' }"
           @click="navigate('Trash')" @keydown.enter="navigate('Trash')" :title="iconOnly ? '回收站' : ''" tabindex="0" role="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        <span v-show="!iconOnly">回收站</span>
        <span v-if="sitesStore.trash.length > 0" class="badge">{{ sitesStore.trash.length }}</span>
      </div>
    </nav>

    <!-- 折叠/展开把手：贴视口左缘、垂直居中、窄长竖条，与右侧面板把手左右对称。
         折叠后按钮常驻，保证还能展开。「添加网站」在右上角工具栏，「管理后台」在「设置」面板内 -->
    <button class="sidebar-collapse-toggle" type="button"
            @click="sidebarStore.toggleCollapse()"
            :title="isCollapsed ? '展开侧边栏' : '折叠侧边栏'"
            :aria-label="isCollapsed ? '展开侧边栏' : '折叠侧边栏'"
            :aria-expanded="!isCollapsed">
      <!-- 箭头：展开态指向左（点击即向左收起），纯图标态指向右（点击即向右展开） -->
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :style="{ transform: iconOnly ? 'rotate(180deg)' : '' }">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
    </button>

    <!-- 拖拽调节宽度手柄：显式折叠时收起（此时没有可调宽度的余地） -->
    <div v-if="!isCollapsed" class="sidebar-resize-handle" @mousedown="startResize" title="拖拽调节宽度"></div>
  </aside>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSidebarStore } from '@/stores/sidebar'
import { useSitesStore } from '@/stores/sites'
import { useFavoritesStore } from '@/stores/favorites'

const route = useRoute()
const router = useRouter()
const sidebarStore = useSidebarStore()
const sitesStore = useSitesStore()
const favoritesStore = useFavoritesStore()

// 移动端（≤768px）侧栏是 off-canvas 抽屉，此时忽略桌面折叠态，始终展开显示完整内容
const MOBILE_QUERY = '(max-width: 768px)'
const isMobile = ref(false)
let mq = null
function syncIsMobile(e) { isMobile.value = e.matches }

// 显式折叠：宽度锁到图标栏宽度（--sidebar-w-collapsed）
const isCollapsed = computed(() => sidebarStore.collapsed && !isMobile.value)

// 纯图标态：显式折叠，或者把宽度拖到图标宽度以下 —— 拖窄就自动收标签，不必非得按折叠按钮。
// 60px 是图标的物理下限（nav 项 44px + 两侧各 8px 内边距），所以「无最小宽度限制」的下限就是它。
const ICON_ONLY_W = 110
const iconOnly = computed(() => !isMobile.value && (isCollapsed.value || sidebarStore.width <= ICON_ONLY_W))

const sidebarWidth = computed(() =>
  isCollapsed.value ? 'var(--sidebar-w-collapsed, 60px)' : sidebarStore.width + 'px'
)

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
  backdrop-filter: blur(var(--glass-blur, 20px));
  -webkit-backdrop-filter: blur(var(--glass-blur, 20px));
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

/* 纯图标状态：显式折叠，或宽度被拖到图标宽度以下 */
.sidebar.icon-only .sidebar-header {
  justify-content: center;
  padding: 16px 8px 12px;
}
.sidebar.icon-only .sidebar-logo {
  width: 32px;
  height: 32px;
  font-size: 13px;
  border-radius: 8px;
}
.sidebar.icon-only .sidebar-nav {
  padding: 8px 8px;
  align-items: center;
}
.sidebar.icon-only .sidebar-nav-item {
  justify-content: center;
  padding: 9px 0;
  width: 44px;
  margin: 0 auto;
}
.sidebar.icon-only .sidebar-nav-item svg {
  width: 20px;
  height: 20px;
}
.sidebar.icon-only .badge {
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
  min-height: var(--nav-item-h, 40px);
  padding: 0 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-sidebar-dim);
  transition: all var(--transition);
  position: relative;
}
.sidebar-nav-item:hover { background: var(--sidebar-hover); color: var(--text-sidebar); }
.sidebar-nav-item.active { background: var(--sidebar-active); color: var(--text-sidebar); }
.sidebar-nav-item svg { width: 18px; height: 18px; flex-shrink: 0; opacity: .7; }
.sidebar-nav-item.active svg { opacity: 1; }
.badge { margin-left: auto; font-size: 11px; font-weight: 600; background: var(--border-light); padding: 2px 8px; border-radius: 10px; color: var(--text-sidebar-dim); }

/* 折叠/展开把手：贴中间内容区的左侧 —— 即本侧栏的右边缘、垂直居中、窄长竖条。
   默认极淡（无边框、无底色、30% 不透明度），只在悬停时显形，避免抢视觉焦点。
   侧栏宽度下限 60px > 把手最大宽 18px，所以它始终在侧栏盒子内部，不会被 overflow 裁掉。 */
.sidebar-collapse-toggle {
  position: absolute;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
  z-index: 20;
  width: 12px;
  height: 48px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px 0 0 6px;
  background: transparent;
  color: var(--text-secondary);
  opacity: .3;
  cursor: pointer;
  transition: width .18s ease, opacity .18s ease, background .18s ease, color .18s ease;
}
.sidebar-collapse-toggle:hover {
  width: 18px;
  opacity: 1;
  background: var(--border-light);
  color: var(--text-primary);
}
.sidebar-collapse-toggle svg {
  width: 12px;
  height: 12px;
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
  /* 低于折叠把手(20)：两者都贴右边缘，让把手在被它覆盖的那 64px 里仍可点，拖拽可从上下两侧进行 */
  z-index: 10;
  background: transparent;
  transition: background .15s ease;
}
.sidebar-resize-handle:hover,
.sidebar-resize-handle:active {
  background: var(--accent);
  opacity: .3;
}
/* 手柄由 v-if="!isCollapsed" 控制显隐：拖窄成纯图标态时手柄必须留着，否则拖不回去 */

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
