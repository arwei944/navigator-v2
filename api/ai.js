/**
 * AI 助手（S4）—— OpenAI 兼容接口，能力**只限三件**。
 *
 * ## 边界（刻意收窄）
 *
 *   1. `polish`        名称/描述润色（单条）
 *   2. `categorize`    批量分类建议（多个站点 → 建议分类，不直接改数据）
 *   3. `summarize`     巡检异常摘要（把 down 的站点归并成人话）
 *
 * 不做「让 AI 改站点数据」：分类建议只出建议、润色只出文本，**落库一律由用户确认**。
 * 理由很直接——AI 输出是不可复现的，站点表是全站渲染的唯一输入；
 * 让不可复现的东西直接写进数据面，出了问题没法归因也没法回滚。
 *
 * ## 配置与安全
 *
 *  - `baseURL` / `model` / `apiKey` 全部来自服务端（`data/ai-config.json` 或环境变量
 *    `AI_BASE_URL` / `AI_MODEL` / `AI_API_KEY`）—— **前端永远拿不到 key**。
 *  - 未配置 → 501 + 明确文案；前端据此**隐藏入口**（沿用 v8 的降级纪律）。
 *  - 逐条调用都要鉴权（checkAuthHeader）：这是花钱的接口，不能匿名用。
 *  - 出网目标由**服务端配置**决定，调用方不能传 URL（否则又是一个开放代理）。
 *  - 单次请求条数与文本长度封顶；响应只取 content，不透传上游的原始响应体。
 */
import { get, put } from '#store'
import { checkAuthHeader } from '../shared/auth.mjs'
import { chatWithChain } from '../shared/llm-engine.mjs'
import { dayKey } from '../shared/clicks-core.mjs'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = dirname(fileURLToPath(import.meta.url))
const TIMEOUT_MS = 45 * 1000
const MAX_BATCH = 20
const MAX_TEXT = 400

/**
 * 免鉴权动作（v11）：`polish` 面向所有访客开放。
 *
 * 为什么必须开放：「添加网站」弹窗里的润色按钮此前一律带 admin key 请求，
 * 于是**没有管理 key 的人点了必定失败**，而且失败文案只说「请求失败」——
 * 看上去像功能坏了，实际是鉴权设计把普通用户挡在门外。
 *
 * 为什么不干脆全部免鉴权：`categorize` / `summarize` 是批量动作（一次 20 条、
 * 800 token），且需要站点表与巡检数据，属于管理作业。只有 polish 是单条、
 * 300 token、输入已被截断到 400 字的轻量动作，适合开放。
 *
 * 开放的代价是**必须自己限流**：走的仍是服务端的 key 与额度。
 */
const PUBLIC_ACTIONS = new Set(['polish'])
/** 免鉴权动作的每日额度（按 IP 指纹计） */
const PUBLIC_DAILY = 30
const QUOTA_PATH = 'ops/ai-quota.json'

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
}

function readBody(req) {
  if (typeof req.body === 'string') return Promise.resolve(JSON.parse(req.body))
  if (req.body && typeof req.body.getReader === 'function') return new Response(req.body).json()
  return Promise.resolve(req.body || {})
}

/* ---------------- 免鉴权动作的额度 ---------------- */

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  const raw = Array.isArray(fwd) ? fwd[0] : fwd
  return String(raw || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()
}

/** 只落指纹、不存明文 IP：这张表会被运维导出，明文 IP 属于不必留的个人信息 */
function ipFingerprint(ip) {
  return createHash('sha256').update(`ai:${ip}`).digest('hex').slice(0, 16)
}

/**
 * 扣一次当日额度。
 *
 * 与点击统计同一取舍：Serverless 无共享状态，读-改-写理论上会并发丢更新。
 * 额度是**防刷的保险**而非计费账本，少扣几次不构成问题；反过来，
 * 存储抖动时**仍然放行** —— 不能因为存不下就让正常用户用不了润色。
 */
async function quotaTake(key, today, limit = PUBLIC_DAILY) {
  let cur = {}
  try {
    const blob = await get(QUOTA_PATH, { access: 'private', useCache: false })
    if (blob && blob.stream) {
      const data = JSON.parse(await new Response(blob.stream).text())
      const days = data && data.days && typeof data.days === 'object' ? data.days : {}
      if (days[today] && typeof days[today] === 'object') cur = days[today]
    }
  } catch { /* 首次使用：从零开始 */ }

  const used = Number(cur[key]) || 0
  if (used >= limit) return { ok: false, left: 0 }

  try {
    await put(QUOTA_PATH, JSON.stringify({
      // 额度按天，昨天的数据没有任何留存价值 —— 顺手清掉，表不会无限变大
      days: { [today]: { ...cur, [key]: used + 1 } },
      updatedAt: new Date().toISOString(),
    }), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' })
  } catch { /* 落盘失败也放行，理由见上面 */ }

  return { ok: true, left: limit - used - 1 }
}

/** 配置优先级：环境变量 > data/ai-config.json（文件不进 git，沙箱没有环境变量注入） */
export function aiConfig() {
  let file = {}
  try {
    const p = join(ROOT, 'data', 'ai-config.json')
    if (existsSync(p)) file = JSON.parse(readFileSync(p, 'utf-8'))
  } catch { /* 没有就用环境变量 */ }

  const baseURL = String(process.env.AI_BASE_URL || file.baseURL || '').trim()
  const apiKey = String(process.env.AI_API_KEY || file.apiKey || '').trim()
  const model = String(process.env.AI_MODEL || file.model || 'gpt-4o-mini').trim()
  return {
    ready: Boolean(baseURL && apiKey),
    baseURL: baseURL.replace(/\/+$/, ''),
    apiKey,
    model,
    // 有没有配 ≠ 有没有 key：前者决定入口显不显示
    configured: Boolean(baseURL),
  }
}

/**
 * 调一次 chat/completions，拿 content。
 *
 * 传输与解析已抽到 `shared/llm-engine.mjs`（后端注册表）：
 * 这里是**唯一**把服务端配置（key / baseURL / model）交给后端的地方 ——
 * 后端自己不认识 `data/ai-config.json`，也就没有第二条可能泄漏 key 的路径。
 *
 * 换中转或私有化部署：`NAV_LLM_BACKENDS` 换序、或配 `LLM_GATEWAY_ENDPOINT` 多一个后端，
 * 本函数不用动。注意全链失败会**抛错**（不像翻译会静默回原文）—— 助手失败必须可见。
 */
async function chat(cfg, system, user, { maxTokens = 600 } = {}) {
  const { text } = await chatWithChain(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    {
      config: { baseURL: cfg.baseURL, apiKey: cfg.apiKey, model: cfg.model },
      maxTokens,
      timeoutMs: TIMEOUT_MS,
    },
  )
  return text
}

const clip = (s, n = MAX_TEXT) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)

/* ---------------- 三个动作 ---------------- */

async function polish(body) {
  const name = clip(body.name, 80)
  const desc = clip(body.desc, MAX_TEXT)
  if (!name && !desc) return { ok: false, error: '没有可润色的内容' }
  const text = await chat(
    aiConfig(),
    '你是导航站点的文案编辑。把给定的名称/描述润色成更简洁准确的中文，保持事实不变（不要编造功能、不要夸大），'
      + '输出严格 JSON：{"name":"...","desc":"..."}。name 不超过 24 字，desc 不超过 60 字。'
      + '如果原文已经是好的，就原样返回。',
    `名称：${name}\n描述：${desc}`,
    { maxTokens: 300 },
  )
  const out = parseJsonLoose(text)
  if (!out || (!out.name && !out.desc)) return { ok: false, error: '模型没有给出可用结果', raw: text.slice(0, 200) }
  return { ok: true, name: clip(out.name, 40), desc: clip(out.desc, 120) }
}

async function categorize(body) {
  const items = Array.isArray(body.sites) ? body.sites.slice(0, MAX_BATCH) : []
  if (!items.length) return { ok: false, error: '没有待分类的站点' }
  const existing = Array.isArray(body.categories) ? body.categories.slice(0, 60).map(c => `${c.id}=${c.label}`) : []
  const list = items.map((s, i) => `${i + 1}. ${clip(s.name, 40)} | ${clip(s.url, 60)} | ${clip(s.desc, 60)}`).join('\n')

  const text = await chat(
    aiConfig(),
    '你是网址导航的分类助手。为每个站点选一个最贴切的分类。'
      + `可用分类（id=名称）：${existing.join('、') || '（无，请给出建议新分类名）'}。`
      + '优先复用已有分类；确实没有合适的才用 {"new":"建议名"}。'
      + '输出严格 JSON 数组： [{"i":1,"id":"coding","label":"编程与开发"},{"i":2,"new":"设计工具"}]',
    list,
    { maxTokens: 800 },
  )
  const parsed = parseJsonLoose(text)
  if (!Array.isArray(parsed)) return { ok: false, error: '模型没有给出可用分类', raw: text.slice(0, 200) }
  const byIndex = new Map()
  for (const r of parsed) {
    const i = Number(r && r.i)
    if (!Number.isFinite(i) || i < 1 || i > items.length) continue
    byIndex.set(i, r)
  }
  const suggestions = items.map((s, idx) => {
    const r = byIndex.get(idx + 1)
    const base = { id: s.id, name: clip(s.name, 40) }
    if (!r) return { ...base, kind: 'keep' }
    if (r.new) return { ...base, kind: 'new', label: clip(r.new, 16) }
    const known = existing.some(x => x.split('=')[0] === String(r.id))
    // ⚠️ 分类 id 必须放 `categoryId`，**不能**覆盖 `id` —— `id` 是站点 id。
    // 早先这里写成 `id: String(r.id)`，把站点 id 覆盖成了分类 id，
    // 于是前端「应用」时拿分类 id 去 updateSiteField，写进一个不存在的站点（静默无效）。
    return known
      ? { ...base, kind: 'use', categoryId: String(r.id), label: clip(r.label, 16) }
      : { ...base, kind: 'new', label: clip(r.label || r.id, 16) }
  })
  return { ok: true, suggestions }
}

async function summarize(body) {
  const down = Array.isArray(body.down) ? body.down.slice(0, MAX_BATCH) : []
  if (!down.length) return { ok: true, summary: '当前没有需要处理的异常站点。' }
  const list = down.map((s, i) => `${i + 1}. ${clip(s.name, 40)}（${clip(s.url, 50)}）`).join('\n')
  const text = await chat(
    aiConfig(),
    '你是站点运维助手。下面是探活判定为「需处理」的站点。请用两三句中文归纳：'
      + '可能的共同原因（例如对方集体改版/域名到期/我们的网络出口被封），以及建议先看什么。'
      + '不要编造未给出的信息，不要逐条复述。',
    list,
    { maxTokens: 400 },
  )
  return { ok: true, summary: clip(text, 600) }
}

/**
 * 批量生成 / 改写站点描述（#13）。
 *
 * 只依据**站名、域名、分类**推断，并明确要求模型不要编造具体功能、价格、数据 ——
 * 描述会被写进导航库，编造的「支持 XX 协议」比空描述更糟。拿不准就写得通用一点。
 * 已有的、看起来不空的描述也一并交给模型判断「要不要重写」：它比人工一条条看快得多，
 * 但仍**只出建议**，写库由用户在面板上确认后触发（与 categorize 同一纪律）。
 */
async function describe(body) {
  const items = Array.isArray(body.sites) ? body.sites.slice(0, MAX_BATCH) : []
  if (!items.length) return { ok: false, error: '没有待生成描述的站点' }
  const list = items
    .map((s, i) => `${i + 1}. ${clip(s.name, 40)} | ${clip(s.url, 60)} | 分类：${clip(s.categoryLabel || s.categoryId, 20)} | 现有描述：${clip(s.desc, 60) || '（空）'}`)
    .join('\n')

  const text = await chat(
    aiConfig(),
    '你是网址导航的文案编辑。为每个站点写一句中文简介（30~60 字），说明它是做什么的、对什么人有帮助。'
      + '只依据给出的站名 / 域名 / 分类推断，不要编造具体功能、价格、数字与版本号；拿不准就写得通用一点。'
      + '已有描述已经清楚准确的，原样返回；空泛或错误的才重写。'
      + '输出严格 JSON 数组：[{"i":1,"desc":"..."}]',
    list,
    { maxTokens: 900 },
  )
  const parsed = parseJsonLoose(text)
  if (!Array.isArray(parsed)) return { ok: false, error: '模型没有给出可用描述', raw: text.slice(0, 200) }
  const byIndex = new Map()
  for (const r of parsed) {
    const i = Number(r && r.i)
    if (Number.isFinite(i) && i >= 1 && i <= items.length) byIndex.set(i, r)
  }
  const results = items.map((s, idx) => {
    const r = byIndex.get(idx + 1)
    const desc = r ? clip(r.desc, 120) : ''
    return {
      id: s.id,
      name: clip(s.name, 40),
      desc,
      changed: Boolean(desc) && desc !== String(s.desc || '').trim(),
    }
  })
  return { ok: true, results }
}

/** 模型偶尔会给 JSON 裹上 ```json 或加一句废话，做一次宽松提取 */
function parseJsonLoose(text) {
  const s = String(text || '').trim()
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1].trim() : s
  try { return JSON.parse(body) } catch { /* 继续尝试截取 */ }
  const a = body.indexOf('{'), b = body.indexOf('[')
  const start = a === -1 ? b : (b === -1 ? a : Math.min(a, b))
  if (start === -1) return null
  const end = body.lastIndexOf('}')
  const end2 = body.lastIndexOf(']')
  const stop = Math.max(end, end2)
  if (stop <= start) return null
  try { return JSON.parse(body.slice(start, stop + 1)) } catch { return null }
}

const ACTIONS = { polish, categorize, summarize, describe }

export default async function handler(req, res) {
  noStore(res)
  const cfg = aiConfig()

  // 可用性自检：前端拿它决定入口显不显示（不泄露任何 key 材料）
  if (req.method === 'GET') {
    res.status(200).json({
      ok: true, ready: cfg.ready, model: cfg.ready ? cfg.model : '',
      actions: Object.keys(ACTIONS),
      // 前端据此决定「润色」是出现在添加弹窗里（免鉴权）还是只在后台出现
      publicActions: [...PUBLIC_ACTIONS],
    })
    return
  }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Method not allowed' }); return }

  // body 要先读出来才能分流鉴权：路由取决于 action，而不是请求头
  let body
  try { body = await readBody(req) } catch { res.status(400).json({ ok: false, error: 'Invalid JSON body' }); return }
  const action = String(body.action || '')

  if (PUBLIC_ACTIONS.has(action)) {
    // 免鉴权路径：只查额度、不看 admin key（理由见文件头 PUBLIC_ACTIONS 的注释）
    const q = await quotaTake(ipFingerprint(clientIp(req)), dayKey())
    if (!q.ok) {
      res.status(429).json({ ok: false, error: `今日润色额度已用完（${PUBLIC_DAILY} 次/天）` })
      return
    }
  } else {
    const auth = checkAuthHeader(req)
    if (!auth.ok) { res.status(auth.code).json({ ok: false, error: auth.error }); return }
  }

  if (!cfg.ready) {
    res.status(501).json({ ok: false, error: 'AI 未配置：请在 data/ai-config.json 或环境变量里设置 AI_BASE_URL 与 AI_API_KEY' })
    return
  }

  const fn = ACTIONS[action]
  if (!fn) { res.status(400).json({ ok: false, error: `未知动作（可用：${Object.keys(ACTIONS).join(' / ')}）` }); return }

  try {
    res.status(200).json(await fn(body))
  } catch (e) {
    const upstream = e && e.upstream
    res.status(upstream ? 502 : 500).json({ ok: false, error: String((e && e.message) || e), upstream: upstream || 0 })
  }
}