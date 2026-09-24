<template>
  <div class="cp-search-wrap">
    <svg class="cp-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
    <input
      ref="inputRef"
      :value="query"
      class="cp-input"
      placeholder="搜索站点、页面、分类..."
      @input="emit('update:query', $event.target.value)"
      @keydown="emit('keydown', $event)"
    />
    <kbd class="cp-hint">ESC</kbd>
  </div>
</template>

<script setup>
import { ref } from 'vue'

defineProps({
  query: { type: String, default: '' }
})
const emit = defineEmits(['update:query', 'keydown'])

const inputRef = ref(null)
function focus() {
  inputRef.value?.focus()
}
defineExpose({ focus })
</script>

<style scoped>
.cp-search-wrap { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
.cp-search-icon { width: 18px; height: 18px; flex-shrink: 0; color: var(--text-secondary); }
.cp-input { flex: 1; border: none; outline: none; font-size: 15px; font-family: var(--font); color: var(--text-primary); background: transparent; }
.cp-input::placeholder { color: var(--text-secondary); }
.cp-hint { font-size: 11px; padding: 2px 6px; border: 1px solid var(--border); border-radius: 4px; color: var(--text-secondary); background: var(--border-light); font-family: inherit; line-height: 1.4; flex-shrink: 0; }
</style>