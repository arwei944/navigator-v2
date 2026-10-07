<template>
  <section class="settings-section">
    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      <span>管理</span>
    </div>
    <div class="setting-row">
      <div class="data-info">
        <span class="data-info-label">管理后台</span>
        <span class="data-info-value">发布热更新、批量操作站点、快照回滚与通知。</span>
      </div>
      <button class="data-btn" @click="$emit('open-admin')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        进入
      </button>
    </div>
  </section>
</template>

<script setup>
defineEmits(['open-admin'])
</script>

<style scoped>
.settings-section { padding: 16px 0; border-bottom: 1px solid var(--border-light); }
.settings-section:last-child { border-bottom: none; }
.section-header { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 14px; }
.section-header svg { width: 16px; height: 16px; color: var(--accent); opacity: 0.8; }
.setting-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; gap: 16px; }
.data-info { display: flex; flex-direction: column; gap: 2px; }
.data-info-label { font-size: 12px; font-weight: 500; color: var(--text-primary); }
.data-info-value { font-size: 11px; color: var(--text-secondary); }
.data-btn { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-white); color: var(--text-primary); font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.15s ease; font-family: var(--font); flex-shrink: 0; }
.data-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-light); }
.data-btn svg { width: 16px; height: 16px; }
</style>