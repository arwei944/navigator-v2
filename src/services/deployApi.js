/**
 * 部署状态的前端服务。
 *
 * 两件事分得很开，因为它们的数据来源与失败模式完全不同：
 *   1. `fetchStatus()` —— 问**线上这台机器**：你跑的是哪次构建、现在什么状态。同源，必成功。
 *   2. `checkUpstream()` —— 问 **GitHub**：master 上还有没有我没部署的提交。跨域，随时可能失败。
 *
 * 第 2 项刻意做成「点一下才查」并且失败静默：它撞上的是外部服务（限流、断网、仓库改名），
 * 不该让「看一眼部署状态」这件事跟着一起坏掉。
 */

import { safeSetItem } from '../utils/safeStorage.js'

const BASE = '/api/deploy-status'

/**
 * 上游仓库。硬编码是有意的：站点产物里没有 git remote 信息，
 * 而「我到底是哪个仓库的部署」本来就是部署配置的一部分。
 */
const UPSTREAM_REPO = 'arwei944/navigator-v2'
const UPSTREAM_TTL = 30 * 60 * 1000

export async function fetchStatus() {
  try {
    const res = await fetch(BASE, { headers: { Accept: 'application/json' } })
    const j = await res.json().catch(() => ({}))
    if (!res.ok || !j.ok) return { ok: false, error: j.error || `请求失败（${res.status}）` }
    return { ok: true, status: j }
  } catch (e) {
    return { ok: false, error: '连不上部署状态接口' }
  }
}

/**
 * 比较线上版本与上游 master。
 *
 * @param {string} sha 线上正在跑的提交
 * @returns {{ok:boolean, behind?:number, more?:boolean, commits?:Array, error?:string}}
 */
export async function checkUpstream(sha) {
  if (!sha) return { ok: false, error: '线上版本没有提交号（本地开发或旧部署包）' }

  const cacheKey = `nav-upstream-${sha}`
  try {
    const hit = JSON.parse(localStorage.getItem(cacheKey) || 'null')
    if (hit && Date.now() - hit.at < UPSTREAM_TTL) return { ok: true, ...hit.data, cached: true }
  } catch { /* 坏缓存当作没有 */ }

  try {
    const res = await fetch(`https://api.github.com/repos/${UPSTREAM_REPO}/commits?per_page=40`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) {
      // 403/429 基本都是匿名限流：这不是「代码有问题」，文案要说清是外部服务
      const hint = res.status === 403 || res.status === 429 ? '（GitHub 限流，稍后再试）' : ''
      return { ok: false, error: `查不到上游提交（${res.status}）${hint}` }
    }
    const list = await res.json()
    if (!Array.isArray(list)) return { ok: false, error: '上游返回格式不对' }

    const idx = list.findIndex(c => c.sha === sha || String(c.sha).startsWith(sha))
    const data = idx === 0
      ? { behind: 0, more: false, commits: [] }
      : idx > 0
        // idx 就是「线上之后又提交了几个」——列表是倒序，前面的都比线上新
        ? { behind: idx, more: false, commits: list.slice(0, idx).map(summarize) }
        // 线上版本比这 40 条都旧（或不是这个仓库的提交）：只能说「至少这么多」
        : { behind: list.length, more: true, commits: list.slice(0, 10).map(summarize) }

    safeSetItem(cacheKey, JSON.stringify({ at: Date.now(), data }))  // 存不下时仅告警，不影响返回
    return { ok: true, ...data }
  } catch {
    return { ok: false, error: '连不上 GitHub（网络或浏览器拦截）' }
  }
}

function summarize(c) {
  return {
    sha: String(c.sha || '').slice(0, 7),
    message: String(c.commit?.message || '').split('\n')[0].slice(0, 80),
    date: c.commit?.author?.date || '',
    author: c.commit?.author?.name || '',
  }
}

/**
 * 取本机自动登录密钥（`/api/_local-key`，仅回环地址可用，服务端会再校验来源）。
 * 失败或没有时返回空串 —— 调用方据此判断「本机自动登录」是否可用。
 */
export async function fetchLocalKey() {
  try {
    const res = await fetch('/api/_local-key', { headers: { Accept: 'application/json' } })
    if (!res.ok) return ''
    const j = await res.json().catch(() => null)
    return String((j && j.key) || '').trim()
  } catch {
    return ''
  }
}
