/**
 * 在新标签页打开外部链接 —— 全项目唯一口径。
 *
 * ## 为什么不用 `window.open(url, '_blank', 'noopener')`
 *
 * 那一版在**桌面浏览器**里是对的（实测：`Page.windowOpen` 触发、`windowName=_blank`、
 * 当前页 `location.href` 不变、新开一个浏览上下文）。但按 HTML 规范，只要传了第三个
 * 参数（windowFeatures），这次调用就被定性为**弹窗请求**（auxiliary browsing context），
 * 而不是一次普通导航。于是两种环境下会掉链子：
 *
 *   1. 内嵌 WebView / App 内置浏览器 / IDE 预览面板 —— 常把弹窗直接拦掉，
 *      或把弹窗「就地打开」，用户看到的就是**当前页被覆盖**；
 *   2. 弹窗拦截器 —— 一旦这次调用不在用户手势的同步栈里（例如被 `await` 隔开），
 *      就会被拦。
 *
 * 合成为一次 `<a target="_blank" rel="noopener noreferrer">` 的点击则是**普通链接导航**：
 * 各浏览器与 WebView 普遍实现 `target="_blank"`，不经过弹窗通道；同时天然保留
 * 「中键 / Ctrl+点击 / 右键新标签页」这些原生语义。
 *
 * `rel="noopener noreferrer"` 与原来的 `noopener` 等价（新页面拿不到 `window.opener`，
 * 也拿不到 Referer），所以不会被目标站点反查来源。
 *
 * ## 用法
 *
 * 只在**用户手势的同步栈里**调用（点击处理器内直接调，不要 `await` 之后再调）。
 * 本函数不返回新窗口句柄 —— `noopener` 下本来也拿不到。
 */
export function openInNewTab(url) {
  const href = String(url ?? '').trim()
  if (!href) return

  const a = document.createElement('a')
  a.href = href
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  // 不参与布局，也不闪现；appendChild 是 Firefox 触发真实导航的必要条件
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
