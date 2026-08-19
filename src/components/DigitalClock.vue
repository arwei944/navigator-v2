<template>
  <div class="digital-clock">
    <div class="clock-time">{{ timeString }}</div>
    <div class="clock-date">{{ dateString }}</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  hour24: {
    type: Boolean,
    default: true,
  },
})

const now = ref(new Date())
let timer = null

const DAYS = ['日', '一', '二', '三', '四', '五', '六']

const timeString = computed(() => {
  const d = now.value
  const hh = d.getHours()
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')

  if (props.hour24) {
    return `${String(hh).padStart(2, '0')}:${mm}:${ss}`
  }
  const period = hh >= 12 ? 'PM' : 'AM'
  const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh
  return `${String(h12).padStart(2, '0')}:${mm}:${ss} ${period}`
})

const dateString = computed(() => {
  const d = now.value
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const w = DAYS[d.getDay()]
  return `${y}年${m}月${day}日 星期${w}`
})

function tick() {
  now.value = new Date()
}

onMounted(() => {
  tick()
  timer = setInterval(tick, 1000)
})

onUnmounted(() => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
})
</script>

<style scoped>
.digital-clock {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  user-select: none;
}

.clock-time {
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 18px;
  font-weight: 600;
  color: #f1f5f9;
  letter-spacing: 1px;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.clock-date {
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 11px;
  color: var(--text-sidebar-dim);
  letter-spacing: 0.5px;
  font-variant-numeric: tabular-nums;
}
</style>