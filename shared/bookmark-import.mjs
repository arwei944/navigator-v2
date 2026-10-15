/**
 * 书签导入内核：把「浏览器书签（HTML / JSON）解析出来的条目」整理成可入库的站点草稿。
 *
 * ## 为什么单独一层
 *
 * 浏览器侧（`src/utils/bookmarks.js`）只管把文件解析成 `{name,url,desc}` 数组 —— 它用
 * `DOMParser` / `FileReader`，只能在浏览器里跑。而「哪条已收录要跳过、哪条地址不合法、
 * 该给什么分类、颜色怎么定」是**纯数据判断**，与 DOM 无关：放这里就能被 node 测试直接覆盖，
 * 也能被控制台 / CLI 的批量导入复用。
 *
 * ## 口径一律取自既有内核
 *
 * 归一与判重走 `shared/ops/site-ops.mjs` 的 `normalizeUrl` / `findDupe`，分类与用途走
 * `shared/site-infer.mjs` 的引擎 —— 与「手工添加一个站点」**同一条尺度**。任何一处
 * 自己写一套，就会出现「手工加说重复、导入却放行」的死路（本项目在 hostOf 上踩过）。
 *
 * 纯函数 + 零依赖（只引同仓库的纯函数模块），浏览器侧与 Node 侧都能直接用。
 */
import { normalizeUrl, findDupe } from './ops/site-ops.mjs'
import { inferCategory } from './site-infer.mjs'
import { hashColor } from './hash-color.mjs'
import { inferPurposes } from './purposes.mjs'

/** 明显不是可收录网站的 scheme（浏览器内部页 / 脚本 / 文件） */
const NON_HTTP = /^(javascript|place|chrome|chrome-extension|about|edge|file|data|blob):/i

/**
 * @param {Array<{name?:string,url?:string,desc?:string}>} items 解析出来的书签条目
 * @param {{ existingSites?: object[], categoryMeta?: object, fallbackCategory?: string, maxItems?: number }} opts
 * @returns {{ toAdd: object[], duplicates: object[], invalid: object[], total: number }}
 *   `toAdd` 可直接交给 `sitesStore.addSites`；`duplicates` / `invalid` 供 UI 展示「跳过了哪些、为什么」
 */
export function prepareBookmarkImport(items, {
  existingSites = [],
  categoryMeta = {},
  fallbackCategory = '',
  maxItems = 2000,
} = {}) {
  const toAdd = []
  const duplicates = []
  const invalid = []
  const seen = new Set()
  const list = Array.isArray(items) ? items.slice(0, maxItems) : []

  // 判重时要把**本批已加进去的**也算上：书签文件里同一域名可能出现多次（不同路径、不同文件夹），
  // 只跟「已收录」比会让批内重复全部漏过。用一份可增长的本地数组，逐条 push。
  const known = Array.isArray(existingSites) ? [...existingSites] : []

  for (const raw of list) {
    const rawUrl = String((raw && raw.url) || '').trim()
    const rawName = String((raw && raw.name) || '').trim()

    if (!rawUrl || rawUrl === '#' || NON_HTTP.test(rawUrl)) {
      invalid.push({ name: rawName, url: rawUrl, reason: '不是 http(s) 网址（浏览器内部页 / 脚本链接）' })
      continue
    }

    let domain
    try {
      domain = normalizeUrl(rawUrl)
    } catch (e) {
      invalid.push({ name: rawName, url: rawUrl, reason: String((e && e.message) || e) })
      continue
    }

    if (seen.has(domain)) {
      duplicates.push({ name: rawName, url: rawUrl, domain, reason: '文件内重复（同一域名已出现过）' })
      continue
    }
    const dupe = findDupe({ url: domain }, known)
    if (dupe) {
      duplicates.push({ name: rawName, url: rawUrl, domain, reason: `已收录：${dupe.name}` })
      continue
    }
    seen.add(domain)

    const name = (rawName || domain).slice(0, 40)
    const desc = String((raw && raw.desc) || '').trim() || `${name}（${domain}）——点击直达官网。`
    const cat = inferCategory({ name, domain, desc: '' }, known, categoryMeta, { fallback: fallbackCategory })
    const site = {
      name,
      url: domain,
      desc,
      categoryId: cat.categoryId || fallbackCategory,
      color: hashColor(domain),
      initial: name.charAt(0).toUpperCase(),
      purposes: inferPurposes({ categoryId: cat.categoryId, name, desc: '', url: domain }),
      aliases: [],
      categoryConfidence: cat.confidence,
    }
    toAdd.push(site)
    known.push(site)
  }

  return { toAdd, duplicates, invalid, total: list.length }
}

/** 导入结果的一句话摘要（toast / 审计日志共用） */
export function summarizeImport(result) {
  if (!result) return ''
  const parts = [`可导入 ${result.toAdd.length} 个`]
  if (result.duplicates.length) parts.push(`跳过重复 ${result.duplicates.length} 个`)
  if (result.invalid.length) parts.push(`无效 ${result.invalid.length} 个`)
  return parts.join('，')
}
