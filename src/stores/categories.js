import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { CATEGORY_GROUPS, cloneGroups, sanitizeGroups } from '../../shared/categories.mjs'

export const useCategoriesStore = defineStore('categories', () => {
  // 默认表是模块级常量；这里持有运行时副本，云端下发自定义分类表时整体替换。
  // 全站分类下拉 / 筛选条 / 卡片配色 / 后台管理都读这一处，改分类只需改这里。
  const groups = ref(cloneGroups(CATEGORY_GROUPS))
  // 云端下发的分类表基线，用于判断「本地草稿是否已偏离云端」（未发布提示）
  const cloudGroups = ref(null)

  const categories = computed(() => groups.value.flatMap(g => g.categories))
  const domains = computed(() => groups.value.map(g => ({ id: g.id, label: g.label })))

  function isDomainScope(value) {
    return groups.value.some(g => g.id === value)
  }

  function domainOfScope(value) {
    if (!value || value === 'all') return 'all'
    for (const g of groups.value) {
      if (g.id === value) return g.id
      if (g.categories.some(c => c.id === value)) return g.id
    }
    return 'all'
  }

  function categoriesOfDomain(domainId) {
    if (!domainId || domainId === 'all') return categories.value
    const g = groups.value.find(g => g.id === domainId)
    return g ? g.categories : []
  }

  function getCategoryLabel(id) {
    if (isDomainScope(id)) return groups.value.find(g => g.id === id)?.label || id
    for (const g of groups.value) {
      const cat = g.categories.find(c => c.id === id)
      if (cat) return cat.label
    }
    return id
  }

  function getCategoryColor(id) {
    if (isDomainScope(id)) return '#64748b'
    for (const g of groups.value) {
      const cat = g.categories.find(c => c.id === id)
      if (cat) return cat.dotColor
    }
    return '#64748b'
  }

  function getGroupByCategory(catId) {
    return groups.value.find(g => g.categories.some(c => c.id === catId))
  }

  /**
   * 用云端分类表替换运行时表。结构非法（sanitizeGroups 返回 null）时保持原表不动并返回 false——
   * 半张表比上一版表更危险，宁可整体回退。
   */
  function applyCloudGroups(input) {
    if (input === undefined || input === null) return false
    const next = sanitizeGroups(input)
    if (!next) return false
    groups.value = next
    cloudGroups.value = cloneGroups(next)
    return true
  }

  /** 导出为可发布的云端结构（深拷贝，避免发布过程中被本地编辑串改） */
  function toCloudGroups() {
    return cloneGroups(groups.value)
  }

  function resetToDefault() {
    groups.value = cloneGroups(CATEGORY_GROUPS)
  }

  // ── 分类体系编辑（本地草稿，发布后才同步到其他设备） ──

  const ID_RE = /^[a-z0-9][a-z0-9_-]*$/

  function bump() {
    groups.value = [...groups.value]
  }

  function findGroupOf(catId) {
    return groups.value.find(g => g.categories.some(c => c.id === catId)) || null
  }

  function addCategory(groupId, { id, label, dotColor } = {}) {
    const cid = String(id || '').trim()
    const clabel = String(label || '').trim()
    if (!cid || !clabel) return { ok: false, error: '分类 id 与名称都不能为空' }
    if (!ID_RE.test(cid)) return { ok: false, error: 'id 只能用小写字母 / 数字 / - _，且以字母或数字开头' }
    if (categories.value.some(c => c.id === cid)) return { ok: false, error: `分类 id「${cid}」已存在` }
    if (domains.value.some(d => d.id === cid)) return { ok: false, error: `id 与域「${cid}」重名，会造成筛选歧义` }
    const g = groups.value.find(x => x.id === groupId)
    if (!g) return { ok: false, error: '目标域不存在' }
    g.categories.push({ id: cid, label: clabel, dotColor: String(dotColor || '').trim() || '#64748b' })
    bump()
    return { ok: true, id: cid }
  }

  function updateCategory(catId, patch = {}) {
    const g = findGroupOf(catId)
    if (!g) return { ok: false, error: '分类不存在' }
    const c = g.categories.find(x => x.id === catId)
    if (patch.label !== undefined) {
      const label = String(patch.label).trim()
      if (!label) return { ok: false, error: '分类名称不能为空' }
      c.label = label
    }
    if (patch.dotColor !== undefined) {
      const color = String(patch.dotColor).trim()
      if (color) c.dotColor = color
    }
    bump()
    return { ok: true }
  }

  /** 删除分类：不检查引用 —— 是否还有站点占用由调用方（后台）判定并给出更明确的提示 */
  function removeCategory(catId) {
    const g = findGroupOf(catId)
    if (!g) return { ok: false, error: '分类不存在' }
    if (g.categories.length <= 1) return { ok: false, error: `域「${g.label}」至少要保留一个分类` }
    g.categories.splice(g.categories.findIndex(x => x.id === catId), 1)
    bump()
    return { ok: true }
  }

  /** 域内上下移动；delta 为 -1 / +1 */
  function moveCategory(catId, delta) {
    const g = findGroupOf(catId)
    if (!g) return { ok: false, error: '分类不存在' }
    const i = g.categories.findIndex(x => x.id === catId)
    const j = i + delta
    if (j < 0 || j >= g.categories.length) return { ok: false, error: '已到边界' }
    const [c] = g.categories.splice(i, 1)
    g.categories.splice(j, 0, c)
    bump()
    return { ok: true }
  }

  function updateGroupLabel(groupId, label) {
    const g = groups.value.find(x => x.id === groupId)
    if (!g) return { ok: false, error: '域不存在' }
    const next = String(label).trim()
    if (!next) return { ok: false, error: '域名称不能为空' }
    g.label = next
    bump()
    return { ok: true }
  }

  /** 本地草稿是否已偏离云端（含从未下发过云端表时与内置默认表对比） */
  const dirty = computed(() => {
    const base = cloudGroups.value || cloneGroups(CATEGORY_GROUPS)
    return JSON.stringify(groups.value) !== JSON.stringify(base)
  })

  return {
    groups, cloudGroups, categories, domains, dirty,
    isDomainScope, domainOfScope, categoriesOfDomain,
    getCategoryLabel, getCategoryColor, getGroupByCategory,
    applyCloudGroups, toCloudGroups, resetToDefault,
    addCategory, updateCategory, removeCategory, moveCategory, updateGroupLabel,
  }
})