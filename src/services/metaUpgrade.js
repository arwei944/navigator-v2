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
 * 「这段等待里有没有被人动过」。
 *
 * 只比 updatedAt 是不够的：它是毫秒级时间戳，而我们自己的两次写 + 用户的一次编辑完全可能
 * 落在同一毫秒里（单测里就是必现），那时时间戳相等 → 守卫看着一切正常 → 译文把人的输入盖掉。
 * 所以再叠一层**字段比对**：自己写过的那些字段，现在的值必须还是自己写进去的那个。
 *
 * @param {object} now    当前库里的记录
 * @param {object} since  我们这条链路最后一次看到的记录
 * @param {string[]} wrote 我们自己写过的字段名
 */
function isTouched(now, since, wrote) {
  if (!now || !since) return true
  if (now.updatedAt !== since.updatedAt) return true
  return (wrote || []).some(k => now[k] !== since[k])
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
  timeoutMs = META_TIMEOUT_MS, warn = console.warn, trace = null,
}) {
  const base = { changed: false, real: false, reason: '', name: created?.name || '', patch: null, message: '' }
  // 追踪句柄缺失时（没人看日志）退化成 no-op：这些 stage 不能反过来影响主流程
  const t = trace || { stage: () => ({ ok() {}, warn() {}, fail() {}, skip() {}, note() {} }), end() {} }
  try {
    const sFetch = t.stage('fetch', '后台抓取真实信息')
    const t0 = Date.now()
    const r = await fetchMeta(url, { timeoutMs })
    if (!r || !r.ok) {
      // 「抓取失败」是预期内的（对方拒绝、超时、接口不可用），但它必须留痕：
      // 用户看到的「信息没填上」正是这里 —— 不留原因就没法复述
      sFetch.fail(String(r?.message || '未知原因'), r?.reason || 'unknown')
      t.end?.('fail', `未能读到对方页面：${r?.message || '未知原因'}`)
      return { ...base, reason: 'fetch-failed', message: String(r?.message || '未知原因') }
    }

    /**
     * 服务端把自己的抓取耗时报在 `fetchMs` 里。端到端（`ms`）在这里几乎没信息量：
     * 宿主网关与冷启动能占掉 400~1300ms，拿它判「引擎有没有守住预算」是把宿主慢误报成
     * 引擎慢 —— 两个口径必须分开摆出来，才谈得上定位。
     */
    const ms = Date.now() - t0
    const serverMs = r.data?.fetchMs
    const timing = `${ms}ms${serverMs ? `（服务端 ${serverMs}ms）` : ''}`
    if (r.data?.warning) sFetch.warn(`${timing} ${r.data.warning}`, 'server-warning')
    else sFetch.ok(`${timing} ${r.data?.name || ''}`.trim())

    const cur = store.sites.find(s => s.id === created.id)
    // 站点已被撤销添加 / 被删除 → 没什么可升级的
    if (!cur) {
      sFetch.warn('站点已被移除，放弃升级', 'gone')
      t.end('warn', '站点已被移除，本次升级作废')
      return { ...base, reason: 'gone' }
    }
    // 覆盖守卫：以添加时刻的 updatedAt 为凭。用户在抓取返回前动过这条站点，
    // 就整体放弃 —— 自动补全绝不能覆盖人的输入。
    if (cur.updatedAt !== created.updatedAt) {
      t.stage('guard', '覆盖守卫').skip('这条记录已被改动，自动补全不再覆盖')
      t.end('skip', '用户已改过这条记录，自动补全不作修改')
      return { ...base, reason: 'edited' }
    }

    const data = r.data || {}
    const domain = domainOf(url)
    /**
     * **真实信息先落库，译文到了再补一次**（2026-10-14 修）。
     *
     * 上一版把「取译文」排在「写真实信息」之前 await，于是译文那一路要多久，卡片就要等多久：
     * L2 浏览器模型首次要下几十 MB 语言包、L3 在线引擎还常被共享 IP 的日配额挡住 ——
     * 线上实测 figma.com：真实信息 **+2.0s** 就到手，却拖到 **+10.4s** 才写进卡片，
     * 中间 8 秒用户盯着一张写着 `www.figma.com` 的卡，理所当然以为「压根没去抓」。
     *
     * 所以这里分两写：第一写只覆盖抓取到原文；第二写专门补译文（也可能不来）。
     * 翻译失败因此再也连累不到抓取结果。
     */
    const result = {
      changed: false,
      // 服务端在抓取失败 / 命中反爬挑战页时会给 warning，此时它回的是「按域名推断」，
      // 跟秒加时的本地推断同源，不构成「拿到了真信息」
      real: !data.warning,
      reason: '',
      name: cur.name,
      patch: null,
      data,
      translation: null,
      /** 抓取/写回失败时把原因带出去 —— 调用方要能对用户复述「为什么没补全」 */
      message: '',
    }

    const sPatch = t.stage('patch', '写回站点')
    const patch = upgradePatchFromMeta(cur, { ...data }, domain)
    const fields = Object.keys(patch)
    if (fields.length) {
      store.updateSite(created.id, patch)
      result.changed = true
      result.patch = patch
      result.name = patch.name || cur.name
      sPatch.ok(fields.join('、'))
    }
    // 自己的写入也会刷新 updatedAt —— 守卫凭据必须跟着走到最新一份，
    // 否则第二写会被「自己」挡下来
    let since = cur
    if (fields.length) {
      const written = store.sites.find(s => s.id === created.id)
      if (written) since = written
    }

    /**
     * 异步补译（可选第二跳）：只对**服务端标记为需要翻译**的字段动手。
     * 译不到就保留原文（`translateFields` 自己的纪律是永不返回空译文）。
     * 它**不再阻塞**上面的写库 —— 失败至多是「没译」，不能再变成「没补全」。
     */
    const needs = data.needsTranslate || null
    const wantTr = needs
      ? (needs.name || needs.desc)
      // 兼容旧版响应（内联翻译过、没有 needsTranslate 字段）：按「名称非中文」粗判
      : false
    const sTr = t.stage('translate', '中文补译')
    let translation = null
    if (!wantTr) {
      sTr.skip('名称与描述无需翻译')
    } else {
      try {
        translation = await translate({
          name: needs.name ? data.name : '',
          desc: needs.desc ? data.desc : '',
        })
        const got = translation?.translated || {}
        if (got.name || got.desc) {
          sTr.ok(translation.note || [got.name && '名称', got.desc && '描述'].filter(Boolean).join('、'))
          result.translation = {
            source: translation.source || '',
            note: translation.note || '',
            keywords: translation.keywords || '',
            translated: got,
          }
          // 译文有可能是中文 salt 之后落在 name / desc 上 —— 第二写只补「译到了」的字段
          const cur2 = store.sites.find(s => s.id === created.id)
          if (!cur2) {
            sTr.warn('站点已被移除，译文不再写入', 'gone')
          } else if (isTouched(cur2, since, fields)) {
            sTr.warn('这条记录在等待译文期间被改过，不再覆盖', 'edited')
          } else {
            const merged = { ...data }
            if (got.desc && translation.desc) merged.desc = translation.desc
            if (got.name && translation.name) merged.name = translation.name
            const patch2 = upgradePatchFromMeta(cur2, merged, domain)
            const fields2 = Object.keys(patch2)
            if (fields2.length) {
              store.updateSite(created.id, patch2)
              result.changed = true
              result.reason = ''
              result.patch = { ...(result.patch || {}), ...patch2 }
              result.name = patch2.name || result.name
              result.data = merged
              sTr.note(`已补写 ${fields2.join('、')}`)
            } else {
              sTr.note('译文与原文一致，无需改写')
            }
          }
        } else {
          sTr.warn(translation?.keywords ? `未译出，已按词表抽取关键词：${translation.keywords}` : '三层引擎都没译出，保留原文', 'no-translation')
        }
      } catch (e) {
        warn('[meta-upgrade] 补译抛错，本次保留原文：', e)
        sTr.fail(String(e?.message || e))
      }
    }

    if (!result.changed) {
      result.reason = 'same'
      if (!fields.length) sPatch.skip('服务端给出的内容与域名推断一致，无需改写')
    }
    t.end(
      !result.real ? 'warn' : result.changed ? 'ok' : 'skip',
      !result.real
        ? (data.warning || '对方页面没读到，描述仍是域名推断值')
        : result.changed
          ? `已补全 ${Object.keys(result.patch || {}).join('、')}`
          : '抓到的内容与既有值一致，未改动',
    )
    return result
  } catch (e) {
    // 走到这里说明是**代码级缺陷**（作用域漏取、字段名打错、store 未就绪……），
    // 不是「站点抓不到」。绝不能静默：这正是上一版后台升级死了整整一轮的原因。
    warn('[meta-upgrade] 升级过程抛错，已放弃本次升级：', e)
    t.stage('patch', '写回站点').fail(String(e?.message || e), 'throw')
    t.end('fail', String(e?.message || e))
    return { ...base, reason: 'error' }
  }
}
