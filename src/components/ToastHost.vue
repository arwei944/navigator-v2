<template>
  <Teleport to="body">
    <div class="toast-host" :class="{ 'above-batch-bar': batchBarVisible }" role="status" aria-live="polite">
      <TransitionGroup name="toast">
        <div v-for="t in toastStore.items" :key="t.id"
             class="toast" :class="'toast-' + t.tone"
             @mouseenter="toastStore.pause(t.id)" @mouseleave="toastStore.resume(t.id)">
          <span class="toast-msg">{{ t.message }}</span>
          <button v-if="t.actionLabel" class="toast-action" @click="runAction(t)">{{ t.actionLabel }}</button>
          <button class="toast-close" aria-label="关闭提示" @click="toastStore.dismiss(t.id)">×</button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup>
import { computed } from 'vue'
import { useToastStore } from '@/stores/toast'
import { useSitesStore } from '@/stores/sites'

const toastStore = useToastStore()
const sitesStore = useSitesStore()

/**
 * 批量栏挡在底部时把提示抬上去。
 *
 * 批量栏（z-index 200）与提示（700）都贴在底边，提示按设计压在批量栏之上 ——
 * 于是「已置顶 3 个站点 · 撤销」这几秒里，它正好盖住批量栏中间的按钮。
 * 以前提示 4~5 秒就自动消失，问题一闪而过；而撤销提示是**用户要读、要点的**，
 * 盖住「置顶 / 归档 / 改分类」就成了实打实的误点与点不到。
 * 抬高偏移量与批量栏自身的几何是同一套数（见 CardsContainer 的 .batch-bar / 移动端媒体查询）。
 */
const batchBarVisible = computed(() => sitesStore.batchMode && sitesStore.selectedIds.size > 0)

function runAction(t) {
  toastStore.dismiss(t.id)
  if (typeof t.onAction === 'function') t.onAction()
}
</script>

<style scoped>
/* 底部居中；z-index 高于右键菜单(500)与批量栏(200)，任何弹窗出现时都压得住 */
.toast-host {
  position: fixed;
  left: 50%;
  bottom: calc(24px + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  max-width: 96vw;
  transition: bottom var(--dur-base) ease;
}
/* 批量栏在下方时抬到它之上：59px（批量栏自身高度 = 14 上下内边距 + 31 控件）＋ 12 间隙 ＋ 原 24 */
.toast-host.above-batch-bar { bottom: calc(95px + env(safe-area-inset-bottom)); }
@media (max-width: 768px) {
  /* 移动端批量栏被抬到 tab 栏之上（bottom: 56px），提示要再高一层 */
  .toast-host.above-batch-bar { bottom: calc(176px + env(safe-area-inset-bottom)); }
}
.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(92vw, 560px);
  padding: 10px 14px;
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-left-width: 3px;
  border-radius: var(--radius-sm);
  box-shadow: 0 8px 30px rgba(0, 0, 0, .16);
  font-size: 13px;
  color: var(--text-primary);
}
.toast-ok { border-left-color: #22c55e; }
.toast-info { border-left-color: var(--accent); }
.toast-error { border-left-color: #ef4444; }
.toast-msg { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.toast-action {
  flex-shrink: 0;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  cursor: pointer;
  transition: opacity var(--dur-fast) ease;
}
.toast-action:hover { opacity: .85; }
.toast-close {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.toast-close:hover { color: var(--text-primary); }

.toast-enter-active, .toast-leave-active { transition: all var(--dur-base) ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(12px); }
.toast-move { transition: transform var(--dur-base) ease; }

/* 移动端抬到 tab 栏与批量栏之上，否则会被盖住 */
@media (max-width: 768px) {
  .toast-host { bottom: calc(76px + env(safe-area-inset-bottom)); }
}
@media (prefers-reduced-motion: reduce) {
  .toast-enter-active, .toast-leave-active, .toast-move { transition: none; }
}
</style>
