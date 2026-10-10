import { ref } from 'vue'
import Fuse from 'fuse.js'
import { purposeLabel } from '../../shared/purposes.mjs'

/**
 * 站点检索内核：页面搜索框与命令面板共用同一套评分与排序，
 * 避免「同一关键词两处结果不同」。纯函数，不依赖 Pinia。
 *
 * ## pinyin-pro 为什么是懒加载的（改这块前必读）
 *
 * `pinyin-pro` 是整个应用里最大的单个依赖：**317 KB raw**，比 vue + pinia + router
 * 加起来还大。而它只在「用户输入了搜索词、且中文站名要靠拼音命中」时才用得上 ——
 * 首屏一次都不用。此前它是静态 import，于是这部分体积压在首屏关键路径上，白下白解析。
 *
 * 现在改为动态 import，于是：
 *   - 构建时 pinyin-pro 被切成独立 chunk，首屏不请求它；
 *   - `preloadPinyin()` 在启动后空闲时把它取回来（用户真开始打字时通常已就绪）；
 *   - 引擎没到位时 `keysOf` 把拼音字段算成空串 → **降级为「无拼音命中」**，
 *     中文名与描述的直接命中、别名、域名、Fuse 模糊兜底全部照常工作；
 *   - `pinyinReady` 是响应式信号，且**在 keysOf / textKeys 内部被读取** ——
 *     于是「引擎到位」会自动让依赖检索结果的 computed 重算一次（sitesStore.filteredSites、
 *     全能框的 siteResults…），不需要每个消费方各自去订阅。
 *
 * 降级窗口只有从「首屏」到「空闲时预取完成」这一小段，正常网络下用户还没打完第一个字。
 *
 * ## 评分分档（越高越靠前）
 *
 *   名称精确 > 别名精确 > 名称前缀 > 别名前缀 > 名称包含 > 别名包含
 *   > 域名包含 > 用途命中 > 描述包含 > 拼音首字母前缀 > 别名拼音首字母前缀
 *   > 拼音名包含 > 别名拼音包含 > 拼音描述包含
 * 别名是站点的「另一个叫法」（币安 / 小狐狸 / 抱抱脸），因此排在主名称
 * 同名档位之后、域名与描述之前——既让俗称找得到，又不喧宾夺主。
 * 全部未命中时退化为 Fuse 模糊匹配，容忍拼写错误。
 */

/** 拼音引擎是否就绪（响应式：见文件头注释里对消费方的说明） */
export const pinyinReady = ref(false)

/** 键表要能被整体换掉（见 preloadPinyin 里的说明），所以不能用 const */
let keyCache = new WeakMap()

let pinyinLib = null
let pinyinLoading = null
let pinyinFailedAt = 0

/** 取一次拼音引擎；未就绪返回 null，调用方据此降级 */
function py(text, opts) {
  if (!pinyinLib) return ''
  try {
    return pinyinLib(text, opts)
  } catch {
    // 拼音库对个别符号串会抛 —— 退化为「这条没有拼音键」而不是让整次检索失败
    return ''
  }
}

/**
 * 预取拼音引擎。幂等、可重入、不阻塞：
 * 失败后 5s 内不再重试，避免网络不通时每次按键都打一个必然失败的请求。
 */
export function preloadPinyin() {
  // 已就绪：回一个已兑现的 promise，让 `await preloadPinyin()` 永远拿到函数本身。
  // （早先直接 `return pinyinLoading` 会在加载完成后返回 null —— 调用方 await 到 null，
  //   虽然当前调用方都忽略返回值，但这是个会咬人的接口。）
  if (pinyinLib) return Promise.resolve(pinyinLib)
  if (pinyinLoading) return pinyinLoading
  if (pinyinFailedAt && Date.now() - pinyinFailedAt < 5000) return null
  pinyinLoading = import('pinyin-pro')
    .then(m => {
      pinyinLib = m.pinyin
      // 丢弃降级期间算出的键：它们没有拼音字段，留着会让「引擎到位」也搜不出拼音结果。
      // WeakMap 没有 clear()，整体换一个是等价的（旧表会被 GC 回收）。
      keyCache = new WeakMap()
      textKeyCache.clear()
      pinyinReady.value = true
      return pinyinLib
    })
    .catch(() => {
      pinyinFailedAt = Date.now()
      return null
    })
    .finally(() => { pinyinLoading = null })
  return pinyinLoading
}

function keysOf(site) {
  // 读一下就绪信号，让调用它的 computed 在引擎到位后自动重算（见文件头）
  void pinyinReady.value
  // 引擎没到位就顺手催一次，别让用户第一次搜索走完降级路径
  if (!pinyinLib) preloadPinyin()

  let k = keyCache.get(site)
  if (k) return k
  const name = String(site?.name ?? '')
  const desc = String(site?.desc ?? '')
  const aliases = Array.isArray(site?.aliases) ? site.aliases.map(a => String(a ?? '')) : []
  // 用途既能按中文标签（查资料）也能按英文 id（reference）命中，两种写法拼成一段可搜文本
  const purposes = (Array.isArray(site?.purposes) ? site.purposes : []).map(p => String(p ?? ''))
  k = {
    name: name.toLowerCase(),
    desc: desc.toLowerCase(),
    url: String(site?.url ?? '').toLowerCase(),
    aliases: aliases.map(a => a.toLowerCase()),
    purposes: purposes.map(p => p.toLowerCase()),
    purposeText: purposes.map(p => purposeLabel(p)).filter(Boolean).join(' ').toLowerCase(),
    pyName: py(name, { toneType: 'none', separator: '' }).toLowerCase(),
    pyInitial: py(name, { pattern: 'first', toneType: 'none', separator: '' }).toLowerCase(),
    pyDesc: py(desc, { toneType: 'none', separator: '' }).toLowerCase(),
    pyAliases: aliases.map(a => py(a, { toneType: 'none', separator: '' }).toLowerCase()),
    pyAliasInitial: aliases.map(a => py(a, { pattern: 'first', toneType: 'none', separator: '' }).toLowerCase())
  }
  keyCache.set(site, k)
  return k
}

export const SCORE = {
  NAME_EXACT: 1000,
  ALIAS_EXACT: 940,
  NAME_PREFIX: 820,
  ALIAS_PREFIX: 760,
  NAME_INCLUDES: 640,
  ALIAS_INCLUDES: 580,
  URL_INCLUDES: 520,
  PURPOSE_INCLUDES: 500,
  DESC_INCLUDES: 440,
  PY_INITIAL_PREFIX: 400,
  PY_ALIAS_INITIAL_PREFIX: 380,
  PY_NAME_INCLUDES: 340,
  PY_ALIAS_INCLUDES: 320,
  PY_DESC_INCLUDES: 200
}

const anyStarts = (arr, q) => arr.some(a => a.startsWith(q))
const anyIncludes = (arr, q) => arr.some(a => a.includes(q))

export function scoreSite(site, q) {
  if (!q) return 0
  const k = keysOf(site)
  if (k.name === q) return SCORE.NAME_EXACT
  if (k.aliases.includes(q)) return SCORE.ALIAS_EXACT
  if (k.name.startsWith(q)) return SCORE.NAME_PREFIX
  if (anyStarts(k.aliases, q)) return SCORE.ALIAS_PREFIX
  if (k.name.includes(q)) return SCORE.NAME_INCLUDES
  if (anyIncludes(k.aliases, q)) return SCORE.ALIAS_INCLUDES
  if (k.url.includes(q)) return SCORE.URL_INCLUDES
  // 用途是受控词表，命中即「这条站就是干这个的」，比描述里的顺带提及更可信，故排在描述之前
  if (anyIncludes(k.purposes, q) || k.purposeText.includes(q)) return SCORE.PURPOSE_INCLUDES
  if (k.desc.includes(q)) return SCORE.DESC_INCLUDES
  if (k.pyInitial.startsWith(q)) return SCORE.PY_INITIAL_PREFIX
  if (anyStarts(k.pyAliasInitial, q)) return SCORE.PY_ALIAS_INITIAL_PREFIX
  if (k.pyName.includes(q)) return SCORE.PY_NAME_INCLUDES
  if (anyIncludes(k.pyAliases, q)) return SCORE.PY_ALIAS_INCLUDES
  if (k.pyDesc.includes(q)) return SCORE.PY_DESC_INCLUDES
  return 0
}

/**
 * Fuse 实例按「站点数组引用」缓存。
 *
 * 建索引是 O(n)，而输入时前几个字符往往零命中，每敲一键就要走这条兜底路径。
 * 数组引用在列表内容没变时是稳定的（见 sites.js 的 rebuild：未变的站点沿用旧对象，
 * 全表恒等时连数组引用都不换），所以同一批数据只会建一次索引；数据一变引用就变，
 * 缓存自然失效，不会读到陈旧索引。
 */
let fuseCache = { sites: null, fuse: null }

function fuzzySites(sites, q) {
  try {
    if (fuseCache.sites !== sites) {
      fuseCache = {
        sites,
        fuse: new Fuse(sites, {
          keys: [
            { name: 'name', weight: 2 },
            { name: 'aliases', weight: 1.6 },
            { name: 'desc', weight: 1 },
            { name: 'url', weight: 1 }
          ],
          threshold: 0.4,
          includeScore: true
        })
      }
    }
    return fuseCache.fuse.search(q).map(r => r.item)
  } catch {
    return []
  }
}

/**
 * 按相关性返回排序后的站点数组；query 为空时返回空数组。
 * tieBreak 仅用于同一评分档位内部的先后（稳定排序不会跨档乱序），
 * 因此「切换排序方式」不会推翻相关性。
 */
export function rankSites(sites, query, { limit, tieBreak } = {}) {
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return []
  const scored = []
  for (const s of sites) {
    const score = scoreSite(s, q)
    if (score > 0) scored.push({ site: s, score })
  }
  let out
  if (scored.length) {
    scored.sort((a, b) => (b.score - a.score) || (tieBreak ? tieBreak(a.site, b.site) : 0))
    out = scored.map(x => x.site)
  } else {
    // 模糊兜底已按 Fuse 自身评分排序，不再叠加 tieBreak 以免打乱
    out = fuzzySites(sites, q)
  }
  return typeof limit === 'number' ? out.slice(0, limit) : out
}

/**
 * 返回命中的别名（含拼音 / 拼音首字母命中），用于在结果里解释
 * 「这条为什么会出现」。命中优先级与评分一致：精确 > 前缀 > 包含 > 拼音。
 * 无命中返回 ''。
 */
export function matchedAlias(site, query) {
  const q = String(query ?? '').trim().toLowerCase()
  const aliases = Array.isArray(site?.aliases) ? site.aliases : []
  if (!q || !aliases.length) return ''
  const lower = aliases.map(a => String(a ?? '').toLowerCase())
  let i = lower.indexOf(q)
  if (i === -1) i = lower.findIndex(a => a && a.startsWith(q))
  if (i === -1) i = lower.findIndex(a => a && a.includes(q))
  // 拼音两档只在引擎就绪时可能命中；py() 未就绪返回 ''，下面的 includes/startsWith 自然为假
  if (i === -1) i = lower.findIndex(a => a && py(a, { toneType: 'none', separator: '' }).toLowerCase().includes(q))
  if (i === -1) i = lower.findIndex(a => a && py(a, { pattern: 'first', toneType: 'none', separator: '' }).toLowerCase().startsWith(q))
  return i === -1 ? '' : aliases[i]
}

/* ─────────────────────────────────────────────────────────────
 * 通用文本打分：命令名 / 页面名 / 分类名 / 用途名复用。
 * 与站点打分同源（同一个 pinyin-pro、同一套「精确 > 前缀 > 包含 > 拼音」档位序），
 * 这样「切换主题」打 zhuti / zt 能和站点一样被搜到——命令面板时代这四类
 * 只有 String.includes，中文命令靠拼音根本搜不出来。
 * ───────────────────────────────────────────────────────────── */

const TEXT_SCORE = {
  EXACT: 900,
  PREFIX: 700,
  INCLUDES: 500,
  PY_INITIAL_PREFIX: 380,
  PY_PREFIX: 360,
  PY_INCLUDES: 260
}

// 文本量级远小于站点且基本固定（命令 45 条 + 分类 37 + 用途 12），用 Map 裸缓存即可
const textKeyCache = new Map()

function textKeys(text) {
  // 与 keysOf 同理：读一下就绪信号，让依赖命中的 computed 在引擎到位后重算
  void pinyinReady.value
  if (!pinyinLib) preloadPinyin()
  const src = String(text ?? '')
  let k = textKeyCache.get(src)
  if (k) return k
  // 引擎未就绪时 py() 返回 ''，等价于「这条没有拼音键」，中文/英文的直接命中不受影响
  const pyFull = py(text, { toneType: 'none', separator: '' }).toLowerCase().replace(/\s+/g, '')
  const pyInitial = py(text, { pattern: 'first', toneType: 'none', separator: '' }).toLowerCase().replace(/\s+/g, '')
  k = { lower: src.toLowerCase(), py: pyFull, pyInitial }
  textKeyCache.set(src, k)
  return k
}

/** 单条文本对 query 的相关度，0 = 未命中。字符串数组（如关键词表）用 matchAny。 */
export function scoreText(text, query) {
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return 0
  const k = textKeys(text)
  if (!k.lower) return 0
  if (k.lower === q) return TEXT_SCORE.EXACT
  if (k.lower.startsWith(q)) return TEXT_SCORE.PREFIX
  if (k.lower.includes(q)) return TEXT_SCORE.INCLUDES
  if (k.pyInitial && k.pyInitial.startsWith(q)) return TEXT_SCORE.PY_INITIAL_PREFIX
  if (k.py && k.py.startsWith(q)) return TEXT_SCORE.PY_PREFIX
  if (k.py && k.py.includes(q)) return TEXT_SCORE.PY_INCLUDES
  return 0
}

/** 对一组文本（标题 + 副标题 + 关键词表）打分，取最高值。 */
export function matchAny(list, query) {
  let best = 0
  for (const t of list) {
    if (!t) continue
    const s = scoreText(t, query)
    if (s > best) best = s
  }
  return best
}

/** 把 text 按 query 切成分段，供模板用 <mark> 渲染，替代 v-html。 */
export function splitHighlight(text, query) {
  const src = String(text ?? '')
  const q = String(query ?? '').trim()
  if (!q) return [{ text: src, hit: false }]
  const lower = src.toLowerCase()
  const needle = q.toLowerCase()
  const parts = []
  let i = 0
  for (;;) {
    const at = lower.indexOf(needle, i)
    if (at === -1) {
      if (i < src.length) parts.push({ text: src.slice(i), hit: false })
      break
    }
    if (at > i) parts.push({ text: src.slice(i, at), hit: false })
    parts.push({ text: src.slice(at, at + needle.length), hit: true })
    i = at + needle.length
  }
  return parts.length ? parts : [{ text: src, hit: false }]
}