/**
 * 抓取结果的**会话级共享缓存**。
 *
 * ## 为什么是单独一个模块
 *
 * 这份缓存有两类使用者，且它们对首屏的约束正好相反：
 *  - **搜索框预览**要**同步** peek —— 命中时必须马上出卡片、不闪「抓取中」，
 *    所以它在首屏静态图里，只能引一个极小的模块；
 *  - **抓取本身**（`services/meta.js`，抓取容错 + 文案表）必须留在懒加载 chunk 里，
 *    静态引入它会撞首屏预算（`test-bundle.mjs` 第 7 节点名过这条链路）。
 *
 * 放进 `services/meta.js` 会让首屏被迫把整个抓取模块拖进来；放进 `useUrlPreview`
 * 又只有预览自己看得见，下游（秒加补全、添加弹窗）拿不到。缓存本身是纯数据，
 * 独立成模块最省 —— 这也是「同一份事实只留一份」的落点。
 *
 * ## 为什么按域名收敛
 *
 * 预览与补全要回答的都是「这是什么站」。同站不同路径页面描述可能不同，但按域名
 * 收敛就够用，还顺带省掉「用户把路径打全一点」引发的第二次抓取。
 * 键的算法与 `utils/urlPreview.js#previewKeyOf` 完全一致（都走 `domainOf`）。
 *
 * ## 只缓存成功
 *
 * 失败可能是瞬时故障（超时、对端抖动），缓存住会让重试永远失败 ——
 * 用户看到的就成了一张再也刷不出来的卡片。
 */
import { domainOf } from './siteDraft.js'

const store = new Map()

/** 按域名取已抓到的元信息（同步；未命中返回 null，调用方据此决定要不要联网） */
export function peekCachedMeta(url) {
  const key = domainOf(url)
  return key ? store.get(key) || null : null
}

/** 抓到成功结果后登记（键取不到时静默跳过，不抛错） */
export function rememberMeta(url, data) {
  const key = domainOf(url)
  if (!key || !data) return false
  store.set(key, data)
  return true
}

/** 仅供测试：清空与计数。正常流程不调用 —— 一次会话内元信息不会变。 */
export function clearMetaCache() { store.clear() }
export function metaCacheSize() { return store.size }
