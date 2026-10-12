/**
 * 翻译 **L2 层**：调用浏览器自带的本地翻译模型（Chrome/Edge 138+ 的 `Translator` API）。
 *
 * ## 为什么这才是「实时免费」的答案
 *
 * 这是**完全本地**的神经翻译：语言包一次性下载后（几十 MB），翻译在设备上完成 ——
 * 不走网络、没有配额、没有 API Key、没有按 IP 计的日限额。相比 MyMemory 那种
 * 「免密钥但有共享出口 IP 日配额」的方案，本地模型是唯一能同时满足
 * 「实时」（毫秒级）和「免费」（零外部依赖且永不耗尽）的路径。
 *
 * 本机实测（Chrome 154，真实 https 源）：
 *   `typeof Translator` → `function`
 *   `Translator.availability({en → zh})` → `'downloadable'`（即：只差语言包）
 *   `LanguageDetector.detect('The best free online tools…')` → en，置信度 0.9995
 *
 * ## 三条必须遵守的设计约束
 *
 * **① 绝不阻塞关键路径。** 语言包要下载几十 MB，第一次用不可能瞬时可用。
 * 所以策略是「静默预热 + 有就用，没有就算」：弹窗挂载时在后台开始准备，
 * 本轮翻译能等到就等（默认 1.5s），等不到就返回空串交给 L1/L3，
 * **永远不让下载把用户晾在界面上**。
 *
 * **② 绝不抛错。** 这个 API 在不同版本上名字不同（`Translator` ← `window.translation`），
 * 在非安全上下文里根本不存在，无头浏览器里 `create()` 会**挂起不返回**（实测）。
 * 任何一条路径出错都必须降级，不能让添加站点功能跟着崩。
 *
 * **③ 不进首屏。** 首屏预算只剩 ~2KiB 余量（598.1 / 600 KiB），
 * 本模块**只能被动态 import 引到**，绝不能出现在入口静态图里（test-bundle 守）。
 */

/* ---------------- 能力探测 ---------------- */

/** 语言码归一：Chrome 用 `zh`（不是 `zh-CN`），这里统一成它认得的形式 */
function normLang(code, { target = false } = {}) {
  const s = String(code || '').trim()
  if (!s) return target ? 'zh' : 'en'
  const low = s.toLowerCase()
  if (/^zh(-|_)?(cn|hans|sg)?$/i.test(low)) return target ? 'zh' : 'zh'
  if (/^zh(-|_)?(tw|hk|hant|mo)?$/i.test(low)) return target ? 'zh-Hant' : 'zh-Hant'
  return low.split(/[-_]/)[0]
}

/**
 * 取得可用的 API 族：新版是 `Translator`，早期 origin trial 叫 `window.translation`。
 *
 * 判据是**鸭子类型**（有没有 `create` / `createTranslator` 方法），不看 `typeof`：
 * 真实环境里 `Translator` 是命名空间对象，`typeof` 各版本报得不一样（Chrome 154 报
 * `'function'`，但把它当构造器调会炸），而「能不能调 create」才是我们真正依赖的能力。
 */
function apiFamily() {
  try {
    const T = globalThis.Translator
    if (T && typeof T.create === 'function') return 'new'
    const L = globalThis.translation
    if (L && typeof L.createTranslator === 'function') return 'legacy'
  } catch { /* 某些环境下访问全局会抛 */ }
  return 'none'
}

/** 同步能力探测结果，给 UI/决策层用（不发起任何异步动作） */
export function translatorSupport() {
  return apiFamily()
}

/* ---------------- 内部状态 ---------------- */

let ready = null          // 已建好的翻译器实例
let readyPair = null      // 实例对应的语言对 { source, target } —— 换语言对必须重建
let creating = null       // 进行中的 create()（去重，别并发下两份语言包）
let creatingPair = null
let status = 'unknown'    // unknown | unavailable | preparing | ready | failed

/**
 * 明确失败过的语言对。**这是唯一的失败记忆，故意不做全局开关**：
 * 曾经用一个 `createFailed` 布尔表示「整体不可用」，结果一次日文失败会把
 * 已经能用的英文翻译一起废掉（真机逻辑走查发现）。失败的粒度就是语言对。
 */
const failedPairs = new Set()
const pairKey = (s, t) => `${s}->${t}`

/** 供 UI 展示与探针断言：当前处于哪一步 */
export function translatorState() {
  return {
    status,
    support: apiFamily(),
    ready: Boolean(ready),
    pair: readyPair,
    failed: failedPairs.size > 0,
    failedPairs: [...failedPairs],
  }
}

/* ---------------- 超时工具：不用 AbortSignal.timeout，老浏览器没有 ---------------- */

function withTimeout(promise, ms, fallback = null) {
  let timer = null
  const guard = new Promise(resolve => {
    timer = setTimeout(() => resolve(fallback), ms)
  })
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer))
}

/* ---------------- 预热 ---------------- */

/**
 * 在后台把语言包准备好。**幂等**，可以随便调。
 *
 * 失败（或无此能力）只是记个状态，不抛错、不打扰用户 —— 翻译是锦上添花，
 * L1 词表和 L3 在线引擎仍在。
 *
 * @param {{ source?: string, target?: string }} [opts]
 * @returns {Promise<boolean>} 是否已就绪
 */
export async function warmUpTranslator({ source = 'en', target = 'zh' } = {}) {
  const src = normLang(source)
  const dst = normLang(target, { target: true })

  // 已有实例且语言对一致 → 直接用。语言对不同则必须重建（一个实例只服务一个语言对）
  if (ready && readyPair && readyPair.source === src && readyPair.target === dst) return true
  if (failedPairs.has(pairKey(src, dst))) return false

  const family = apiFamily()
  if (family === 'none') {
    status = 'unavailable'
    return false
  }

  // 同一个语言对正在建 → 搭车；不同语言对 → 也搭车（不并发下两份包，建完再按需重建）
  if (creating) return withTimeout(creating.then(() => readyPair?.source === src && readyPair?.target === dst), 1000, false)

  status = 'preparing'
  creatingPair = { source: src, target: dst }
  creating = (async () => {
    try {
      let inst
      if (family === 'new') {
        // downloadprogress 只用来观测，不做任何 UI 阻塞
        const monitor = (m) => {
          try { m.addEventListener('downloadprogress', () => {}) } catch { /* 无事件也无所谓 */ }
        }
        inst = await globalThis.Translator.create({ sourceLanguage: src, targetLanguage: dst, monitor })
      } else {
        inst = await globalThis.translation.createTranslator({ sourceLanguage: src, targetLanguage: dst })
      }
      ready = inst
      readyPair = { source: src, target: dst }
      status = 'ready'
      return true
    } catch {
      // 语言对不支持 / 下载失败 / 被策略拦下 —— 都走同一条降级路径。
      // 只把**这一个语言对**记失败，不牵连其它：一次日文失败不该把已经就绪的英文翻译废掉，
      // 也不该让后续每次日文请求都重新卡一遍超时。
      failedPairs.add(pairKey(src, dst))
      status = ready ? 'ready' : 'failed'
      return false
    } finally {
      creating = null
      creatingPair = null
    }
  })()

  // 预热本身**不等**：调用方（弹窗挂载）要立刻返回，下载在后台继续
  creating.catch(() => {})
  const warm = await withTimeout(creating, 1200, false)
  return Boolean(warm)
}

/* ---------------- 翻译 ---------------- */

/**
 * 用本地模型翻译一段文本。
 *
 * **永远不抛错、永远不超时挂住**：`timeoutMs` 内拿不到就返回空串，
 * 由调用方继续走 L1/L3 或保留原文。
 *
 * @param {string} text
 * @param {{ source?: string, target?: string, timeoutMs?: number, autoDetect?: boolean }} [opts]
 * @returns {Promise<string>} 译文；不可用时为空串（**绝不是原文**，让调用方自己决定回退）
 */
export async function translateText(text, { source = '', target = 'zh', timeoutMs = 1500, autoDetect = true } = {}) {
  const src0 = String(text ?? '').trim()
  if (!src0) return ''

  // **先探测源语言、再预热**：顺序反了会把语言对锁死成默认的 en ——
  // 一个日文站点会拿到 en→zh 的实例，然后 translate 出一堆垃圾或直接失败。
  // 探测是本地计算（无网络），代价可以忽略；给它一个很小的上限，超时就回落 en。
  let src = source
  if (!src && autoDetect) src = await withTimeout(detectLanguage(src0), Math.min(300, timeoutMs), '')
  src = normLang(src || 'en')

  const ok = await withTimeout(warmUpTranslator({ source: src, target }), timeoutMs, false)
  if (!ok || !ready) return ''

  try {
    const out = await withTimeout(Promise.resolve(ready.translate(src0)), Math.max(300, timeoutMs), '')
    const s = String(out ?? '').trim()
    // 译文与原文一模一样说明没真译（有些实现会原样返回）
    return s && s !== src0 ? s : ''
  } catch {
    return ''
  }
}

/**
 * 用浏览器自带检测器判定语言。拿不到就返回空串。
 * @returns {Promise<string>} 例如 `'en'`
 */
export async function detectLanguage(text) {
  const s = String(text ?? '').trim()
  if (!s) return ''
  try {
    const D = globalThis.LanguageDetector
    if (!D || typeof D.create !== 'function') return ''
    const avail = typeof D.availability === 'function' ? await D.availability() : ''
    if (avail === 'unavailable') return ''
    const det = await D.create()
    const res = await det.detect(s)
    const top = Array.isArray(res) ? res[0] : null
    // 置信度太低就不要猜，让上层用默认的 en
    return top && top.confidence >= 0.5 ? String(top.detectedLanguage || '') : ''
  } catch {
    return ''
  }
}

/** 仅供测试：重置内部状态 */
export function __resetTranslatorForTest() {
  ready = null
  readyPair = null
  creating = null
  creatingPair = null

  status = 'unknown'
  failedPairs.clear()
}
