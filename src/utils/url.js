/**
 * 网址归一与识别：搜索框的「添加站点」入口与「添加站点」弹窗共用。
 *
 * `hostOf` 已收敛到 `shared/host.mjs` 的唯一实现（原来这里有第二份，加上
 * site-infer / site-ops / 控制台 UI 各一份，一共四份）。四份实现只要有一份在
 * 裸域名、大小写、www 前缀上略有出入，就会出现「搜索框说没收录、弹窗却拦下来说重复」
 * 的死路 —— 那正是这里原本注释警告的事。
 */
import { hostOf } from '../../shared/host.mjs'

export { hostOf }

/** 补全协议；空值原样返回空串 */
export function normalizeUrl(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  return /^https?:\/\//i.test(s) ? s : 'https://' + s
}

/**
 * 输入是否已经像一条网址。
 * TLD 要求至少两位字母，所以 chatgpt / a.b / 某某工具 / 1.2 都不会被误判，
 * 否则用户每输入一个带点的词，搜索框都会跳出「添加站点」。
 */
const URL_LIKE = /^(https?:\/\/)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:\/\S*)?$/i

export function looksLikeUrl(raw) {
  return URL_LIKE.test(String(raw ?? '').trim())
}