<template>
  <div class="confirm-overlay" @click.self="$emit('cancel')">
    <div class="confirm-dialog">
      <div class="confirm-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      </div>
      <h3 class="confirm-title">{{ title }}</h3>
      <p class="confirm-message">{{ message }}</p>
      <div class="confirm-actions">
        <button class="btn btn-cancel" @click="$emit('cancel')">取消</button>
        <button class="btn btn-danger" @click="$emit('confirm')">{{ confirmText }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, default: '确认操作' },
  message: { type: String, default: '确定要执行此操作吗？' },
  confirmText: { type: String, default: '确认删除' }
})

defineEmits(['confirm', 'cancel'])
</script>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 400;
}
.confirm-dialog {
  background: var(--bg-white);
  border-radius: 12px;
  width: 380px;
  max-width: 90vw;
  padding: 28px 24px 24px;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0,0,0,.2);
}
.confirm-icon {
  width: 48px;
  height: 48px;
  margin: 0 auto 16px;
  color: #ef4444;
}
.confirm-icon svg { width: 48px; height: 48px; }
.confirm-title { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
.confirm-message { font-size: 13px; color: var(--text-secondary); margin-bottom: 24px; line-height: 1.5; }
.confirm-actions { display: flex; justify-content: center; gap: 10px; }
.btn {
  padding: 8px 24px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all .15s ease;
}
.btn-cancel { background: var(--border-light); color: var(--text-secondary); }
.btn-cancel:hover { background: var(--border); }
.btn-danger { background: #ef4444; color: #fff; }
.btn-danger:hover { filter: brightness(1.1); }
</style>