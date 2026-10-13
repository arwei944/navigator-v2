/**
 * 翻译 **引擎注册表（热拔插）**。
 *
 * 与 shared/site-engine.mjs 同构，但语义是**链式优先**而非二选一：
 * 翻译要的是「第一个能用的引擎」，所以注册表产出的是一个**有序链**，
 * 逐个尝试直到拿到非空且不等于原文的译文。
 *
 * 分工（刻意避免 ESM 循环依赖）：
 *   · 本文件只做**机制** —— 注册、排序、跑链；
 *   · 内建两引擎（MyMemory / Google）由 shared/translate.mjs 在加载时注册，
 *     因为它俩的 URL 构造与响应解析本就属于那个文件，反向 import 会成环。
 *   · LLM 引擎（OpenAI 兼容端点）在本文件内条件注册：**未配置则不出现**。
 *
 * 为什么需要它：`translateToZh` 原本把 MyMemory / Google 的顺序与解析**硬编码**在
 * 函数体里，换译厂就要动主流程。现在换序/裁剪只是 `NAV_TRANSLATE_ENGINES` 一个变量，
 * 新增译厂只是多一次 `registerTranslator`，主流程一行不改。
 *
 * 「热拔插」的确切含义：
 *   · `NAV_TRANSLATE_ENGINES=mymemory,google` 可换序、可裁剪（只留一个也行）；
 *   · 配了 `TRANSLATE_LLM_ENDPOINT` 就多出 `llm` 引擎排在链尾（默认不启用）；
 *   · 任何引擎失败/回空/回显原文都**静默跳过**，绝不让翻译链整体失败。
 */

const registry = new Map()
let seq = 0

/**
 * 注册一个翻译引擎。同 id 覆盖（便于测试与热替换）。
 *
 * @param {{
 *   id: string,
 *   label?: string,
 *   order?: number,                 // 越小越先试；缺省按注册顺序追加到 100 之后
 *   kind?: 'http' | 'llm',
 *   available?: () => boolean,      // 缺省恒 true；LLM 用它看环境变量
 *   buildUrl: (text: string, opts: { from?: string, to?: string }) => string,
 *   init?: (text: string, opts: { from?: string, to?: string }) => object,  // 需要 POST 的引擎提供
 *   parse: (raw: unknown) => string, // 返回译文；解析不出返回空串
 * }} spec
 */
export function registerTranslator(spec) {
  if (!spec || !spec.id) throw new Error('翻译引擎必须提供 id')
  if (typeof spec.buildUrl !== 'function') throw new Error(`翻译引擎 ${spec.id} 缺少 buildUrl`)
  const entry = {
    id: String(spec.id),
    label: spec.label ? String(spec.label) : String(spec.id),
    order: Number.isFinite(spec.order) ? Number(spec.order) : 100 + seq,
    kind: spec.kind === 'llm' ? 'llm' : 'http',
    available: typeof spec.available === 'function' ? spec.available : () => true,
    buildUrl: spec.buildUrl,
    init: typeof spec.init === 'function' ? spec.init : null,
    parse: typeof spec.parse === 'function' ? spec.parse : () => '',
  }
  seq += 1
  registry.set(entry.id, entry)
  return entry
}

/** 引擎清单（供控制台/接口展示，顺序即默认尝试顺序） */
export function listTranslators({ check = true } = {}) {
  return [...registry.values()]
    .sort((a, b) => a.order - b.order)
    .map(e => ({
      id: e.id,
      label: e.label,
      order: e.order,
      kind: e.kind,
      available: check ? Boolean(e.available()) : true,
    }))
}

/**
 * 产出实际要跑的引擎链。
 * 优先级：显式传入 → NAV_TRANSLATE_ENGINES → 注册顺序；然后过滤掉不可用引擎。
 *
 * 容错语义（配置写错不该让翻译整体失效）：
 *   · 列出的一部分 id 未注册 → 忽略未注册的那些，其余照用；
 *   · 列出的 id **一个都没匹配上** → 回退到全量引擎（多为配置事故，不静默失效）；
 *   · `NAV_TRANSLATE_ENGINES=none`（或 off / 0）→ 显式清空链，只留调用方离线层。
 */
export function translatorChain(explicit) {
  const all = [...registry.values()].sort((a, b) => a.order - b.order)
  const raw = explicit !== undefined && explicit !== null
    ? String(explicit)
    : String(process.env.NAV_TRANSLATE_ENGINES || '')
  const ids = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (ids.length === 1 && ['none', 'off', '0'].includes(ids[0])) return []
  const matched = ids.map(id => all.find(e => e.id === id)).filter(Boolean)
  const chosen = matched.length ? matched : all
  return chosen.filter(e => e.available())
}

/**
 * 按链依次尝试翻译。任一引擎成功即返回；全部失败返回空串（调用方保留原文）。
 * 与原文相同的译文**视为未翻译**并继续下一个（有些接口会原样回显）。
 *
 * @param {string} text
 * @param {{ fetchText?: (url: string, init?: object) => Promise<string>, from?: string, to?: string, chain?: object[] }} opts
 * @returns {Promise<{ text: string, engine: string }>}
 */
export async function translateWithChain(text, { fetchText, from = 'en', to = 'zh-CN', chain } = {}) {
  const src = String(text ?? '').trim()
  if (!src || typeof fetchText !== 'function') return { text: '', engine: '' }
  for (const eng of (Array.isArray(chain) ? chain : translatorChain())) {
    try {
      const url = eng.buildUrl(src, { from, to })
      const init = eng.init ? eng.init(src, { from, to }) : undefined
      const out = eng.parse(await fetchText(url, init))
      if (out && out !== src) return { text: out, engine: eng.id }
    } catch { /* 换下一个引擎 */ }
  }
  return { text: '', engine: '' }
}

/* ---------------- 条件注册：LLM（OpenAI 兼容端点） ---------------- */

/**
 * LLM 引擎：走 OpenAI 兼容的 /chat/completions。
 * **默认不启用** —— 只有配了 TRANSLATE_LLM_ENDPOINT 才 available。
 * 本机模型网关（如 127.0.0.1:3003）或任何 OpenAI 兼容中转都能直接接上。
 *
 * 注意：它需要 POST 传输。若调用方只提供 GET 型 fetchText（如控制台的 curl 包装），
 * 该引擎会失败并被链静默跳过 —— 不影响其余引擎。
 */
function llmSpec() {
  const endpointOf = () => String(process.env.TRANSLATE_LLM_ENDPOINT || '').replace(/\/+$/, '')
  const modelOf = () => String(process.env.TRANSLATE_LLM_MODEL || 'gpt-4o-mini')
  return {
    id: 'llm',
    label: `LLM（${modelOf()}）`,
    order: 300,
    kind: 'llm',
    available: () => Boolean(endpointOf().trim()),
    buildUrl: () => `${endpointOf()}/chat/completions`,
    init: (text, { to = 'zh-CN' } = {}) => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modelOf(),
        temperature: 0,
        messages: [
          { role: 'system', content: `你是翻译引擎。把用户给的文本译成${to === 'zh-CN' ? '简体中文' : to}，只输出译文，不要解释、不要引号。` },
          { role: 'user', content: text },
        ],
      }),
    }),
    parse: (raw) => {
      try {
        const c = JSON.parse(String(raw ?? ''))?.choices?.[0]?.message?.content
        return typeof c === 'string' ? c.trim().replace(/^["'“”]+|["'“”]+$/g, '').trim() : ''
      } catch { return '' }
    },
  }
}

registerTranslator(llmSpec())
