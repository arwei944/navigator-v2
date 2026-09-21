import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import Fuse from 'fuse.js'
import { pinyin } from 'pinyin-pro'
import SEED_SITES from '../../api/sites-data.json'

export const useSitesStore = defineStore('sites', () => {
  const sites = ref([...SEED_SITES])
  const cloudVersion = ref(0)
  const cloudLoaded = ref(false)
  let pollTimer = null
  const searchQuery = ref('')
  const currentCategory = ref('all')
  const sortBy = ref('default')
  const viewMode = ref('grid') // grid | list

  // 回收站
  const trash = ref([])

  // 批量选择
  const batchMode = ref(false)
  const selectedIds = ref(new Set())

  // 拼音索引缓存
  let pinyinIndex = null

  // 构建拼音索引
  function buildPinyinIndex(sitesList) {
    return sitesList.map(s => ({
      ...s,
      _pinyinName: pinyin(s.name, { toneType: 'none', separator: '' }).toLowerCase(),
      _pinyinDesc: pinyin(s.desc, { toneType: 'none', separator: '' }).toLowerCase(),
      _pinyinInitial: pinyin(s.name, { pattern: 'first', toneType: 'none', separator: '' }).toLowerCase()
    }))
  }

  // Fuse 实例
  let fuseInstance = null
  function getFuse() {
    if (!fuseInstance || fuseInstance._items !== sites.value) {
      const withPinyin = buildPinyinIndex(sites.value)
      pinyinIndex = withPinyin
      fuseInstance = new Fuse(withPinyin, {
        keys: [
          { name: 'name', weight: 2 },
          { name: 'desc', weight: 1 },
          { name: 'url', weight: 1 },
          { name: '_pinyinName', weight: 1.5 },
          { name: '_pinyinDesc', weight: 0.8 },
          { name: '_pinyinInitial', weight: 1.5 }
        ],
        threshold: 0.4,
        distance: 100,
        includeScore: true
      })
      fuseInstance._items = sites.value
    }
    return { fuse: fuseInstance, index: pinyinIndex }
  }

  const filteredSites = computed(() => {
    let result = [...sites.value]

    // 分类筛选
    if (currentCategory.value !== 'all') {
      result = result.filter(s => s.categoryId === currentCategory.value)
    }

    // 搜索过滤
    const q = searchQuery.value.trim().toLowerCase()
    if (q) {
      // 先尝试精确匹配
      const exact = result.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.desc.toLowerCase().includes(q) ||
        s.url.toLowerCase().includes(q)
      )
      if (exact.length > 0) {
        result = exact
      } else {
        // 使用 Fuse 模糊搜索 + 拼音
        try {
          const { fuse } = getFuse()
          const fuseResults = fuse.search(q)
          const matchedIds = new Set(fuseResults.map(r => r.item.id))
          result = result.filter(s => matchedIds.has(s.id))
          // 按匹配分数排序
          const scoreMap = new Map(fuseResults.map(r => [r.item.id, r.score]))
          result.sort((a, b) => (scoreMap.get(a.id) || 1) - (scoreMap.get(b.id) || 1))
        } catch (e) {
          // fallback
          result = result.filter(s =>
            s.name.toLowerCase().includes(q) ||
            s.desc.toLowerCase().includes(q) ||
            s.url.toLowerCase().includes(q)
          )
        }
      }
    }

    // 排序
    switch (sortBy.value) {
      case 'name-asc': result.sort((a, b) => a.name.localeCompare(b.name)); break
      case 'name-desc': result.sort((a, b) => b.name.localeCompare(a.name)); break
      case 'hot': result.sort((a, b) => b.visitCount - a.visitCount); break
      case 'newest': result.sort((a, b) => b.createdAt - a.createdAt); break
      default: break
    }

    return result
  })

  function addSite(site) {
    sites.value.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      sortOrder: sites.value.length,
      visitCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...site
    })
  }

  function updateSite(id, data) {
    const idx = sites.value.findIndex(s => s.id === id)
    if (idx !== -1) {
      sites.value[idx] = { ...sites.value[idx], ...data, updatedAt: Date.now() }
    }
  }

  function updateSiteField(id, key, value) {
    const idx = sites.value.findIndex(s => s.id === id)
    if (idx !== -1) {
      sites.value[idx][key] = value
      sites.value[idx].updatedAt = Date.now()
    }
  }

  function deleteSite(id) {
    const site = sites.value.find(s => s.id === id)
    if (site) {
      trash.value.push({ ...site, deletedAt: Date.now() })
      sites.value = sites.value.filter(s => s.id !== id)
    }
  }

  function recordVisit(id) {
    const site = sites.value.find(s => s.id === id)
    if (site) site.visitCount++
  }

  function reorderSites(newOrderedSites) {
    sites.value = newOrderedSites.map((site, index) => ({
      ...site,
      sortOrder: index
    }))
  }

  function setSearchQuery(q) { searchQuery.value = q }
  function setCategory(cat) { currentCategory.value = cat }
  function setSortBy(s) { sortBy.value = s }
  function setViewMode(m) { viewMode.value = m }

  // ── 批量选择 ──
  function toggleBatchMode() {
    batchMode.value = !batchMode.value
    if (!batchMode.value) {
      selectedIds.value = new Set()
    }
  }

  function toggleSelect(id) {
    const newSet = new Set(selectedIds.value)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    selectedIds.value = newSet
  }

  function selectAll(ids) {
    selectedIds.value = new Set(ids)
  }

  function clearSelection() {
    selectedIds.value = new Set()
  }

  function batchDeleteToTrash(targetIds) {
    const ids = targetIds || [...selectedIds.value]
    ids.forEach(id => {
      const site = sites.value.find(s => s.id === id)
      if (site) {
        trash.value.push({ ...site, deletedAt: Date.now() })
      }
    })
    sites.value = sites.value.filter(s => !ids.includes(s.id))
    selectedIds.value = new Set()
  }

  // ── 回收站管理 ──
  function restoreFromTrash(id) {
    const idx = trash.value.findIndex(s => s.id === id)
    if (idx !== -1) {
      const site = trash.value[idx]
      delete site.deletedAt
      sites.value.push(site)
      trash.value.splice(idx, 1)
    }
  }

  function permanentDelete(id) {
    trash.value = trash.value.filter(s => s.id !== id)
  }

  function emptyTrash() {
    trash.value = []
  }

  // ── 云端热更新 ──
  function applyCloudData(data) {
    if (!data || !Array.isArray(data.sites)) return false
    const localById = new Map(sites.value.map(s => [s.id, s]))
    sites.value = data.sites.map(cloudSite => {
      const local = localById.get(cloudSite.id)
      return local ? { ...cloudSite, visitCount: local.visitCount } : cloudSite
    })
    cloudVersion.value = data.version || 0
    return true
  }

  async function initCloudSites() {
    try {
      const res = await fetch('/api/sites')
      if (!res.ok) return
      const data = await res.json()
      applyCloudData(data)
    } catch {
      // 离线时使用本地种子兜底
    } finally {
      cloudLoaded.value = true
    }
  }

  async function pollCloudSites() {
    try {
      const res = await fetch('/api/sites')
      if (!res.ok) return
      const data = await res.json()
      if (data && data.version && data.version !== cloudVersion.value) {
        applyCloudData(data)
      }
    } catch {
      // 忽略轮询失败，下次再试
    }
  }

  function startPolling(interval = 30000) {
    stopPolling()
    pollTimer = setInterval(pollCloudSites, interval)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  return {
    sites, searchQuery, currentCategory, sortBy, viewMode,
    filteredSites, trash, batchMode, selectedIds,
    cloudVersion, cloudLoaded,
    addSite, updateSite, updateSiteField, deleteSite, recordVisit, reorderSites,
    setSearchQuery, setCategory, setSortBy, setViewMode,
    toggleBatchMode, toggleSelect, selectAll, clearSelection, batchDeleteToTrash,
    restoreFromTrash, permanentDelete, emptyTrash,
    initCloudSites, pollCloudSites, startPolling, stopPolling
  }
})

