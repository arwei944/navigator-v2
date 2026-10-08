/**
 * 全局轻提示：站内没有第二个「全局瞬时状态」的去处，故独立成 store，
 * 由 App.vue 挂一次 ToastHost 渲染。项目里没有通用 Toast 组件，这是新建的基础设施。
 *
 * 倒计时要能被悬停暂停 —— 提示里有「撤销」按钮，用户读到一半被自动收掉是最糟的体验。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

const MAX_ITEMS = 3
const TONE_DURATION = { ok: 5000, info: 4000, error: 8000 }
const FALLBACK_DURATION = 5000

let seq = 0

export const useToastStore = defineStore('toast', () => {
  const items = ref([])
  const timers = new Map()

  function arm(item, ms) {
    item.remaining = ms
    item.expiresAt = Date.now() + ms
    timers.set(item.id, setTimeout(() => dismiss(item.id), ms))
  }

  function dismiss(id) {
    const timer = timers.get(id)
    if (timer) { clearTimeout(timer); timers.delete(id) }
    const idx = items.value.findIndex(t => t.id === id)
    if (idx !== -1) items.value.splice(idx, 1)
  }

  function push({ message, tone = 'ok', actionLabel = '', onAction = null, duration = 0 }) {
    const item = {
      id: ++seq,
      message: String(message || ''),
      tone: ['ok', 'info', 'error'].includes(tone) ? tone : 'ok',
      actionLabel: String(actionLabel || ''),
      onAction,
      remaining: 0,
      expiresAt: 0,
    }
    items.value.push(item)
    // 超出上限丢最旧的，绝不让提示堆满屏幕
    while (items.value.length > MAX_ITEMS) dismiss(items.value[0].id)
    arm(item, duration || TONE_DURATION[item.tone] || FALLBACK_DURATION)
    return item.id
  }

  function pause(id) {
    const item = items.value.find(t => t.id === id)
    const timer = timers.get(id)
    if (!item || !timer) return
    clearTimeout(timer)
    timers.delete(id)
    item.remaining = Math.max(0, item.expiresAt - Date.now())
  }

  function resume(id) {
    const item = items.value.find(t => t.id === id)
    if (!item || timers.has(id)) return
    arm(item, item.remaining || FALLBACK_DURATION)
  }

  return { items, push, dismiss, pause, resume }
})
