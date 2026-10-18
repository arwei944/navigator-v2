/**
 * PWA 分享目标（G4 / L0-2）：从「系统分享面板」传来的参数里取出要收录的网址。
 *
 * ## 为什么单独一层
 *
 * 分享各家的填法并不统一：安卓分享通常给 `url`；有些 App 只填 `text`（形如
 * 「站点名 https://example.com」）；还有的把地址塞进 `title`。若把这些判断写进组件里，
 * 就没法在门禁里跑（组件要挂载、要路由）。抽成纯函数后，各种真实填法都能用数据钉住。
 *
 * ## 与站内收录的关系
 *
 * 这里只负责「取出网址」，收录本身复用既有 `services/autoAdd.autoAddSite` ——
 * 站内粘贴网址与分享进来走的是**同一条秒加链路**（识别 → 分类 → 入库 → 后台补全），
 * 不另起一套。
 */

/** 形如 example.com 或 example.com/path（无协议） */
const DOMAIN_LIKE = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:[/?#].*)?$/i
const HTTP_URL = /https?:\/\/[^\s"'<>）)】]+/i

const str = (v) => String(v ?? '').trim()

/**
 * 从分享参数里取出网址。
 *
 * 优先级：`url` 参数（若是裸域名补 https）→ `text` 里的首个 http(s) 链接 → `title` 里的。
 * 都取不到返回 ''，由调用方给「手动粘贴」兜底 —— 分享内容千奇百怪，不能假装总能猜到。
 *
 * @param {{ url?: string, text?: string, title?: string }} params
 * @returns {string} 完整 URL，或 ''
 */
export function extractSharedUrl({ url = '', text = '', title = '' } = {}) {
  const direct = str(url)
  if (/^https?:\/\//i.test(direct)) return trimTrailingPunct(direct)
  if (DOMAIN_LIKE.test(direct)) return 'https://' + trimTrailingPunct(direct)

  for (const field of [text, title]) {
    const m = str(field).match(HTTP_URL)
    if (m) return trimTrailingPunct(m[0])
  }
  return ''
}

/**
 * 去掉粘在末尾的标点。
 *
 * 分享正文里的链接常被包在句子里（「看这个 https://a.com/x。」），末尾的中英文句号、
 * 逗号、括号会被一起截进来，直接当网址用就会 404。只削尾、不动主体。
 */
function trimTrailingPunct(s) {
  return String(s).replace(/[.,;:!?，。；：！？、）)】\]]+$/, '')
}
