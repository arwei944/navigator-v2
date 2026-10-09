<template>
  <Teleport to="body">
    <div v-if="visible" class="shortcuts-overlay" @click.self="close">
      <div class="shortcuts-panel">
        <div class="shortcuts-header">
          <h3 class="shortcuts-title">键盘快捷键</h3>
          <button class="shortcuts-close" @click="close" aria-label="关闭">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="shortcuts-body">
          <div class="shortcut-row" v-for="item in shortcuts" :key="item.id">
            <span class="shortcut-label">{{ item.label }}</span>
            <kbd class="shortcut-key">{{ item.key }}</kbd>
          </div>
        </div>
        <div class="shortcuts-footer">
          按 <kbd class="shortcut-key">Escape</kbd> 或点击空白区域关闭
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const visible = ref(false)

// 这几条必须与真实绑定一致：此前 Ctrl+D 写了却没实现，是纯误导
const shortcuts = [
  { id: 'omni', label: '打开全能框（命令）', key: 'Ctrl+K' },
  { id: 'search', label: '聚焦顶部搜索框', key: 'Ctrl+F' },
  { id: 'theme', label: '切换主题', key: 'Ctrl+D' },
  { id: 'shortcuts', label: '查看快捷键', key: '?' },
  { id: 'close', label: '关闭面板/弹窗', key: 'Escape' },
]

function open() {
  visible.value = true
}

function close() {
  visible.value = false
}

function handleKeydown(e) {
  // ? key shows shortcuts
  if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // Don't trigger if user is typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
      return
    }
    e.preventDefault()
    visible.value = !visible.value
    return
  }

  // Escape closes the panel
  if (e.key === 'Escape' && visible.value) {
    close()
  }
}

// 全能框的「查看快捷键」命令直接调 open()，不再靠伪造 KeyboardEvent 绕一圈
defineExpose({ open, close })

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<style scoped>
.shortcuts-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.15s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.shortcuts-panel {
  background: var(--bg-white);
  border-radius: var(--radius-lg);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  width: 380px;
  max-width: 90vw;
  overflow: hidden;
  animation: slideUp 0.2s ease;
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

.shortcuts-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border);
}

.shortcuts-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.shortcuts-close {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  transition: all var(--transition);
}

.shortcuts-close:hover {
  background: var(--border-light);
  color: var(--text-primary);
}

.shortcuts-close svg {
  width: 16px;
  height: 16px;
}

.shortcuts-body {
  padding: 8px 0;
}

.shortcut-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  transition: background var(--transition);
}

.shortcut-row:hover {
  background: var(--border-light);
}

.shortcut-label {
  font-size: 13px;
  color: var(--text-primary);
}

.shortcut-key {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--border-light);
  border: 1px solid var(--border);
  border-radius: 4px;
  letter-spacing: 0.3px;
  line-height: 1.4;
}

.shortcuts-footer {
  padding: 10px 20px 14px;
  font-size: 12px;
  color: var(--text-secondary);
  border-top: 1px solid var(--border);
  text-align: center;
}

.shortcuts-footer .shortcut-key {
  font-size: 10px;
  padding: 1px 6px;
}
</style>