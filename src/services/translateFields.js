/**
 * 翻译编排：按 **L2 → L3 → L1** 的顺序取第一个拿得到的译文。
 *
 * | 层 | 引擎 | 延迟 | 依赖 |
 * |---|---|---|---|
 * | L2 | 浏览器自带的本地模型（`browserTranslate.js`） | 毫秒级 | Chrome/Edge 138+ 且语言包已下载 |
 * | L3 | `/api/translate`（MyMemory → Google） | 0.5~3s | 有网；额度按出口 IP 计，不可控 |
 * | L1 | 离线词表（`shared/glossary.mjs`） | 0ms | **无** |
 *
 * ## 为什么 L2 排第一（它才是「实时免费」的正确答案）
 *
 * L2 完全在设备上跑：过一次语言包之后就不联网、没有配额、没有 Key、不可能被
 * 别人耗光。L3 虽然免密钥，但额度**按出口 IP 计**，部署出口是共享 IP，
 * 耗尽时它连错都不报（只在译文位回一句警告）—— 「今天能译、明天不能译」。
 * 所以 L2 优先，L3 只在 L2 不可用时兜底。
 *
 * ## L1 为什么不是「第三层译文」而是「关键词」
 *
 * 逐词替换英文句子只会得到词沙拉。词表真正擅长的是**抽概念**：产出
 * 「免费 · 在线 · 开发者工具」，一眼可知这是关键词而非译文，用户不会被
 * 「看起来像翻译」的假象骗到。所以它落在 `keywords` 字段，由 UI 如实标注。
 *
 * ## 纪律
 *
 * - **永不抛错**、**永不挂住**：任何一层失败都往下走，最后至少还有原文与关键词。
 * - 三层全部按需 `import()` 加载 —— 首屏预算只剩 ~2KiB 余量，这个模块
 *   必须由调用方动态引，且它内部也不能有静态的重依赖。
 */
import { needsTranslation, shouldTranslateName } from '../../shared/translatable.mjs'
import { glossaryGloss } from '../../shared/glossary.mjs'

/** L2 单次翻译的等待上限：超过就不等了，交给 L3（下载语言包不能把用户晾住） */
const L2_TIMEOUT_MS = 1500
/** L3 网络等待上限 */
const L3_TIMEOUT_MS = 4000

const EMPTY = { name: '', desc: '' }

function withTimeout(promise, ms, fallback) {
  let timer = null
  return Promise.race([
    promise,
    new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms) }),
  ]).finally(() => clearTimeout(timer))
}

/**
 * 预热 L2（在弹窗挂载时调，不阻塞任何东西）。
 * 没有此能力时静默返回 —— 翻译是锦上添花，不该在界面上留下任何痕迹。
 */
export async function warmUpTranslate() {
  try {
    const { translatorSupport, warmUpTranslator } = await import('@/services/browserTranslate')
    if (translatorSupport() === 'none') return false
    return await warmUpTranslator({ source: 'en', target: 'zh' })
  } catch {
    return false
  }
}

/** L2 当前状态，供 UI 决定要不要显示「本地翻译已就绪 / 正在准备」之类的提示 */
export async function translateEngineState() {
  try {
    const { translatorState } = await import('@/services/browserTranslate')
    return translatorState()
  } catch {
    return { status: 'unavailable', support: 'none', ready: false }
  }
}

/**
 * 只算 L1 关键词（0ms，不出网）。第 0 跳就能调，用来给英文草稿补一层中文线索。
 */
export function keywordsOf(text, opts) {
  return glossaryGloss(text, opts)
}

/**
 * 三层编排。
 *
 * @param {{ name?: string, desc?: string }} fields 抓回来的名称与描述（可能是英文）
 * @param {{ timeoutMs?: number, signal?: AbortSignal, useBrowser?: boolean }} [opts]
 * @returns {Promise<{
 *   name: string, desc: string,
 *   original: { name: string, desc: string },
 *   translated: { name: boolean, desc: boolean },
 *   source: 'browser'|'server'|''|'',
 *   engines: { name: string, desc: string },
 *   keywords: string,
 *   note: string
 * }>}
 */
export async function translateFields({ name = '', desc = '' } = {}, { signal, useBrowser = true } = {}) {
  const original = { name: String(name ?? ''), desc: String(desc ?? '') }
  const want = {
    name: shouldTranslateName(original.name),
    desc: needsTranslation(original.desc),
  }

  // L1 无条件先算：它是唯一「永不失败」的一层，即使后面全崩也已经有了
  const kwDesc = glossaryGloss(original.desc)
  const kwName = glossaryGloss(original.name)
  const keywords = kwDesc.text || kwName.text || ''

  const out = {
    name: original.name,
    desc: original.desc,
    original,
    translated: { name: false, desc: false },
    source: '',
    engines: { ...EMPTY },
    keywords,
    note: '',
  }

  if (!want.name && !want.desc) {
    // 已是中文 / 是品牌名：不需要译，但也把关键词带出去（英文品牌名仍可能抽出概念）
    return out
  }

  /* ---------- L2：浏览器本地模型（0 网络） ---------- */
  if (useBrowser) {
    try {
      const bt = await import('@/services/browserTranslate')
      if (bt.translatorSupport() !== 'none') {
        const [n, d] = await Promise.all([
          want.name ? withTimeout(bt.translateText(original.name, { timeoutMs: L2_TIMEOUT_MS }), L2_TIMEOUT_MS + 200, '') : Promise.resolve(''),
          want.desc ? withTimeout(bt.translateText(original.desc, { timeoutMs: L2_TIMEOUT_MS }), L2_TIMEOUT_MS + 200, '') : Promise.resolve(''),
        ])
        if (n) { out.name = n; out.translated.name = true; out.engines.name = 'browser' }
        if (d) { out.desc = d; out.translated.desc = true; out.engines.desc = 'browser' }
        if (out.translated.name || out.translated.desc) out.source = 'browser'
      }
    } catch { /* L2 不可用 → 走 L3 */ }
  }

  // L2 已经把所有需要译的字段都拿到 → 不必再多一次网络往返
  const stillWant = {
    name: want.name && !out.translated.name,
    desc: want.desc && !out.translated.desc,
  }
  if (!stillWant.name && !stillWant.desc) {
    out.note = '浏览器本地翻译'
    return out
  }

  /* ---------- L3：服务端 /api/translate（免密钥在线引擎） ---------- */
  try {
    const qs = new URLSearchParams({
      name: stillWant.name ? original.name : '',
      desc: stillWant.desc ? original.desc : '',
    })
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), L3_TIMEOUT_MS)
    if (signal) {
      if (signal.aborted) ctl.abort()
      else signal.addEventListener('abort', () => ctl.abort(), { once: true })
    }
    let data = null
    try {
      const r = await fetch('/api/translate?' + qs.toString(), { signal: ctl.signal })
      if (r.ok) data = await r.json().catch(() => null)
    } finally {
      clearTimeout(timer)
    }

    if (data && typeof data === 'object') {
      // 服务端只负责它被问到的字段，这里按需合并，不覆盖 L2 已经译好的结果
      if (stillWant.name && data.translated?.name && data.name) {
        out.name = String(data.name); out.translated.name = true; out.engines.name = data.engines?.name || 'online'
      }
      if (stillWant.desc && data.translated?.desc && data.desc) {
        out.desc = String(data.desc); out.translated.desc = true; out.engines.desc = data.engines?.desc || 'online'
      }
      if (!out.keywords && data.keywords) out.keywords = String(data.keywords)
      if (out.translated.name || out.translated.desc) out.source = out.source || 'server'
    }
  } catch { /* L3 失败 → 只剩 L1 关键词可给 */ }

  /* ---------- L1：离线词表（已在前文算好） ---------- */
  if (!out.translated.name && !out.translated.desc) {
    out.source = keywords ? 'glossary' : ''
    out.note = keywords ? '词表关键词' : ''
  } else if (out.source === 'browser') {
    out.note = '浏览器本地翻译'
  } else if (out.source === 'server') {
    out.note = '在线引擎翻译'
  }
  return out
}
