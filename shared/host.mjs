/**
 * 取主机名做「是不是同一个站」的比较 —— **全项目唯一一份实现**。
 *
 * 这份文件的存在本身就是一条约定：`utils/url.js` 的注释里写着「两边必须用同一把尺子」，
 * 而实际上曾经有四把（前端、site-infer、site-ops、控制台 UI 各一份）。四份实现只要有一份
 * 在处理裸域名 / 大小写 / www 上略有出入，「已收录判定」就会出现一边拦下、另一边放行的死路。
 *
 * 因此：
 *   - `src/utils/url.js` 走 Vite 别名之外的相对路径 import 它（前端可用）；
 *   - `shared/site-infer.mjs`、`shared/ops/site-ops.mjs` 直接 import 并 re-export；
 *   - `tools/console/ui/*.js` 通过控制台服务器的 `/shared/` 静态路由 import 同一份。
 *
 * 口径：补全协议 → 取 hostname → 去 `www.` 前缀 → 转小写；解析失败返回空串。
 * 去 www 是刻意的：`www.github.com` 与 `github.com` 对用户是同一个站。
 */

/** 取主域名：小写、去 www；无法解析返回 '' */
export function hostOf(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  try {
    return new URL(s.includes('://') ? s : 'https://' + s).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

/**
 * 取注册域（eTLD+1 的最简近似）：去协议 / 路径 / `www.`，保留最后两段。
 *
 * 与 `hostOf` 的分工：hostOf 回答「这是不是同一个站」（`docs.google.com` 与 `google.com`
 * 是**不同**的 host），registrableDomain 回答「这属不属于同一家」（两者同族）。
 * 去重、近重复检测、关联图谱的「同族」判据都取后者。
 *
 * 两段式后缀（`co.uk` / `com.cn`）多留一段，避免把 `foo.co.uk` 与 `bar.co.uk` 当成同族。
 * 这是**刻意不引公共后缀库**的近似 —— 覆盖本仓库实际出现的域名，够用且零依赖。
 *
 * 唯一实现：`shared/affinity.mjs` 原来自己写了一份（它是被搬过来的第四份 host 实现），
 * 现在两边都从这里取，口径不会再分叉。
 */
export function registrableDomain(raw) {
  const host = hostOf(raw)
  const parts = host.split('.').filter(Boolean)
  if (parts.length <= 2) return host
  const lastTwo = parts.slice(-2).join('.')
  if (/^(co|com|org|net|gov|edu)\.[a-z]{2}$/.test(lastTwo)) return parts.slice(-3).join('.')
  return lastTwo
}
