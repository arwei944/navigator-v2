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
