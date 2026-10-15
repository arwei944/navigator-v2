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

/**
 * 从一段混合文本里抽出**第一个网址**。
 *
 * 为什么需要：「Figma - 设计工具 https://figma.com」这种从文章、聊天记录里复制来的整段，
 * `looksLikeUrl` 判 false（整串不是网址），于是预览卡片不出、添加入口也不出现 ——
 * 而用户此刻的意图恰恰是其中那个网址。
 *
 * 用正则**搜索**子串而不是按空白切词：`（https://figma.com），推荐` 整段没有空格，
 * 切词拿到的是「…），推荐」这种拖着尾巴的整块，判不成网址；正则从左往右找到第一个
 * 像网址的片段就停，天然不受前后文影响。
 *
 * 末尾仍要削一次标点：英文句号、逗号、右括号都在「像网址」的字符范围里，
 * 而 `https://figma.com.` 结尾那个点不属于网址。
 *
 * 抽出来的候选**仍要过 `looksLikeUrl`** —— 判据与其它入口共用同一把尺子，
 * 「什么算网址」不会在这里悄悄放宽。
 */
const URL_IN_TEXT = /(?:https?:\/\/|www\.)[^\s<>"'（）【】「」]+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s<>"'（）【】「」]*)?/i
const TRIM_TAIL = /[），,。.;；:：)\]】」』>、！!？?"'”’]+$/

export function extractUrl(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  // 整串就是网址：原样返回（最常见的情形，也保证与改动前逐字一致）
  if (looksLikeUrl(s)) return s
  const m = s.match(URL_IN_TEXT)
  if (!m) return ''
  const cleaned = m[0].replace(TRIM_TAIL, '')
  return looksLikeUrl(cleaned) ? cleaned : ''
}