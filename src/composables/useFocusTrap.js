import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

/**
 * 浮层焦点陷阱（v11）。
 *
 * ## 为什么需要
 *
 * 命令面板、快捷键面板、添加/编辑弹窗此前都只是「把 DOM 显示出来」：
 * 没有 `role="dialog"`、没有 `aria-modal`，焦点也停留在打开它之前的那个元素上。
 * 于是屏幕阅读器读不到「你进了一个对话框」，而键盘用户按 Tab 会直接走到浮层后面的
 * 卡片网格里 —— 视觉上浮层盖着一切，焦点却在看不见的地方，是最难排查的一类问题。
 *
 * ## 怎么用
 *
 *   const panelRef = ref(null)
 *   const trap = useFocusTrap(panelRef)
 *   watch(visible, (v) => { v ? trap.activate() : trap.release() })
 *
 * ## 两条刻意的选择
 *
 *  1. **只拦 Tab，不拦方向键**。方向键在面板里是「移动选中项」，在网格里是「移动焦点」，
 *     陷阱一律拦掉会破坏两者。Esc 由各面板自己处理（关闭语义不同）。
 *  2. **关闭时把焦点还给触发它的元素**。不还的话键盘用户关掉浮层会被扔回文档开头，
 *     得从头按一遍才能回到刚才的位置 —— 这也是 WAI-ARIA 对话框模式的要求。
 *     元素已从 DOM 移除时不强还（还到一个孤立节点等于没还）。
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function isVisible(el) {
  if (!el) return false
  if (el.hasAttribute('hidden')) return false
  // offsetParent 为 null 覆盖了 display:none 与其祖先隐藏两种情况，比读样式便宜
  return el.offsetParent !== null || el.getClientRects().length > 0
}

export function useFocusTrap(rootRef) {
  const active = ref(false)
  /** 打开浮层前的焦点所在，关闭时还回去 */
  let restoreTo = null

  function focusables() {
    const root = rootRef.value
    if (!root) return []
    return [...root.querySelectorAll(FOCUSABLE)].filter(isVisible)
  }

  function onKeydown(e) {
    if (e.key !== 'Tab' || !active.value) return
    const list = focusables()
    if (!list.length) { e.preventDefault(); return }
    const first = list[0]
    const last = list[list.length - 1]
    const cur = document.activeElement
    const outside = !rootRef.value?.contains(cur)

    if (e.shiftKey && (cur === first || outside)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (cur === last || outside)) {
      e.preventDefault()
      first.focus()
    }
  }

  async function activate() {
    if (active.value) return
    restoreTo = document.activeElement
    active.value = true
    document.addEventListener('keydown', onKeydown, true)
    await nextTick()
    // 初始焦点落在第一个可聚焦元素：屏幕阅读器从对话框开头读起，
    // 用户也不用先 Tab 一圈才知道自己在哪
    const list = focusables()
    if (list.length) list[0].focus()
    else rootRef.value?.focus?.()
  }

  function release() {
    if (!active.value) return
    active.value = false
    document.removeEventListener('keydown', onKeydown, true)
    if (restoreTo && document.body.contains(restoreTo)) {
      try { restoreTo.focus() } catch { /* 元素可能已不可聚焦 */ }
    }
    restoreTo = null
  }

  // v-if 卸载时若忘了 release，keydown 监听会留下一个闭包持有已销毁的 DOM
  onBeforeUnmount(release)

  return { active, activate, release, focusables }
}
