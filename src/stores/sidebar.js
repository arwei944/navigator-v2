import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { versionedPersist } from '@/utils/storeVersioning'
import { usePreferencesStore } from '@/stores/preferences'
import { reduceRightPanel } from '../../shared/right-panel.mjs'
import { clampSideWidth, DEFAULT_SIDE_WIDTH, MIN_SIDE_W, MAX_SIDE_W } from '@/utils/sideWidth'

/** 右侧详情面板的出厂宽度（设置里的「重置宽度」要用，所以导出成本模块的常量） */
export const DEFAULT_RIGHT_WIDTH = 280

export const useSidebarStore = defineStore('sidebar', () => {
  // 右边栏「显示模式」「折叠策略」属于用户偏好（用户可配），本 store 只读不写
  const prefs = usePreferencesStore()

  const open = ref(false)
  const collapsed = ref(false)
  const rightCollapsed = ref(false)
  const activeNav = ref('discover')
  const width = ref(DEFAULT_SIDE_WIDTH) // 左侧栏可拖拽宽度（60–520，折叠态仍可拖）
  const rightWidth = ref(DEFAULT_RIGHT_WIDTH) // 右侧详情面板可拖拽宽度，默认280px

  /**
   * 右边栏当前显示的站点 —— **渲染层唯一的订阅点**。
   *
   * 只有一个状态，不再搞「悬停目标 + 锁定目标」两套：
   * 面板从"鼠标移开就消失"改成"移开保留"之后，「临时 / 按住」这个维度就不存在了
   * （推导见 `shared/right-panel.mjs` 开头的注释）。谁在什么时候能改它，
   * 全部由那个纯函数决定，组件不需要知道当前是哪种模式。
   *
   * **刻意不进持久化**：面板每次进来都该是干净的空状态，
   * 而不是上次残留的某个站点 —— 那会让人以为是数据错了。
   */
  const rightSite = ref(null)

  /**
   * 面板正被「占用」（详情面板处于内联编辑态）。
   *
   * 只用来拦住**悬停**这一类"无意"事件 —— 用户点了铅笔在改字段，
   * 鼠标划过任意一张卡片就会把面板换走、未保存的改动当场丢失。
   * `select`（右键「查看详情」）与 `clear`（拔图钉）是明确动作，仍然照常生效。
   */
  const rightFrozen = ref(false)

  // ≤768px 的详情入口：触屏没有 hover，右侧面板又整体隐藏，详情在那里原本毫无入口
  const detailSheetSite = ref(null)

  /**
   * 侧栏 / 详情面板正在改宽（折叠、展开、拖拽调宽）。
   * 期间临时摘掉毛玻璃：backdrop-filter 每帧都要重算模糊，叠加 300 张卡片随宽度重排，
   * 实测折叠动画会掉出 150ms 的卡顿帧（空闲基线稳定 16.7ms / 60fps）；只关模糊即可降到 33ms。
   * 动画结束自动恢复，用户看不到差别（那 0.3 秒面板本来就在移动）。
   */
  const animating = ref(false)
  let animTimer = null
  function markAnimating(ms = 320) {
    animating.value = true
    clearTimeout(animTimer)
    animTimer = setTimeout(() => { animating.value = false }, ms)
  }

  function toggle() {
    open.value = !open.value
    // 窄屏抽屉是覆盖在网格之上的浮层，滑入/滑出期间它自己的毛玻璃每帧都要在
    // 300 张卡之上重算一次模糊。与折叠、拖拽同源，一并临时摘掉。
    markAnimating()
  }
  function close() { open.value = false }
  function openSidebar() { open.value = true }
  function setActiveNav(nav) { activeNav.value = nav }
  function toggleCollapse() { collapsed.value = !collapsed.value; markAnimating() }
  function toggleRightCollapse() { rightCollapsed.value = !rightCollapsed.value; markAnimating() }
  // 两侧宽度下限都是 60px：左侧图标的物理下限（nav 项 44px + 两侧各 8px 内边距），
  // 拖到这个宽度以下就只剩图标了，再窄连图标都放不下。上限 400px。
  //
  // 计时取 300ms 而不是更短的 140ms：拖拽期间 mousemove 是连续来的，但用户随时可能
  // 停顿一下再继续。计时若短于停顿，模糊会在拖拽中途重新弹回来，正好卡在最需要流畅的
  // 那一刻重算。松手后多留 300ms 再恢复，用户看不到差别（面板本来就在动）。
  function setWidth(val) { width.value = clampSideWidth(val); markAnimating(300) }
  /** 双击把手：回到出厂宽度（拖宽之后想一键还原） */
  function resetWidth() { setWidth(DEFAULT_SIDE_WIDTH) }
  function setRightWidth(val) { rightWidth.value = clampSideWidth(val, DEFAULT_RIGHT_WIDTH); markAnimating(300) }
  function resetRightWidth() { setRightWidth(DEFAULT_RIGHT_WIDTH) }

  /* ---------- 右边栏显示目标：唯一的写入口 ---------- */

  /**
   * 把一次事件交给状态机，整体替换目标站点。
   *
   * 为什么不让调用方自己写 `rightSite`：模式不同、该不该响应就不同，
   * 散在各组件里迟早漏掉一处 —— 「改了设置但某个入口不听话」正是这么来的。
   * 这里收成一条通道，判断逻辑在纯函数里、可被真值表钉死。
   */
  function applyRight(action) {
    const next = reduceRightPanel(
      prefs.rightPanelMode,
      { site: rightSite.value, frozen: rightFrozen.value },
      action
    )
    rightSite.value = next.site
  }

  /** 占用 / 释放面板（内联编辑进出时切换）。见 rightFrozen 的注释。 */
  function setRightFrozen(v) { rightFrozen.value = v === true }

  /** 鼠标进入卡片（仅 `hover` 模式生效） */
  function hoverSite(site) { applyRight({ type: 'hover', site }) }
  /** 主动打开详情（右键菜单「查看详情」等）：各模式语义见 right-panel.mjs */
  function selectSite(site) { if (site) applyRight({ type: 'select', site }) }
  /** 清空显示目标（拔掉图钉 / 关闭面板） */
  function clearRight() { applyRight({ type: 'clear' }) }

  /**
   * 应用折叠策略 —— 必须在**持久化回填之后**调用（见 App.vue 的启动钩子）。
   *
   * 为什么不能写在 store setup 主体里：`rightCollapsed` 现在是持久化字段，
   * 而 persistedstate 是在 setup 返回**之后**才回填的，setup 里同步读只会拿到默认值，
   * 表现为「策略永远按默认走」。这与主题启动动作踩的是同一个坑。
   */
  function applyCollapsePolicy() {
    const policy = prefs.rightCollapsePolicy
    if (policy === 'always-collapse') rightCollapsed.value = true
    else if (policy === 'always-expand') rightCollapsed.value = false
    // 'remember'：什么都不做，保留持久化回填上来的值
  }

  /**
   * 策略改动后**立即**重放一次 —— 否则用户在设置里选了「每次折叠」，
   * 要等下次刷新才生效，看起来就是"设置没起作用"。
   *
   * 收在这里（而不是让设置面板记得手动调）是有意的：入口只有一个，
   * 将来再加别的 UI 也自动生效。注意 watch 不触发初始值，
   * 所以启动那一次仍然得靠 App.vue 的 onMounted。
   */
  watch(() => prefs.rightCollapsePolicy, () => applyCollapsePolicy())

  /**
   * 打开站点详情：桌面走右侧面板，窄屏走底部抽屉。
   * 按调用时的视口一次性分流，调用方（卡片右键菜单）不必知道断点在哪。
   */
  function showDetail(site) {
    if (!site) return
    const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
    if (narrow) {
      detailSheetSite.value = site
      return
    }
    rightCollapsed.value = false
    // 走「主动打开」语义（`pin` 模式下它是 toggle）。
    // 这里**不能**直接写 rightSite —— 那会让 click / pin 模式下的右键「查看详情」
    // 与它们的模式语义脱钩，表现为「设置改了但右键还是老样子」。
    selectSite(site)
  }
  function closeDetailSheet() { detailSheetSite.value = null }

  return {
    open, collapsed, rightCollapsed, activeNav, width, rightWidth,
    rightSite, detailSheetSite, animating, rightFrozen,
    toggle, close, openSidebar, setActiveNav,
    toggleCollapse, toggleRightCollapse, setWidth, setRightWidth, resetWidth, resetRightWidth,
    hoverSite, selectSite, clearRight, setRightFrozen, applyCollapsePolicy, showDetail, closeDetailSheet
  }
}, {
  /**
   * `rightCollapsed` 现在**进持久化**了（为了让「记住折叠状态」这条策略能生效）。
   *
   * 这与 v1 时期的处理不冲突：那时它被误持久化导致「折叠一次永久收起」，
   * 迁移表会在 v1→v2 时删掉它；而新写入的数据是 v2，不会再走那条迁移。
   * 「每次进入都展开」这个旧观感由默认策略 `always-expand` 保证 —— 见 applyCollapsePolicy。
   */
  persist: versionedPersist('sidebar', ['width', 'rightWidth', 'collapsed', 'rightCollapsed'])
})
