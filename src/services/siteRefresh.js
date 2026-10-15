/**
 * 「重新获取信息」：给**已收录**的站点手动拉一次最新元信息。
 *
 * 与秒加的自动补全（`metaUpgrade.runMetaUpgrade`）是两条不同的路：
 *  - 自动补全针对「入库那一刻」的记录，有 `updatedAt` 守卫 —— 后台任务绝不能盖掉
 *    人刚敲进去的字；
 *  - 这里的对象是**老站点**，updatedAt 早就变了，那条守卫恒真、会把每次刷新都拦下来。
 *    所以守卫语义换成**人工确认**：用户点了按钮 = 明确要求以最新抓取为准。
 *
 * 判定与写回的规则集中在 `metaUpgrade.upgradePatchFromMeta`（唯一实现）：
 * 只改页面上真能读到的名称 / 描述 / 配色 / 图标，**不碰**别名、用途、分类 ——
 * 那几项是人的判断，抓一百次也抓不出来，覆盖它们才是真的破坏数据。
 * 同值不写：抓到的与库里一致时返回 `changed:false`，不空转 updatedAt。
 *
 * 本模块只在用户点按钮时才被动态 import，整个都是懒加载的，
 * 静态引 metaUpgrade（同为懒加载 chunk）不会牵连首屏。
 */
import { upgradePatchFromMeta } from './metaUpgrade.js'
import { fetchSiteMetaShared } from './meta.js'
import { domainOf } from '../utils/siteDraft.js'
import { beginRun } from '../utils/pipelineTrace.js'

/** 动态取翻译编排 —— 词表与浏览器适配器不许被静态图拖着走（与 metaUpgrade 同理由） */
async function defaultTranslate(fields) {
  const m = await import('./translateFields')
  return m.translateFields(fields)
}

/**
 * 刷新一个站点。**永不抛错**，结果通过返回值表达。
 *
 * @param {object}   o
 * @param {object}   o.site        要刷新的站点对象（库里现存的）
 * @param {Function} o.update      写回：`(patch) => void`，调用方传 `(p) => store.updateSite(site.id, p)`
 * @param {Function} [o.fetchMeta] 抓取实现（测试可注入）
 * @param {Function} [o.translate] 翻译实现（测试可注入）
 * @param {Function} [o.warn]      代码级异常出口
 * @returns {Promise<
 *   { ok: true, changed: boolean, fields: string[], patch: object|null,
 *     real: boolean, message: string } |
 *   { ok: false, reason: string, message: string }
 * >}
 *   `ok:true` 时 `fields` 是实际改写的字段名（空数组 = 抓到的与库里一致）。
 */
export async function refreshSiteMeta({
  site, update, fetchMeta = fetchSiteMetaShared, translate = defaultTranslate,
  warn = console.warn,
}) {
  const t = beginRun({ flow: 'site-refresh', title: '重新获取站点信息', target: site?.url || '' })
  const base = { ok: false, reason: '', message: '' }
  try {
    const sPre = t.stage('preflight', '预检')
    const url = String(site?.url || '').trim()
    if (!url) {
      const msg = '这条站点没有可用网址，无法刷新'
      sPre.fail(msg)
      t.end('fail', msg)
      return { ...base, reason: 'invalid', message: msg }
    }
    sPre.ok(site.name || url)

    // 用户明确要最新的 —— 绕过会话缓存（会话缓存里那份正是他想刷掉的）
    const sFetch = t.stage('fetch', '抓取最新信息')
    const r = await fetchMeta(url, { skipCache: true })
    if (!r || !r.ok) {
      const msg = String(r?.message || '未知原因')
      sFetch.fail(msg, r?.reason || 'unknown')
      t.end('fail', `未能读到对方页面：${msg}`)
      return { ...base, reason: 'fetch-failed', message: msg }
    }
    const data = r.data || {}
    // 服务端抓不到真页面时会回「按域名推断」并给 warning —— 那不构成「拿到了新信息」
    const real = !data.warning
    sFetch[real ? 'ok' : 'warn'](
      `${data.name || ''}${real ? '' : '（命中反爬，只有推断值）'}`.trim(),
    )

    const sPatch = t.stage('patch', '与当前值比对')
    const domain = domainOf(url)
    const patch = upgradePatchFromMeta(site, { ...data }, domain)
    const fields = Object.keys(patch)
    if (!fields.length) {
      sPatch.skip('抓到的内容与当前一致，无需改写')
      t.end('skip', '已是最新')
      return { ok: true, changed: false, fields: [], patch: null, real, message: '已是最新' }
    }
    sPatch.ok(fields.join('、'))

    const sWrite = t.stage('write', '写回')
    update(patch)
    sWrite.ok(fields.join('、'))

    // 译文不阻塞主写回 —— 与秒加补全同一纪律：失败至多是「没译」，不能再变成「没刷新」
    const sTr = t.stage('translate', '中文补译')
    const needs = data.needsTranslate || null
    if (!needs || !(needs.name || needs.desc)) {
      sTr.skip('无需翻译')
    } else {
      try {
        const tr = await translate({
          name: needs.name ? data.name : '',
          desc: needs.desc ? data.desc : '',
        })
        const got = tr?.translated || {}
        if (got.name || got.desc) {
          const merged = { ...data }
          if (got.desc && tr.desc) merged.desc = tr.desc
          if (got.name && tr.name) merged.name = tr.name
          const patch2 = upgradePatchFromMeta(site, merged, domain)
          const f2 = Object.keys(patch2)
          if (f2.length) {
            update(patch2)
            sTr.note(`已补写 ${f2.join('、')}`)
          } else {
            sTr.note('译文与当前一致')
          }
        } else {
          sTr.note('未取得译文')
        }
      } catch (e) {
        sTr.warn(String(e?.message || e), 'translate')
      }
    }

    t.end('ok', `已更新 ${fields.join('、')}`)
    return { ok: true, changed: true, fields, patch, real, message: `已更新 ${fields.join('、')}` }
  } catch (e) {
    warn('[site-refresh] 刷新过程抛错：', e)
    t.end('fail', String(e?.message || e))
    return { ...base, reason: 'error', message: String(e?.message || e) }
  }
}
