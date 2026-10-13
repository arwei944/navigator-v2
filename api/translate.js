/**
 * 翻译接口：`GET /api/translate?name=&desc=`
 *
 * ## 为什么把它从 `/api/metadata` 拆出来
 *
 * 翻译是整条「添加站点」链路上**最慢、最不可控**的一段：等 MyMemory 往返（0.5~3s），
 * 而它的额度是按出口 IP 计的日配额，随时会被共享 IP 用完。把它串在抓取响应里，
 * 等于让**每一次**添加都为一个可能失败的外部调用多等几秒 —— 线上实测
 * figma.com 端到端 10.3s，其中很大一块就是这里。
 *
 * 拆开之后：抓取该多快就多快，翻译由前端**异步**补上（复用已有的两段式升级通道），
 * 用户在抓取完成的那一刻就已经看到真实名称与原文描述，中文稍后到。
 *
 * ## 三层里的位置
 *
 * 这个接口提供 **L1（离线词表）+ L3（在线免密钥引擎）**；
 * **L2（浏览器本地模型）在前端**，不走网络 —— 见 `src/services/browserTranslate.js`。
 * 前端按 L2 → L3 → L1 的顺序取第一个拿得到的。
 *
 * ## 返回
 *
 * ```json
 * {
 *   "name": "…", "desc": "…",                    // 译后（没译成则等于原文）
 *   "original": { "name": "…", "desc": "…" },   // 原文，UI 可做对照
 *   "translated": { "name": false, "desc": false },
 *   "engines": { "name": "", "desc": "" },      // mymemory | google | ''
 *   "keywords": "免费 · 在线 · 工具",             // ★ L1，恒有（无网也拿得到）
 *   "keywordSource": "glossary"                  // 关键词来源，空串表示没抽出来
 * }
 * ```
 */
import { translateSiteFields, needsTranslation, shouldTranslateName } from '../shared/translate.mjs'
import { glossaryGloss } from '../shared/glossary.mjs'
import { rejectAbusive } from '../shared/rate-limit.mjs'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/** 单次请求的整体预算：翻译是异步补的，慢一点用户可以接受，但不能挂住函数 */
const TRANSLATE_BUDGET_MS = 6000

/** 单条文本的长度上限（与 shared/translate.mjs 的 MAX_LEN 同量级，防止被塞长文刷额度） */
const MAX_FIELD_LEN = 600

/** 字段裁剪：超长直接截断而不是拒绝 —— 用户不该为一个过长描述看到报错 */
const clip = (s) => String(s ?? '').slice(0, MAX_FIELD_LEN)

export default async function handler(req, res) {
  if (rejectAbusive(req, res)) return

  const name = clip(req.query.name)
  const desc = clip(req.query.desc)

  if (!name && !desc) {
    res.status(400).json({ error: '缺少 name 或 desc 参数' })
    return
  }

  res.setHeader('Cache-Control', 'no-store')

  /**
   * L1：离线词表，**恒定先算**。
   *
   * 它是这条链路上唯一「永不失败」的东西 —— 纯本地计算、0ms、不需要网络、没有配额。
   * 放在最前面算，是因为即使后面 L3 全部超时，这一项也已经有了。
   */
  const kwName = glossaryGloss(name)
  const kwDesc = glossaryGloss(desc)
  const keywords = kwDesc.text || kwName.text || ''

  /** 该不该译：名称走品牌名保护（单词型视为品牌，不译），描述非中文即译 */
  const want = {
    name: shouldTranslateName(name),
    desc: needsTranslation(desc),
  }

  if (!want.name && !want.desc) {
    // 不需要翻译（已是中文 / 是品牌名 / 是空串）—— 直接返回 L1 结果，一次网络都不出
    res.status(200).json({
      name, desc,
      original: { name, desc },
      translated: { name: false, desc: false },
      engines: { name: '', desc: '' },
      keywords,
      keywordSource: keywords ? 'glossary' : '',
      skipped: 'not-needed',
    })
    return
  }

  // L3：在线免密钥引擎（MyMemory 优先、Google 兜底）。失败就退回原文，绝不写空译文。
  const out = await onlineTranslate({ name, desc }, UA, TRANSLATE_BUDGET_MS)

  res.status(200).json({
    name: out.name,
    desc: out.desc,
    original: out.original,
    translated: out.translated,
    engines: out.engines,
    keywords,
    keywordSource: keywords ? 'glossary' : '',
  })
}

/**
 * L3 的传输层：把超时控制与错误吞掉都收在这里。
 * 内核（shared/translate.mjs）负责「该不该译 / 怎么解析 / 怎么兜底」，
 * 这里只管发请求。任何异常都静默退回原文 —— 译文为空时调用方保留原文。
 */
async function onlineTranslate({ name, desc }, ua, timeoutMs) {
  const original = { name, desc }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  // 支持引擎传入 init（LLM 引擎需要 POST）；只提供 GET 的引擎不受影响
  const fetchText = async (url, init) => {
    const r = await fetch(url, {
      ...init,
      headers: { 'user-agent': ua, ...((init && init.headers) || {}) },
      signal: controller.signal,
    })
    if (!r.ok) throw new Error(`translate http ${r.status}`)
    return r.text()
  }
  try {
    const t = await translateSiteFields({ name, desc }, { fetchText })
    return {
      name: t.name,
      desc: t.desc,
      original: t.original,
      translated: t.translated,
      engines: t.engines,
    }
  } catch {
    return { ...original, original, translated: { name: false, desc: false }, engines: { name: '', desc: '' } }
  } finally {
    clearTimeout(timer)
  }
}
