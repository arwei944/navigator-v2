<template>
  <aside class="right-sidebar" :class="{ collapsed: sidebarStore.rightCollapsed }"
         :style="{ width: panelWidth, minWidth: panelWidth }"
         role="complementary" aria-label="站点详情">
    <!-- 折叠按钮：折叠态面板宽度归零，按钮靠 right 定位挂在视口右缘（见样式说明），
         因此不会像之前那样被 display:none 藏掉、导致无法再展开 -->
    <button class="right-collapse-toggle" @click="sidebarStore.toggleRightCollapse()"
            :title="sidebarStore.rightCollapsed ? '展开站点详情' : '折叠站点详情'"
            :aria-label="sidebarStore.rightCollapsed ? '展开站点详情' : '折叠站点详情'"
            :aria-expanded="!sidebarStore.rightCollapsed"
            :class="{ collapsed: sidebarStore.rightCollapsed }">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </button>

    <!-- 图钉（仅 pin 模式）：点击即「拔掉」，面板回到空状态。
         其他模式没有"钉住"概念，所以不显示（避免多一个不知道干嘛的控件）。 -->
    <button v-if="showPin" class="right-pin-toggle" title="取消固定" aria-label="取消固定"
            @click="sidebarStore.clearRight()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
    </button>

    <!-- 管理后台：右栏跟随当前模块（说明 / 概览 / 快捷跳转），而不是站点详情 -->
    <AdminAside v-if="isAdmin" :tab="adminTab" />

    <!-- 站点详情面板 -->
    <SiteDetailPanel v-else-if="site" :site="site" />

    <!-- 空状态 -->
    <div v-else class="empty-state">
      <div class="empty-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
        </svg>
      </div>
      <p class="empty-title">站点详情</p>
      <p class="empty-desc">{{ emptyLines[0] }}<br/>{{ emptyLines[1] }}</p>
    </div>

    <!-- 拖拽调节宽度手柄：折叠时收起（此时没有可调宽度的余地） -->
    <!-- 右栏折叠是「收成 0 宽」（不是图标栏），把手会跟着跑到屏幕最右 —— 所以只在展开时给。
         左栏是图标栏形态，那边连折叠态也留着把手。双击复位到出厂宽度。 -->
    <div
      v-if="!isNarrow && !sidebarStore.rightCollapsed"
      class="right-resize-handle"
      @mousedown="startResize"
      @dblclick="sidebarStore.resetRightWidth()"
      title="拖拽调宽 · 双击复位"
    ></div>
  </aside>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useSidebarStore } from '@/stores/sidebar'
import { usePreferencesStore } from '@/stores/preferences'
import { useSitesStore } from '@/stores/sites'
import SiteDetailPanel from '@/components/right/SiteDetailPanel.vue'
import { defineAsyncComponent } from 'vue'
import { useRoute } from 'vue-router'

/**
 * 管理后台的右栏**异步加载**：它带着 13 个模块的说明文案，静态引入会整块进首屏 ——
 * 实测首屏因此涨到 613.8 KiB，越过 608 的预算线（那条线防的正是这种「顺手带胖首屏」）。
 * 后台不是首屏路径，等真进 /admin 再加载完全来得及。
 */
const AdminAside = defineAsyncComponent(() => import('@/components/right/AdminAside.vue'))

const route = useRoute()
/** 管理后台下右栏换内容：跟着当前 tab 走 */
const isAdmin = computed(() => route.name === 'Admin')
const adminTab = computed(() => String(route.query.tab || 'overview'))

const sidebarStore = useSidebarStore()
const prefs = usePreferencesStore()
const sitesStore = useSitesStore()

/**
 * 面板显示谁：只订阅 sidebar 里的那**一个 id**，内容按 id 现取。
 *
 * 为什么不直接把 `rightSite` 这个对象传下去：`sitesStore.updateSite` 之后
 * `rebuild()` 会为新内容生成**新对象**（memo 的 edit 身份变了），而 `rightSite`
 * 还攥着旧引用 —— 内联编辑保存后面板会停在旧值上，表现为"保存了但没生效"。
 * 按 id 从全量 `sites` 重取即可自动跟上（`sites` 是全量，不受筛选影响）。
 */
const site = computed(() => {
  const cur = sidebarStore.rightSite
  if (!cur) return null
  return sitesStore.sites.find(s => s.id === cur.id) || cur
})

/** 图钉只在 `pin` 模式出现：它是那个模式的"拔掉"动作，其他模式没有"钉住"这个概念 */
const showPin = computed(() => prefs.rightPanelMode === 'pin' && Boolean(site.value))

/** 空状态提示随模式变：`hover` 之外的模式悬停不会打开面板，写「悬停」等于骗人 */
const emptyLines = computed(() => (prefs.rightPanelMode === 'hover'
  ? ['将鼠标悬停到中间栏的卡片上', '即可查看多维度的站点信息']
  : ['在卡片上点右键，选「查看详情」', '即可在此查看并编辑站点']))

// ≤1024px 面板收起不占宽度，≤768px 直接隐藏 —— 触屏无 hover，详情面板在此区间没有入口。
// 宽度改由内联样式下发后，这个断点必须同时由 JS 判断，否则内联宽度会盖掉媒体查询。
// 同步初始化（而非等到 onMounted）是为了避免窄视口下先按默认宽度闪一帧。
const NARROW_QUERY = '(max-width: 1024px)'
const mq = window.matchMedia(NARROW_QUERY)
const isNarrow = ref(mq.matches)
function syncIsNarrow(e) { isNarrow.value = e.matches }

const panelWidth = computed(() =>
  (isNarrow.value || sidebarStore.rightCollapsed) ? '0px' : sidebarStore.rightWidth + 'px'
)

/* ---- 拖拽调节宽度：面板贴右，向左拖是变宽 ---- */
let resizeUnlisten = null

function startResize(e) {
  e.preventDefault()
  const startX = e.clientX
  const startWidth = sidebarStore.rightWidth

  // 同 Sidebar：mousemove 逐次写 store 会让 300 项网格反复重排，合并到一帧一次
  let pendingX = startX
  let raf = 0
  function flush() {
    raf = 0
    sidebarStore.setRightWidth(startWidth + (startX - pendingX))
  }
  function onMove(ev) {
    pendingX = ev.clientX
    if (!raf) raf = requestAnimationFrame(flush)
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    if (raf) { cancelAnimationFrame(raf); raf = 0 }
    sidebarStore.setRightWidth(startWidth + (startX - pendingX))
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'

  resizeUnlisten = onUp
}

onMounted(() => mq.addEventListener('change', syncIsNarrow))

onUnmounted(() => {
  if (resizeUnlisten) resizeUnlisten()
  mq.removeEventListener('change', syncIsNarrow)
})
</script>

<style scoped>
/* 宽度由 store 的 rightWidth 经内联样式下发（默认 280px），这里不再写死宽度，避免两个来源打架 */
.right-sidebar { background: var(--glass-bg); backdrop-filter: blur(var(--glass-blur, 20px)); -webkit-backdrop-filter: blur(var(--glass-blur, 20px)); color: var(--text-sidebar); display: flex; flex-direction: column; padding: 0; overflow-y: auto; overflow-x: hidden; z-index: var(--z-rail); position: relative; border-left: 1px solid var(--border); transition: width var(--dur-slow) cubic-bezier(.4,0,.2,1), min-width var(--dur-slow) cubic-bezier(.4,0,.2,1); }
/* 折叠态：不裁剪 —— 面板宽度归零后，把手靠 right: 0 仍然露在视口右缘。
   宽度本身由 panelWidth 下发，这里只管裁剪与边框。 */
.right-sidebar.collapsed { border-left: none; overflow: visible; }
/* 既然不再裁剪，面板内容必须自己藏起来，否则会溢出盖到主内容区 */
.right-sidebar.collapsed > *:not(.right-collapse-toggle) { display: none; }
/* 折叠/展开把手：贴中间内容区的右侧 —— 即本面板的左边缘、垂直居中、窄长竖条。
   默认极淡（无边框、无底色、30% 不透明度），只在悬停时显形，避免抢视觉焦点。
   折叠态面板宽度归零，left: 0 会把把手推到视口外，所以改锚右缘：此时中间内容区已铺满到视口右缘，
   把手依旧贴在它的右侧。两种状态的形状都遵循「贴分界线那侧是平的、探出来那侧是圆的」。 */
.right-collapse-toggle { position: absolute; top: 50%; left: 0; transform: translateY(-50%); z-index: var(--z-pin); width: 12px; height: 48px; padding: 0; border: none; border-radius: 0 6px 6px 0; background: transparent; color: var(--text-secondary); opacity: .3; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: width var(--dur-base) ease, opacity var(--dur-base) ease, background var(--dur-base) ease, color var(--dur-base) ease; }
.right-collapse-toggle:hover { width: 18px; opacity: 1; background: var(--border-light); color: var(--text-primary); }
.right-collapse-toggle svg { width: 12px; height: 12px; transition: transform var(--dur-slow) ease; }
.right-collapse-toggle.collapsed svg { transform: rotate(180deg); }
.right-collapse-toggle.collapsed { left: auto; right: 0; border-radius: 6px 0 0 6px; }
/* 图钉（仅 pin 模式）：面板右上角。走「有底色但不抢焦点」的调子 ——
   它是那个模式里唯一的"拔掉"入口，不能像折叠把手那样淡到几乎看不见。 */
.right-pin-toggle { position: absolute; top: 10px; right: 10px; z-index: var(--z-pin); width: 26px; height: 26px; padding: 0; border: none; border-radius: 8px; background: var(--border-light); color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all var(--dur-fast) ease; }
.right-pin-toggle:hover { background: var(--accent-light); color: var(--accent); }
.right-pin-toggle svg { width: 13px; height: 13px; }
.empty-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 24px; text-align: center; gap: 8px; }
.empty-icon { width: 48px; height: 48px; border-radius: 16px; background: var(--border-light); display: flex; align-items: center; justify-content: center; color: var(--text-secondary); opacity: 0.5; margin-bottom: 4px; }
.empty-icon svg { width: 24px; height: 24px; }
.empty-title { font-size: 14px; font-weight: 600; color: var(--text-primary); margin: 0; }
.empty-desc { font-size: 12px; color: var(--text-secondary); line-height: 1.6; margin: 0; opacity: 0.7; }

/* 拖拽调节宽度手柄：贴在面板左边缘（与中间栏的分界线上），向左拖变宽。
   z-index 低于折叠把手(20)：两者都贴左边缘，让把手在被覆盖的那 64px 里仍可点。 */
.right-resize-handle { position: absolute; top: 0; left: 0; bottom: 0; width: 6px; z-index: var(--z-handle); cursor: col-resize; background: transparent; transition: background var(--dur-fast) ease; }
.right-resize-handle:hover,
.right-resize-handle:active { background: var(--accent); opacity: .3; }

/* ≤1024 收起（不再占用宽度），≤768 直接隐藏 —— 触屏无 hover，详情面板在此区间没有入口。
   宽度/最小宽度不在这里写，由 panelWidth 统一决定（内联样式会盖过媒体查询）。 */
@media (max-width: 1024px) {
  .right-sidebar { border-left: none; overflow: hidden; }
  .right-collapse-toggle { display: none; }
}
@media (max-width: 768px) {
  .right-sidebar { display: none; }
}
</style>