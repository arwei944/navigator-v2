<template>
  <svg class="omni-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-for="(el, i) in shape" :key="i">
      <path v-if="el[0] === 'path'" :d="el[1]" />
      <line v-else-if="el[0] === 'line'" :x1="el[1]" :y1="el[2]" :x2="el[3]" :y2="el[4]" />
      <circle v-else-if="el[0] === 'circle'" :cx="el[1]" :cy="el[2]" :r="el[3]" />
      <polyline v-else-if="el[0] === 'polyline'" :points="el[1]" />
      <rect v-else-if="el[0] === 'rect'" :x="el[1]" :y="el[2]" :width="el[3]" :height="el[4]" :rx="el[5] || 0" />
    </template>
  </svg>
</template>

<script setup>
import { computed } from 'vue'

/**
 * 全能框图标表。
 * 形状写成数组而不是 v-html 字符串：项目里高亮刻意用 splitHighlight 替代 v-html，
 * 图标同理保持「模板只渲染元素、不注入字符串」的一致口径。
 */
const SHAPES = {
  home: [['path', 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'], ['polyline', '9 22 9 12 15 12 15 22']],
  star: [['path', 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z']],
  clock: [['circle', 12, 12, 10], ['polyline', '12 6 12 12 16 14']],
  archive: [['polyline', '21 8 21 21 3 21 3 8'], ['rect', 1, 3, 22, 5, 1], ['line', 10, 12, 14, 12]],
  feed: [['rect', 3, 3, 18, 18, 2], ['line', 3, 9, 21, 9], ['line', 8, 21, 8, 9]],
  trash: [['polyline', '3 6 5 6 21 6'], ['path', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2']],
  settings: [
    ['circle', 12, 12, 3],
    ['path', 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z']
  ],
  sun: [
    ['circle', 12, 12, 5],
    ['line', 12, 1, 12, 3], ['line', 12, 21, 12, 23],
    ['line', 4.22, 4.22, 5.64, 5.64], ['line', 18.36, 18.36, 19.78, 19.78],
    ['line', 1, 12, 3, 12], ['line', 21, 12, 23, 12],
    ['line', 4.22, 19.78, 5.64, 18.36], ['line', 18.36, 5.64, 19.78, 4.22]
  ],
  moon: [['path', 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z']],
  layout: [['rect', 3, 3, 7, 7, 1], ['rect', 14, 3, 7, 7, 1], ['rect', 3, 14, 7, 7, 1], ['rect', 14, 14, 7, 7, 1]],
  sort: [['line', 3, 6, 13, 6], ['line', 3, 12, 11, 12], ['line', 3, 18, 9, 18]],
  card: [['rect', 3, 4, 18, 6, 1], ['rect', 3, 14, 18, 6, 1]],
  palette: [['circle', 12, 12, 9], ['circle', 9, 9, 1.4], ['circle', 15, 9, 1.4], ['circle', 9, 15, 1.4]],
  search: [['circle', 11, 11, 8], ['line', 21, 21, 16.65, 16.65]],
  panel: [['rect', 3, 3, 18, 18, 2], ['line', 9, 3, 9, 21]],
  plus: [['line', 12, 5, 12, 19], ['line', 5, 12, 19, 12]],
  import: [['path', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'], ['polyline', '17 8 12 3 7 8'], ['line', 12, 3, 12, 15]],
  todo: [['path', 'M9 11l3 3L22 4'], ['path', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11']],
  check: [['polyline', '22 4 12 14.01 9 11.01'], ['path', 'M22 11.08V12a10 10 0 1 1-5.93-9.14']],
  drag: [
    ['line', 8, 6, 21, 6], ['line', 8, 12, 21, 12], ['line', 8, 18, 21, 18],
    ['line', 3, 6, 3.01, 6], ['line', 3, 12, 3.01, 12], ['line', 3, 18, 3.01, 18]
  ],
  close: [['line', 18, 6, 6, 18], ['line', 6, 6, 18, 18]],
  external: [['path', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'], ['polyline', '15 3 21 3 21 9'], ['line', 10, 14, 21, 3]],
  info: [['circle', 12, 12, 10], ['line', 12, 16, 12, 12], ['line', 12, 8, 12.01, 8]],
  copy: [['rect', 9, 9, 13, 13, 2], ['path', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1']],
  pin: [['line', 12, 17, 12, 22], ['path', 'M5 17h14l-2-6V4h-2v7H9V4H7v7z']],
  edit: [['path', 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7'], ['path', 'M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z']],
  keyboard: [['rect', 2, 4, 20, 16, 2], ['line', 6, 8, 18, 8], ['line', 6, 12, 18, 12], ['line', 6, 16, 12, 16]],
  filter: [['polyline', '22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3']]
}

const props = defineProps({
  name: { type: String, default: '' }
})

const shape = computed(() => SHAPES[props.name] || [])
</script>

<style scoped>
.omni-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
</style>
