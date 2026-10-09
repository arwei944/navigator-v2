<template>
  <Teleport to="body">
    <div v-if="visible" class="cp-overlay" @click.self="close" @keydown="onOverlayKeydown">
      <div class="cp-panel">
        <div class="cp-search-wrap">
          <svg class="cp-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input ref="inputRef" v-model="raw" class="cp-input"
                 :placeholder="page ? '筛选站点操作…' : '搜索站点、命令、页面…（> 命令 / @ 站点 / / 页面）'"
                 aria-label="全能框"
                 @keydown="onKeydown">
          <kbd class="cp-hint">ESC</kbd>
        </div>

        <OmniResults
          :groups="groups"
          :selected-index="selectedIndex"
          :query="trimmed"
          :breadcrumb="breadcrumb"
          :empty="empty"
          @select="onSelect"
          @hover="setSelected"
          @back="back"
        />

        <div class="cp-hints">
          <kbd>↑↓</kbd> 导航 <kbd>⏎</kbd> 执行 <kbd>⇥</kbd> 站点操作 <kbd>⌫</kbd> 返回
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { nextTick, ref } from 'vue'
import { useOmniBox } from '@/composables/useOmniBox'
import OmniResults from '@/components/OmniResults.vue'

const visible = ref(false)
const inputRef = ref(null)

const omni = useOmniBox({ mode: 'palette', onDone: () => close() })
const {
  raw, trimmed, groups, selectedIndex, empty, breadcrumb, page,
  moveDown, moveUp, enter, tab, backspace, back, reset
} = omni

function open() {
  visible.value = true
  reset()
  nextTick(() => inputRef.value?.focus())
}

function close() {
  visible.value = false
  reset()
}

function onSelect(item) {
  item.run?.()
  close()
}

// 鼠标悬停即改选中项（同 UnifiedSearchBox，不依赖模板对 ref 的赋值解包）
function setSelected(i) {
  selectedIndex.value = i
}

function onKeydown(e) {
  if (e.key === 'Escape') { e.preventDefault(); close(); return }
  if (e.key === 'ArrowDown') { e.preventDefault(); moveDown(); return }
  if (e.key === 'ArrowUp') { e.preventDefault(); moveUp(); return }
  if (e.key === 'Enter') { e.preventDefault(); enter(); return }
  if (e.key === 'Tab') { if (tab()) e.preventDefault(); return }
  if (e.key === 'Backspace') { if (backspace()) e.preventDefault() }
}

// 面板内任意位置的 Escape 都能关（输入框失焦时上面那个 @keydown 就够不着了）
function onOverlayKeydown(e) {
  if (e.key === 'Escape') { e.preventDefault(); close() }
}

defineExpose({ open, close })
</script>

<style scoped>
.cp-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 15vh 16px 16px;
}
.cp-panel {
  width: 580px;
  max-width: 100%;
  max-height: 70vh;
  background: var(--bg-white);
  border-radius: var(--radius-lg);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  animation: cp-slide-up 0.2s ease;
}
/* 只动 transform，不用 opacity 起帧：动画时钟不推进的环境里 opacity:0 会让面板永久透明 */
@keyframes cp-slide-up {
  from { transform: translateY(-8px) scale(0.98); }
}
@media (prefers-reduced-motion: reduce) { .cp-panel { animation: none; } }

.cp-search-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.cp-search-icon { width: 18px; height: 18px; flex-shrink: 0; color: var(--text-secondary); }
.cp-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 15px;
  font-family: var(--font);
  color: var(--text-primary);
  background: transparent;
  min-width: 0;
}
.cp-input::placeholder { color: var(--text-secondary); }
.cp-hint {
  font-size: 11px;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-secondary);
  background: var(--border-light);
  font-family: inherit;
  line-height: 1.4;
  flex-shrink: 0;
}

.cp-hints {
  padding: 8px 16px;
  border-top: 1px solid var(--border);
  text-align: center;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.cp-hints kbd {
  font-size: 10px;
  padding: 1px 5px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--border-light);
  color: var(--text-secondary);
  font-family: inherit;
  line-height: 1.4;
}

@media (max-width: 768px) {
  .cp-overlay { padding: 8vh 12px 12px; }
  .cp-panel { max-height: 76vh; }
}
</style>
