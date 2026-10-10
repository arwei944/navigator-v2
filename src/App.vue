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
      <!-- 云端数据状态条：断网/超时/服务端报错/响应不合法时，让用户知道
           「现在看到的可能是本机数据而不是云端最新」。旧实现是 catch 全空，
           断网与正常在界面上完全一样，用户会以为数据没问题。
           放在 .main 内部而不是 fixed 定位：避开与移动端头部栏、批量操作栏的层叠打架。 -->
      <div v-if="cloudNotice" class="cloud-notice" :class="cloudNotice.tone" role="status">
        <span class="cloud-notice-text">{{ cloudNotice.text }}</span>
        <button v-if="cloudNotice.retry" class="cloud-notice-btn" @click="sitesStore.retryCloudNow()">重试</button>
      </div>

      <!-- 内容聚合视图 -->
      <template v-if="scope === 'feed'">
        <ContentFeed />
      </template>

      <!-- 常规视图 -->
      <template v-else>
        <!-- 站内搜索 + 列表操作合并为一条工具栏；统计与时钟下沉到侧栏底部 -->
        <MainToolbar v-if="scope !== 'trash'"
                     @open-settings="showSettings = true" @open-todo="showTodo = true"
                     @open-add="openAddSite" @open-card-settings="showCardSettings = true"
                     @open-palette="commandPaletteRef?.open()" />
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
  </div>

  <!-- ── 全局浮层区 ──
       刻意放在路由壳之外：/admin、404 这类独立页面不套 app-layout，
       浮层若挂在里面，这些页面下 Ctrl+K 与命令唤起的弹窗就全部失效。 -->
  <ShortcutsPanel ref="shortcutsRef" />

  <!-- 全能框（Ctrl+K）：与顶部搜索框共用同一套命令与检索内核 -->
  <CommandPalette ref="commandPaletteRef" />

  <!-- 设置面板 -->
  <SettingsPanel v-if="showSettings" @close="showSettings = false" @open-import="openBookmarkImport" @open-admin="openAdmin" />

  <!-- 卡片设置：右侧抽屉，改动在左侧网格即时可见 -->
  <CardSettingsPanel v-if="showCardSettings" @close="showCardSettings = false" />

  <!-- 待办面板：入口在中间栏工具栏 -->
  <TodoPanel v-if="showTodo" @close="showTodo = false" />

  <!-- 导入导出面板 -->
  <BookmarkImport v-if="showBookmarkImport" @close="showBookmarkImport = false" />

  <!-- 添加站点：入口在右上角工具栏与全能框，弹窗宿主上提到这里（原挂在左侧栏内） -->
  <AddSiteModal v-if="showAddModal" :prefill-url="addPrefillUrl" :notice="addNotice" @close="closeAddSite" />

  <!-- 编辑站点：全能框「编辑」命令的宿主。卡片上的编辑仍走 CardsContainer 自己的实例，
       这里只补命令层够不着的那一条路径 -->
  <EditSiteModal v-if="editSite" :site="editSite" @close="closeEditSite" @saved="closeEditSite" />

  <!-- 删除确认：全能框「删除」命令的二次确认 -->
  <ConfirmDialog
    v-if="deleteSite"
    title="删除站点"
    :message="`确定要把「${deleteSite.name}」移入回收站吗？可以在回收站里恢复。`"
    confirm-text="删除"
    @cancel="cancelDeleteSite"
    @confirm="confirmDeleteSite"
  />

  <!-- 全局轻提示：自动添加的成功 / 重复 / 失败反馈都从这里出，替代原预览卡片 -->
  <ToastHost />

  <!-- 全局单例右键菜单：替代每张卡片各自一份（300 卡 = 600 个 document 监听） -->
  <ContextMenuHost />

  <!-- 移动端站点详情抽屉：≤768px 没有 hover，右侧面板又整体隐藏，详情在这里兜住 -->
  <MobileDetailDrawer />
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
import EditSiteModal from '@/components/EditSiteModal.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ToastHost from '@/components/ToastHost.vue'
import ContextMenuHost from '@/components/ContextMenuHost.vue'
import MobileDetailDrawer from '@/components/MobileDetailDrawer.vue'
import { autoAddSite } from '@/services/autoAdd'
import { AUTO_ADD_REASON } from '@/utils/siteDraft'
import { useToastStore } from '@/stores/toast'
import { useOmniStore } from '@/stores/omni'

const route = useRoute()
const router = useRouter()
const sidebarStore = useSidebarStore()
const preferencesStore = usePreferencesStore()
const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()
const clicksStore = useClicksStore()
const toastStore = useToastStore()
const omniStore = useOmniStore()
const commandPaletteRef = ref(null)
const shortcutsRef = ref(null)
const showSettings = ref(false)
// 卡片设置面板：右侧抽屉，与「设置」一样由工具栏触发
const showCardSettings = ref(false)
const showTodo = ref(false)
const showBookmarkImport = ref(false)
const showAddModal = ref(false)
// 全能框「编辑 / 删除」命令的宿主状态：命令只发请求，弹窗由这里渲染
const editSite = ref(null)
const deleteSite = ref(null)
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

/* ---- 全能框：命令只发请求，弹窗宿主在这里落地 ----
   命令层因此完全不持有 DOM 状态，也不必知道每个面板挂在谁的 v-if 里。 */

watch(() => omniStore.panel, (name) => {
  if (!name) return
  if (name === 'settings') showSettings.value = true
  else if (name === 'cardSettings') showCardSettings.value = true
  else if (name === 'todo') showTodo.value = true
  else if (name === 'bookmarkImport') { showSettings.value = false; showBookmarkImport.value = true }
  else if (name === 'shortcuts') nextTick(() => shortcutsRef.value?.open())
  // 一次性请求：消费后立即清空，不带到下一次
  omniStore.panel = ''
})

watch(() => omniStore.editTarget, (site) => {
  if (!site) return
  editSite.value = site
  omniStore.editTarget = null
})

watch(() => omniStore.deleteTarget, (site) => {
  if (!site) return
  deleteSite.value = site
  omniStore.deleteTarget = null
})

watch(() => omniStore.addOpen, (v) => {
  if (!v) return
  openAddSite({ url: omniStore.addPrefillUrl || '' })
  omniStore.addOpen = false
})

function closeEditSite() {
  editSite.value = null
}

function cancelDeleteSite() {
  deleteSite.value = null
}

function confirmDeleteSite() {
  const site = deleteSite.value
  deleteSite.value = null
  if (!site) return
  sitesStore.deleteSite(site.id)
  toastStore.push({
    message: `已把「${site.name}」移入回收站`,
    tone: 'ok',
    actionLabel: '撤销',
    onAction: () => sitesStore.restoreFromTrash(site.id)
  })
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
  // 云端站点热更新：启动拉取 + 轮询（失败会指数退避）
  sitesStore.initCloudSites()
  sitesStore.startPolling(30000)

  // 全局点击量（卡片角标 / 排行的权威口径）：启动拉一次，之后按 TTL 自刷新
  clicksStore.load()

  // 标签页重新可见时立即重拉，避免热更新后等待整轮 30s。
  // 顺带复位退避：用户切回来就是要看最新数据，不该让他等一个断网期间攒出来的窗口。
  document.addEventListener('visibilitychange', onVisibility)

  // 联网恢复/断开：恢复时立刻重拉（不必等退避），断开时把状态写进 cloudError 让界面说出来。
  // 这两个事件在移动端尤其重要 —— 切 4G/WiFi 时 navigator.onLine 变化是最早的信号。
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)

  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  // 这个组件挂在应用根上，正常不会卸载；但把监听与定时器收干净是基本功，
  // 否则将来一旦有 HMR / 多实例挂载，就会同时跑好几条轮询。
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
  document.removeEventListener('keydown', onKeydown)
  sitesStore.stopPolling()
})

/**
 * 云端状态条文案：把 store 里的机器可读短码翻译成人话。
 * 放在 UI 层而不是 store 里，是为了 store 不带文案、也便于将来换措辞。
 */
const cloudNotice = computed(() => {
  const e = sitesStore.cloudError
  if (!e) return null
  if (e === 'offline') return { tone: 'warn', retry: true, text: '已离线，当前展示的是本机数据，联网后会自动更新' }
  if (e === 'timeout') return { tone: 'warn', retry: true, text: '读取云端数据超时，当前展示的是本机数据' }
  if (e === 'invalid-payload') return { tone: 'bad', retry: true, text: '云端数据格式异常，已保留上一版本，请联系管理员' }
  if (String(e).startsWith('http-')) return { tone: 'bad', retry: true, text: `云端数据读取失败（${e.slice(5)}），当前展示的是本机数据` }
  return { tone: 'warn', retry: true, text: '云端数据暂时不可用，当前展示的是本机数据' }
})

function onVisibility() {
  if (document.visibilityState === 'visible') sitesStore.retryCloudNow()
}
function onOnline() { sitesStore.retryCloudNow() }
function onOffline() { sitesStore.pollCloudSites() }

function onKeydown(e) {
  // Ctrl+K 打开全能框（命令面板形态）
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault()
    commandPaletteRef.value?.open()
    return
  }
  // Ctrl+D 切换主题：快捷键面板里写了这条但一直没实现，这里补上
  if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
    e.preventDefault()
    preferencesStore.toggleTheme()
    return
  }
  if (e.key === 'Escape') {
    sidebarStore.close()
  }
}
</script>

