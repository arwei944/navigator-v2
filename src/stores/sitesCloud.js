/**
 * 站点云端同步：条件请求、错误分类、轮询退避、种子兜底。
 *
 * ## 这一层的职责
 *
 * 只负责「拿到一份合法的云端数据 / 说清楚为什么没拿到」，**不碰渲染**。
 * store 拿到结果后调 `applyCloudData` / `rebuild`。
 *
 * ## 三个设计决定，每个都来自一次真实故障
 *
 * ### 1. 不能直接 `res.json()`
 *
 * 静态托管（或任何 SPA 兜底 / 代理）会把未知路径也返回 200 + `index.html`，
 * 于是 `res.ok` 为真、`res.json()` 抛「Unexpected token '<'」，再被 catch 误判成
 * 「离线」—— 用户明明在线，界面却说「已离线，联网后会自动更新」，而那个自动恢复
 * 永远不会发生。所以先看 Content-Type，拿不到合法对象就归入 `invalid-payload`。
 *
 * ### 2. version 必须单调递增才应用
 *
 * 旧判据是 `version !== cloudVersion`，只要求「不等」—— 于是慢响应的旧版本也满足，
 * 成了数据回滚的通道。
 *
 * ### 3. 有些错误重试一万次也不会好
 *
 * `CLOUD_FATAL` 那三项（402 / 404 / 非 JSON）说明「这个部署没有可用的数据接口」，
 * 继续按退避节奏打只是白白消耗额度 —— 而额度正是被耗光的那个东西。
 * 停掉之后由用户手动重试、`online` 事件、标签页回到前台三条路径重新探。
 *
 * @param {object} deps
 * @param {() => number} deps.getVersion 当前已应用的云端版本
 * @param {() => boolean} deps.hasSites 当前基底是否已有数据（决定要不要种子兜底）
 * @param {(data:any)=>boolean} deps.applyData 应用一份新数据（返回是否真的应用了）
 * @param {(sites:any[])=>void} deps.applySeed 用种子填充基底
 * @param {import('vue').Ref<string>} deps.cloudError 错误短码（UI 侧翻译成人话）
 * @param {import('vue').Ref<boolean>} deps.cloudLoaded 是否完成过首拉
 * @param {(visible:boolean)=>void} deps.watchVisibility 可见性订阅
 */
import { ref } from 'vue'

const CLOUD_TIMEOUT = 10000
const POLL_BASE_MS = 30000
const POLL_MAX_MS = 300000

/** 「再轮询一万次也不可能成功」的服务端状态 → 停掉排期 */
export const CLOUD_FATAL = new Set(['http-402', 'http-404', 'invalid-payload'])

export function createCloudSync({ getVersion, hasSites, applyData, applySeed, cloudError, cloudLoaded, watchVisibility }) {
  /** 条件请求用：只在拿到**合法版本号**时才记住 ETag（理由见 fetchCloud 内注释） */
  let cloudEtag = ''
  let cloudInflight = null
  let seedPromise = null
  let seedApplied = false
  let pollTimer = null
  let pollDelay = POLL_BASE_MS
  let pollFails = 0
  let polling = false
  /** 标签页是否在后台：在后台不排期（见 utils/visibility.js 的说明） */
  let pageHidden = false

  async function fetchCloud() {
    if (cloudInflight) return cloudInflight
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), CLOUD_TIMEOUT)
    cloudInflight = (async () => {
      try {
        const res = await fetch('/api/sites', {
          signal: ctrl.signal,
          headers: cloudEtag ? { 'If-None-Match': cloudEtag } : undefined,
        })
        // 304：内容与上次一致。既不用解析 JSON，也不用 rebuild
        if (res.status === 304) {
          cloudError.value = ''
          return null
        }
        if (!res.ok) {
          cloudError.value = `http-${res.status}`
          return null
        }
        // 先看 Content-Type，再尽力解析（理由见文件头注释 ①）
        const ctype = res.headers.get('Content-Type') || ''
        if (!ctype.includes('json')) {
          cloudError.value = 'invalid-payload'
          return null
        }
        let data = null
        try {
          data = await res.json()
        } catch {
          cloudError.value = 'invalid-payload'
          return null
        }
        // 只在拿到合法版本号时才记住 ETag。否则一旦第一次响应体不合法，
        // 下次的 304 会把「这份数据没被应用过」这个状态永久钉住，热更新再也进不来。
        const v = Number(data?.version)
        if (Number.isFinite(v)) cloudEtag = res.headers.get('ETag') || cloudEtag
        return data
      } catch (e) {
        cloudError.value = e && e.name === 'AbortError' ? 'timeout' : 'offline'
        return null
      } finally {
        clearTimeout(timer)
        cloudInflight = null
      }
    })()
    return cloudInflight
  }

  /**
   * version 必须**单调递增**才应用（理由见文件头注释 ②）。
   */
  function applyIfNewer(data) {
    if (!data) return false
    const v = Number(data.version)
    if (!Number.isFinite(v)) {
      console.warn('[sites] 云端响应缺少合法的 version，已忽略本次更新')
      cloudError.value = 'invalid-payload'
      return false
    }
    if (v <= getVersion()) return false
    return applyData(data)
  }

  /**
   * 种子兜底：**只在首次云端拉取失败时**才动态取回那份 152 KB 的站点表。
   *
   * 承诺缓存（seedPromise）确保只 import 一次；失败也兑现空数组 ——
   * 否则每次轮询失败都会重试同一个必然失败的 import。
   */
  function loadSeedSites() {
    if (!seedPromise) {
      seedPromise = import('../../api/sites-data.json')
        .then((m) => (Array.isArray(m?.default) ? m.default : Array.isArray(m) ? m : []))
        .catch(() => [])
    }
    return seedPromise
  }

  /** 把种子灌进基底。期间云端若已成功（已有数据），这次惰性加载直接作废。 */
  async function applySeedFallback() {
    if (seedApplied) return
    seedApplied = true
    const seed = await loadSeedSites()
    if (seed.length && !hasSites()) applySeed(seed)
  }

  async function initCloudSites() {
    try {
      applyIfNewer(await fetchCloud())
    } finally {
      cloudLoaded.value = true
    }
    // 首拉没拿到数据（离线 / 接口不存在 / 平台暂停 / 响应不合法）→ 种子兜底，
    // 别让首屏停在空列表上。云端正常时这一步不执行，那份字节也就不会被下载。
    if (!hasSites()) await applySeedFallback()
  }

  /* ── 轮询节奏：成功间隔恒定，失败指数退避 ──
   * 为什么必须退避：断网时 30s 一轮会一直打一个必然失败的请求，移动端上每次都要等
   * 到超时（10s），叠加起来就是「后台一直在耗电、前台一直没有新数据」。
   * 退避到 5 分钟封顶，并在 online 事件与标签页重新可见时立刻重试。 */
  function scheduleNext(delay = pollDelay) {
    if (!polling || pageHidden) return
    if (pollTimer) clearTimeout(pollTimer)
    pollTimer = setTimeout(tick, delay)
  }

  async function tick() {
    pollTimer = null
    if (!polling || pageHidden) return
    await pollCloudSites()
    if (!polling || pageHidden) return
    // 平台暂停（CLOUD_FATAL）时 pollCloudSites 已经决定不再排期，这里不续期
    if (CLOUD_FATAL.has(cloudError.value)) return
    scheduleNext()
  }

  async function pollCloudSites() {
    const applied = applyIfNewer(await fetchCloud())
    if (CLOUD_FATAL.has(cloudError.value)) {
      if (pollTimer) {
        clearTimeout(pollTimer)
        pollTimer = null
      }
      return applied
    }
    if (cloudError.value) {
      pollFails += 1
      pollDelay = Math.min(POLL_MAX_MS, POLL_BASE_MS * 2 ** Math.min(pollFails, 4))
    } else {
      pollFails = 0
      pollDelay = POLL_BASE_MS
    }
    return applied
  }

  /** 立刻重试并复位退避：联网恢复 / 标签页回来 / 用户点「重试」时用，别让人干等退避窗口 */
  function retryCloudNow() {
    pollFails = 0
    pollDelay = POLL_BASE_MS
    return pollCloudSites().then((applied) => {
      // 之前可能因为平台暂停或进后台停掉了排期，这次探通了就把节奏接回去
      if (polling && !pollTimer && !pageHidden && !CLOUD_FATAL.has(cloudError.value)) scheduleNext()
      return applied
    })
  }

  function startPolling(interval = POLL_BASE_MS) {
    stopPolling()
    polling = true
    pollDelay = interval
    scheduleNext(interval)
  }

  function stopPolling() {
    polling = false
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
  }

  // 进后台停排期、回前台立刻补一次并接回节奏 —— 后台标签页不该消耗云端额度
  watchVisibility((visible) => {
    pageHidden = !visible
    if (!visible) {
      if (pollTimer) {
        clearTimeout(pollTimer)
        pollTimer = null
      }
      return
    }
    if (polling && !CLOUD_FATAL.has(cloudError.value)) {
      if (!pollTimer) retryCloudNow()
    }
  })

  return { initCloudSites, pollCloudSites, startPolling, stopPolling, retryCloudNow, fetchCloud, applyIfNewer }
}

export { CLOUD_TIMEOUT, POLL_BASE_MS, POLL_MAX_MS }
