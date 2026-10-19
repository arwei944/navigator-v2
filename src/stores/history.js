import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { versionedPersist } from '@/utils/storeVersioning'
import { safeSetItem } from '@/utils/safeStorage'

/**
 * 本机访问记录 —— **「这台设备访问过什么」的唯一真相源**。
 *
 * ## 为什么把 visitCounts 并进来
 *
 * 合并前，「一次点击」要写三个地方：
 *   1. `sites` store 的 `visitCounts[id] += 1`（overlay 持久化）
 *   2. `site.visitCount` 就地改（为了让卡片角标立刻 +1）
 *   3. `history.records` unshift 一条时间戳（最近访问列表）
 *
 * 前两者是「访问了多少次」，后者是「最后一次是什么时候」—— 同一件事被拆成两处存储，
 * 于是 `recordVisit` 必须同时维护，而 `sitesRebuild` 还要专门为「就地改 visitCount
 * 会让 memo 失效」写注释解释。两处存储迟早不同步（例如用户清了 history 但 overlay 还在）。
 *
 * 现在收敛成一份 `visits: { [siteId]: { count, lastAt } }`：
 * 计数、最后访问时间、最近列表、智能排序信号**都从这一份派生**，只写一次。
 *
 * ## 数据结构
 *
 *   visits    { [siteId]: { count: number, lastAt: number } }   ← 唯一存储
 *   records   派生：最近访问列表（最新在前），由 visits 按 lastAt 排序得出
 *
 * `records` 保留为 computed 而非独立存储，是为了让既有消费方（会话同步、备份导出、
 * 全能框的「最近访问」）无需改调用方式，但它们读到的已经是派生物，不可能再漂移。
 */

/** 保留条数上限。按 siteId 去重后，这 50 条代表「最近 50 个不同站点」而不是「最近 50 次点击」 */
const MAX_RECORDS = 50

/** 时间戳可能是数字或 ISO 串（旧数据 / 会话同步过来的），统一成毫秒 */
function toTs(ts) {
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts
  const n = new Date(ts).getTime()
  return Number.isFinite(n) ? n : Date.now()
}

/**
 * 单调递增序号，用于「同一毫秒内多次访问」的次序判定。
 *
 * `Date.now()` 只有毫秒精度：连续点击几个站（或脚本批量灌数据）时 lastAt 全相同，
 * 只按时间排序结果不稳定 —— 「最近访问」的顺序会随排序实现抖动。
 * 旧实现靠 `unshift` 的插入顺序隐式保住次序，改成按 lastAt 排序后这条隐式保证就丢了。
 *
 * seq 不持久化（只在本次会话内递增）：它是**次序的补充判据**，不是业务数据。
 * 跨会话时同毫秒的概率极低，且那时 lastAt 已被持久化值覆盖。
 */
let seqCounter = 0

/** 单条访问记录净化：count 必须是非负整数，lastAt 必须是有效时间 */
function sanitizeVisit(raw) {
  if (!raw || typeof raw !== 'object') return null
  const count = Math.floor(Number(raw.count))
  const lastAt = toTs(raw.lastAt)
  if (!Number.isFinite(count) || count < 0) return null
  if (!Number.isFinite(lastAt)) return null
  return { count, lastAt }
}

/** 旧 overlay 里存着 `visits: { [id]: number }`，迁移后要合并进来（跨 key，迁移函数看不到） */
const LEGACY_OVERLAY_KEY = 'nav-sites-overlay'
const MERGED_FLAG = 'nav-history-merged-from-overlay'

/**
 * 一次性把旧 overlay 的访问计数并进来。
 *
 * 迁移时机只能在这里做：`storeVersioning` 的迁移函数是**按 key 独立**执行的，
 * history 的迁移读不到 overlay 的数据。之前「同一个访问量存两处」正是这次要消除的
 * 问题，所以合并必须发生在能同时看见两边的地方 —— 也就是 store 初始化时。
 *
 * 只在 v2→v3 已完成、且尚未合并过时执行一次；合并后写标记，避免每次启动重复累加。
 */
function mergeLegacyOverlayCounts(store) {
  try {
    if (localStorage.getItem(MERGED_FLAG)) return
    const raw = localStorage.getItem(LEGACY_OVERLAY_KEY)
    if (raw) {
      const d = JSON.parse(raw)
      const payload = d && typeof d === 'object' && 'data' in d ? d.data : d
      const legacy = payload?.visits
      if (legacy && typeof legacy === 'object') {
        const next = { ...store.visits }
        for (const [id, n] of Object.entries(legacy)) {
          const v = Math.floor(Number(n) || 0)
          if (v <= 0) continue
          const prev = next[id]
          // 计数取较大值：旧 overlay 的 count 与迁移出的「记录条数」是同一次访问的
          // 两种记账方式，相加会翻倍
          next[id] = {
            count: Math.max(prev?.count || 0, v),
            lastAt: prev?.lastAt || 0,
          }
        }
        store.visits = next
      }
    }
    // 用 safeSetItem：配额满 / 无痕模式下裸 setItem 会抛错，
    // 而这里只是写一个「已合并」标记，失败也不该打断启动
    safeSetItem(MERGED_FLAG, '1')
  } catch {
    // 存储不可用 / 数据损坏：跳过合并，不影响启动
  }
}

export const useHistoryStore = defineStore('history', () => {
  // { [siteId]: { count, lastAt } } —— 唯一存储，不再有第二个计数来源
  const visits = ref({})

  /**
   * 最近访问列表（最新在前），由 visits 派生。
   *
   * 之前这里是无条件 unshift，而「最近」列表按 id 去重后渲染 ——
   * 同一个站点连点 50 次就能把整个配额占满，用户看到的「最近」只剩一条。
   * 现在天然按 siteId 聚合（一个站点一条），再按 lastAt 排序，不会出现这个问题。
   */
  const records = computed(() => Object.entries(visits.value)
    .map(([siteId, v]) => ({ siteId, timestamp: v.lastAt, seq: v.seq || 0 }))
    /*
     * 先按时间、再按 seq —— 同毫秒内连续点击时，只用时间排序结果是任意的
     * （「最近访问」顺序会抖）。seq 只在本次会话内递增，跨会话时为 0，
     * 那时 lastAt 必然不同，不影响正确性。
     */
    .sort((a, b) => (b.timestamp - a.timestamp) || (b.seq - a.seq))
    .slice(0, MAX_RECORDS))

  /**
   * 记一次访问。`clicksStore` 的云端口径上报由调用方负责 ——
   * 这里只管本机事实，不掺全局统计（两者是不同口径，混在一起会让「清空本机记录」
   * 连带影响云端热度，那是错的）。
   */
  function addRecord(siteId, at = Date.now()) {
    if (siteId === undefined || siteId === null || siteId === '') return
    const id = String(siteId)
    const prev = visits.value[id]
    const ts = toTs(at)
    seqCounter += 1
    visits.value = {
      ...visits.value,
      [id]: { count: (prev?.count || 0) + 1, lastAt: ts, seq: seqCounter },
    }
  }

  /** 只更新最后访问时间、不增加计数（供「恢复回放」这类不算一次访问的场景） */
  function touch(siteId, at = Date.now()) {
    if (!siteId) return
    const id = String(siteId)
    const prev = visits.value[id]
    visits.value = { ...visits.value, [id]: { count: prev?.count || 0, lastAt: toTs(at) } }
  }

  /** 读某站点的本机访问次数（无记录按 0） */
  function countOf(siteId) {
    return visits.value[siteId]?.count || 0
  }

  /** 读某站点最后一次访问时间（无记录返回 null） */
  function getLastVisitTime(siteId) {
    return visits.value[siteId]?.lastAt ?? null
  }

  /**
   * 从外部（会话同步 / 备份导入）灌入一条记录。
   *
   * 合并语义：计数取较大值而非相加 —— 同步过来的可能是另一台设备的计数，
   * 相加会把「同一批访问」重复计算。时间取较晚者。
   */
  function addRawRecord(r) {
    if (!r || r.siteId === undefined || r.siteId === null) return
    const id = String(r.siteId)
    const prev = visits.value[id]
    const ts = toTs(r.timestamp ?? r.lastAt)
    const incoming = Math.max(0, Math.floor(Number(r.count) || 0))
    visits.value = {
      ...visits.value,
      [id]: {
        count: Math.max(prev?.count || 0, incoming),
        lastAt: Math.max(prev?.lastAt || 0, ts),
      },
    }
  }

  /** 清空本机访问记录。云端全局点击量不受影响（那是另一个口径）。 */
  function clear() {
    visits.value = {}
  }

  /** 最近访问的站点对象列表（附带 time 字段），保持既有调用方式 */
  function getRecentSites(sites) {
    const byId = new Map((sites || []).map(s => [s.id, s]))
    const out = []
    for (const r of records.value) {
      const site = byId.get(r.siteId)
      if (site) out.push({ ...site, time: r.timestamp })
    }
    return out
  }

  const store = { visits, records, addRecord, touch, countOf, getLastVisitTime, addRawRecord, clear, getRecentSites }

  // 跨 key 的历史计数合并（见 mergeLegacyOverlayCounts 的注释：迁移函数做不到这件事）
  if (typeof localStorage !== 'undefined') mergeLegacyOverlayCounts(store)

  return store
}, {
  persist: versionedPersist('history')
})
