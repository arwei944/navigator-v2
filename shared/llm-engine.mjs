/**
 * LLM 后端 **注册表（热拔插）**。
 *
 * ## 为什么单独一层
 *
 * `api/ai.js` 的 `chat()` 原本把「URL 拼法 + 鉴权头 + 解析 `choices[0].message.content`」
 * 全写在函数体里，换一个中转 / 私有化部署就要动主流程。而那个文件已经有完备的
 * **配置读取**（env + `data/ai-config.json`）与**安全边界**（key 只在服务端、
 * 出网目标由服务端决定、调用方不能传 URL）—— 那是一层不该被搬动的知识。
 * 所以这里只抽「怎么发一次 chat 请求」，配置仍由调用方经 `opts.config` 注入。
 *
 * ## 与 translate-engine 里那个 `llm` 引擎的关系（刻意不合并）
 *
 * 两者都打 OpenAI 兼容的 `/chat/completions`，但**用途与调参面不同**：
 *   · translate 的 `llm` 是翻译链的一环（`TRANSLATE_LLM_ENDPOINT`，temperature 0、剥引号、弃回显）；
 *   · 这里的后端供 AI 助手用（`AI_BASE_URL`，temperature 0.2、要严格 JSON、token 上限按动作给）。
 * 合成一个会为了其中一个改坏另一个，所以留两份薄适配。
 *
 * ## 热拔插
 *
 *   · `NAV_LLM_BACKENDS=openai,gateway` 可换序 / 裁剪；
 *   · 配 `LLM_GATEWAY_ENDPOINT` 就多出一个后端（本机模型网关即插即用）；
 *   · 单个后端失败会静默换下一个 —— 但**全链失败要如实抛出**：
 *     AI 助手的失败必须让用户看到，不能像翻译那样静默降级成原文。
 */

const registry = new Map()
let seq = 0

/**
 * 注册一个 LLM 后端。同 id 覆盖。
 *
 * @param {{
 *   id: string,
 *   label?: string,
 *   order?: number,
 *   available?: () => boolean,
 *   chat: (messages: object[], opts: object) => Promise<string>,   // 返回正文；失败抛错
 * }} spec
 */
export function registerLlm(spec) {
  if (!spec || !spec.id) throw new Error('LLM 后端必须提供 id')
  if (typeof spec.chat !== 'function') throw new Error(`LLM 后端 ${spec.id} 缺少 chat`)
  const entry = {
    id: String(spec.id),
    label: spec.label ? String(spec.label) : String(spec.id),
    order: Number.isFinite(spec.order) ? Number(spec.order) : 100 + seq,
    available: typeof spec.available === 'function' ? spec.available : () => true,
    chat: spec.chat,
  }
  seq += 1
  registry.set(entry.id, entry)
  return entry
}

/** 后端清单（供控制台/接口展示） */
export function listLlms({ check = true } = {}) {
  return [...registry.values()]
    .sort((a, b) => a.order - b.order)
    .map(b => ({ id: b.id, label: b.label, order: b.order, available: check ? Boolean(b.available()) : true }))
}

/**
 * 产出实际要试的后端链。
 * 优先级：显式传入 → `NAV_LLM_BACKENDS` → 注册顺序；然后过滤掉不可用项。
 * 容错与其余引擎一致：全不匹配回退全量；`none` 显式清空。
 */
export function llmChain(explicit) {
  const all = [...registry.values()].sort((a, b) => a.order - b.order)
  const raw = explicit !== undefined && explicit !== null
    ? String(explicit)
    : String(process.env.NAV_LLM_BACKENDS || '')
  const ids = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (ids.length === 1 && ['none', 'off', '0'].includes(ids[0])) return []
  const matched = ids.map(id => all.find(b => b.id === id)).filter(Boolean)
  const chosen = matched.length ? matched : all
  return chosen.filter(b => b.available())
}

/**
 * 按链依次请求。任一后端给出非空正文即返回；**全链失败抛最后一个错误**。
 *
 * @param {object[]} messages OpenAI 形状的消息数组
 * @param {{ chain?: object[], config?: {baseURL?:string,apiKey?:string,model?:string}, maxTokens?: number, temperature?: number, timeoutMs?: number }} opts
 * @returns {Promise<{ text: string, backend: string }>}
 */
export async function chatWithChain(messages, opts = {}) {
  const list = Array.isArray(opts.chain) ? opts.chain : llmChain()
  let lastErr = null
  for (const b of list) {
    try {
      const text = await b.chat(messages, opts)
      if (text) return { text, backend: b.id }
    } catch (e) { lastErr = e }
  }
  // 与翻译链不同：这里不留「静默返回空」的后路 —— 助手失败必须冒泡到 handler
  if (lastErr) throw lastErr
  return { text: '', backend: '' }
}

/** 从 opts.config → 环境变量的顺序解析出连接参数 */
function resolveConfig(opts = {}) {
  const cfg = opts.config || {}
  return {
    baseURL: String(cfg.baseURL || process.env.AI_BASE_URL || '').trim().replace(/\/+$/, ''),
    apiKey: String(cfg.apiKey || process.env.AI_API_KEY || '').trim(),
    model: String(cfg.model || process.env.AI_MODEL || 'gpt-4o-mini').trim(),
  }
}

/** 发一次 OpenAI 兼容的 chat/completions，返回正文 */
async function postChat({ baseURL, apiKey, model, messages, maxTokens = 600, temperature = 0.2, timeoutMs = 45_000, extraHeaders }) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...(extraHeaders || {}),
      },
      body: JSON.stringify({ model, temperature, max_tokens: maxTokens, messages }),
      signal: ctl.signal,
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      const err = new Error(`上游返回 ${res.status}${t ? `：${t.slice(0, 120)}` : ''}`)
      err.upstream = res.status
      throw err
    }
    const j = await res.json()
    return String(j?.choices?.[0]?.message?.content || '').trim()
  } finally { clearTimeout(timer) }
}

/* ---------------- 内建后端 ---------------- */

registerLlm({
  id: 'openai',
  label: 'OpenAI 兼容（AI_BASE_URL）',
  order: 100,
  available: () => true,
  chat: async (messages, opts = {}) => {
    const { baseURL, apiKey, model } = resolveConfig(opts)
    if (!baseURL) throw new Error('未配置 AI_BASE_URL')
    return postChat({
      baseURL, apiKey, model, messages,
      maxTokens: opts.maxTokens, temperature: opts.temperature, timeoutMs: opts.timeoutMs,
    })
  },
})

/**
 * 本机模型网关（如 `127.0.0.1:3003`）——**默认不出现**，配 `LLM_GATEWAY_ENDPOINT` 才注册。
 * 网关通常自带鉴权，用 `LLM_GATEWAY_API_KEY`；模型名用 `LLM_GATEWAY_MODEL`。
 */
function gatewaySpec() {
  const endpointOf = () => String(process.env.LLM_GATEWAY_ENDPOINT || '').replace(/\/+$/, '')
  return {
    id: 'gateway',
    label: `本机模型网关（${endpointOf() || '未配置'}）`,
    order: 200,
    available: () => Boolean(endpointOf()),
    chat: (messages, opts = {}) => postChat({
      baseURL: endpointOf(),
      apiKey: String(opts.config?.gatewayKey || process.env.LLM_GATEWAY_API_KEY || '').trim(),
      model: String(process.env.LLM_GATEWAY_MODEL || opts.config?.model || 'gpt-4o-mini').trim(),
      messages,
      maxTokens: opts.maxTokens, temperature: opts.temperature, timeoutMs: opts.timeoutMs,
    }),
  }
}

registerLlm(gatewaySpec())
