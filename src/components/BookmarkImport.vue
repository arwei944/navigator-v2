<template>
  <Teleport to="body">
    <div class="bm-overlay" @click.self="$emit('close')">
      <div class="bm-modal">
        <div class="bm-header">
          <h3>书签管理</h3>
          <button class="close-btn" @click="$emit('close')" aria-label="关闭">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div class="tabs">
          <button class="tab" :class="{ active: activeTab === 'import' }" @click="activeTab = 'import'">导入</button>
          <button class="tab" :class="{ active: activeTab === 'export' }" @click="activeTab = 'export'">导出</button>
        </div>

        <ImportPanel v-if="activeTab === 'import'" />
        <ExportPanel v-else-if="activeTab === 'export'" />
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref } from 'vue'
import ImportPanel from '@/components/bookmarks/ImportPanel.vue'
import ExportPanel from '@/components/bookmarks/ExportPanel.vue'

defineEmits(['close'])
const activeTab = ref('import')
</script>

<style scoped>
.bm-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(0, 0, 0, 0.45); display: flex; align-items: center; justify-content: center; animation: fadeIn 0.2s ease; }
.bm-modal { background: var(--bg-white); border-radius: var(--radius-lg); width: 520px; max-width: 90vw; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15); animation: slideUp 0.25s ease; }
.bm-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px 0; }
.bm-header h3 { font-size: 16px; font-weight: 600; color: var(--text-primary); }
.close-btn { width: 32px; height: 32px; border: none; background: transparent; border-radius: var(--radius-sm); color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background var(--transition); }
.close-btn:hover { background: var(--accent-light); color: var(--accent); }
.tabs { display: flex; gap: 0; padding: 16px 24px 0; border-bottom: 1px solid var(--border); margin-bottom: 0; }
.tab { padding: 10px 20px; font-size: 13px; font-weight: 500; border: none; background: transparent; color: var(--text-secondary); cursor: pointer; position: relative; transition: color var(--transition); }
.tab::after { content: ''; position: absolute; bottom: -1px; left: 0; right: 0; height: 2px; background: transparent; border-radius: 1px; transition: background var(--transition); }
.tab.active { color: var(--accent); font-weight: 600; }
.tab.active::after { background: var(--accent); }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp { from { opacity: 0; transform: translateY(16px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
</style>