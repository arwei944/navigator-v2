<template>
  <Teleport to="body">
    <div class="toast-host" role="status" aria-live="polite">
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
import { useToastStore } from '@/stores/toast'

const toastStore = useToastStore()

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
  z-index: 700;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  max-width: 96vw;
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
  transition: opacity .15s ease;
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

.toast-enter-active, .toast-leave-active { transition: all .25s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(12px); }
.toast-move { transition: transform .25s ease; }

/* 移动端抬到 tab 栏与批量栏之上，否则会被盖住 */
@media (max-width: 768px) {
  .toast-host { bottom: calc(76px + env(safe-area-inset-bottom)); }
}
@media (prefers-reduced-motion: reduce) {
  .toast-enter-active, .toast-leave-active, .toast-move { transition: none; }
}
</style>
