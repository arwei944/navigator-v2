<template>
  <Teleport to="body">
    <div class="settings-overlay" @click.self="close" @keydown.escape="close">
      <div class="settings-modal">
        <div class="settings-header">
          <h2 class="settings-title">设置</h2>
          <button class="settings-close" @click="close" aria-label="关闭">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="settings-body">
          <!-- 主题是「配色 + 形状 + 明暗」的统一入口，放在最上面；
               下面两个分区是它的原料（配色预设与令牌微调），保留给要细调的人。 -->
          <ThemeSection @open-editor="$emit('open-theme-editor')" />
          <VisualSchemeSection />
          <DisplaySection />
          <SessionSyncSection @open-import="$emit('open-import')" />
          <AdminSection @open-admin="$emit('open-admin')" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import ThemeSection from '@/components/settings/ThemeSection.vue'
import VisualSchemeSection from '@/components/settings/VisualSchemeSection.vue'
import DisplaySection from '@/components/settings/DisplaySection.vue'
import SessionSyncSection from '@/components/settings/SessionSyncSection.vue'
import AdminSection from '@/components/settings/AdminSection.vue'

const emit = defineEmits(['close', 'open-import', 'open-admin', 'open-theme-editor'])

function close() {
  // emit('close') 由父组传入的 handler；这里通过 emits 声明触发
  emit('close')
}
</script>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.2s ease;
}
.settings-modal {
  background: var(--bg-white);
  border-radius: 16px;
  width: 540px;
  max-width: 92vw;
  max-height: 85vh;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
  animation: slideUp 0.25s ease;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.settings-title { font-size: 17px; font-weight: 600; color: var(--text-primary); }
.settings-close {
  width: 32px; height: 32px; border: none; background: transparent; border-radius: 8px;
  color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.15s ease;
}
.settings-close:hover { background: var(--accent-light); color: var(--accent); }
.settings-close svg { width: 18px; height: 18px; }
.settings-body { padding: 8px 24px 24px; overflow-y: auto; flex: 1; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp { from { opacity: 0; transform: translateY(16px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
</style>