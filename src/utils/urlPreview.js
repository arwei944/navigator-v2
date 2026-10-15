/**
 * 搜索框下拉里的**网址预览卡片**：数据来源与状态判定。
 *
 * 用户粘一个网址进搜索框，下拉顶部应当直接给出「这个网址是什么」—— 图标、站名、
 * 描述、域名 —— 而不是只留一行「添加站点 example.com」让用户先猜后点。
 *
 * 这里的三个决定，都是为了「预览所见 = 入库所得」：
 *  1. **已收录就用本地数据**（`cardFromSite`）—— 本地已有事实，没有理由再去网上问一遍，
 *     更不该让用户为一次本地查询等网络；
 *  2. **抓取结果与入库用同一把尺子**（`cardFromMeta`）—— 尤其是图标域名校验：
 *     入库时第三方域名的图标会被丢弃（`siteDraft.js#buildSiteFromDraft`），预览若照挂，
 *     用户就会看到「预览有图标、入库后变字母块」的落差；
 *  3. **失败与加载都先给主机名占位**（`hostCard`）—— 卡片不能在等网络时是空的。
 *
 * 只允许相对路径导入：tools/console 下的纯 node 测试要直接加载本模块。
 */
import { looksLikeUrl } from './url.js'
import { domainOf, rawHostOf, colorFromHost } from './siteDraft.js'

/** 预览卡片的状态 */
export const PREVIEW_KIND = {
  /** 输入不像网址 —— 不出卡片 */
  IDLE: 'idle',
  /** 该域名已收录 —— 用本地站点数据出卡 */
  FOUND: 'found',
  /** 正在抓取 —— 先出主机名占位卡 */
  LOADING: 'loading',
  /** 抓到了 —— 出完整卡片 */
  READY: 'ready',
  /** 抓取失败 —— 出主机名卡 + 失败原因 */
  ERROR: 'error',
}

/**
 * 是否该为这次输入出预览卡片。
 * 带前缀（`>` 命令 / `@` 站点 / `/` 页面）时用户在找别的东西；
 * 二级页（站点操作）里输入的也不是网址 —— 两种都不出。
 */
export function shouldPreview(raw, { prefix = '', hasPage = false } = {}) {
  if (hasPage) return false
  if (prefix) return false
  return looksLikeUrl(raw)
}

/**
 * 预览缓存的键：按去重域名算，`https://www.GitHub.com/a` 与 `github.com` 同键 ——
 * 同一域名只抓一次，且用户在地址栏上多打一个路径不该触发第二次抓取。
 */
export function previewKeyOf(raw) {
  return domainOf(raw)
}

function initialOf(text) {
  return String(text || '').charAt(0).toUpperCase()
}

/** 等网络时的占位卡：至少让用户看见自己在说哪个域名 */
function hostCard(url) {
  const host = rawHostOf(url)
  return {
    host,
    title: host,
    desc: '',
    iconUrl: '',
    color: colorFromHost(domainOf(url)),
    initial: initialOf(host),
    source: 'fallback',
  }
}

/** 已收录站点 → 卡片（全部字段本地可得，不联网、不等待） */
export function cardFromSite(site) {
  const s = site || {}
  return {
    host: s.url || '',
    title: s.name || s.url || '',
    desc: s.desc || '',
    iconUrl: s.iconUrl || '',
    color: s.color || colorFromHost(domainOf(s.url)),
    initial: s.initial || initialOf(s.name || s.url),
    source: 'site',
  }
}

/**
 * 抓取结果 → 卡片。
 * 图标只在「图标所在域名 === 本站域名」时展示 —— 与入库判据完全一致（见文件头第 2 条）。
 */
export function cardFromMeta(meta, url) {
  const m = meta || {}
  const host = String(m.domain || '').trim() || rawHostOf(url)
  const title = String(m.name || '').trim() || host
  const faviconUrl = m.faviconUrl || m.favicon || ''
  const iconOk = /^https?:\/\//i.test(faviconUrl) && domainOf(faviconUrl) === domainOf(host)

  return {
    host,
    title,
    desc: m.desc || '',
    iconUrl: iconOk ? faviconUrl : '',
    color: m.color || colorFromHost(domainOf(host)),
    initial: initialOf(title),
    source: 'meta',
  }
}

/**
 * 把「输入 + 已有数据」收敛成一个状态。
 *
 * 判定顺序即优先级，两处顺序是有意的：
 *  - **已收录先于一切**：本地已有事实，既不必联网也不必等 —— 抓取中/失败都不该盖住它；
 *  - **失败先于抓到**：抓取出错时 meta 可能是上一次的残留（或压根为空），
 *    这时报错比显示一份来路不明的数据诚实。
 */
export function resolvePreviewState({
  url = '', duplicate = null, loading = false, meta = null, error = '',
} = {}) {
  if (!url) return { kind: PREVIEW_KIND.IDLE, card: null, message: '' }

  if (duplicate) {
    return { kind: PREVIEW_KIND.FOUND, card: cardFromSite(duplicate), message: '' }
  }
  if (error) {
    return { kind: PREVIEW_KIND.ERROR, card: hostCard(url), message: error }
  }
  if (meta) {
    return { kind: PREVIEW_KIND.READY, card: cardFromMeta(meta, url), message: '' }
  }
  return { kind: PREVIEW_KIND.LOADING, card: hostCard(url), message: '' }
}
