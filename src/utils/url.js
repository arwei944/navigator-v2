/**
 * 网址归一与识别：搜索框的「添加站点」入口与「添加站点」弹窗共用。
 *
 * 两边必须用同一把尺子判断「这个域名是否已收录」——否则会出现
 * 搜索框说没收录、弹窗却拦下来说重复的死路。
 */

/** 补全协议；空值原样返回空串 */
export function normalizeUrl(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  return /^https?:\/\//i.test(s) ? s : 'https://' + s
}

/** 取主域名：小写、去 www；无法解析返回 '' */
export function hostOf(raw) {
  try {
    return new URL(normalizeUrl(raw)).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
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