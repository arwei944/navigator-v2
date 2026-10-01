import { defineStore } from 'pinia'
import { computed } from 'vue'
import { CATEGORY_GROUPS, categoriesOfDomain, domainOfScope, isDomainScope } from '../../shared/categories.mjs'

export const useCategoriesStore = defineStore('categories', () => {
  // 分类表唯一数据源在 shared/categories.mjs，与本地控制台、线上接口同源。
  // 侧栏已不再展开子分类（改由中间栏筛选条承载），所以这里不需要可变副本。
  const groups = CATEGORY_GROUPS

  // 向后兼容：扁平化所有分类
  const categories = computed(() => groups.flatMap(g => g.categories))

  // 域（导航一级方向）：全部 + AI 学习 / 币圈 / 工具 / 基础服务
  const domains = computed(() => groups.map(g => ({ id: g.id, label: g.label })))

  function getCategoryLabel(id) {
    if (isDomainScope(id)) return groups.find(g => g.id === id)?.label || id
    for (const g of groups) {
      const cat = g.categories.find(c => c.id === id)
      if (cat) return cat.label
    }
    return id
  }

  function getCategoryColor(id) {
    if (isDomainScope(id)) return '#64748b'
    for (const g of groups) {
      const cat = g.categories.find(c => c.id === id)
      if (cat) return cat.dotColor
    }
    return '#64748b'
  }

  function getGroupByCategory(catId) {
    return groups.find(g => g.categories.some(c => c.id === catId))
  }

  return {
    groups, categories, domains,
    getCategoryLabel, getCategoryColor, getGroupByCategory,
    isDomainScope, domainOfScope, categoriesOfDomain
  }
})
