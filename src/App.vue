<template>
  <!-- 独立页面（管理后台 / 404）：不套导航壳，直接渲染路由组件 -->
  <router-view v-if="isStandalone" />

  <div v-else class="app-layout" :class="{ 'sidebar-collapsed': sidebarStore.collapsed, 'no-blur': sidebarStore.animating }" :style="wallpaperStyle">
    <!-- 无障碍（F3）：第一个可聚焦元素，键盘/读屏用户一键跳过导航直达主内容 -->
    <a href="#main" class="skip-link">跳到主内容</a>

    <!-- 移动端顶部栏 -->
    <MobileHeader />

    <!-- 左侧导航 -->
    <Sidebar />

    <!-- 遮罩层 -->
    <div class="overlay" :class="{ show: sidebarStore.open }" @click="sidebarStore.close()"></div>

    <!-- 主内容区 -->
    <main class="main" id="main">
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

      <!-- 洞察面板（v11）：整页图表，不需要搜索工具栏与卡片网格 -->
      <template v-else-if="scope === 'insights'">
        <InsightsView />
      </template>

      <!-- 关联图谱（v12）：整页画布，同样不走搜索工具栏与卡片网格 -->
      <template v-else-if="scope === 'graph'">
        <GraphView />
      </template>

      <!-- 领域流水线：按价值链位置组织站点，同样整页呈现 -->
      <template v-else-if="scope === 'domain'">
        <DomainFlowView />
      </template>

      <!-- 关于：整页信息，同样不走搜索工具栏与卡片网格 -->
      <template v-else-if="scope === 'about'">
        <AboutView />
      </template>

      <!-- 管理后台：套壳渲染（保持三栏），不再是整页独立的 /admin -->
      <template v-else-if="scope === 'admin'">
        <AdminView />
      </template>

      <!-- 常规视图 -->
      <template v-else>
        <!-- 站内搜索 + 列表操作合并为一条工具栏；统计与时钟下沉到侧栏底部 -->
        <MainToolbar v-if="scope !== 'trash'"
                     @open-settings="showSettings = true" @open-todo="showTodo = true"
                     @open-add="openAddSite" @open-card-settings="showCardSettings = true"
                     @open-notes="openNotes"
                     @open-palette="commandPaletteRef?.open()" />
        <!-- 此刻推荐：只在首页「没在搜索」时出现 —— 搜索时结果已经由相关性决定，
             再插一排推荐等于和用户输入的词抢注意力。
             用 prop 控制可见性、组件常驻：让「搜索时隐藏推荐」不改变父级模板的
             兄弟节点数量。理由与守卫见 SmartBar.vue 的 `enabled` 注释。 -->
        <SmartBar
          :enabled="scope === 'discover' && !sitesStore.searchQuery && preferencesStore.smartBar"
        />

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
  <SettingsPanel v-if="showSettings" @close="showSettings = false" @open-import="openBookmarkImport" @open-admin="openAdmin"
                 @open-theme-editor="showThemeEditor = true" @open-card-settings="showCardSettings = true" />

  <!-- 主题编辑器：右侧抽屉，与卡片设置同形态 —— 改动即时可见 -->
  <ThemeEditor v-if="showThemeEditor" @close="showThemeEditor = false" />

  <!-- 卡片设置：右侧抽屉，改动在左侧网格即时可见 -->
  <CardSettingsPanel v-if="showCardSettings" @close="showCardSettings = false" />

  <!-- 待办面板：入口在中间栏工具栏 -->
  <TodoPanel v-if="showTodo" @close="showTodo = false" />

  <!-- 便利贴：停靠形态常驻桌面右下角（移动端由 CSS 隐藏，改走便签墙）；
       便签墙是按需打开的全屏浮层。两者都在路由壳之外，/admin 下同样可用。 -->
  <StickyDock ref="dockRef" @open-board="showStickyBoard = true" />
  <StickyBoard v-if="showStickyBoard" @close="showStickyBoard = false" />

  <!-- 导入导出面板 -->
  <BookmarkImport v-if="showBookmarkImport" @close="showBookmarkImport = false" />

  <!-- 管线日志：常驻挂载、内部自管显隐（组件头注释说了为什么不能用 v-if 条件挂载） -->
  <PipelineLogPanel :open-token="pipelineOpenToken" />

  <!-- 添加站点：入口在右上角工具栏与全能框，弹窗宿主上提到这里（原挂在左侧栏内） -->
  <AddSiteModal v-if="showAddModal" :prefill-url="addPrefillUrl" :notice="addNotice" @close="closeAddSite" @saved="onAddSaved" />

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
  <!-- 背景音乐播放器：只在设置里打开后才加载与挂载 —— 首屏一行代码都不为它多付 -->
  <BgmPlayer v-if="preferencesStore.bgmOn" />

  <!-- 全局单例右键菜单：替代每张卡片各自一份（300 卡 = 600 个 document 监听） -->
  <ContextMenuHost />

  <!-- 移动端站点详情抽屉：≤768px 没有 hover，右侧面板又整体隐藏，详情在这里兜住 -->
  <MobileDetailDrawer />
</template>

<script setup>
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MOBILE_QUERY, isMobileWidth, safeMatchMedia } from '@/utils/breakpoints'
import { useSidebarStore } from '@/stores/sidebar'
import { usePreferencesStore } from '@/stores/preferences'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { useAutoPublish } from '@/composables/useAutoPublish'
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
import CardSettingsPanel from '@/components/CardSettingsPanel.vue'
import TodoPanel from '@/components/TodoPanel.vue'
import BookmarkImport from '@/components/BookmarkImport.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ToastHost from '@/components/ToastHost.vue'
import ContextMenuHost from '@/components/ContextMenuHost.vue'
import MobileDetailDrawer from '@/components/MobileDetailDrawer.vue'
import StickyDock from '@/components/StickyDock.vue'
import SmartBar from '@/components/SmartBar.vue'
/**
 * `services/autoAdd` 走**动态 import**（见 `runAutoAdd` 里的说明）：把它写回静态
 * import，整条秒加链路（含它引用的站点草稿工具与本次新增的管线追踪总线）会一起被提进入口
 * chunk —— 实测首屏 597.8 → 602.8 KiB，越过 600 KiB 预算。
 */
const loadAutoAdd = () => Promise.all([import('@/services/autoAdd'), import('@/utils/siteDraft')])
import { useToastStore } from '@/stores/toast'
import { useOmniStore } from '@/stores/omni'
import { useNotesStore } from '@/stores/notes'
import { useSiteNotesStore } from '@/stores/siteNotes'
import { useThemeStore } from '@/stores/theme'
import { useUndoActions } from '@/composables/useUndoActions'
import { useRouteSync } from '@/composables/useRouteSync'
import { useAppLifecycle } from '@/composables/useAppLifecycle'
import { useCloudNotice } from '@/composables/useCloudNotice'

/**
 * 「点开才用」的重组件一律走异步：它们都由用户点击打开、`v-if` 控制，没有任何理由把代码压在首屏。
 * v8 上线时这几块（含新增的主题编辑器与便签墙）把首屏顶出了 600 KiB 预算，故在此收口。
 * 注意 `StickyDock` 仍是同步的 —— 它是常驻的右下角浮标，异步会让它晚一拍才出现。
 */
const SettingsPanel = defineAsyncComponent(() => import('@/components/SettingsPanel.vue'))
const StickyBoard = defineAsyncComponent(() => import('@/components/StickyBoard.vue'))
const ThemeEditor = defineAsyncComponent(() => import('@/components/ThemeEditor.vue'))
/**
 * 添加站点弹窗也是「点开才用」—— 与上面三个同类。它拖着的推断引擎
 * （shared/site-infer.mjs，services/localMeta.js 动态引用）有 700+ 行，
 * 只要它在首屏静态图里，引擎就会被一起提进入口 chunk（实测 591.6 → 608.4 KiB，
 * 越过 600 KiB 预算）。改成异步后整条链路落到异步 chunk，首屏反而省下一截。
 */
const AddSiteModal = defineAsyncComponent(() => import('@/components/AddSiteModal.vue'))
// 编辑站点弹窗同理：只在右键点「编辑」时才出现。它拖着 PurposePicker，
// 静态引入会连带一起压在首屏（实测 598.3 → 604.0 KiB，越过 600 KiB 预算）。
// **三处引用都得异步**（这里 / CardsContainer / AdminSitesPanel）——
// 只要还剩一处静态 import，整个模块就会被提升回首屏，异步化等于白做。
const EditSiteModal = defineAsyncComponent(() => import('@/components/EditSiteModal.vue'))
// 洞察面板：整页图表，只在点进 /insights 时才需要 —— 必须异步，否则图表原语会进首屏包
const InsightsView = defineAsyncComponent(() => import('@/views/InsightsView.vue'))
// 关联图谱：同理必须异步 —— 它带着 affinity 引擎与力导向布局，进首屏必超预算
const GraphView = defineAsyncComponent(() => import('@/views/GraphView.vue'))
const DomainFlowView = defineAsyncComponent(() => import('@/views/DomainFlowView.vue'))
const AboutView = defineAsyncComponent(() => import('@/views/AboutView.vue'))
const AdminView = defineAsyncComponent(() => import('@/views/AdminView.vue'))
// 背景音乐播放器：懒加载，且只在设置里打开后才挂载 —— 首屏为它只付一行声明
const BgmPlayer = defineAsyncComponent(() => import('@/components/BgmPlayer.vue'))
/**
 * 管线日志：排查「多跳异步链路到底停在哪」用的 Observability 浮层。
 *
 * 它必须**异步挂载**（不做异步的话 trace 总线与面板模板都要压在首屏预算里，而预算只剩
 * 个位数 KiB）；但挂载必须是**无条件的** —— 若等第一条 run 出现才去挂载，那一跳已经跑完、
 * 埋点已被丢弃，而最需要看见的恰恰是「第一次为什么没发生」。
 */
const PipelineLogPanel = defineAsyncComponent(() => import('@/components/PipelineLogPanel.vue'))

const route = useRoute()
const router = useRouter()
const sidebarStore = useSidebarStore()
const preferencesStore = usePreferencesStore()
const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()
/**
 * 实时发布调度器：全局安装一次。
 * 默认手动模式下它什么都不做；只有用户在后台切到「实时发布」且已登录时才生效。
 */
useAutoPublish()
const clicksStore = useClicksStore()
const toastStore = useToastStore()
const omniStore = useOmniStore()
const notesStore = useNotesStore()
const siteNotesStore = useSiteNotesStore()
// 撤销：批量改分类/加用途/置顶/归档/删除都入栈，Ctrl+Z 与提示上的「撤销」按钮共用一份逻辑
const { undoableDelete, undoLast } = useUndoActions()
/**
 * 主题 store 必须在启动时就实例化，**不能**只靠主题设置面板去创建它：
 * 「跟随系统」「日落自动换深色」「自建主题刷新后补应用」都挂在它的初始化里，
 * 而 `ThemeSection` / `ThemeEditor` 现在都是按需加载的 —— 等用户点开设置才建 store，
 * 这些行为在刷新后一次都不会发生。
 */
useThemeStore()
const commandPaletteRef = ref(null)
const shortcutsRef = ref(null)
const dockRef = ref(null)
const showSettings = ref(false)
// 卡片设置面板：右侧抽屉，与「设置」一样由工具栏触发
const showCardSettings = ref(false)
const showTodo = ref(false)
const showStickyBoard = ref(false)
const showThemeEditor = ref(false)
const showBookmarkImport = ref(false)
const showAddModal = ref(false)
// 全能框「编辑 / 删除」命令的宿主状态：命令只发请求，弹窗由这里渲染
const editSite = ref(null)
const deleteSite = ref(null)
// 搜索框里输入的网址：打开弹窗时带过去预填；从右上角按钮进来则为空
const addPrefillUrl = ref('')
// 自动添加被护栏拦下时，带进弹窗的原因提示
const addNotice = ref('')
// 管线日志面板的打开请求：命令层只给一个递增令牌，面板自己管打开状态
const pipelineOpenToken = ref(0)

// 连续触发时丢弃过期结果，避免旧请求把新卡片覆盖回去
let autoAddSeq = 0

/* ---------- 移动端返回手势与抽屉的协同（F4）---------- */
/**
 * 为什么是「用原生返回」而不是「自己监听边缘滑动」：Android / iOS 的边缘返回手势由
 * 浏览器实现，页面再在同样区域叠一层 touch 监听必然与它抢事件（要么自定义手势失灵，
 * 要么误触发返回）。正解是**让原生手势为我们干活** —— 抽屉打开时压一条哨兵历史记录，
 * 原生返回（滑动手势或返回键）触发 popstate 时消费掉它来**关闭抽屉**，用户不会一按返回
 * 就离开站点；经 UI 关闭时再把哨兵弹掉，历史保持干净（开 / 关 1:1）。
 *
 * 只在窄屏压历史：桌面端侧栏是常驻栏位，不该被历史记录牵连。桌面按浏览器返回键仍是
 * 正常后退（popstate 里判到抽屉没开就不消费）。
 */
const drawerOpen = computed(() => sidebarStore.open || Boolean(sidebarStore.detailSheetSite))
const isNarrowViewport = () => safeMatchMedia(MOBILE_QUERY)

function closeDrawers() {
  if (sidebarStore.open) sidebarStore.close()
  if (sidebarStore.detailSheetSite) sidebarStore.closeDetailSheet()
}

// 由 popstate 关闭时置位：哨兵记录已被那一次返回弹掉，UI 关闭路径不能再回退一次
let drawerClosedByPop = false
function onDrawerPopState() {
  if (drawerOpen.value) { drawerClosedByPop = true; closeDrawers() }
}

watch(drawerOpen, (open) => {
  if (typeof window === 'undefined' || typeof window.history === 'undefined') return
  if (open) {
    if (isNarrowViewport()) window.history.pushState({ navDrawer: true }, '')
    drawerClosedByPop = false
    return
  }
  // 因 popstate 而关闭：哨兵已弹，不能再 history.back()
  if (drawerClosedByPop) { drawerClosedByPop = false; return }
  // 因 UI 关闭（点遮罩 / 关闭按钮 / Esc / 下滑）：把哨兵弹掉，别让下次返回「返回」到抽屉
  if (window.history.state && window.history.state.navDrawer) window.history.back()
})

onMounted(() => { if (typeof window !== 'undefined') window.addEventListener('popstate', onDrawerPopState) })
onBeforeUnmount(() => { if (typeof window !== 'undefined') window.removeEventListener('popstate', onDrawerPopState) })

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
  // 失败原因常量：随同一批动态 import 进来（它在 `utils/siteDraft.js` 里，
  // 静态引它等于把 autoAdd 那条链路再拽回一半）
  let reasonCodes = null
  try {
    const [autoAddMod, draftMod] = await loadAutoAdd()
    reasonCodes = draftMod.AUTO_ADD_REASON
    res = await autoAddMod.autoAddSite({ url })
  } catch (e) {
    res = { ok: false, reason: 'write-failed', message: '添加失败，请稍后重试。' }
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
    await settleUpgrade(res)
    return
  }

  if (reasonCodes && res.reason === reasonCodes.DUPLICATE) {
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
 * 秒加之后的回执。
 *
 * ## 为什么这里必须「说失败」
 *
 * 卡片入库的那一刻用的是域名推断草稿，真实信息要等后台抓取。只挂一条「已补全」的成功回执时，
 * 抓不到的那些站（对方 CDN/WAF 限流、超时、配额耗尽）**全程没有任何声音** —— 用户看到的是
 * 一张写着模板描述、分类也未必准的卡，既不知道它已经尽力、也不知道自己该怎么补。
 * 「没补全」是一种**需要被告知的结果**，不是「什么都没发生」。
 *
 * 译文来源也一并交代（本地模型 / 在线引擎 / 只有词表关键词）：
 * 「描述显示的是中文」和「描述显示的是中文**译文**」是两件事，后者才值得用户放心。
 *
 * @param {{site: object, upgrade?: Promise<object>, category: object}} res `autoAddSite()` 的结果
 */
async function settleUpgrade(res) {
  if (!res.upgrade) return
  // 真实抓取要花几秒，而「正在识别」那条 toast 此刻已经撤了 —— 中间这段空窗
  // 正是用户以为「压根没去抓」的那几秒，给一条持续可见的进度提示补上
  const progressId = toastStore.push({ message: '正在抓取站点真实信息…', tone: 'info', duration: 60000 })
  const u = await res.upgrade.catch(() => null)
  toastStore.dismiss(progressId)
  if (!u) return

  if (u.changed && u.real) {
    const tr = u.translation
    let tail = ''
    if (tr?.translated?.desc && tr.note) tail = `，描述译文来自${tr.note}`
    else if (tr && !tr.translated?.desc && tr.keywords) tail = '，描述未译成中文（已抽取关键词）'
    toastStore.push({
      message: `已补全「${u.name}」的名称与描述${tail}`,
      tone: 'info',
      actionLabel: '查看',
      onAction: () => locateSite(res.site),
    })
    return
  }

  /**
   * 降级回执：区分三种「没补全」，一句话说清楚是哪一种、接下去能做什么。
   * 凡是站在用户面前的产品文案，都不许把「对方拒绝」说成「还没做」。
   */
  const manualLabel = '手动补全'
  const manual = () => {
    const cur = sitesStore.sites.find(s => s.id === res.site.id)
    if (cur) editSite.value = cur
  }
  if (u.reason === 'fetch-failed') {
    toastStore.push({
      message: `「${u.name}」的真实信息没抓到：${u.message || '对方没有响应'}（名称与描述仍是推断值）`,
      tone: 'error',
      actionLabel: manualLabel,
      onAction: manual,
    })
    return
  }
  if (!u.real) {
    toastStore.push({
      message: `「${u.name}」的页面没读到（${u.data?.warning || '对方返回了不可解析的内容'}），描述仍是推断值`,
      tone: 'error',
      actionLabel: manualLabel,
      onAction: manual,
    })
    return
  }
  if (!u.changed) {
    toastStore.push({
      message: `已核对「${u.name}」，对方给出的信息与推断值一致`,
      tone: 'info',
      duration: 3000,
    })
  }
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

// 弹窗手动添加成功后与搜索栏路径同等待遇：切到该分类并滚动定位到新卡片
function onAddSaved({ id }) {
  const site = sitesStore.sites.find(s => s.id === id)
  if (site) locateSite(site)
}

function openBookmarkImport() {
  showSettings.value = false
  showBookmarkImport.value = true
}

/* ---- 便利贴 ----
   默认形态是停靠（右下角浮标），便签墙按需打开。
   窄屏没有浮标（会被底部 tab 栏压住），一律走便签墙。 */

function isNarrow() {
  return isMobileWidth()
}

function openNotes() {
  if (isNarrow()) { showStickyBoard.value = true; return }
  dockRef.value?.open()
}

/** 新建一枚并打开。钉住是为了让它直接出现在停靠区 —— 「新建后看不见」最让人困惑 */
function createNote() {
  if (isNarrow()) {
    showStickyBoard.value = true
    notesStore.create('', { pinned: true })
    return
  }
  dockRef.value?.createAndOpen()
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
  else if (name === 'stickyBoard') showStickyBoard.value = true
  else if (name === 'noteNew') createNote()
  else if (name === 'bookmarkImport') { showSettings.value = false; showBookmarkImport.value = true }
  else if (name === 'shortcuts') nextTick(() => shortcutsRef.value?.open())
  else if (name === 'pipeline') pipelineOpenToken.value++
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
  // 单站删除也入撤销栈：这样 Ctrl+Z 撤的总是「刚刚那件破坏性的事」，
  // 而不是「上一次批量操作」—— 撤销键的含义不该随操作规模变化。
  undoableDelete({
    ids: [site.id],
    label: '删除',
    forward: list => sitesStore.deleteSite(list[0]),
    message: () => `已把「${site.name}」移入回收站`,
  })
}

/* ---- 路由 ⇄ 状态：路由是唯一事实来源 ---- */

// 范围（Axis 1）：由路由名派生，不再作为独立可写状态
/*
 * 路由同步 / 生命周期 / 云端状态文案已抽到 composables：
 *   - useRouteSync      路由 ↔ store（范围 / 分类 / 用途 / 搜索四个轴）
 *   - useAppLifecycle   云端轮询、可见性与联网事件、快捷键、备注上行、chunk 预热
 *   - useCloudNotice    云端错误码 → 人话（含 402 的处理指引）
 */
const { scope, isStandalone } = useRouteSync()

useAppLifecycle({
  sitesStore,
  clicksStore,
  sidebarStore,
  preferencesStore,
  notesStore,
  siteNotesStore,
  commandPaletteRef,
  undoLast,
  createNote,
  showStickyBoard,
  loadAutoAdd,
})

const { cloudNotice } = useCloudNotice()
</script>

