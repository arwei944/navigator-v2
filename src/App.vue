<template>
  <!-- 独立页面（管理后台 / 404）：不套导航壳，直接渲染路由组件 -->
  <router-view v-if="isStandalone" />

  <div v-else class="app-layout" :class="{ 'sidebar-collapsed': sidebarStore.collapsed, 'no-blur': sidebarStore.animating }" :style="wallpaperStyle">
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
                     @open-settings="showSettings = true" @open-todo="showTodo = true"
                     @open-add="openAddSite" @open-card-settings="showCardSettings = true" />
        <!-- 方向 + 子分类筛选条：回收站里分类无意义，故不显示；归档同理（筛选条的计数
             基于在册站点，在归档范围内会虚高） -->
        <FilterBar v-if="scope !== 'trash' && scope !== 'archived'" />
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
    <SettingsPanel v-if="showSettings" @close="showSettings = false" @open-import="openBookmarkImport" @open-admin="openAdmin" />

    <!-- 卡片设置：右侧抽屉，改动在左侧网格即时可见 -->
    <CardSettingsPanel v-if="showCardSettings" @close="showCardSettings = false" />

    <!-- 待办面板：入口在中间栏工具栏 -->
    <TodoPanel v-if="showTodo" @close="showTodo = false" />

    <!-- 导入导出面板 -->
    <BookmarkImport v-if="showBookmarkImport" @close="showBookmarkImport = false" />

    <!-- 添加站点：入口在右上角工具栏与站内搜索框，弹窗宿主上提到这里（原挂在左侧栏内） -->
    <AddSiteModal v-if="showAddModal" :prefill-url="addPrefillUrl" :notice="addNotice" @close="closeAddSite" />

    <!-- 全局轻提示：自动添加的成功 / 重复 / 失败反馈都从这里出，替代原预览卡片 -->
    <ToastHost />

    <!-- 全局单例右键菜单：替代每张卡片各自一份（300 卡 = 600 个 document 监听） -->
    <ContextMenuHost />

    <!-- 移动端站点详情抽屉：≤768px 没有 hover，右侧面板又整体隐藏，详情在这里兜住 -->
    <MobileDetailDrawer />
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSidebarStore } from '@/stores/sidebar'
import { usePreferencesStore } from '@/stores/preferences'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { useClicksStore } from '@/stores/clicks'
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
import CardSettingsPanel from '@/components/CardSettingsPanel.vue'
import TodoPanel from '@/components/TodoPanel.vue'
import BookmarkImport from '@/components/BookmarkImport.vue'
import AddSiteModal from '@/components/AddSiteModal.vue'
import ToastHost from '@/components/ToastHost.vue'
import ContextMenuHost from '@/components/ContextMenuHost.vue'
import MobileDetailDrawer from '@/components/MobileDetailDrawer.vue'
import { autoAddSite } from '@/services/autoAdd'
import { AUTO_ADD_REASON } from '@/utils/siteDraft'
import { useToastStore } from '@/stores/toast'

const route = useRoute()
const router = useRouter()
const sidebarStore = useSidebarStore()
const preferencesStore = usePreferencesStore()
const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()
const clicksStore = useClicksStore()
const toastStore = useToastStore()
const commandPaletteRef = ref(null)
const shortcutsRef = ref(null)
const showSettings = ref(false)
// 卡片设置面板：右侧抽屉，与「设置」一样由工具栏触发
const showCardSettings = ref(false)
const showTodo = ref(false)
const showBookmarkImport = ref(false)
const showAddModal = ref(false)
// 搜索框里输入的网址：打开弹窗时带过去预填；从右上角按钮进来则为空
const addPrefillUrl = ref('')
// 自动添加被护栏拦下时，带进弹窗的原因提示
const addNotice = ref('')

// 连续触发时丢弃过期结果，避免旧请求把新卡片覆盖回去
let autoAddSeq = 0

function openAddSite(payload) {
  const url = payload?.url || ''
  // 带网址且开关为开 → 走自动添加；工具栏「+」（无网址）与关掉开关时，行为与从前完全一致
  if (url && preferencesStore.autoAddOnUrl) {
    runAutoAdd(url)
    return
  }
  addPrefillUrl.value = url
  showAddModal.value = true
}

async function runAutoAdd(url) {
  const seq = ++autoAddSeq
  // 抓取最长 8s，先给一条「进行中」提示，否则用户按回车后会以为没反应
  const pendingId = toastStore.push({ message: '正在识别站点信息…', tone: 'info', duration: 60000 })

  let res
  try {
    res = await autoAddSite({ url })
  } catch {
    res = { ok: false, reason: AUTO_ADD_REASON.WRITE_FAILED, message: '添加失败，请稍后重试。' }
  }
  toastStore.dismiss(pendingId)
  if (seq !== autoAddSeq) return

  if (res.ok) {
    toastStore.push({
      message: res.category.created
        ? `已添加「${res.site.name}」，并新建分类「${res.category.label}」`
        : `已添加「${res.site.name}」到「${res.category.label}」`,
      tone: 'ok',
      actionLabel: '撤销',
      onAction: () => undoAutoAdd(res.site.id, res.category),
    })
    await locateSite(res.site)
    return
  }

  if (res.reason === AUTO_ADD_REASON.DUPLICATE) {
    const existing = res.existing
    toastStore.push({
      message: res.message,
      tone: 'info',
      actionLabel: '查看',
      onAction: () => locateSite({ id: existing.id, categoryId: existing.categoryId }),
    })
    await locateSite({ id: existing.id, categoryId: existing.categoryId })
    return
  }

  // 网址不成立 / 写库失败：报错即可，自动路径不再退回弹窗
  toastStore.push({ message: res.message, tone: 'error' })
}

/**
 * 自动切到站点所属分类并高亮定位。路由是唯一事实来源，改范围 / 分类都走这里。
 * 清掉 p、q 是必须的：不清掉用途与搜索词，新卡片会被筛掉，定位就落空了。
 */
async function locateSite(site) {
  const target = site.categoryId || 'all'
  const current = (route.query.c && route.query.c !== 'all') ? route.query.c : 'all'
  const needNav = route.name !== 'Home' || current !== target || Boolean(route.query.p) || Boolean(route.query.q)
  if (needNav) {
    await router.push({ name: 'Home', query: site.categoryId ? { c: site.categoryId } : {} })
  }
  await nextTick()
  sitesStore.highlightSite(site.id)
}

/** 撤销一次自动添加；本次顺带新建、且现已无人使用的分类一并回收 */
function undoAutoAdd(siteId, category) {
  const undone = sitesStore.undoAdd(siteId)
  if (undone && category?.created && category.id) {
    const stillUsed = sitesStore.sites.some(s => s.categoryId === category.id)
    if (!stillUsed) categoriesStore.removeCategory(category.id)
  }
  toastStore.push({ message: '已撤销', tone: 'info', duration: 2000 })
}

// 关掉就清空预填与提示，否则下次从按钮打开还会带着上一次的内容
function closeAddSite() {
  showAddModal.value = false
  addPrefillUrl.value = ''
  addNotice.value = ''
}

function openBookmarkImport() {
  showSettings.value = false
  showBookmarkImport.value = true
}

// 管理后台入口收敛进设置面板：先关面板再跳转，避免返回时面板还盖在上面
function openAdmin() {
  showSettings.value = false
  router.push('/admin')
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
  Trash: 'trash',
  Archived: 'archived'
}
const SCOPE_LABEL = {
  favorites: '收藏',
  recent: '最近',
  archived: '归档',
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
// 用途（Axis 4）：同样放 query，才能和分类、范围任意组合
function purposeFromRoute() {
  const id = route.query.p
  return id && id !== 'all' ? id : 'all'
}
function queryFromRoute() {
  return route.query.q || ''
}

function applyRouteToStore() {
  if (sidebarStore.activeNav !== scope.value) sidebarStore.setActiveNav(scope.value)

  // 「归档」是范围轴：只有在这个范围内才把 archived 站点放出来，其余范围一律不显示
  sitesStore.setArchivedScope(scope.value === 'archived')

  const cat = categoryFromRoute()
  if (sitesStore.currentCategory !== cat) sitesStore.setCategory(cat)

  const purpose = purposeFromRoute()
  if (sitesStore.currentPurpose !== purpose) sitesStore.setPurpose(purpose)

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

  // 全局点击量（卡片角标 / 排行的权威口径）：启动拉一次，之后按 TTL 自刷新
  clicksStore.load()

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

