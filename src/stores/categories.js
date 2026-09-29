import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { CATEGORY_GROUPS } from '../../shared/categories.mjs'

export const useCategoriesStore = defineStore('categories', () => {
  // 分类表唯一数据源在 shared/categories.mjs，与本地控制台、线上接口同源。
  // 这里深拷一份：collapsed 是纯 UI 状态，不该写回共享常量。
  const groups = ref(CATEGORY_GROUPS.map(g => ({ ...g, categories: g.categories.map(c => ({ ...c })) })))

  // 向后兼容：扁平化所有分类
  const categories = computed(() => {
    return groups.value.flatMap(g => g.categories)
  })

  function toggleGroup(groupId) {
    const g = groups.value.find(g => g.id === groupId)
    if (g) g.collapsed = !g.collapsed
  }

  function getCategoryLabel(id) {
    for (const g of groups.value) {
      const cat = g.categories.find(c => c.id === id)
      if (cat) return cat.label
    }
    return id
  }

  function getCategoryColor(id) {
    for (const g of groups.value) {
      const cat = g.categories.find(c => c.id === id)
      if (cat) return cat.dotColor
    }
    return '#64748b'
  }

  function getGroupByCategory(catId) {
    return groups.value.find(g => g.categories.some(c => c.id === catId))
  }

  return { groups, categories, toggleGroup, getCategoryLabel, getCategoryColor, getGroupByCategory }
})