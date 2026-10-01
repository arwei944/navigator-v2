<template>
  <!-- 独立页面（管理后台 / 404）：不套导航壳，直接渲染路由组件 -->
  <router-view v-if="isStandalone" />

  <div v-else class="app-layout" :class="{ 'sidebar-collapsed': sidebarStore.collapsed }" :style="wallpaperStyle">
    <!-- 移动端顶部栏 -->
    <MobileHeader />

    <!-- 左侧导航 -->
    <Sidebar />

    <!-- 遮罩层 -->
    <div class="overlay" :class="{ show: sidebarStore.open }" @click="sidebarStore.close()"></div>

    <!-- 主内容区 -->
    <main class="main">
      <!-- 内容聚合视图 -->
      <template v-if="scope === 'feed'">
        <ContentFeed />
      </template>

      <!-- 常规视图 -->
      <template v-else>
        <!-- 站内搜索 + 列表操作合并为一条工具栏；统计与时钟下沉到侧栏底部 -->
        <MainToolbar v-if="scope !== 'trash'"
                     @open-settings="showSettings = true" @open-todo="showTodo = true" />
        <!-- 方向 + 子分类筛选条：回收站里分类无意义，故不显示 -->
        <FilterBar v-if="scope !== 'trash'" />
        <CardsContainer />
      </template>
    </main>

    <!-- 右侧面板 -->
    <RightSidebar />

    <!-- 移动端底部 tab 栏 -->
    <MobileTabBar />

    <!-- 快捷键面板 -->
    <ShortcutsPanel ref="shortcutsRef" />

    <!-- 全局命令面板 -->
    <CommandPalette ref="commandPaletteRef" @navigate="onPaletteNavigate" />

    <!-- 设置面板 -->
    <SettingsPanel v-if="showSettings" @close="showSettings = false" @open-import="openBookmarkImport" />

    <!-- 待办面板：入口在中间栏工具栏 -->
    <TodoPanel v-if="showTodo" @close="showTodo = false" />

    <!-- 导入导出面板 -->
    <BookmarkImport v-if="showBookmarkImport" @close="showBookmarkImport = false" />
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSidebarStore } from '@/stores/sidebar'
import { usePreferencesStore } from '@/stores/preferences'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import MobileHeader from '@/components/MobileHeader.vue'
import MobileTabBar from '@/components/MobileTabBar.vue'
import Sidebar from '@/components/Sidebar.vue'
import RightSidebar from '@/components/RightSidebar.vue'
import MainToolbar from '@/components/MainToolbar.vue'
import FilterBar from '@/components/FilterBar.vue'
import CardsContainer from '@/components/CardsContainer.vue'
import ShortcutsPanel from '@/components/ShortcutsPanel.vue'
import ContentFeed from '@/components/ContentFeed.vue'
import CommandPalette from '@/components/CommandPalette.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import TodoPanel from '@/components/TodoPanel.vue'
import BookmarkImport from '@/components/BookmarkImport.vue'

const route = useRoute()
const router = useRouter()
const sidebarStore = useSidebarStore()
const preferencesStore = usePreferencesStore()
const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()
const commandPaletteRef = ref(null)
const shortcutsRef = ref(null)
const showSettings = ref(false)
const showTodo = ref(false)
const showBookmarkImport = ref(false)

function openBookmarkImport() {
  showSettings.value = false
  showBookmarkImport.value = true
}

const wallpaperStyle = computed(() => {
  if (preferencesStore.wallpaper) {
    return {
      backgroundImage: `url(${preferencesStore.wallpaper})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundAttachment: 'fixed'
    }
  }
  return {}
})

function onPaletteNavigate(action) {
  if (action === 'shortcuts') {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))
  }
}

/* ---- 路由 ⇄ 状态：路由是唯一事实来源 ---- */

// 范围（Axis 1）：由路由名派生，不再作为独立可写状态
const SCOPE_BY_ROUTE = {
  Home: 'discover',
  Favorites: 'favorites',
  Recent: 'recent',
  Feed: 'feed',
  Trash: 'trash'
}
const SCOPE_LABEL = {
  favorites: '收藏',
  recent: '最近',
  feed: '内容聚合',
  trash: '回收站'
}

const scope = computed(() => SCOPE_BY_ROUTE[route.name] || 'discover')

// 不走导航壳的独立页面（自带整页布局）
const STANDALONE_ROUTES = new Set(['Admin', 'NotFound'])
const isStandalone = computed(() => STANDALONE_ROUTES.has(route.name))

// 分类（Axis 3）：与范围正交，放 query 才能和 /favorites、/recent 组合
function categoryFromRoute() {
  const id = route.query.c
  return id && id !== 'all' ? id : 'all'
}
function queryFromRoute() {
  return route.query.q || ''
}

function applyRouteToStore() {
  if (sidebarStore.activeNav !== scope.value) sidebarStore.setActiveNav(scope.value)

  const cat = categoryFromRoute()
  if (sitesStore.currentCategory !== cat) sitesStore.setCategory(cat)

  const q = queryFromRoute()
  if (sitesStore.searchQuery !== q) sitesStore.setSearchQuery(q)

  updatePageTitle()
}

// 路由变化 → 状态（含首次进入，保证直接粘贴 /favorites 也能还原状态）
watch(() => route.fullPath, applyRouteToStore, { immediate: true })

// 搜索 → query（仅当路由尚未反映该关键词时；用 replace 避免每个按键都进历史）
watch(() => sitesStore.searchQuery, (q) => {
  if ((q || '') === queryFromRoute()) return
  const next = { ...route.query }
  if (q) next.q = q
  else delete next.q
  router.replace({ path: route.path, query: next })
})

function updatePageTitle() {
  const cat = categoryFromRoute()
  let title = 'Navigator'
  if (SCOPE_LABEL[scope.value]) {
    title = `Navigator | ${SCOPE_LABEL[scope.value]}`
  } else if (cat !== 'all') {
    title = `Navigator | ${categoriesStore.getCategoryLabel(cat) || cat}`
  }
  if (sitesStore.searchQuery) {
    title = `Navigator | 搜索: ${sitesStore.searchQuery}`
  }
  document.title = title
}

onMounted(() => {
  // 云端站点热更新：启动拉取 + 30s 轮询
  sitesStore.initCloudSites()
  sitesStore.startPolling(30000)

  // 标签页重新可见时立即重拉，避免热更新后等待整轮 30s
  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      sitesStore.pollCloudSites()
    }
  }
  document.addEventListener('visibilitychange', onVisibility)

  document.addEventListener('keydown', (e) => {
    // Ctrl+K 打开全局命令面板
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault()
      if (commandPaletteRef.value) {
        commandPaletteRef.value.open()
      }
    }
    if (e.key === 'Escape') {
      sidebarStore.close()
    }
  })
})
</script>

