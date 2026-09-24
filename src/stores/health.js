import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 站点在线状态探测 store
 * 按需探测：只探测调用方传入的站点（通常为当前可见卡片），
 * 带 60s LRU 缓存与并发控制，避免对全量站点打爆触发反爬。
 *
 * 状态等级（与 scripts/check-sites.mjs 口径一致）：
 *  - ok      : 2xx / 3xx 可访问
 *  - limited : 429/403/405/401 反爬/限流（可忽略，但非正常）
 *  - down    : 连接失败 / ERR / 000 / 404 / 402 / 410 等真实失效
 *  - unknown : 未探测 / 探测中 / 缓存过期
 */
const CACHE_TTL = 60 * 1000 // 60s
const MAX_CONCURRENT = 6

export const useHealthStore = defineStore('health', () => {
  const statusMap = ref({}) // { [siteId]: { status, code, ts } }

  function classify(code) {
    const n = Number(code)
    if (code === 'ERR' || code === '000' || Number.isNaN(n)) return { status: 'down', code: 'ERR' }
    if (n >= 200 && n < 400) return { status: 'ok', code: n }
    if ([429, 403, 405, 401].includes(n)) return { status: 'limited', code: n } // 反爬/限流
    return { status: 'down', code: n } // 404/402/410 等真实失效
  }

  /** 读取某站状态；缓存过期视为 unknown */
  function getStatus(siteId) {
    const e = statusMap.value[siteId]
    if (!e || Date.now() - e.ts > CACHE_TTL) return { status: 'unknown', code: null, ts: 0 }
    return e
  }

  async function _probeOne(site) {
    const base = site.url.includes('://') ? site.url : 'https://' + site.url
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    let code = 'ERR'
    try {
      let resp = await fetch(base, { method: 'HEAD', redirect: 'follow', signal: controller.signal })
      code = String(resp.status)
      if (resp.status === 405 || resp.status === 403 || resp.status === 404) {
        // HEAD 被拒，回退 GET 探测（注意 404 可能是 HEAD 不支持，再试 GET）
        resp = await fetch(base, { method: 'GET', redirect: 'follow', signal: controller.signal })
        code = String(resp.status)
      }
    } catch {
      code = 'ERR'
    } finally {
      clearTimeout(timer)
    }
    const { status, code: c } = classify(code)
    statusMap.value[site.id] = { status, code: c, ts: Date.now() }
    return status
  }

  /**
   * 探测一批站点。仅探测未缓存或已过期的；
   * 信号量限流并发；resolve 后 statusMap 已更新。
   */
  async function probeSites(sites) {
    const pending = sites.filter(s => {
      const e = statusMap.value[s.id]
      return !e || Date.now() - e.ts > CACHE_TTL
    })
    if (pending.length === 0) return

    let cursor = 0
    async function worker() {
      while (cursor < pending.length) {
        const site = pending[cursor++]
        try { await _probeOne(site) } catch { /* 单站失败不阻塞批处理 */ }
      }
    }
    const workers = Array.from({ length: Math.min(MAX_CONCURRENT, pending.length) }, worker)
    await Promise.all(workers)
  }

  /** 供卡片使用：含义化节点 */
  function nodeFor(status) {
    return { ok: 'green', limited: 'amber', down: 'red' }[status] || 'gray'
  }

  return { statusMap, getStatus, probeSites, nodeFor }
})