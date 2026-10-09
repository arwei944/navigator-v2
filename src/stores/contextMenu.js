import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 全局单例右键菜单的状态。
 *
 * 为什么要有它：菜单原先挂在每张卡片里（`SiteCard.vue` 内部一份 `<Teleport>` +
 * 两个 `document` 监听）。300 张卡片 = 300 个 Teleport 容器 + 600 个 document 级
 * 监听器，每次点击/滚动全部触发。改为单例后：容器 1 个、监听 2 个，与卡片数量无关。
 *
 * `handlers` 由打开方注入（卡片把自己的 emit 包成回调），这样「编辑 / 删除」这类
 * 需要调用方弹窗的动作仍留在原处，菜单本身不关心业务。
 */
export const useContextMenuStore = defineStore('contextMenu', () => {
  const visible = ref(false)
  const x = ref(0)
  const y = ref(0)
  const site = ref(null)
  const readOnly = ref(false)
  const handlers = ref(null)

  // 菜单实测尺寸（宽固定 180，高随项目数变化），用于把菜单收进视口
  const MENU_W = 180
  const MENU_H_READONLY = 190
  const MENU_H_FULL = 260

  function open({ x: px = 0, y: py = 0, site: s = null, readOnly: ro = false, handlers: h = null }) {
    site.value = s
    readOnly.value = ro
    handlers.value = h
    const menuH = ro ? MENU_H_READONLY : MENU_H_FULL
    let nx = px
    let ny = py
    if (nx + MENU_W > window.innerWidth) nx = window.innerWidth - MENU_W - 8
    if (ny + menuH > window.innerHeight) ny = window.innerHeight - menuH - 8
    x.value = Math.max(8, nx)
    y.value = Math.max(8, ny)
    visible.value = true
  }

  function close() {
    visible.value = false
    site.value = null
    handlers.value = null
  }

  return { visible, x, y, site, readOnly, handlers, open, close }
})
