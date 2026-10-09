<template>
  <Teleport to="body">
    <Transition name="detail-sheet">
      <div v-if="site" class="detail-sheet" role="dialog" aria-modal="true" aria-label="站点详情">
        <div class="detail-sheet-backdrop" @click="close"></div>
        <div class="detail-sheet-panel">
          <div class="detail-sheet-grip" aria-hidden="true"></div>
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
import { computed, onMounted, onUnmounted } from 'vue'
import { useSidebarStore } from '@/stores/sidebar'
import SiteDetailPanel from '@/components/right/SiteDetailPanel.vue'

const sidebarStore = useSidebarStore()
const site = computed(() => sidebarStore.detailSheetSite)

function close() { sidebarStore.closeDetailSheet() }
function onKeydown(e) { if (e.key === 'Escape') close() }

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.detail-sheet { position: fixed; inset: 0; z-index: 900; display: flex; flex-direction: column; justify-content: flex-end; }
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
  width: 30px; height: 30px;
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
