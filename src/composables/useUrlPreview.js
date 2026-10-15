/**
 * 网址预览的抓取侧：防抖、按域名缓存、过期请求作废。
 *
 * 三件事各自都有理由，不是习惯动作：
 *  1. **防抖**（`DEBOUNCE_MS`）—— 用户是逐字粘网址的，`g`→`gi`→`git`→… 每一步都像网址，
 *     不防抖就会为一次粘贴打出一串请求，还会让卡片在几个域名之间来回闪；
 *  2. **按域名缓存** —— 抓取结果在一次会话内不会变，反复删掉再打同一个网址不该重新联网；
 *     缓存命中时**直接出结果、不进 loading 态**：本地已有事实，闪一下转圈是纯噪音；
 *  3. **过期作废**（`seq` + `AbortController`）—— 用户改主意快过网络时，
 *     迟到的响应绝不能把已经换掉的卡片覆盖回去。
 *
 * 状态判定本身在 `utils/urlPreview.js` 的纯函数里，这里只负责「把数据取回来」。
 */
import { ref, onUnmounted } from 'vue'
import { previewKeyOf } from '@/utils/urlPreview'

/** 防抖窗口：够覆盖连续敲键，又不至于让人觉得卡 */
export const PREVIEW_DEBOUNCE_MS = 350

export function useUrlPreview() {
  const url = ref('')
  const loading = ref(false)
  const meta = ref(null)
  const error = ref('')

  /** 域名 → 抓取结果。只存成功结果：失败可能是瞬时故障，缓存住会让重试永远失败 */
  const cache = new Map()
  let timer = null
  let seq = 0
  let ctrl = null

  function clearTimer() {
    if (timer) { clearTimeout(timer); timer = null }
  }

  /** 作废在途请求：递增序号让迟到的响应认不出自己，再断掉连接 */
  function cancelInFlight() {
    seq++
    clearTimer()
    if (ctrl) { ctrl.abort(); ctrl = null }
  }

  function idle() {
    cancelInFlight()
    url.value = ''
    loading.value = false
    meta.value = null
    error.value = ''
  }

  /**
   * 请求某个网址的预览。传空串即回到 idle（输入不再是网址 / 进了二级页）。
   *
   * @param {string} nextUrl
   * @param {{ delay?: number }} [opts] `delay` 供测试缩短防抖窗口
   */
  function request(nextUrl, { delay = PREVIEW_DEBOUNCE_MS } = {}) {
    if (!nextUrl) { idle(); return }

    const key = previewKeyOf(nextUrl)
    cancelInFlight()
    url.value = nextUrl

    // 缓存命中：同步出结果，不经过 loading —— 本地已有事实，不必让用户等一个转圈
    if (key && cache.has(key)) {
      meta.value = cache.get(key)
      error.value = ''
      loading.value = false
      return
    }

    meta.value = null
    error.value = ''
    loading.value = true
    timer = setTimeout(() => { timer = null; run(nextUrl, key) }, delay)
  }

  async function run(targetUrl, key) {
    const my = ++seq
    ctrl = new AbortController()
    // 动态取 services/meta（先例：autoAdd.js 里 suggestCategory 同样动态取）：
    // 这条抓取链路只在「输入像网址」时才用得到，静态 import 会把它拖回首屏 ——
    // test-bundle.mjs 第 7 节点名了这条链路，与 autoAdd 共用同一个理由。
    const { fetchSiteMeta } = await import('@/services/meta')
    const res = await fetchSiteMeta(targetUrl, { signal: ctrl.signal })
    // 拿到结果时若已经换了输入，这次响应就是废的 —— 直接丢，别覆盖新卡片
    if (my !== seq) return

    if (res.ok) {
      meta.value = res.data
      error.value = ''
      if (key) cache.set(key, res.data)
    } else {
      meta.value = null
      error.value = res.message
    }
    loading.value = false
  }

  onUnmounted(cancelInFlight)

  return { url, loading, meta, error, request, idle }
}
