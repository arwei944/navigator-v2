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
          <!-- 分组：项目所有「和视觉有关」的设置都收在「外观」这一组 ——
               配色与明暗（主题）、视觉方案（令牌微调）、显示密度、卡片与布局。
               组标题让人一眼知道「视觉都在这里改」，不必在平铺列表里翻找。 -->
          <section class="settings-group">
            <h3 class="group-title">外观</h3>
            <p class="group-hint">配色、明暗、视觉方案与卡片布局 —— 全站视觉都在这里改</p>

            <!-- 主题是「配色 + 形状 + 明暗」的统一入口，放在最上面；
                 下面两个分区是它的原料（配色预设与令牌微调），保留给要细调的人。 -->
            <ThemeSection @open-editor="$emit('open-theme-editor')" />
            <VisualSchemeSection />
            <DisplaySection />

            <!-- 卡片设置原先只有工具栏一个入口，是块「孤岛」；这里补一个直达入口，
                 让「外观」这一组真正覆盖卡片布局。点击先关设置再开抽屉，避免双层浮层叠加。 -->
            <button class="group-entry" @click="openCardSettings">
              <svg class="group-entry-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
              <span class="group-entry-text">
                <span class="group-entry-label">卡片与布局</span>
                <span class="group-entry-desc">排列方式 · 卡片大小 · 显示的元素</span>
              </span>
              <svg class="group-entry-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </section>

          <section class="settings-group">
            <h3 class="group-title">功能</h3>
            <BgmSection />
            <RightSidebarSection />
            <SessionSyncSection @open-import="$emit('open-import')" />
          </section>

          <section class="settings-group">
            <h3 class="group-title">系统</h3>
            <AdminSection @open-admin="$emit('open-admin')" />
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import ThemeSection from '@/components/settings/ThemeSection.vue'
import VisualSchemeSection from '@/components/settings/VisualSchemeSection.vue'
import DisplaySection from '@/components/settings/DisplaySection.vue'
import BgmSection from '@/components/settings/BgmSection.vue'
import RightSidebarSection from '@/components/settings/RightSidebarSection.vue'
import SessionSyncSection from '@/components/settings/SessionSyncSection.vue'
import AdminSection from '@/components/settings/AdminSection.vue'

const emit = defineEmits(['close', 'open-import', 'open-admin', 'open-theme-editor', 'open-card-settings'])

function close() {
  // emit('close') 由父组传入的 handler；这里通过 emits 声明触发
  emit('close')
}

/** 「卡片与布局」入口：先关设置面板再开卡片抽屉，避免两层浮层叠在一起 */
function openCardSettings() {
  emit('open-card-settings')
  emit('close')
}
</script>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
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
  transition: all var(--dur-fast) ease;
}
.settings-close:hover { background: var(--accent-light); color: var(--accent); }
.settings-close svg { width: 18px; height: 18px; }
.settings-body { padding: 8px 24px 24px; overflow-y: auto; flex: 1; }

/* 分组：把「和视觉有关」的设置归到一组，与功能 / 系统分开。
   组标题比各分节自己的标题更大更醒目，形成「组 → 节」两级层次，不再是平铺一长条。 */
.settings-group { margin-bottom: 28px; }
.settings-group:last-child { margin-bottom: 0; }
.group-title {
  font-size: 13px; font-weight: 700; letter-spacing: .04em;
  color: var(--text-primary);
  padding-bottom: 8px; margin-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
.group-hint { font-size: 12px; line-height: 1.5; color: var(--text-secondary); margin: -6px 0 12px; }

/* 「外观」组里的直达入口：一行可点卡片，补上卡片设置这块孤岛 */
.group-entry {
  display: flex; align-items: center; gap: 12px;
  width: 100%; padding: 12px 14px; margin-top: 10px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--bg-white); color: var(--text-primary);
  cursor: pointer; text-align: left;
  transition: border-color var(--transition), background var(--transition);
}
.group-entry:hover { border-color: var(--accent); background: var(--accent-light); }
.group-entry-icon { width: 20px; height: 20px; flex-shrink: 0; color: var(--accent); }
.group-entry-text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.group-entry-label { font-size: 13px; font-weight: 600; }
.group-entry-desc { font-size: 11.5px; color: var(--text-secondary); }
.group-entry-arrow { width: 16px; height: 16px; flex-shrink: 0; color: var(--text-secondary); }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp { from { opacity: 0; transform: translateY(16px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
</style>