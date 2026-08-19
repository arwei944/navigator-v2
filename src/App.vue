<template>
  <div class="app-layout" :class="{
    'sidebar-collapsed': sidebarStore.collapsed
  }" :style="wallpaperStyle">
    <!-- 移动端顶部栏 -->
    <MobileHeader />

    <!-- 左侧导航 -->
    <Sidebar />

    <!-- 遮罩层 -->
    <div class="overlay" :class="{ show: sidebarStore.open }" @click="sidebarStore.close()"></div>

    <!-- 主内容区 -->
    <main class="main">
      <!-- 内容聚合视图 -->
      <template v-if="sidebarStore.activeNav === 'feed'">
        <ContentFeed />
      </template>

      <!-- 常规视图 -->
      <template v-else>
        <StatsBar @open-settings="showSettings = true" />
        <div class="top-widgets">
          <DigitalClock />
        </div>
        <GoogleSearchBar />
        <SiteSearchBar />
        <CardsContainer />
      </template>
    </main>

    <!-- 右侧面板 -->
    <RightSidebar />

    <!-- 快捷键面板 -->
    <ShortcutsPanel ref="shortcutsRef" />

    <!-- 全局命令面板 -->
    <CommandPalette ref="commandPaletteRef" @navigate="onPaletteNavigate" />

    <!-- 设置面板 -->
    <SettingsPanel v-if="showSettings" @close="showSettings = false" @open-import="openBookmarkImport" />

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
import Sidebar from '@/components/Sidebar.vue'
import RightSidebar from '@/components/RightSidebar.vue'
import StatsBar from '@/components/StatsBar.vue'
import DigitalClock from '@/components/DigitalClock.vue'
import GoogleSearchBar from '@/components/GoogleSearchBar.vue'
import SiteSearchBar from '@/components/SiteSearchBar.vue'
import CardsContainer from '@/components/CardsContainer.vue'
import ShortcutsPanel from '@/components/ShortcutsPanel.vue'
import ContentFeed from '@/components/ContentFeed.vue'
import CommandPalette from '@/components/CommandPalette.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
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

onMounted(() => {
  // 路由初始化：从 URL 同步状态
  syncRouteToStore()
  updatePageTitle()

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

// 路由 → Store 同步
function syncRouteToStore() {
  if (route.params.id && route.params.id !== 'all') {
    sitesStore.setCategory(route.params.id)
  } else {
    sitesStore.setCategory('all')
  }
  if (route.query.q) {
    sitesStore.setSearchQuery(route.query.q)
  }
}

// Store → 路由同步
watch(() => sitesStore.currentCategory, (cat) => {
  const base = { name: 'Home' }
  if (cat && cat !== 'all') {
    router.replace({ name: 'Category', params: { id: cat }, query: route.query.q ? { q: route.query.q } : undefined })
  } else {
    router.replace({ name: 'Home', query: route.query.q ? { q: route.query.q } : undefined })
  }
  updatePageTitle()
})

watch(() => sitesStore.searchQuery, (q) => {
  const base = { name: 'Home' }
  if (q) {
    router.replace({ name: 'Home', query: { q } })
  } else {
    const cat = sitesStore.currentCategory
    if (cat && cat !== 'all') {
      router.replace({ name: 'Category', params: { id: cat } })
    } else {
      router.replace({ name: 'Home' })
    }
  }
  updatePageTitle()
})

// 路由变化 → Store 同步
watch(() => route.params.id, () => {
  syncRouteToStore()
})

watch(() => route.query.q, () => {
  if (route.query.q !== undefined) {
    sitesStore.setSearchQuery(route.query.q || '')
  }
  updatePageTitle()
})

function updatePageTitle() {
  let title = 'Navigator'
  const cat = sitesStore.currentCategory
  if (cat && cat !== 'all') {
    const label = categoriesStore.getCategoryLabel(cat) || cat
    title = `Navigator | ${label}`
  }
  if (sitesStore.searchQuery) {
    title = `Navigator | 搜索: ${sitesStore.searchQuery}`
  }
  document.title = title
}
</script>

<style scoped>
.top-widgets {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 28px 0;
  gap: 16px;
  flex-shrink: 0;
}
</style>