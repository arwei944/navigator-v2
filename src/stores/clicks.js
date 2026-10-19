import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { countOf, dayKey } from '../../shared/clicks-core.mjs'
import { decodeStored, encodeStored } from '@/utils/storeVersioning'
import { safeSetItem } from '@/utils/safeStorage'
import { setVisibleInterval } from '@/utils/visibility'

/**
 * 点击统计 store —— **全局口径**，与「我的访问次数」区分开。
 *
 * 两套计数各有用途，不要混：
 *  - `visitCounts`（在 sites store，本地）：我这台设备访问了多少次，供「推荐发现」做个性化；
 *  - `clicks`（这里，云端）：**所有访客**点击某站点的总次数，是站点热度的唯一权威口径。
 *
 * 写路径（匿名上报）：每次点击先进本地待发队列 `pending`，防抖合并后批量 POST。
 * 为什么必须落 localStorage：点击发生在跳转前的一瞬，用户点完就离开页面，
 * 若只放内存，未发出的增量会随页面卸载一起丢。因此 pending 持久化，并额外在
 * `pagehide` / 页面隐藏时用 `sendBeacon` 兜底发出。
 *
 * 读路径（公开读取）：GET 云端聚合结果，5 分钟 TTL 内不重复拉取，失败保留旧值。
 */

const PENDING_KEY = 'nav-clicks-pending'
const CLOUD_TTL = 5 * 60 * 1000
const FLUSH_DELAY = 4000

export const useClicksStore = defineStore('clicks', () => {
  const counts = ref({})     // { [siteId]: 全局点击量 }
  const series = ref({})     // { [siteId]: { 'YYYY-MM-DD': n } } 时间分桶，趋势图唯一数据源
  const total = ref(0)       // 全站总点击量
  const sites = ref(0)       // 有点击的站点数
  const updatedAt = ref(null)
  const loaded = ref(false)
  const loadedAt = ref(0)

  // 待发增量：{ [siteId]: n }，已发出但未确认的部分不会从队列里扣掉
  const pending = ref(decodeStored(PENDING_KEY, localStorage.getItem(PENDING_KEY), {}))

  // 展示 / 排行统一走这一份：云端已确认 + 本地待发，避免「角标」与「排行」两套口径
  const mergedCounts = computed(() => {
    const out = { ...counts.value }
    for (const [id, n] of Object.entries(pending.value)) {
      const v = Number(n) || 0
      if (v > 0) out[id] = (out[id] || 0) + v
    }
    return out
  })

  /**
   * 趋势图读这一份：云端已确认 + 本地待发（待发部分全部记在**今天**的桶里）。
   * 没有待发时**直接复用 series.value 的引用** —— 趋势图订阅的是对象身份，
   * 每次都造新对象会让「没变化也重算」，300 站的图表全量重绘。
   */
  const mergedSeries = computed(() => {
    const pend = Object.entries(pending.value).filter(([, n]) => Number(n) > 0)
    if (!pend.length) return series.value
    const key = dayKey(new Date())
    if (!key) return series.value
    const out = {}
    for (const [id, buckets] of Object.entries(series.value)) out[id] = buckets
    for (const [id, n] of pend) {
      const cur = out[id] || {}
      out[id] = { ...cur, [key]: (Number(cur[key]) || 0) + Number(n) }
    }
    return out
  })

  let inflight = null
  let flushTimer = null
  let flushing = null
  let retryTimer = null

  /** 冲突后延迟重试：退避到 10s，避免服务端持续高并发时反复打 */
  function scheduleRetry() {
    if (retryTimer) return
    retryTimer = setTimeout(() => { retryTimer = null; flush() }, 10000)
  }

  function persistPending() {
    safeSetItem(PENDING_KEY, encodeStored(pending.value))
  }

  /** 展示用点击量 = 云端已确认 + 本地待发（点完立刻 +1，不等云端往返） */
  function countFor(siteId) {
    return countOf(mergedCounts.value, siteId)
  }

  function record(siteId) {
    const id = String(siteId || '').trim()
    if (!id) return
    pending.value = { ...pending.value, [id]: (pending.value[id] || 0) + 1 }
    persistPending()
    scheduleFlush()
  }

  function scheduleFlush() {
    if (flushTimer) return
    flushTimer = setTimeout(() => { flushTimer = null; flush() }, FLUSH_DELAY)
  }

  function dropSent(sent) {
    const next = { ...pending.value }
    for (const [id, n] of Object.entries(sent)) {
      const left = (next[id] || 0) - n
      if (left > 0) next[id] = left
      else delete next[id]
    }
    pending.value = next
    persistPending()
  }

  /** 把已发出的增量乐观并入本地计数（sendBeacon 拿不到响应时靠它避免角标回跳） */
  function absorb(sent) {
    const next = { ...counts.value }
    for (const [id, n] of Object.entries(sent)) next[id] = (next[id] || 0) + n
    counts.value = next
  }

  /**
   * 发送待发队列。`beacon=true` 时优先走 sendBeacon（页面卸载场景，请求必须同步发出）。
   * 任何失败都保留队列，下次重试 —— 点击统计丢一点可以接受，丢整份不行。
   */
  function flush({ beacon = false } = {}) {
    if (flushing) return flushing
    const entries = Object.entries(pending.value).filter(([, n]) => Number(n) > 0)
    if (!entries.length) return Promise.resolve({ ok: true, skipped: true })

    const sent = Object.fromEntries(entries)
    const payload = JSON.stringify({ clicks: entries.map(([id, n]) => ({ id, n })) })

    if (beacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        const ok = navigator.sendBeacon('/api/clicks', new Blob([payload], { type: 'application/json' }))
        if (ok) {
          dropSent(sent)
          absorb(sent)
          return Promise.resolve({ ok: true, via: 'beacon' })
        }
      } catch {
        // 落到下面的 fetch 兜底
      }
    }

    flushing = (async () => {
      try {
        const res = await fetch('/api/clicks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        })
        if (!res.ok) {
          /*
           * 409 = 服务端 CAS 冲突（并发写，已重试过仍失败）。
           * pending 保留着（这里没 dropSent），但光保留不够 —— 用户可能不再点击，
           * 这批增量就要等到下次点击才补发。安排一次延迟重试，且避免无谓的密集重试。
           */
          if (res.status === 409) scheduleRetry()
          return { ok: false, status: res.status }
        }
        const j = await res.json().catch(() => null)
        dropSent(sent)
        // 服务端返回的是合并后的全量：直接采用，顺带把并发期间的他人点击也拉齐
        if (j && j.clicks && typeof j.clicks === 'object') {
          counts.value = j.clicks
          if (j.series && typeof j.series === 'object') series.value = j.series
          total.value = Number(j.total) || 0
          sites.value = Number(j.sites) || 0
          updatedAt.value = j.updatedAt || updatedAt.value
          loaded.value = true
          loadedAt.value = Date.now()
        } else {
          absorb(sent)
        }
        return { ok: true }
      } catch {
        return { ok: false, error: 'network' }
      } finally {
        flushing = null
      }
    })()
    return flushing
  }

  /** 拉取云端全局点击量；TTL 内为 no-op */
  async function load({ force = false } = {}) {
    if (!force && loadedAt.value && Date.now() - loadedAt.value < CLOUD_TTL) return
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const res = await fetch('/api/clicks', { cache: 'no-store' })
        if (!res.ok) return
        const j = await res.json()
        counts.value = j && j.clicks && typeof j.clicks === 'object' ? j.clicks : {}
        series.value = j && j.series && typeof j.series === 'object' ? j.series : {}
        total.value = Number(j?.total) || 0
        sites.value = Number(j?.sites) || 0
        updatedAt.value = j?.updatedAt || null
        loaded.value = true
        loadedAt.value = Date.now()
      } catch {
        // 网络失败保留旧值：宁可显示上一次统计，也不要闪回 0
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  function refresh() {
    return load({ force: true })
  }

  // 页面卸载 / 切到后台：用 beacon 把待发增量发出去，避免用户关页丢点击
  if (typeof window !== 'undefined') {
    const onHide = () => { flush({ beacon: true }) }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onHide()
    })
    // 云端统计是快照，页面长开时不轮询就会一直显示开局那一份。
    // 但**后台标签页不轮询**：浏览器只把后台定时器压到 1 次/分钟、不会停掉它，
    // 挂后台一整天就是白烧云端额度（额度打满会被平台暂停整个部署，见 utils/visibility.js）
    setVisibleInterval(CLOUD_TTL, () => { if (loadedAt.value) load({ force: true }) })
  }

  return {
    counts, series, total, sites, updatedAt, loaded, pending, mergedCounts, mergedSeries,
    countFor, record, flush, load, refresh,
  }
})