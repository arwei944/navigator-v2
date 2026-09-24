import { defineStore } from 'pinia'
import { ref } from 'vue'
import { versionedPersist } from '@/utils/storeVersioning'

export const useHistoryStore = defineStore('history', () => {
  const records = ref([])

  function addRecord(siteId) {
    records.value.unshift({ siteId, timestamp: Date.now() })
    // 最多保留 50 条
    if (records.value.length > 50) {
      records.value = records.value.slice(0, 50)
    }
  }

  function clear() {
    records.value = []
  }

  function addRawRecord(r) {
    if (!r || r.siteId === undefined) return
    if (records.value.some(x => x.siteId === r.siteId)) return
    records.value.push(r)
    if (records.value.length > 50) records.value = records.value.slice(0, 50)
  }

  function getRecentSites(sites) {
    return records.value
      .map(r => {
        const site = sites.find(s => s.id === r.siteId)
        return site ? { ...site, time: r.timestamp } : null
      })
      .filter(Boolean)
      .filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i) // 去重
  }

  function getLastVisitTime(siteId) {
    const found = records.value.find(r => r.siteId === siteId)
    return found ? found.timestamp : null
  }

  return { records, addRecord, addRawRecord, clear, getRecentSites, getLastVisitTime }
}, {
  persist: versionedPersist('history')
})