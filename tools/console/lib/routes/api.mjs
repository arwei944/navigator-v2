/**
 * 控制台 JSON API 路由 —— **分发起**。
 *
 * 返回 true 表示已处理，false 交给静态资源处理。
 * 来源校验统一在 server.mjs 入口执行（`isTrusted`），本模块只做路由。
 *
 * ## 为什么按域拆开
 *
 * 拆分前本文件 777 行、40 多个路由分支，混装 git/发布/站点/健康/通知/部署六件事。
 * 任何一处改动都要在一个大文件里跳着看，且六个域共享同一个 import 头部
 * （19 个模块，即使某个域只用得上两个）——改一个域时无法从文件边界看出影响面。
 *
 * 现在：每个域一个文件，只在需要的域里 import 需要的模块。
 * **公开契约不变**：`handleApi` / `sendJson` / `isTrusted` 仍从本文件导出。
 *
 * ## 分发顺序的约束
 *
 * 顺序无关正确性（路径互不重叠），但按「最常用 → 最少用」排列，
 * 让高频的 git/站点路由少走几次 `if`。新增域时加一行即可。
 */
import { sendJson, isTrusted } from './api-http.mjs'
import { handleSystemGet, handleSystemPost } from './api-system.mjs'
import { handleGitGet, handleGitPost } from './api-git.mjs'
import { handleSitesGet, handleSitesPost } from './api-sites.mjs'
import { handleHealthGet, handleHealthPost } from './api-health.mjs'
import { handleOpsGet, handleOpsPost } from './api-ops.mjs'

export { sendJson, isTrusted }

const GET_HANDLERS = [handleGitGet, handleSitesGet, handleHealthGet, handleOpsGet, handleSystemGet]
const POST_HANDLERS = [handleGitPost, handleSitesPost, handleHealthPost, handleOpsPost, handleSystemPost]

export async function handleApi(req, res, path, url) {
  const method = req.method

  if (method === 'GET') {
    for (const handle of GET_HANDLERS) {
      if (await handle(req, res, path, url)) return true
    }
    return false
  }

  if (method === 'POST') {
    for (const handle of POST_HANDLERS) {
      if (await handle(req, res, path)) return true
    }
    return false
  }

  return false
}
