/**
 * 本地推断兜底：`/api/metadata` 不可用时，在浏览器里跑**同一个**推断引擎。
 *
 * ## 为什么这条路径必须存在
 *
 * 站点改为纯静态托管后，`/api/metadata`（Vercel 函数，负责跨域抓目标网页 + SSRF 防护）
 * 整体不存在了，自动补全必然 404。但服务端那套推断的**内核**在 `shared/site-infer.mjs`，
 * 而且它本来就为「抓不到页面」设计过 —— `api/metadata.js` 里的原话是
 * 「抓不到页面不算失败：照常产出一份按域名推断的草稿，让用户只需复核而不是从零手填」。
 *
 * 所以这里传 `html: ''`，拿到的就是服务端在「页面抓不到」时给出的同一份草稿：
 * 名称来自域名（若该域名已在站点表里则直接沿用真名）、分类与用途来自
 * `CATEGORY_HINTS` 命中、配色来自分类色或按域名派生的稳定色。
 * 描述是一句**生成的模板话**（「XX（域名）—— 分类方向的常用站点」），不是站点自述；
 * favicon 兜底到 `/<host>/favicon.ico`。这两样要拿真值必须读到对方页面，
 * 浏览器跨域读不到，没有取巧办法 —— 所以 UI 必须标注「推断值」。
 *
 * ## 为什么是动态 import
 *
 * `site-infer.mjs` 有 700+ 行。`siteDraft.js` 只用到它的 `hashColor`，被 tree-shaking
 * 摇掉了其余部分，所以它目前**不在首屏包里**；这里一旦改成静态 import，整个模块就会
 * 被拖进入口 chunk —— 首屏预算只剩个位数 KiB，挤进去 `test-bundle` 必炸。
 */

import { looksLikeUrl } from '../utils/url.js'

/**
 * 产出与服务端同构的元信息草稿。
 *
 * @param {string} url 已归一化的网址
 * @param {{ existingSites?: Array, categoryMeta?: Record<string, {label: string, color?: string}> }} [opts]
 *        `existingSites` 传当前完整站点表：同域已收录时直接沿用真名（比拼域名靠谱得多）；
 *        `categoryMeta` 传**当前生效**的分类表（含用户新建的），保证推断出的分类真的存在于下拉框。
 * @returns {Promise<{ok: true, status: number, data: object} |
 *                   {ok: false, status: number, reason: string, message: string}>}
 */
export async function localSiteMeta(url, { existingSites = [], categoryMeta = null } = {}) {
  // inferSite 对「解析得出但不合法」的输入（如纯中文串会被补上 https:// 后通过）不报错，
  // 会照常按域名编一份草稿 —— 垃圾进垃圾出。先按项目统一的 URL 判据拦一道。
  if (!looksLikeUrl(url)) {
    return { ok: false, status: 0, reason: 'invalid-url', message: '没能识别出有效网址，请检查后重试。' }
  }
  try {
    const [{ inferSite }, { categoryMeta: builtinCategoryMeta }] = await Promise.all([
      import('../../shared/site-infer.mjs'),
      import('../../shared/categories.mjs'),
    ])
    const info = inferSite({
      html: '',
      rootHtml: '',
      url,
      existingSites,
      categoryMeta: categoryMeta || builtinCategoryMeta(),
    })
    return { ok: true, status: 200, data: { ...info, favicon: info.faviconUrl, local: true } }
  } catch (e) {
    // inferSite 对解析不出的地址会抛错 —— 这里与 fetchSiteMeta 的失败结构保持同构，
    // 调用方可以用同一套分支处理，不必为本地路径多写一层判断
    return { ok: false, status: 0, reason: 'invalid-url', message: String(e?.message || e) }
  }
}

/**
 * 把本地推断结果拼成界面文案。
 * 注意描述**不是空的**：引擎会按「名称（域名）—— 分类方向」生成一句模板话，
 * 看着像正经描述，实际是我们编的 —— 必须说清楚，不然用户会当成站点自述。
 */
export function localMetaNotice(data) {
  const low = Object.entries(data?.confidence || {}).filter(([, v]) => v === 'low').length
  return low
    ? `后端抓取不可用，已按域名推断（${low} 项为推断值，描述为生成文案，请复核）`
    : '后端抓取不可用，已按域名推断（描述为生成文案，请复核）'
}
