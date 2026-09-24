<template>
  <aside class="right-sidebar" :class="{ collapsed: sidebarStore.rightCollapsed }" role="complementary" aria-label="站点详情">
    <!-- 折叠按钮 -->
    <button class="right-collapse-toggle" @click="sidebarStore.toggleRightCollapse()"
            :title="sidebarStore.rightCollapsed ? '展开右侧面板' : '折叠右侧面板'"
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
  </aside>
</template>

<script setup>
import { computed } from 'vue'
import { useSidebarStore } from '@/stores/sidebar'
import SiteDetailPanel from '@/components/right/SiteDetailPanel.vue'

const sidebarStore = useSidebarStore()
const site = computed(() => sidebarStore.hoveredSite)
</script>

<style scoped>
.right-sidebar { width: 280px; min-width: 280px; background: var(--glass-bg); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); color: var(--text-sidebar); display: flex; flex-direction: column; padding: 0; overflow-y: auto; overflow-x: hidden; z-index: 50; position: relative; border-left: 1px solid var(--border); transition: width .28s cubic-bezier(.4,0,.2,1), min-width .28s cubic-bezier(.4,0,.2,1); }
.right-sidebar.collapsed { width: 0; min-width: 0; border-left: none; overflow: hidden; }
.right-collapse-toggle { position: absolute; top: 12px; left: 8px; z-index: 20; width: 28px; height: 28px; border: none; background: transparent; border-radius: 6px; color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease; }
.right-collapse-toggle:hover { background: var(--accent-light); color: var(--accent); }
.right-collapse-toggle svg { width: 16px; height: 16px; transition: transform 0.28s ease; }
.right-collapse-toggle.collapsed svg { transform: rotate(180deg); }
.right-sidebar.collapsed .right-collapse-toggle { display: none; }
.empty-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 24px; text-align: center; gap: 8px; }
.empty-icon { width: 48px; height: 48px; border-radius: 16px; background: var(--border-light); display: flex; align-items: center; justify-content: center; color: var(--text-secondary); opacity: 0.5; margin-bottom: 4px; }
.empty-icon svg { width: 24px; height: 24px; }
.empty-title { font-size: 14px; font-weight: 600; color: var(--text-primary); margin: 0; }
.empty-desc { font-size: 12px; color: var(--text-secondary); line-height: 1.6; margin: 0; opacity: 0.7; }
</style>