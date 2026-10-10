/**
 * 「页面不可见时别轮询」的共用闸门。
 *
 * ## 为什么必须有这一层
 *
 * 浏览器会把后台标签页的定时器**压到约 1 次/分钟，但不会停掉它**。而这个站点长开是常态：
 * 三路云端轮询（站点 30s、点击 5min、健康判定 5min）在后台依旧稳定发请求，
 * 一天下来单个标签页是数千次函数调用 + 边缘请求，用户一个字都没看。
 *
 * 后果不只是「浪费」：Vercel Hobby 的额度（边缘请求 100 万/月、函数调用 100 万/月）
 * 打满后平台会**暂停整个部署** —— 全站返回 402 `DEPLOYMENT_DISABLED`，
 * 站点直接下线，代价远大于「后台多刷新几次」。所以宁可回到前台时补一次。
 *
 * 两个出口：
 *   - `watchVisibility(handler)` —— 自带定时逻辑的调用方（如 sites 的自适应退避）用它；
 *   - `setVisibleInterval(ms, fn)` —— 固定 TTL 的轮询用它，返回清除函数。
 */

/** 订阅可见性变化，注册时立刻回调一次当前状态；返回取消订阅函数 */
export function watchVisibility(handler) {
  if (typeof document === 'undefined') return () => {}
  const fn = () => handler(document.visibilityState === 'visible')
  document.addEventListener('visibilitychange', fn)
  fn()
  return () => document.removeEventListener('visibilitychange', fn)
}

/**
 * 只在页面可见时运行的定时轮询。
 * @returns {() => void} 清除函数（store 卸载 / 测试收尾都该调）
 */
export function setVisibleInterval(ms, fn) {
  if (typeof document === 'undefined') return () => {}
  let timer = null
  const start = () => { if (timer === null) timer = setInterval(fn, ms) }
  const stop = () => { if (timer !== null) { clearInterval(timer); timer = null } }
  const off = watchVisibility(visible => (visible ? start() : stop()))
  return () => { stop(); off() }
}
