/**
 * 「秒加之后的真实补全」（`src/services/metaUpgrade.js`）用例：零依赖、不联网。
 *
 * ## 这层用例守的是什么
 *
 * 上一版这段逻辑长在 `services/autoAdd.js` 里，是**模块级函数却引用了 `runAutoAdd()`
 * 的局部变量 `sitesStore`** —— 每跑必抛 ReferenceError，被调用处的 `.catch(() => {})`
 * 一并吞掉。后果不是「升级偶尔失败」，而是**抓取 / 翻译 / 改写全程静默失败整整一个版本**：
 * 用户看到的永远是秒加那一刻的域名推断草稿，后台升级从未生效过一次，
 * 而单测、门禁、真机探针全绿 —— 因为没有任何一条断言看过这条链路。
 *
 * 所以这里最重要的两组断言是：
 *   ① **代码级抛错必须走 `warn`**（不再有静默吞错这条退路）；
 *   ② 依赖必须显式注入 —— 漏传 store 时要报成 `reason:'error'` 并告警，
 *      而不是「升级成功但什么都没发生」。
 *
 * 其余是升级决策本身：覆盖守卫（用户改过就不动）、只改哪些字段、原文别名、favicon 同源。
 *
 * 运行：node tools/console/test-meta-upgrade.mjs
 */
import { runMetaUpgrade, upgradePatchFromMeta } from '../../src/services/metaUpgrade.js'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

/* ---------------- 打桩 ---------------- */

/** 最小 store：只有 sites 与 updateSite，够升级用；记录每次写入 */
function makeStore(site) {
  const state = { sites: site ? [site] : [], writes: [] }
  return {
    ...state,
    get sites() { return state.sites },
    updateSite(id, patch) { state.writes.push({ id, patch }); state.sites = state.sites.map(s => (s.id === id ? { ...s, ...patch } : s)) },
    _state: state,
  }
}

const OK_META = {
  name: 'Figma', desc: 'Figma 是设计与代码协作的画布。', color: '#0d99ff',
  faviconUrl: 'https://figma.com/favicon.ico', warning: '',
}
const CREATED = { id: 's1', name: 'www.figma.com', desc: '', color: '#123456', url: 'figma.com', updatedAt: 1000 }

/** 默认抓取桩：返回成功响应 */
const okFetch = (data = OK_META) => async () => ({ ok: true, status: 200, data })
/** 默认静默告警桩：把 warn 收集起来，用例断言「该响的时候响了」 */
const spyWarn = () => { const hits = []; const fn = (...a) => hits.push(a); fn.hits = hits; return fn }

/* ---------------- upgradePatchFromMeta：只改该改的字段 ---------------- */

const p1 = upgradePatchFromMeta({ name: 'www.figma.com', desc: '', color: '#111' }, OK_META, 'figma.com')
eq(p1.name, 'Figma', '名称不同 → 写入新名')
eq(p1.initial, 'F', '改名同步重算 initial（与 buildSiteFromDraft 同一规则）')
eq(p1.desc, 'Figma 是设计与代码协作的画布。', '描述不同 → 写入')
eq(p1.color, '#0d99ff', '配色不同 → 写入')
eq(p1.iconUrl, 'https://figma.com/favicon.ico', 'favicon 与本站同源 → 写入 iconUrl')

const same = upgradePatchFromMeta({ name: 'Figma', desc: OK_META.desc, color: '#0d99ff', iconUrl: OK_META.faviconUrl, aliases: [] }, OK_META, 'figma.com')
eq(Object.keys(same).length, 0, '全字段一致 → 空补丁（不该白写一次库）')

const foreign = upgradePatchFromMeta({ name: 'x', desc: '', color: '' }, { ...OK_META, faviconUrl: 'https://cdn.example.com/f.ico' }, 'figma.com')
ok(!('iconUrl' in foreign), 'favicon 来源域名与本站不同 → 不挂图标（宁可回落字母块）')

const blank = upgradePatchFromMeta({ name: 'Figma', desc: 'x', color: '#0d99ff' }, { name: '   ', desc: '  ', color: '#0d99ff' }, 'figma.com')
eq(Object.keys(blank).length, 0, '响应里只有空白字符 → 不覆盖既有值')

/* 原文别名：译成中文后不能把英文原名一起丢掉 */
const named = upgradePatchFromMeta({ name: 'www.ars.com', desc: '', color: '' }, { ...OK_META, name: '阿尔斯技术', nameOriginal: 'Ars Technica', faviconUrl: '' }, 'ars.com')
eq(named.name, '阿尔斯技术', '译文写进 name')
eq(JSON.stringify(named.aliases), '["Ars Technica"]', '原文落成别名，搜英文原名仍能命中')

const dupAlias = upgradePatchFromMeta({ name: 'x', desc: '', color: '', aliases: ['Ars Technica'] }, { ...OK_META, name: '阿尔斯技术', nameOriginal: 'ars technica', faviconUrl: '' }, 'ars.com')
ok(!('aliases' in dupAlias), '原文已在别名里（忽略大小写）→ 不重复堆叠')

const sameAsHost = upgradePatchFromMeta({ name: 'x', desc: '', color: '' }, { ...OK_META, name: 'Figma', nameOriginal: 'figma.com', faviconUrl: '' }, 'figma.com')
ok(!('aliases' in sameAsHost), '原文与域名同形 → 不写别名（与 parseAliases 同口径）')

const noOriginal = upgradePatchFromMeta({ name: 'x', desc: '', color: '' }, { ...OK_META, name: 'Figma', faviconUrl: '' }, 'figma.com')
ok(!('aliases' in noOriginal), '响应没带 nameOriginal → 不写别名')

/* ---------------- runMetaUpgrade：编排与守卫 ---------------- */

// ① 正常升级
{
  const store = makeStore({ ...CREATED })
  const warn = spyWarn()
  const r = await runMetaUpgrade({ store, url: 'https://www.figma.com', created: { ...CREATED }, fetchMeta: okFetch(), warn })
  eq(r.changed, true, '抓到真实信息 → changed 为真')
  eq(r.real, true, '服务端未报 warning → real 为真（信息是真值）')
  eq(r.name, 'Figma', '回执带回升级后的名字')
  eq(store._state.writes.length, 1, '只写一次库')
  eq(store._state.sites[0].name, 'Figma', '库内名称已就地修正')
  eq(warn.hits.length, 0, '正常路径不该告警')
}

// ② 服务端抓取失败 / 反爬挑战页 → warning 非空，不谎称 real
{
  const store = makeStore({ ...CREATED })
  const r = await runMetaUpgrade({
    store, url: 'https://www.figma.com', created: { ...CREATED },
    fetchMeta: okFetch({ ...OK_META, warning: '抓取超时，已按域名推断，请复核名称与分类' }), warn: spyWarn(),
  })
  eq(r.changed, true, 'warning 非空时仍可能改写字段')
  eq(r.real, false, 'warning 非空 → real 为假（那只是另一个猜测，不是真信息）')
}

// ③ 抓取层失败 → 什么都不动
{
  const store = makeStore({ ...CREATED })
  const r = await runMetaUpgrade({
    store, url: 'https://www.figma.com', created: { ...CREATED },
    fetchMeta: async () => ({ ok: false, status: 0, reason: 'timeout', message: '抓取超时' }), warn: spyWarn(),
  })
  eq(r.changed, false, '抓取失败 → 不改库')
  eq(r.reason, 'fetch-failed', '抓取失败的原因码')
  eq(store._state.writes.length, 0, '抓取失败时一次写库都没有')
}

// ④ 覆盖守卫：用户在抓取返回前编辑过这条站点
{
  const store = makeStore({ ...CREATED, updatedAt: 2000 })
  const r = await runMetaUpgrade({ store, url: 'https://www.figma.com', created: { ...CREATED }, fetchMeta: okFetch(), warn: spyWarn() })
  eq(r.changed, false, 'updatedAt 变了 → 整体放弃升级')
  eq(r.reason, 'edited', '守卫命中原因码为 edited')
  eq(store._state.writes.length, 0, '绝不能覆盖人的输入')
}

// ⑤ 站点已被撤销添加 / 删除
{
  const store = makeStore(null)
  const r = await runMetaUpgrade({ store, url: 'https://www.figma.com', created: { ...CREATED }, fetchMeta: okFetch(), warn: spyWarn() })
  eq(r.reason, 'gone', '站点已不在库里 → reason 为 gone')
}

// ⑥ 抓回来的与本地推断一致 → 不白写
{
  const store = makeStore({ ...CREATED, name: 'Figma', desc: OK_META.desc, color: '#0d99ff', iconUrl: OK_META.faviconUrl })
  const r = await runMetaUpgrade({ store, url: 'https://www.figma.com', created: { ...CREATED }, fetchMeta: okFetch(), warn: spyWarn() })
  eq(r.changed, false, '无字段可改 → changed 为假')
  eq(r.reason, 'same', '无变化的原因码')
  eq(store._state.writes.length, 0, '无变化时不写库')
}

// ⑦ 永不抛错：fetchMeta 抛错 → 报 error 并告警，绝不当成「升级成功」
{
  const store = makeStore({ ...CREATED })
  const warn = spyWarn()
  const r = await runMetaUpgrade({ store, url: 'u', created: { ...CREATED }, fetchMeta: async () => { throw new Error('boom') }, warn })
  eq(r.reason, 'error', '抓取实现抛错 → reason 为 error')
  eq(r.changed, false, '抛错不得被当成改成功')
  eq(warn.hits.length, 1, '★ 代码级抛错必须走 warn —— 这正是上一版静默失败的原因')
}

// ⑧ 回归守卫（本次事故的形态）：依赖漏传 / store 未就绪，必须告警而不是「静默成功」
{
  const warn = spyWarn()
  const r = await runMetaUpgrade({ store: {}, url: 'u', created: { ...CREATED }, fetchMeta: okFetch(), warn })
  eq(r.reason, 'error', 'store 形状不对 → reason 为 error（不是静默无事发生）')
  eq(warn.hits.length, 1, '★ 模块级作用域漏取这类缺陷，必须留下告警痕迹')

  const warn2 = spyWarn()
  const r2 = await runMetaUpgrade({ store: makeStore({ ...CREATED }), url: 'u', created: { ...CREATED }, fetchMeta: okFetch(), warn: warn2 })
  eq(warn2.hits.length, 0, '对照组：依赖齐备时不产生噪音告警')

  const warn3 = spyWarn()
  const r3 = await runMetaUpgrade({ url: 'u', created: { ...CREATED }, fetchMeta: okFetch(), warn: warn3 })
  eq(r3.reason, 'error', '完全不传 store → 报 error')
  eq(warn3.hits.length, 1, '完全不传 store 也要告警')
}

/**
 * ⑨ **真实信息不得再被译文堵住**（2026-10-14 修）
 *
 * 上一版把「取译文」排在「写真实信息」之前 await。译文那一路有多难讲 —— L2 浏览器模型
 * 首次要下几十 MB 语言包、L3 在线引擎常被共享 IP 的日配额挡住 —— 卡片就有多久停在草稿上。
 * 线上实测 figma.com：真实信息 +2.0s 到手，+10.4s 才写进卡片，中间 8 秒用户以为没去抓。
 *
 * 下面三条是「摘掉两阶段写库即失败」的直接凭据：
 *   ① 调用 translate 的那一刻，真实信息那次写库**已经发生**；
 *   ② 译文到手后有一次补写，两写合起来才是最终结果；
 *   ③ 等待译文期间用户改过 → 第二写放弃（覆盖守卫对第二写同样有效）。
 */
{
  const NEEDS = { ...OK_META, name: 'Figma', desc: 'Figma is the canvas.', needsTranslate: { name: false, desc: true } }
  const store = makeStore({ ...CREATED })
  let writesWhenTranslating = -1
  const lateTranslate = async () => {
    writesWhenTranslating = store._state.writes.length
    return {
      name: '', desc: 'Figma 是设计与代码协作的画布。', source: 'browser', note: '浏览器本地模型',
      translated: { name: false, desc: true }, keywords: '',
    }
  }
  const r = await runMetaUpgrade({
    store, url: 'https://www.figma.com', created: { ...CREATED },
    fetchMeta: okFetch(NEEDS), translate: lateTranslate, warn: spyWarn(),
  })
  eq(writesWhenTranslating, 1, '★ 调 translator 之前真实信息已经落库（译文不再挡路）')
  eq(store._state.writes[0].patch.desc, 'Figma is the canvas.', '第一次写的是抓到的原文')
  eq(r.changed, true, '整体仍算「补全过」')
  eq(store._state.writes.length, 2, '译文到手后有一次补写')
  eq(store._state.sites[0].desc, 'Figma 是设计与代码协作的画布。', '最终描述是译文')
  eq(r.translation?.source, 'browser', '回执带回译文来源')
}

{
  // 译文与原文一致 / 压根没译出来 → 不该白写第二次
  const NEEDS = { ...OK_META, needsTranslate: { name: false, desc: true } }
  const store = makeStore({ ...CREATED })
  const sameTranslate = async () => ({ name: '', desc: OK_META.desc, source: 'glossary', note: '', translated: { name: false, desc: true }, keywords: '' })
  const r = await runMetaUpgrade({
    store, url: 'https://www.figma.com', created: { ...CREATED },
    fetchMeta: okFetch(NEEDS), translate: sameTranslate, warn: spyWarn(),
  })
  eq(store._state.writes.length, 1, '译文与既有值一致 → 不重复写库')
  eq(r.changed, true, '真实信息那一次写库仍算补全')
}

{
  // 等待译文期间用户动手改了 → 第二写必须放弃（第一写在“用户动手”之前，不受影响）
  const NEEDS = { ...OK_META, needsTranslate: { name: false, desc: true } }
  const store = makeStore({ ...CREATED })
  const racingTranslate = async (fields) => {
    // 模拟用户在这段时间里改了描述
    store.updateSite(CREATED.id, { desc: '我手写的产品名' })
    return { name: '', desc: '译文到场但没人要了', source: 'browser', note: '', translated: { name: false, desc: true }, keywords: '' }
  }
  const r = await runMetaUpgrade({
    store, url: 'https://www.figma.com', created: { ...CREATED },
    fetchMeta: okFetch(NEEDS), translate: racingTranslate, warn: spyWarn(),
  })
  eq(store._state.writes.length, 2, '第一写（真实信息）+ 用户自己的编辑，共两次')
  eq(store._state.sites[0].desc, '我手写的产品名', '★ 译文绝不覆盖人的输入')
  eq(r.changed, true, '真实信息那一次写库仍然有效')
}

if (failures.length) {
  console.error(`\n❌ 后台升级测试失败 ${failures.length} 项：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 后台升级（秒加 → 真实信息补全）全部通过：${pass} 条断言`)
