<template>
  <div v-if="items.length" class="purpose-tags" :class="'is-' + size">
    <span
      v-for="tag in items"
      :key="tag.id"
      class="purpose-tag"
      :style="{ '--tag-color': tag.color }"
      :title="tag.label"
    >{{ tag.label }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { PURPOSE_TAGS, purposeLabel, purposeColor, MAX_PURPOSES } from '../../shared/purposes.mjs'

const props = defineProps({
  ids: { type: Array, default: () => [] },
  size: { type: String, default: 'sm' },
  max: { type: Number, default: MAX_PURPOSES },
})

const items = computed(() => {
  const raw = Array.isArray(props.ids) ? props.ids : []
  const out = []
  for (const id of raw) {
    // 词表外的脏值直接丢弃，避免渲染出空标签
    if (!PURPOSE_TAGS.some(t => t.id === id)) continue
    out.push({ id, label: purposeLabel(id), color: purposeColor(id) })
    if (out.length >= props.max) break
  }
  return out
})
</script>

<style scoped>
.purpose-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.purpose-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
  line-height: 1.5;
  white-space: nowrap;
  color: var(--tag-color);
  background: color-mix(in srgb, var(--tag-color) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--tag-color) 26%, transparent);
}
.purpose-tags.is-md .purpose-tag { font-size: 11.5px; padding: 3px 10px; }
</style>