<template>
  <div class="purpose-picker">
    <button
      v-for="tag in tags"
      :key="tag.id"
      type="button"
      class="purpose-chip"
      :class="{ active: isActive(tag.id), disabled: isDisabled(tag.id) }"
      :style="isActive(tag.id) ? { background: tag.color, borderColor: tag.color } : null"
      :disabled="isDisabled(tag.id)"
      :aria-pressed="isActive(tag.id)"
      @click="toggle(tag.id)"
    >
      <span v-if="!isActive(tag.id)" class="purpose-dot" :style="{ background: tag.color }"></span>
      {{ tag.label }}
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { PURPOSE_TAGS, MAX_PURPOSES } from '../../shared/purposes.mjs'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  max: { type: Number, default: MAX_PURPOSES },
})

const emit = defineEmits(['update:modelValue'])

const tags = PURPOSE_TAGS
const selected = computed(() => (Array.isArray(props.modelValue) ? props.modelValue : []))

function isActive(id) {
  return selected.value.includes(id)
}

// 到上限后未选中的标签置灰：允许继续勾会写出第 5 个用途，越过后端上限
function isDisabled(id) {
  return !isActive(id) && selected.value.length >= props.max
}

function toggle(id) {
  if (isDisabled(id)) return
  const next = isActive(id)
    ? selected.value.filter(x => x !== id)
    : [...selected.value, id]
  emit('update:modelValue', next)
}
</script>

<style scoped>
.purpose-picker { display: flex; flex-wrap: wrap; gap: 6px; }
.purpose-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 11px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-white);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  line-height: 1.5;
  cursor: pointer;
  transition: all .15s ease;
}
.purpose-chip:hover:not(.disabled) { border-color: var(--accent); color: var(--accent); }
.purpose-chip.active { color: #fff; }
.purpose-chip.disabled { opacity: .45; cursor: not-allowed; }
.purpose-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
</style>