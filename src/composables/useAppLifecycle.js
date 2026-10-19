/**
 * 应用根的生命周期：云端轮询、点击量、可见性 / 联网事件、备注上行、快捷键、异步预热。
 *
 * ## 为什么集中在一处
 *
 * 这些东西的共同点是「**挂在根上、只在 App 卸载时收手**」。它们原先散在 `onMounted`
 * 与 `onBeforeUnmount` 两个函数里（约 60 行），中间夹着预热与主题初始化的说明；
 * 结果是最该成对读的两段被一屏注释隔开 —— 加一个监听时要翻到 80 行后去配对，
 * 漏掉一次就是「HMR 后同时跑好几条轮询」。
 *
 * 现在启动与清理写在同一个函数体内，配对关系一眼可见。
 *
 * ## 为什么预热要放在这里
 *
 * 「秒加」链路的 chunk 在空闲时预取，属于启动期行为（见 App.vue 里 `loadAutoAdd` 的说明）：
 * 静态引会把整条链路压回入口越过预算，纯按需又要让用户按下回车时才等下载。
 * 空闲预取是这两者之间唯一的折中，它属于「启动时做一次」，天然归这里。
 *
 * @param {object} deps
 * @param {object} deps.sitesStore
 * @param {object} deps.clicksStore
 * @param {object} deps.sidebarStore
 * @param {object} deps.preferencesStore
 * @param {object} deps.notesStore
 * @param {object} deps.siteNotesStore
 * @param {import('vue').Ref<any>} deps.commandPaletteRef
 * @param {() => void} deps.undoLast
 * @param {() => void} deps.createNote
 * @param {import('vue').Ref<boolean>} deps.showStickyBoard
 * @param {() => Promise<any>} deps.loadAutoAdd 返回预热目标的动态 import
 */
import { onMounted, onBeforeUnmount } from 'vue'
import { startLiveSync } from '@/services/liveSync'

export function useAppLifecycle({
  sitesStore,
  clicksStore,
  sidebarStore,
  preferencesStore,
  notesStore,
  siteNotesStore,
  commandPaletteRef,
  undoLast,
  createNote,
  showStickyBoard,
  loadAutoAdd,
}) {
  let stopLiveSync = null

  function onVisibility() {
    if (document.visibilityState === 'visible') sitesStore.retryCloudNow()
  }
  function onOnline() {
    sitesStore.retryCloudNow()
  }
  function onOffline() {
    sitesStore.pollCloudSites()
  }

  function onKeydown(e) {
    // Ctrl+K 打开全能框（命令面板形态）
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault()
      commandPaletteRef.value?.open()
      return
    }
    /*
     * Ctrl+Z 撤销最近一次批量改动 / 删除（5 秒窗口内，见 stores/undo.js）。
     * 焦点在输入框里时不接管：那是浏览器 / 编辑器自己的文本撤销，抢过来是破坏。
     */
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return
      e.preventDefault()
      undoLast()
      return
    }
    // Ctrl+D 切换主题：快捷键面板里写了这条，此前一直没实现
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      e.preventDefault()
      preferencesStore.toggleTheme()
      return
    }
    // Ctrl+Alt+N 新建便利贴；Ctrl+Shift+N 打开便签墙
    if (e.altKey && (e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) {
      e.preventDefault()
      createNote()
      return
    }
    if (e.shiftKey && (e.ctrlKey || e.metaKey) && (e.key === 'N')) {
      e.preventDefault()
      showStickyBoard.value = true
      return
    }
    if (e.key === 'Escape') {
      sidebarStore.close()
    }
  }

  onMounted(() => {
    /*
     * 右侧面板的折叠策略：必须在**持久化回填之后**才读（persistedstate 是在 store
     * setup 返回后才写回 ref 的，setup 里同步读只会拿到默认值）。放在这里与主题
     * 启动动作同源 —— 都是「读持久化值得等回填」这一类。
     */
    sidebarStore.applyCollapsePolicy()

    // 云端站点热更新：启动拉取 + 轮询（失败会指数退避）
    sitesStore.initCloudSites()
    sitesStore.startPolling(30000)

    // 全局点击量（卡片角标 / 排行的权威口径）：启动拉一次，之后按 TTL 自刷新
    clicksStore.load()

    // 标签页重新可见时立即重拉，避免热更新后等待整轮 30s。
    // 顺带复位退避：用户切回来就是要看最新数据，不该让他等一个断网期间攒出来的窗口。
    document.addEventListener('visibilitychange', onVisibility)

    // 联网恢复/断开：恢复时立刻重拉（不必等退避），断开时把状态写进 cloudError 让界面说出来。
    // 这两个事件在移动端尤其重要 —— 切 4G/WiFi 时 navigator.onLine 变化是最早的信号。
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    document.addEventListener('keydown', onKeydown)

    // 备注 / 便利贴的自动上行：改完 5s 后推一次云端（没填会话密钥则完全不推）
    stopLiveSync = startLiveSync({ siteNotes: siteNotesStore, notes: notesStore })

    /*
     * 预热「秒加」那条链路的异步 chunk：它现在是按需 import 的，代价是用户按回车那一刻
     * 才开始下载；首屏图标请求还占着连接池时，那一跳可能要等好几秒。
     * 空闲时先取一次（只放进模块图，不做任何事）—— 不改变分包结果。
     */
    const warm = () => {
      loadAutoAdd().catch(() => {})
    }
    if (typeof requestIdleCallback === 'function') requestIdleCallback(warm, { timeout: 3000 })
    else setTimeout(warm, 1200)
  })

  onBeforeUnmount(() => {
    stopLiveSync?.()
    /*
     * 这个组件挂在应用根上，正常不会卸载；但把监听与定时器收干净是基本功，
     * 否则将来一旦有 HMR / 多实例挂载，就会同时跑好几条轮询。
     */
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    document.removeEventListener('keydown', onKeydown)
    sitesStore.stopPolling()
  })
}
