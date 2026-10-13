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
 *
 * 引擎可拔插：内核只保留「该不该译 / 传什么 / 拿到空怎么办」，
 * 具体译厂（URL 构造 + 响应解析）注册到 shared/translate-engine.mjs 的注册表。
 * 本文件在加载时把内建两引擎注册进去，**默认顺序与行为完全不变**。
 */

import { registerTranslator, translateWithChain } from './translate-engine.mjs'

/* ---------------- 中文判定 ---------------- */

// 判定「该不该译」的纯逻辑已拆到 shared/translatable.mjs —— 前端（L2 本地模型）
// 需要同一套判据，而本文件禁止被 src/ 引用（它带着出网细节）。这里 re-export 保持
// 既有 import 路径不变，真相仍只有一份。
export { looksChinese, needsTranslation, shouldTranslateName } from './translatable.mjs'
import { needsTranslation, shouldTranslateName } from './translatable.mjs'

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
    if (typeof t !== 'string') return ''
    // MyMemory 免费额度耗尽时不报错，而是在译文位置回一句警告 —— 不能把它当译文收下
    if (/MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID (SOURCE|TARGET)/i.test(t)) return ''
    return unescapeEntities(t).trim()
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

/* ---------------- 内建引擎注册 ---------------- */

/**
 * 默认顺序 MyMemory(100) → Google(200)，按部署网络实测定的（见 translateToZh 注释）。
 * 数字留空档，便于日后在中间插入自建引擎（LLM 引擎已由注册表以 300 排在链尾）。
 */

registerTranslator({
  id: 'mymemory',
  label: 'MyMemory',
  order: 100,
  buildUrl: (text, { from = 'en', to = 'zh-CN' } = {}) => myMemoryUrl(text, { from, to }),
  parse: parseMyMemory,
})

registerTranslator({
  id: 'google',
  label: 'Google（非官方）',
  order: 200,
  buildUrl: (text) => googleUrl(text),
  parse: (raw) => parseGoogle(raw).text,
})

/* ---------------- 主入口 ---------------- */

/**
 * 翻译单条文本。默认按注册链顺序尝试：**MyMemory 优先，Google 兜底**。
 *
 * 顺序是按部署环境实测定的：服务器在国内网络时 `translate.googleapis.com` 不可达，
 * 请求会一直挂到超时 —— 而它排在首位时会把整个翻译预算吃光，让可达的 MyMemory
 * 根本轮不到执行（线上实测两个引擎都返回空）。反过来 MyMemory 响应快且国内可达，
 * 先走它几乎总是命中；本机/海外部署时 Google 依旧作为兜底可用。
 * 两个都拿不到就返回空串 —— 调用方据此保留原文，绝不写入空译文。
 *
 * 顺序与集合可覆盖：`NAV_TRANSLATE_ENGINES=mymemory,google`（逗号分隔），
 * 或传 `chain` 显式指定；可用引擎见 shared/translate-engine.mjs 的 listTranslators()。
 *
 * @param {string} text
 * @param {{ fetchText: (url: string, init?: object) => Promise<string>, from?: string, to?: string, chain?: object[] }} opts
 * @returns {Promise<{ text: string, engine: string }>}
 */
export async function translateToZh(text, { fetchText, from = 'en', to = 'zh-CN', chain } = {}) {
  return translateWithChain(text, { fetchText, from, to, chain })
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