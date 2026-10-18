<template>
  <Teleport to="body">
    <Transition name="detail-sheet">
      <div v-if="site" class="detail-sheet" role="dialog" aria-modal="true" aria-label="站点详情">
        <div class="detail-sheet-backdrop" @click="close"></div>
        <div class="detail-sheet-panel" :style="dragOffset ? { transform: `translateY(${dragOffset}px)`, transition: 'none' } : null">
          <div class="detail-sheet-grip" aria-hidden="true"
               @touchstart.passive="onGripStart" @touchmove.passive="onGripMove" @touchend="onGripEnd"></div>
          <button type="button" class="detail-sheet-close" aria-label="关闭详情" @click="close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
          <div class="detail-sheet-body">
            <SiteDetailPanel :site="site" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useSidebarStore } from '@/stores/sidebar'
import SiteDetailPanel from '@/components/right/SiteDetailPanel.vue'

const sidebarStore = useSidebarStore()
const site = computed(() => sidebarStore.detailSheetSite)

function close() { sidebarStore.closeDetailSheet() }

/* F4 手势：拖拽条下滑关闭。只绑在顶部 grip 上，不绑整个面板 ——
   抽屉内容是可滚动的，在内容区监听纵向拖动会把「滚动」与「关闭」搅在一起。 */
const dragOffset = ref(0)
let gripStartY = 0
function onGripStart(e) { gripStartY = e.touches?.[0]?.clientY ?? 0 }
function onGripMove(e) {
  const y = e.touches?.[0]?.clientY ?? 0
  dragOffset.value = Math.max(0, y - gripStartY)
}
function onGripEnd() {
  if (dragOffset.value > 80) close()
  dragOffset.value = 0
}
function onKeydown(e) { if (e.key === 'Escape') close() }

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.detail-sheet { position: fixed; inset: 0; z-index: var(--z-sheet); display: flex; flex-direction: column; justify-content: flex-end; }
.detail-sheet-backdrop { position: absolute; inset: 0; background: rgba(0, 0, 0, .45); }
.detail-sheet-panel {
  position: relative;
  background: var(--bg-white);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 -8px 32px rgba(0, 0, 0, .22);
  padding-bottom: env(safe-area-inset-bottom);
}
.detail-sheet-grip { width: 40px; height: 4px; border-radius: 999px; background: var(--border); margin: 8px auto 0; flex-shrink: 0; }
.detail-sheet-close {
  position: absolute; top: 10px; right: 12px;
  /* F4：触摸目标 ≥44px（WCAG 2.5.5）—— 原 30px 偏小，指腹容易点偏 */
  width: 44px; height: 44px;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--border); border-radius: 50%;
  background: var(--bg-white); color: var(--text-secondary);
  cursor: pointer;
}
.detail-sheet-close svg { width: 14px; height: 14px; }
.detail-sheet-body { overflow-y: auto; overscroll-behavior: contain; }
/* SiteDetailPanel 自带 48px 顶距是为右侧面板的折叠按钮让位，抽屉里不需要 */
.detail-sheet-body :deep(.site-detail-panel) { padding-top: 12px; }

.detail-sheet-enter-active, .detail-sheet-leave-active { transition: opacity .2s ease; }
.detail-sheet-enter-active .detail-sheet-panel, .detail-sheet-leave-active .detail-sheet-panel { transition: transform .24s cubic-bezier(.4, 0, .2, 1); }
.detail-sheet-enter-from, .detail-sheet-leave-to { opacity: 0; }
.detail-sheet-enter-from .detail-sheet-panel, .detail-sheet-leave-to .detail-sheet-panel { transform: translateY(100%); }
@media (prefers-reduced-motion: reduce) {
  .detail-sheet-enter-active, .detail-sheet-leave-active,
  .detail-sheet-enter-active .detail-sheet-panel, .detail-sheet-leave-active .detail-sheet-panel { transition: none; }
}
</style>
