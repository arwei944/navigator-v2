/**
 * 「秒加之后的真实补全」：站点已入库，再异步把域名推断值换成真信息。
 *
 * ## 为什么必须有独立模块
 *
 * 这段逻辑原先长在 `services/autoAdd.js` 里，是一个模块级函数，却引用了
 * `runAutoAdd()` 内部的局部变量 `sitesStore` —— 运行时每跑必抛 ReferenceError，
 * 而调用处挂着 `.catch(() => {})`，于是**抓取、翻译、改写全部静默失败**：
 * 用户看到的永远是秒加那一刻的域名推断草稿，后台升级从未生效过一次。
 *
 * 所以这里做两件事：
 *   ① **依赖全部显式注入**（store / fetchMeta / translate / warn），作用域漏取这类缺陷结构上不可能再发生；
 *   ② 不吞错 —— 抓取失败是预期内的（静默），**代码抛错走 `warn`**，不再和前者混为一谈。
 *
 * 纯函数（`upgradePatchFromMeta`）与编排（`runMetaUpgrade`）分开，前者可零依赖穷举。
 *
 * ## 关于翻译（本轮改造）
 *
 * `/api/metadata` **不再内联翻译**（它曾为等一个可能失败的 MyMemory 往返多花最多 3.5s，
 * 是 figma.com 端到端 10.3s 的一大块）。现在它返回原文 + `needsTranslate`，
 * 由这里异步补译：**L2 浏览器本地模型 → L3 服务端在线引擎 → L1 离线词表关键词**。
 * 译文只覆盖「确实译到了」的字段，译不到就保留原文并如实标注来源。
 */
import { hostOf } from '../utils/url.js'
import { domainOf } from '../utils/siteDraft.js'
import { fetchSiteMeta, META_TIMEOUT_MS } from './meta.js'

/** 按站名生成首字符（与 `buildSiteFromDraft` 同一条规则，改名必须同步改） */
function initialOf(name) {
  return String(name || '').charAt(0).toUpperCase()
}

/**
 * 算出「这次升级要写哪些字段」。
 *
 * 只碰 name / initial / desc / color / iconUrl / aliases —— **分类与排序一律不动**：
 * 分类在添加那一刻已经决定（可能已被用户改过），事后改会让卡片在用户眼前换位置，
 * 比「分类略欠准」糟糕得多。
 *
 * @param {object} cur  库里当前那条站点
 * @param {object} meta `/api/metadata` 的响应（name/desc 已是译文）
 * @param {string} domain 本站去重域名（判断 favicon 是否同源）
 * @returns {object} 补丁；空对象表示「没有值得改的」
 */
export function upgradePatchFromMeta(cur, meta, domain) {
  const m = meta || {}
  const patch = {}

  const name = String(m.name || '').trim()
  if (name && name !== cur.name) {
    patch.name = name
    patch.initial = initialOf(name)
    // 译文对应的原文落成别名：改了中文名之后，搜英文原名仍要命中。
    // 与 parseAliases 同一口径 —— 与站名 / 域名同形的项不写。
    const original = String(m.nameOriginal || '').trim()
    const lower = original.toLowerCase()
    if (original && lower !== name.toLowerCase() && lower !== String(domain || '').toLowerCase()) {
      const existing = Array.isArray(cur.aliases) ? cur.aliases : []
      if (!existing.some(a => String(a).toLowerCase() === lower)) patch.aliases = [...existing, original]
    }
  }

  const desc = String(m.desc || '').trim()
  if (desc && desc !== cur.desc) patch.desc = desc

  if (m.color && m.color !== cur.color) patch.color = m.color

  // 与 buildSiteFromDraft 同一条规则：只挂「图标来源域名 === 本站域名」的图标，宁可回落字母块。
  // **同值不写**：这条原先是无条件写入的，于是「其余字段都没变」也会凑出一个非空补丁，
  // 白白写一次库、白改一次 updatedAt（而 updatedAt 是覆盖守卫的凭据，不该被空转搅动）。
  const fav = m.faviconUrl || m.favicon
  if (fav && /^https?:\/\//i.test(fav) && hostOf(fav) === domain && fav !== cur.iconUrl) patch.iconUrl = fav

  return patch
}

/**
 * 默认的翻译实现：**动态** import，避免把词表与浏览器适配器拖进本模块的静态图。
 * 注入点存在是为了可测 —— 用例不需要真去调 `/api/translate`。
 */
async function defaultTranslate(fields) {
  const m = await import('./translateFields')
  return m.translateFields(fields)
}

/**
 * 执行一次后台升级。**永不抛错** —— 所有失败原因都通过返回值与 `warn` 表达。
 *
 * @param {object}   o
 * @param {object}   o.store        sites store（`useSitesStore()` 的实例）
 * @param {string}   o.url          已归一化的网址
 * @param {object}   o.created      `addSite()` 返回的那条记录（用它的 id 与 updatedAt）
 * @param {Function} [o.fetchMeta]  抓取实现，测试可注入
 * @param {Function} [o.translate]  翻译实现（L2→L3→L1 编排），测试可注入
 * @param {number}   [o.timeoutMs]
 * @param {Function} [o.warn]       代码级异常的出口（默认 console.warn）
 * @returns {Promise<{changed: boolean, real: boolean, reason: string, name: string, patch: object|null, data?: object, translation?: object}>}
 *   `changed` 库里记录是否被改写；`real` 是否真的读到了对方页面（拿到原文/译文的前提）；
 *   `reason` ∈ `'' | 'fetch-failed' | 'gone' | 'edited' | 'same' | 'error'`。
 */
export async function runMetaUpgrade({
  store, url, created, fetchMeta = fetchSiteMeta, translate = defaultTranslate,
  timeoutMs = META_TIMEOUT_MS, warn = console.warn,
}) {
  const base = { changed: false, real: false, reason: '', name: created?.name || '', patch: null }
  try {
    const r = await fetchMeta(url, { timeoutMs })
    if (!r || !r.ok) return { ...base, reason: 'fetch-failed' }

    const cur = store.sites.find(s => s.id === created.id)
    // 站点已被撤销添加 / 被删除 → 没什么可升级的
    if (!cur) return { ...base, reason: 'gone' }
    // 覆盖守卫：以添加时刻的 updatedAt 为凭。用户在抓取返回前动过这条站点，
    // 就整体放弃 —— 自动补全绝不能覆盖人的输入。
    if (cur.updatedAt !== created.updatedAt) return { ...base, reason: 'edited' }

    /**
     * 异步补译：只对**服务端标记为需要翻译**的字段动手。
     * 译不到就保留原文（`translateFields` 自己的纪律是永不返回空译文）。
     * 这一步失败**不影响**抓取结果的落地 —— 它是锦上添花，不是前置条件。
     */
    let translation = null
    const data = r.data || {}
    const needs = data.needsTranslate || null
    const wantTr = needs
      ? (needs.name || needs.desc)
      // 兼容旧版响应（内联翻译过、没有 needsTranslate 字段）：按「名称非中文」粗判
      : false
    if (wantTr) {
      try {
        translation = await translate({
          name: needs.name ? data.name : '',
          desc: needs.desc ? data.desc : '',
        })
      } catch (e) {
        warn('[meta-upgrade] 补译抛错，本次保留原文：', e)
      }
    }

    // 合并：译文只覆盖「确实译到了」的字段；原文与别名口径不变
    const merged = { ...data }
    if (translation?.translated?.desc && translation.desc) merged.desc = translation.desc
    if (translation?.translated?.name && translation.name) merged.name = translation.name

    const patch = upgradePatchFromMeta(cur, merged, domainOf(url))
    const result = {
      changed: false,
      // 服务端在抓取失败 / 命中反爬挑战页时会给 warning，此时它回的是「按域名推断」，
      // 跟秒加时的本地推断同源，不构成「拿到了真信息」
      real: !data.warning,
      reason: '',
      name: patch.name || cur.name,
      patch: null,
      data: merged,
      translation: translation
        ? {
            source: translation.source || '',
            note: translation.note || '',
            keywords: translation.keywords || '',
            translated: translation.translated || { name: false, desc: false },
          }
        : null,
    }

    if (!Object.keys(patch).length) return { ...result, reason: 'same' }

    store.updateSite(created.id, patch)
    return { ...result, changed: true, patch }
  } catch (e) {
    // 走到这里说明是**代码级缺陷**（作用域漏取、字段名打错、store 未就绪……），
    // 不是「站点抓不到」。绝不能静默：这正是上一版后台升级死了整整一轮的原因。
    warn('[meta-upgrade] 升级过程抛错，已放弃本次升级：', e)
    return { ...base, reason: 'error' }
  }
}
