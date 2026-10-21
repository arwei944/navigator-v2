/**
 * 云端发布模式的全局单例（每浏览器一份）。
 *
 * 放在模块级 ref 而不是 Pinia：它只影响「本机什么时候把草稿推到云端」，
 * 不属于站点数据本身，也不需要跨标签页同步（localStorage 写盘已经够用）。
 */
import { ref, computed } from 'vue'
import { safeSetItem } from '@/utils/safeStorage'
import { PUBLISH_MODE, parsePublishMode } from '../../shared/cloud-publish.mjs'

export const PUBLISH_MODE_KEY = 'nav-cloud-publish-mode'

function readStored() {
  try {
    return parsePublishMode(localStorage.getItem(PUBLISH_MODE_KEY))
  } catch {
    return PUBLISH_MODE.MANUAL
  }
}

const mode = ref(readStored())

export function useCloudPublishMode() {
  function setMode(next) {
    const value = parsePublishMode(next)
    mode.value = value
    safeSetItem(PUBLISH_MODE_KEY, value)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nav-cloud-mode-change', { detail: { mode: value } }))
    }
    return value
  }

  return {
    mode,
    isRealtime: computed(() => mode.value === PUBLISH_MODE.REALTIME),
    setMode,
  }
}