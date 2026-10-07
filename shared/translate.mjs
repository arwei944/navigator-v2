/**
 * 免密钥翻译内核：把「非中文」的站点名称 / 描述译成中文。
 *
 * 为什么不用 AI：项目没有接入任何 AI 服务，也没有可用的 API Key。翻译只是
 * 「把外文站点简介变成中文」这一个窄用途，不值得为它引入密钥管理与计费链路，
 * 因此走公开的免密钥接口：Google 非官方翻译接口为主，MyMemory 为兜底。
 *
 * 传输层用注入的 fetchText 而非直接 fetch：
 *   - 线上 api/metadata.js 走 Node 原生 fetch（与它的抓取同一条链路、共享超时）；
 *   - 本地控制台 tools/console 走 curl.exe（本机 Node fetch 不走系统代理，会连不通）。
 * 内核只负责「该不该译 / 怎么解析 / 怎么兜底」，不关心用什么发请求。
 *
 * 硬约束：本文件只在 Node 侧被引用（api/、tools/），**不得被 src/ 引用** ——
 * 它依赖网络能力，一旦被前端打包会把不存在的传输层带进浏览器。
 */

/* ---------------- 中文判定 ---------------- */

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

/* ---------------- 解析 ---------------- */

/** MyMemory 会把撇号等转成 HTML 实体，落库前还原成字符 */
function unescapeEntities(str) {
  return String(str)
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/**
 * Google 非官方接口返回嵌套数组：[[["译文","原文",…], …], null, "en", …]。
 * 按段拼接是因为长文本会被切成多段，只取第一段会丢半句。
 */
export function parseGoogle(raw) {
  try {
    const data = JSON.parse(String(raw ?? ''))
    const segs = Array.isArray(data?.[0]) ? data[0] : []
    const text = segs.map(s => (Array.isArray(s) ? s[0] : '')).filter(Boolean).join('')
    return { text: text.trim(), source: typeof data?.[2] === 'string' ? data[2] : '' }
  } catch {
    return { text: '', source: '' }
  }
}

export function parseMyMemory(raw) {
  try {
    const j = JSON.parse(String(raw ?? ''))
    const t = j?.responseData?.translatedText
    return typeof t === 'string' ? unescapeEntities(t).trim() : ''
  } catch {
    return ''
  }
}

/* ---------------- 接口地址 ---------------- */

const GOOGLE = 'https://translate.googleapis.com/translate_a/single'
const MYMEMORY = 'https://api.mymemory.translated.net/get'

/** 单条文本长度上限：MyMemory 兜底接口对超长文本会直接报错，先截断保底 */
const MAX_LEN = 480

export function googleUrl(text, { to = 'zh-CN' } = {}) {
  const q = String(text ?? '').slice(0, MAX_LEN)
  const params = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: to, dt: 't', q })
  return `${GOOGLE}?${params.toString()}`
}

export function myMemoryUrl(text, { from = 'en', to = 'zh-CN' } = {}) {
  const q = String(text ?? '').slice(0, MAX_LEN)
  const params = new URLSearchParams({ q, langpair: `${from}|${to}` })
  return `${MYMEMORY}?${params.toString()}`
}

/* ---------------- 主入口 ---------------- */

/**
 * 翻译单条文本。Google 优先，失败（网络 / 解析不出内容）时退 MyMemory。
 * 两个都拿不到就返回空串 —— 调用方据此保留原文，绝不写入空译文。
 *
 * @param {string} text
 * @param {{ fetchText: (url: string) => Promise<string>, from?: string }} opts
 * @returns {Promise<{ text: string, engine: string }>}
 */
export async function translateToZh(text, { fetchText, from = 'en' } = {}) {
  const src = String(text ?? '').trim()
  if (!src || typeof fetchText !== 'function') return { text: '', engine: '' }

  try {
    const { text: out, source } = parseGoogle(await fetchText(googleUrl(src)))
    if (out && out !== src) return { text: out, engine: 'google' }
  } catch { /* 换兜底引擎 */ }

  try {
    const out = parseMyMemory(await fetchText(myMemoryUrl(src, { from })))
    if (out && out !== src) return { text: out, engine: 'mymemory' }
  } catch { /* 两个引擎都不可用，返回空串由调用方保留原文 */ }

  return { text: '', engine: '' }
}

/**
 * 批量翻译站点的 name / desc（并行，减少一次补全的等待）。
 * 只处理需要翻译的字段：name 走品牌名保护规则（见 shouldTranslateName），
 * desc 非中文即译。译文为空时该字段保持原值，并把 translated 标记为 false。
 *
 * @returns {Promise<{ name: string, desc: string, translated: { name: boolean, desc: boolean }, original: { name: string, desc: string }, engines: object }>}
 */
export async function translateSiteFields({ name = '', desc = '' } = {}, { fetchText, from = 'en' } = {}) {
  const original = { name: String(name ?? ''), desc: String(desc ?? '') }
  const wantName = shouldTranslateName(original.name)
  const wantDesc = needsTranslation(original.desc)

  const [nameRes, descRes] = await Promise.all([
    wantName ? translateToZh(original.name, { fetchText, from }) : Promise.resolve({ text: '', engine: '' }),
    wantDesc ? translateToZh(original.desc, { fetchText, from }) : Promise.resolve({ text: '', engine: '' }),
  ])

  return {
    name: nameRes.text || original.name,
    desc: descRes.text || original.desc,
    translated: { name: Boolean(nameRes.text), desc: Boolean(descRes.text) },
    original,
    engines: { name: nameRes.engine, desc: descRes.engine },
  }
}