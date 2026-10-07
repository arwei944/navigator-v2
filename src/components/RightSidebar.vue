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

    <!-- 站点详情面板 -->
    <SiteDetailPanel v-if="site" :site="site" />

    <!-- 空状态 -->
    <div v-else class="empty-state">
      <div class="empty-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
        </svg>
      </div>
      <p class="empty-title">站点详情</p>
      <p class="empty-desc">将鼠标悬停到中间栏的卡片上<br/>即可查看多维度的站点信息</p>
    </div>

    <!-- 拖拽调节宽度手柄：折叠时收起（此时没有可调宽度的余地） -->
    <div v-if="!sidebarStore.rightCollapsed" class="right-resize-handle" @mousedown="startResize" title="拖拽调节宽度"></div>
  </aside>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useSidebarStore } from '@/stores/sidebar'
import SiteDetailPanel from '@/components/right/SiteDetailPanel.vue'

const sidebarStore = useSidebarStore()
const site = computed(() => sidebarStore.hoveredSite)

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

  function onMove(ev) {
    sidebarStore.setRightWidth(startWidth + (startX - ev.clientX))
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

onMounted(() => mq.addEventListener('change', syncIsNarrow))

onUnmounted(() => {
  if (resizeUnlisten) resizeUnlisten()
  mq.removeEventListener('change', syncIsNarrow)
})
</script>

<style scoped>
/* 宽度由 store 的 rightWidth 经内联样式下发（默认 280px），这里不再写死宽度，避免两个来源打架 */
.right-sidebar { background: var(--glass-bg); backdrop-filter: blur(var(--glass-blur, 20px)); -webkit-backdrop-filter: blur(var(--glass-blur, 20px)); color: var(--text-sidebar); display: flex; flex-direction: column; padding: 0; overflow-y: auto; overflow-x: hidden; z-index: 50; position: relative; border-left: 1px solid var(--border); transition: width .28s cubic-bezier(.4,0,.2,1), min-width .28s cubic-bezier(.4,0,.2,1); }
/* 折叠态：不裁剪 —— 面板宽度归零后，把手靠 right: 0 仍然露在视口右缘。
   宽度本身由 panelWidth 下发，这里只管裁剪与边框。 */
.right-sidebar.collapsed { border-left: none; overflow: visible; }
/* 既然不再裁剪，面板内容必须自己藏起来，否则会溢出盖到主内容区 */
.right-sidebar.collapsed > *:not(.right-collapse-toggle) { display: none; }
/* 折叠/展开把手：贴中间内容区的右侧 —— 即本面板的左边缘、垂直居中、窄长竖条。
   默认极淡（无边框、无底色、30% 不透明度），只在悬停时显形，避免抢视觉焦点。
   折叠态面板宽度归零，left: 0 会把把手推到视口外，所以改锚右缘：此时中间内容区已铺满到视口右缘，
   把手依旧贴在它的右侧。两种状态的形状都遵循「贴分界线那侧是平的、探出来那侧是圆的」。 */
.right-collapse-toggle { position: absolute; top: 50%; left: 0; transform: translateY(-50%); z-index: 20; width: 12px; height: 48px; padding: 0; border: none; border-radius: 0 6px 6px 0; background: transparent; color: var(--text-secondary); opacity: .3; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: width .18s ease, opacity .18s ease, background .18s ease, color .18s ease; }
.right-collapse-toggle:hover { width: 18px; opacity: 1; background: var(--border-light); color: var(--text-primary); }
.right-collapse-toggle svg { width: 12px; height: 12px; transition: transform .28s ease; }
.right-collapse-toggle.collapsed svg { transform: rotate(180deg); }
.right-collapse-toggle.collapsed { left: auto; right: 0; border-radius: 6px 0 0 6px; }
.empty-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 24px; text-align: center; gap: 8px; }
.empty-icon { width: 48px; height: 48px; border-radius: 16px; background: var(--border-light); display: flex; align-items: center; justify-content: center; color: var(--text-secondary); opacity: 0.5; margin-bottom: 4px; }
.empty-icon svg { width: 24px; height: 24px; }
.empty-title { font-size: 14px; font-weight: 600; color: var(--text-primary); margin: 0; }
.empty-desc { font-size: 12px; color: var(--text-secondary); line-height: 1.6; margin: 0; opacity: 0.7; }

/* 拖拽调节宽度手柄：贴在面板左边缘（与中间栏的分界线上），向左拖变宽。
   z-index 低于折叠把手(20)：两者都贴左边缘，让把手在被覆盖的那 64px 里仍可点。 */
.right-resize-handle { position: absolute; top: 0; left: 0; bottom: 0; width: 6px; z-index: 10; cursor: col-resize; background: transparent; transition: background .15s ease; }
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