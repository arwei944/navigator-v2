<template>
  <aside class="sidebar" :class="{ open: sidebarStore.open, collapsed: sidebarStore.collapsed }"
         :style="sidebarStore.collapsed
           ? { width: 'var(--sidebar-w-collapsed, 60px)', minWidth: 'var(--sidebar-w-collapsed, 60px)' }
           : { width: sidebarStore.width + 'px', minWidth: sidebarStore.width + 'px' }"
         role="navigation" aria-label="主导航">
    <div class="sidebar-header">
      <div class="sidebar-logo" aria-hidden="true">N</div>
      <span class="sidebar-brand" v-show="!sidebarStore.collapsed">Navigator</span>
    </div>

    <nav class="sidebar-nav">
      <div class="sidebar-nav-item" :class="{ active: sidebarStore.activeNav === 'discover' }"
           @click="navigate('discover')" :title="sidebarStore.collapsed ? '发现' : ''" tabindex="0" role="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <span v-show="!sidebarStore.collapsed">发现</span>
      </div>
      <div class="sidebar-nav-item" :class="{ active: sidebarStore.activeNav === 'categories' }"
           @click="navigate('categories')" :title="sidebarStore.collapsed ? '分类' : ''" tabindex="0" role="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
        <span v-show="!sidebarStore.collapsed">分类</span>
      </div>
      <div class="sidebar-nav-item" :class="{ active: sidebarStore.activeNav === 'favorites' }"
           @click="navigate('favorites')" :title="sidebarStore.collapsed ? '收藏' : ''" tabindex="0" role="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        <span v-show="!sidebarStore.collapsed">收藏</span>
        <span v-if="favoritesStore.count > 0" class="badge">{{ favoritesStore.count }}</span>
      </div>
      <div class="sidebar-nav-item" :class="{ active: sidebarStore.activeNav === 'recent' }"
           @click="navigate('recent')" :title="sidebarStore.collapsed ? '最近' : ''" tabindex="0" role="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span v-show="!sidebarStore.collapsed">最近</span>
      </div>
      <div class="sidebar-nav-item" :class="{ active: sidebarStore.activeNav === 'feed' }"
           @click="navigate('feed')" :title="sidebarStore.collapsed ? '内容聚合' : ''" tabindex="0" role="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>
        <span v-show="!sidebarStore.collapsed">内容聚合</span>
      </div>
      <div class="sidebar-nav-item" :class="{ active: sidebarStore.activeNav === 'trash' }"
           @click="navigate('trash')" :title="sidebarStore.collapsed ? '回收站' : ''" tabindex="0" role="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        <span v-show="!sidebarStore.collapsed">回收站</span>
        <span v-if="sitesStore.trash.length > 0" class="badge">{{ sitesStore.trash.length }}</span>
      </div>
    </nav>

    <div v-show="!sidebarStore.collapsed" class="sidebar-divider"></div>

    <div v-show="!sidebarStore.collapsed" class="sidebar-categories" id="categories" role="listbox" aria-label="网站分类">
      <div class="sidebar-category" :class="{ active: sitesStore.currentCategory === 'all' }"
           @click="selectCategory('all')" tabindex="0" role="option" :aria-selected="sitesStore.currentCategory === 'all'">
        <span class="category-dot" style="background:var(--accent)"></span>
        全部
        <span class="category-count">{{ sitesStore.sites.length }}</span>
      </div>

      <div v-for="group in categoriesStore.groups" :key="group.id" class="category-group">
        <div class="category-group-header" @click="categoriesStore.toggleGroup(group.id)" tabindex="0" role="button">
          <svg class="group-chevron" :class="{ rotated: !group.collapsed }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
          <span class="group-label">{{ group.label }}</span>
        </div>
        <div v-show="!group.collapsed" class="group-categories">
          <div v-for="cat in group.categories" :key="cat.id"
               class="sidebar-category" :class="{ active: sitesStore.currentCategory === cat.id }"
               @click="selectCategory(cat.id)" tabindex="0" role="option" :aria-selected="sitesStore.currentCategory === cat.id">
            <span class="category-dot" :style="{ background: cat.dotColor }"></span>
            {{ cat.label }}
            <span class="category-count">{{ sitesStore.sites.filter(s => s.categoryId === cat.id).length }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-show="!sidebarStore.collapsed" class="sidebar-footer">
      <button class="sidebar-btn" @click="showAddModal = true" aria-label="添加网站">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        添加网站
      </button>
      <button class="sidebar-btn" @click="showTodoPanel = true" aria-label="待办事项">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        待办事项
      </button>
      <button class="sidebar-btn" @click="showThemePicker = true" aria-label="主题">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        主题换肤
      </button>
      <button class="sidebar-btn" @click="showImport = true" aria-label="导入导出">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        导入导出
      </button>
    </div>

    <!-- 折叠/展开切换按钮 -->
    <button class="sidebar-collapse-toggle" @click="sidebarStore.toggleCollapse()" :title="sidebarStore.collapsed ? '展开侧边栏' : '折叠侧边栏'">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :style="{ transform: sidebarStore.collapsed ? 'rotate(180deg)' : '' }">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
    </button>

    <!-- 拖拽调节宽度手柄 -->
    <div class="sidebar-resize-handle" @mousedown="startResize" title="拖拽调节宽度"></div>

    <!-- 弹窗 -->
    <AddSiteModal v-if="showAddModal" @close="showAddModal = false" />
    <TodoPanel v-if="showTodoPanel" @close="showTodoPanel = false" />
    <ThemePicker v-if="showThemePicker" :current-theme="preferencesStore.themePreset" @select="applyTheme" @close="showThemePicker = false" />
    <BookmarkImport v-if="showImport" @close="showImport = false" />
  </aside>
</template>

<script setup>
import { ref, onUnmounted } from 'vue'
import { useSidebarStore } from '@/stores/sidebar'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { useFavoritesStore } from '@/stores/favorites'
import { usePreferencesStore } from '@/stores/preferences'
import AddSiteModal from '@/components/AddSiteModal.vue'
import TodoPanel from '@/components/TodoPanel.vue'
import ThemePicker from '@/components/ThemePicker.vue'
import BookmarkImport from '@/components/BookmarkImport.vue'

const sidebarStore = useSidebarStore()
const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()
const favoritesStore = useFavoritesStore()
const preferencesStore = usePreferencesStore()
const showAddModal = ref(false)
const showTodoPanel = ref(false)
const showThemePicker = ref(false)
const showImport = ref(false)

function navigate(nav) {
  sidebarStore.setActiveNav(nav)
  if (nav === 'favorites' || nav === 'recent') {
    sitesStore.setCategory('all')
  }
  sidebarStore.close()
}

function selectCategory(catId) {
  sitesStore.setCategory(catId)
  sidebarStore.setActiveNav('categories')
  sidebarStore.close()
}

function applyTheme(theme) {
  preferencesStore.setThemePreset(theme.id)
  showThemePicker.value = false
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

onUnmounted(() => {
  if (resizeUnlisten) resizeUnlisten()
})
</script>

<style scoped>
.sidebar {
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
.sidebar.collapsed {
  width: var(--sidebar-w-collapsed, 60px);
  min-width: var(--sidebar-w-collapsed, 60px);
}
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
.sidebar.collapsed .sidebar-footer,
.sidebar.collapsed .sidebar-divider,
.sidebar.collapsed .sidebar-section-title,
.sidebar.collapsed .sidebar-categories {
  display: none;
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
.sidebar-divider { height: 1px; background: var(--border); margin: 10px 20px 10px; }
.sidebar-section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .8px; color: var(--text-sidebar-dim); padding: 4px 20px 8px; opacity: .7; }
.sidebar-categories { padding: 0 12px; display: flex; flex-direction: column; gap: 1px; }
.category-group { display: flex; flex-direction: column; gap: 1px; }
.category-group-header { display: flex; align-items: center; gap: 6px; padding: 8px 8px 6px; cursor: pointer; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .6px; color: var(--text-sidebar-dim); transition: color .15s ease; user-select: none; opacity: .6; }
.category-group-header:hover { color: var(--text-sidebar); opacity: 1; }
.group-chevron { width: 12px; height: 12px; flex-shrink: 0; transition: transform .2s ease; opacity: .6; }
.group-chevron.rotated { transform: rotate(90deg); }
.group-label { flex: 1; }
.group-categories { display: flex; flex-direction: column; gap: 1px; }
.sidebar-category { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; font-weight: 500; color: var(--text-sidebar-dim); transition: all .15s ease; }
.sidebar-category:hover { background: var(--sidebar-hover); color: var(--text-sidebar); }
.sidebar-category.active { background: var(--sidebar-active); color: var(--text-sidebar); }
.category-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.category-count { margin-left: auto; font-size: 11px; font-weight: 600; background: var(--border-light); padding: 2px 8px; border-radius: 10px; color: var(--text-sidebar-dim); }
.sidebar-category.active .category-count { background: var(--sidebar-active); color: var(--text-sidebar); }
.sidebar-footer { margin-top: auto; padding: 16px 12px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; }
.sidebar-btn { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; font-weight: 500; color: var(--text-sidebar-dim); transition: all .15s ease; border: 1px dashed var(--border); background: transparent; width: 100%; text-align: left; }
.sidebar-btn:hover { background: var(--sidebar-hover); color: var(--text-sidebar); border-color: var(--accent); }
.sidebar-btn svg { width: 16px; height: 16px; opacity: .7; }

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
</style>