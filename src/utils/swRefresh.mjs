/**
 * PWA 新版本提示：检测到新版本后**不自动刷新**，交给用户决定。
 *
 * 为什么改：原来 `main.js` 里是 `onNeedRefresh() { window.location.reload() }`。
 * SW 发现新版本是异步事件，随时可能触发 —— 用户正在添加弹窗填表单、拖拽排序、
 * 编辑站点时被无提示刷新，现场全部丢失。刷新是用户的主动行为，
 * 不该由检测事件替ta决定。
 *
 * 还有一层不那么显眼的坑：`onNeedRefresh` 只在 `registerType: 'prompt'` 下才会被
 * registerSW 模板调用，`autoUpdate` 下它是**死代码**（模板只挂 `activated` 直接 reload）。
 * 所以 vite.config 同步改成了 `prompt`，并且 `reload` 传的是 `updateServiceWorker` ——
 * `prompt` 模式下新 SW 还停在 waiting，直接 `location.reload()` 只会用旧 SW 再跑一遍。
 *
 * 抽成纯函数是为了能在 node 里断言「提示出现了、按钮能点、点了才刷新、
 * 而且不会自己倒计时刷新」—— 这几条正是原实现的全部问题。
 */

/**
 * 弹一条「有新版本」的提示，用户点「刷新」才真正切到新版本。
 *
 * @param {object} ctx
 * @param {(t: object) => number} ctx.push  toast store 的 push，返回 toast id
 * @param {() => void} ctx.reload           真正让新版本生效的函数（生产传 updateServiceWorker，测试传 spy）
 * @param {string} [ctx.message]            提示文案
 * @returns {{ toastId: number, refresh: () => void }}
 */
export function showRefreshPrompt({ push, reload, message = '有新版本可用' }) {
  if (typeof push !== 'function' || typeof reload !== 'function') {
    throw new TypeError('showRefreshPrompt 需要 push 与 reload 两个函数')
  }
  let fired = false
  const refresh = () => {
    // 连点只刷新一次：reload 之后再点按钮没有意义，还可能触发两次导航
    if (fired) return
    fired = true
    reload()
  }
  const toastId = push({
    message,
    tone: 'info',
    actionLabel: '刷新',
    onAction: refresh,
    // 不自动消失：倒计时替用户决定「不刷新」与强制刷新一样粗暴
    duration: 0
  })
  return { toastId, refresh }
}
