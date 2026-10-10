import { defineStore } from 'pinia'
import { ref } from 'vue'
import { versionedPersist } from '@/utils/storeVersioning'

/** 保留条数上限。按 siteId 去重后，这 50 条代表「最近 50 个不同站点」而不是「最近 50 次点击」 */
const MAX_RECORDS = 50

/** 时间戳可能是数字或 ISO 串（旧数据 / 会话同步过来的），统一成毫秒 */
function toTs(ts) {
  return typeof ts === 'number' ? ts : new Date(ts).getTime()
}

export const useHistoryStore = defineStore('history', () => {
  const records = ref([])

  /**
   * 记一次访问。
   *
   * 必须**按 siteId 去重**：旧实现是无条件 `unshift`，而「最近」列表是按 id 去重后渲染的，
   * 于是同一个站点连点 50 次就能把整个配额占满 —— 用户看到的「最近」只剩一条，
   * 其余最近访问过的站点全被这个高频站挤掉了。
   */
  function addRecord(siteId) {
    if (siteId === undefined || siteId === null || siteId === '') return
    const rest = records.value.filter(r => r.siteId !== siteId)
    rest.unshift({ siteId, timestamp: Date.now() })
    records.value = rest.slice(0, MAX_RECORDS)
  }

  function clear() {
    records.value = []
  }

  /**
   * 从外部（会话同步 / 备份导入）灌入一条记录。
   *
   * 方向必须与 addRecord 一致（**最新在前**）：旧实现是 `push` 到末尾，与列表的「最新在前」
   * 正好相反，导入后整个「最近」列表是倒着的。
   */
  function addRawRecord(r) {
    if (!r || r.siteId === undefined) return
    const ts = toTs(r.timestamp)
    const rec = { ...r, timestamp: Number.isFinite(ts) ? ts : Date.now() }
    const rest = records.value.filter(x => x.siteId !== rec.siteId)
    rest.push(rec)
    rest.sort((a, b) => toTs(b.timestamp) - toTs(a.timestamp))
    records.value = rest.slice(0, MAX_RECORDS)
  }

  function getRecentSites(sites) {
    return records.value
      .map(r => {
        const site = sites.find(s => s.id === r.siteId)
        return site ? { ...site, time: r.timestamp } : null
      })
      .filter(Boolean)
      .filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i) // 去重（防历史数据里的重复条目）
  }

  function getLastVisitTime(siteId) {
    const found = records.value.find(r => r.siteId === siteId)
    return found ? found.timestamp : null
  }

  return { records, addRecord, addRawRecord, clear, getRecentSites, getLastVisitTime }
}, {
  persist: versionedPersist('history')
})