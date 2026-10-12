/**
 * 「这段文本该不该译」的纯判定。
 *
 * ## 为什么从 `shared/translate.mjs` 里拆出来
 *
 * `translate.mjs` 的文件头写着一条硬约束：**不得被 `src/` 引用** —— 它包含
 * `googleUrl` / `myMemoryUrl` 这些出网细节，带进浏览器 bundle 没有意义。
 *
 * 但前端**确实需要**同一套判定：L2（浏览器本地模型）在翻译前必须知道
 * 「这是品牌名该留着」还是「这是散文该翻」。两处各写一份的下场就是漂移 ——
 * 服务端认为该译、前端认为不该译，用户看到的结果随路径不同而不同。
 *
 * 所以拆出这个**零依赖、零网络、零副作用**的模块：判定只有一份真相，
 * 服务端与浏览器共用；出网细节仍留在 `translate.mjs` 里。
 */

const HAN = /\p{Script=Han}/u
const LETTER = /\p{L}/u

/**
 * 是否已是中文（含任何汉字即视为中文）。
 * 判据取「出现即算」而不是「汉字占比过半」：混合文案（"ChatGPT 中文站"）里
 * 汉字已经承载了主要语义，再翻一遍只会把品牌名也翻坏。
 */
export function looksChinese(text) {
  return HAN.test(String(text ?? ''))
}

/** 是否值得送去翻译：非空、含字母、且不是中文。纯数字 / 纯符号不译 */
export function needsTranslation(text) {
  const s = String(text ?? '').trim()
  if (!s) return false
  if (looksChinese(s)) return false
  return LETTER.test(s)
}

/**
 * 站点名是否该翻译。
 *
 * 品牌名（Uniswap / OpenAI / DeepSeek）翻成中文只会得到一串音译垃圾，
 * 而它们本来就是用户要认的那几个字。因此只翻「词组型」名称（含空格，如
 * "Best Free Online Tools"）——单词型基本是品牌，保持原样。
 * 描述是散文，不存在这个问题，非中文一律翻。
 */
export function shouldTranslateName(name) {
  const s = String(name ?? '').trim()
  if (!needsTranslation(s)) return false
  return /\s/.test(s)
}
